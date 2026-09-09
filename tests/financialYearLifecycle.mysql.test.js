"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const mysql = require("mysql2/promise");
const { requireFinancialYearForMutation, requireFinancialYearForPosting, transitionFinancialYear } = require("../services/financialYearService");

const enabled = process.env.REVEX_FY_MYSQL_INTEGRATION === "1";
const database = `revex_fy3_test_fy4b1_${process.pid}`;
const user = `fy4b1_${crypto.randomBytes(5).toString("hex")}`;
const password = crypto.randomBytes(24).toString("base64url");
const admin = (sql, dbName = null) => {
  const args = ["--login-path=revex-dryrun"];
  if (dbName) args.push("--database", dbName);
  const result = spawnSync("mysql", args, { input: sql, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "MYSQL_ADMIN_FAILED");
};

test("FY lifecycle is atomic, tenant scoped, append-only, and concurrency safe", { skip: !enabled, timeout: 60000 }, async (t) => {
  let pool;
  t.after(async () => {
    if (pool) await pool.end();
    admin(`DROP DATABASE IF EXISTS \`${database}\`; DROP USER IF EXISTS '${user}'@'localhost';`);
  });
  admin(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    CREATE USER '${user}'@'localhost' IDENTIFIED BY '${password}';
    GRANT ALL PRIVILEGES ON \`${database}\`.* TO '${user}'@'localhost';`);
  admin(`CREATE TABLE companies(id INT PRIMARY KEY,name VARCHAR(255) NOT NULL) ENGINE=InnoDB;
    CREATE TABLE users(id INT PRIMARY KEY,company_id INT NULL,name VARCHAR(100) NOT NULL,FOREIGN KEY(company_id) REFERENCES companies(id)) ENGINE=InnoDB;
    CREATE TABLE user_company_memberships(user_id INT,company_id INT,is_active TINYINT NOT NULL DEFAULT 1,PRIMARY KEY(user_id,company_id),FOREIGN KEY(user_id) REFERENCES users(id),FOREIGN KEY(company_id) REFERENCES companies(id)) ENGINE=InnoDB;
    INSERT INTO companies VALUES(1,'Alpha'),(2,'Beta'); INSERT INTO users VALUES(1,1,'Owner A'),(2,2,'Owner B'); INSERT INTO user_company_memberships VALUES(1,1,1),(2,2,1);`, database);
  admin(fs.readFileSync("db/migrations/2026-09-05-financial-year-foundation.sql", "utf8"), database);
  admin(fs.readFileSync("db/migrations/2026-09-09-financial-year-lifecycle-open-event.sql", "utf8"), database);
  admin(fs.readFileSync("db/migrations/2026-09-09-financial-year-lifecycle-open-event.sql", "utf8"), database);
  admin(`INSERT INTO financial_years(company_id,code,start_date,end_date,status,source,created_by) VALUES
    (1,'FY26','2026-04-01','2027-03-31','DRAFT','TEST',1),
    (1,'FY25','2025-04-01','2026-03-31','CLOSED','TEST',1),
    (2,'FY26','2026-04-01','2027-03-31','OPEN','TEST',2);`, database);
  pool = mysql.createPool({host:"127.0.0.1",port:3306,user,password,database,connectionLimit:4,dateStrings:true});

  const [[draft]] = await pool.query("SELECT id FROM financial_years WHERE company_id=1 AND code='FY26'");
  const concurrent = await Promise.all([
    transitionFinancialYear({companyId:1,financialYearId:draft.id,targetStatus:"OPEN",actorUserId:1},pool),
    transitionFinancialYear({companyId:1,financialYearId:draft.id,targetStatus:"OPEN",actorUserId:1},pool),
  ]);
  assert.equal(concurrent.filter((result) => result.changed).length, 1);
  const [[opened]] = await pool.query("SELECT status FROM financial_years WHERE id=?",[draft.id]);
  const [[openEvents]] = await pool.query("SELECT COUNT(*) n FROM financial_year_events WHERE financial_year_id=? AND event_type='OPEN'",[draft.id]);
  assert.equal(opened.status,"OPEN"); assert.equal(Number(openEvents.n),1);

  admin(`CREATE TABLE invoices(id INT PRIMARY KEY,company_id INT NOT NULL,financial_year_id BIGINT UNSIGNED NOT NULL,status VARCHAR(20) NOT NULL,
    CONSTRAINT fk_test_invoice_fy FOREIGN KEY(financial_year_id,company_id) REFERENCES financial_years(id,company_id)) ENGINE=InnoDB;
    INSERT INTO invoices VALUES(57,1,${draft.id},'pending');`, database);
  const mutation = await pool.getConnection();
  await mutation.beginTransaction();
  const [[invoice]] = await mutation.query("SELECT id,financial_year_id FROM invoices WHERE id=57 AND company_id=1 FOR UPDATE");
  await requireFinancialYearForMutation(1, invoice.financial_year_id, mutation);
  await mutation.query("UPDATE invoices SET status='approved' WHERE id=57 AND company_id=1");
  let transitionFinished = false;
  const racingTransition = transitionFinancialYear({companyId:1,financialYearId:draft.id,targetStatus:"RECONCILIATION",actorUserId:1},pool)
    .then((result) => { transitionFinished = true; return result; });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(transitionFinished, false);
  await mutation.commit();
  mutation.release();
  await racingTransition;
  await transitionFinancialYear({companyId:1,financialYearId:draft.id,targetStatus:"OPEN",actorUserId:1,reason:"continue posting"},pool);

  admin("CREATE TABLE payments(id INT AUTO_INCREMENT PRIMARY KEY,company_id INT NOT NULL,financial_year_id BIGINT UNSIGNED NOT NULL,payment_date DATE NOT NULL,amount DECIMAL(10,2) NOT NULL) ENGINE=InnoDB", database);
  for (const amount of [10, 20]) {
    const posting = await pool.getConnection();
    await posting.beginTransaction();
    const postingYear = await requireFinancialYearForPosting(1, "2026-08-12", posting);
    await posting.query("INSERT INTO payments(company_id,financial_year_id,payment_date,amount) VALUES(?,?,?,?)", [1, postingYear.id, "2026-08-12", amount]);
    let postingTransitionFinished = false;
    const postingRace = transitionFinancialYear({companyId:1,financialYearId:draft.id,targetStatus:"RECONCILIATION",actorUserId:1},pool)
      .then((result) => { postingTransitionFinished = true; return result; });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(postingTransitionFinished, false);
    await posting.commit();
    posting.release();
    await postingRace;
    await transitionFinancialYear({companyId:1,financialYearId:draft.id,targetStatus:"OPEN",actorUserId:1,reason:"next posting"},pool);
  }

  const [[closed]] = await pool.query("SELECT id FROM financial_years WHERE company_id=1 AND code='FY25'");
  await transitionFinancialYear({companyId:1,financialYearId:closed.id,targetStatus:"LOCKED",actorUserId:1,reason:"archive complete",confirmation:"LOCK"},pool);
  await assert.rejects(transitionFinancialYear({companyId:1,financialYearId:closed.id,targetStatus:"OPEN",actorUserId:1,reason:"no"},pool),{code:"FINANCIAL_YEAR_TRANSITION_NOT_ALLOWED"});
  await assert.rejects(transitionFinancialYear({companyId:2,financialYearId:closed.id,targetStatus:"LOCKED",actorUserId:2,reason:"x",confirmation:"LOCK"},pool),{code:"FINANCIAL_YEAR_NOT_FOUND"});

  await assert.rejects(pool.query("UPDATE financial_year_events SET reason='changed' WHERE financial_year_id=?",[draft.id]),/append-only/i);
  await assert.rejects(pool.query("DELETE FROM financial_year_events WHERE financial_year_id=?",[draft.id]),/append-only/i);

  await transitionFinancialYear({companyId:1,financialYearId:draft.id,targetStatus:"RECONCILIATION",actorUserId:1},pool);
  admin("CREATE TRIGGER fail_lifecycle_event BEFORE INSERT ON financial_year_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced event failure'",database);
  await assert.rejects(transitionFinancialYear({companyId:1,financialYearId:draft.id,targetStatus:"OPEN",actorUserId:1,reason:"FAIL_EVENT"},pool),/forced event failure/i);
  const [[stillRecon]] = await pool.query("SELECT status FROM financial_years WHERE id=?",[draft.id]);
  assert.equal(stillRecon.status,"RECONCILIATION");
});
