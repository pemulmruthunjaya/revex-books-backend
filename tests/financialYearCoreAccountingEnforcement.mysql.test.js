"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const mysql = require("mysql2/promise");
const {
  requireFinancialYearForMutation,
  requireFinancialYearForPosting,
  transitionFinancialYear,
} = require("../services/financialYearService");

const enabled = process.env.REVEX_FY_MYSQL_INTEGRATION === "1";
const database = `revex_fy4b2c_test_${process.pid}`;
const user = `fy4b2c_${crypto.randomBytes(5).toString("hex")}`;
const password = crypto.randomBytes(24).toString("base64url");
const admin = (sql, dbName = null) => {
  const args = ["--login-path=revex-dryrun"];
  if (dbName) args.push("--database", dbName);
  const result = spawnSync("mysql", args, { input: sql, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || "MYSQL_ADMIN_FAILED");
};

test("core accounting posting and mutation locks serialize with FY transitions", { skip: !enabled, timeout: 60000 }, async (t) => {
  let pool;
  t.after(async () => {
    if (pool) await pool.end();
    admin(`DROP DATABASE IF EXISTS \`${database}\`; DROP USER IF EXISTS '${user}'@'localhost';`);
  });
  admin(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    CREATE USER '${user}'@'localhost' IDENTIFIED BY '${password}';
    GRANT ALL PRIVILEGES ON \`${database}\`.* TO '${user}'@'localhost';`);
  admin(`CREATE TABLE companies(id INT PRIMARY KEY,name VARCHAR(255) NOT NULL) ENGINE=InnoDB;
    CREATE TABLE users(id INT PRIMARY KEY,company_id INT NULL,name VARCHAR(100) NOT NULL) ENGINE=InnoDB;
    CREATE TABLE user_company_memberships(user_id INT,company_id INT,is_active TINYINT NOT NULL DEFAULT 1,PRIMARY KEY(user_id,company_id)) ENGINE=InnoDB;
    INSERT INTO companies VALUES(1,'Alpha'); INSERT INTO users VALUES(1,1,'Owner');
    INSERT INTO user_company_memberships VALUES(1,1,1);`, database);
  admin(fs.readFileSync("db/migrations/2026-09-05-financial-year-foundation.sql", "utf8"), database);
  admin(fs.readFileSync("db/migrations/2026-09-09-financial-year-lifecycle-open-event.sql", "utf8"), database);
  admin(`INSERT INTO financial_years(company_id,code,start_date,end_date,status,source,created_by)
    VALUES(1,'FY26','2026-04-01','2027-03-31','OPEN','TEST',1);
    CREATE TABLE core_rows(id INT AUTO_INCREMENT PRIMARY KEY,company_id INT NOT NULL,financial_year_id BIGINT UNSIGNED NOT NULL,kind VARCHAR(40),amount INT,
      FOREIGN KEY(financial_year_id,company_id) REFERENCES financial_years(id,company_id)) ENGINE=InnoDB;`, database);
  pool = mysql.createPool({ host: "127.0.0.1", port: 3306, user, password, database, connectionLimit: 4, dateStrings: true });
  const [[fy]] = await pool.query("SELECT id FROM financial_years WHERE company_id=1");

  const reopen = async () => {
    const [[row]] = await pool.query("SELECT status FROM financial_years WHERE id=?", [fy.id]);
    if (row.status === "RECONCILIATION") {
      await transitionFinancialYear({ companyId: 1, financialYearId: fy.id, targetStatus: "OPEN", actorUserId: 1, reason: "continue test" }, pool);
    }
  };
  const assertTransitionWaits = async (work) => {
    const connection = await pool.getConnection();
    await connection.beginTransaction();
    await work(connection);
    let finished = false;
    const transition = transitionFinancialYear({ companyId: 1, financialYearId: fy.id, targetStatus: "RECONCILIATION", actorUserId: 1 }, pool)
      .then((result) => { finished = true; return result; });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(finished, false);
    await connection.commit();
    connection.release();
    await transition;
    await reopen();
  };

  for (const kind of ["expense-create", "journal-create", "opening-create"]) {
    await assertTransitionWaits(async (connection) => {
      const year = await requireFinancialYearForPosting(1, "2026-08-12", connection);
      await connection.query("INSERT INTO core_rows(company_id,financial_year_id,kind,amount) VALUES(?,?,?,?)", [1, year.id, kind, 100]);
    });
  }
  for (const kind of ["expense-delete", "journal-delete", "opening-adjustment"]) {
    const [result] = await pool.query("INSERT INTO core_rows(company_id,financial_year_id,kind,amount) VALUES(?,?,?,?)", [1, fy.id, kind, 100]);
    await assertTransitionWaits(async (connection) => {
      const [[row]] = await connection.query("SELECT id,financial_year_id FROM core_rows WHERE id=? AND company_id=1 FOR UPDATE", [result.insertId]);
      await requireFinancialYearForMutation(1, row.financial_year_id, connection);
      await connection.query("UPDATE core_rows SET amount=amount+1 WHERE id=? AND company_id=1", [row.id]);
    });
  }
});
