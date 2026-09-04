const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const enabled = process.env.REVEX_FY_MYSQL_INTEGRATION === "1";
const DATABASE = "revex_fy1a_integration";
const LOGIN_PATH = "revex-dryrun";
const migrationPath = path.join(__dirname, "..", "db", "migrations", "2026-09-05-financial-year-foundation.sql");

const mysql = (sql, database = null) => new Promise((resolve, reject) => {
  const args = [`--login-path=${LOGIN_PATH}`, "--batch", "--raw", "--skip-column-names"];
  if (database) args.push(database);
  const child = spawn("mysql", args, { windowsHide: true });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", reject);
  child.on("close", (code) => {
    if (code === 0) return resolve(stdout.trim());
    const error = new Error(stderr.trim() || `mysql exited with ${code}`);
    error.exitCode = code;
    reject(error);
  });
  child.stdin.end(sql);
});

const expectSqlFailure = async (sql, pattern) => {
  await assert.rejects(mysql(sql, DATABASE), pattern);
};

test("FY schema, invariants, idempotency, and concurrency on real MySQL", { skip: !enabled, timeout: 60000 }, async (t) => {
  await mysql(`
    DROP DATABASE IF EXISTS ${DATABASE};
    CREATE DATABASE ${DATABASE} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    USE ${DATABASE};
    CREATE TABLE companies (
      id INT NOT NULL AUTO_INCREMENT,
      name VARCHAR(255) NOT NULL,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB;
    CREATE TABLE users (
      id INT NOT NULL AUTO_INCREMENT,
      company_id INT NULL,
      name VARCHAR(100) NOT NULL,
      PRIMARY KEY (id),
      FOREIGN KEY (company_id) REFERENCES companies(id)
    ) ENGINE=InnoDB;
    CREATE TABLE user_company_memberships (
      user_id INT NOT NULL,
      company_id INT NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      PRIMARY KEY (user_id, company_id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (company_id) REFERENCES companies(id)
    ) ENGINE=InnoDB;
    INSERT INTO companies (id,name) VALUES (1,'Alpha'),(2,'Beta');
    INSERT INTO users (id,company_id,name) VALUES (1,1,'Owner A'),(2,2,'Owner B');
    INSERT INTO user_company_memberships VALUES (1,1,1),(2,2,1);
  `);
  t.after(async () => mysql(`DROP DATABASE IF EXISTS ${DATABASE};`));

  const migration = await readFile(migrationPath, "utf8");
  await mysql(migration, DATABASE);
  await mysql(migration, DATABASE);

  assert.equal(await mysql(`SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='${DATABASE}' AND TABLE_NAME IN ('financial_years','financial_year_events')`), "2");
  assert.equal(await mysql(`SELECT COUNT(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA='${DATABASE}' AND TRIGGER_NAME LIKE 'trg_financial_year%'`), "4");
  assert.equal(await mysql("SELECT COUNT(*) FROM financial_years", DATABASE), "0");

  await mysql(`
    INSERT INTO financial_years
      (company_id,code,name,start_date,end_date,status,is_default,source,created_by)
    VALUES
      (1,'FY25','FY 2025-26','2025-04-01','2026-03-31','DRAFT',0,'TEST',1),
      (1,'FY26','FY 2026-27','2026-04-01','2027-03-31','OPEN',1,'TEST',1),
      (2,'FY26','FY 2026-27','2026-04-01','2027-03-31','RECONCILIATION',1,'TEST',2);
  `, DATABASE);

  assert.equal(await mysql("SELECT COUNT(*) FROM financial_years WHERE company_id=1 AND is_default=1", DATABASE), "1");
  assert.equal(await mysql("SELECT status FROM financial_years WHERE company_id=1 AND '2026-04-01' BETWEEN start_date AND end_date", DATABASE), "OPEN");
  assert.equal(await mysql("SELECT status FROM financial_years WHERE company_id=1 AND '2027-03-31' BETWEEN start_date AND end_date", DATABASE), "OPEN");
  assert.equal(await mysql("SELECT COUNT(*) FROM financial_years WHERE company_id=1 AND '2028-01-01' BETWEEN start_date AND end_date", DATABASE), "0");

  await expectSqlFailure(
    "INSERT INTO financial_years(company_id,code,start_date,end_date) VALUES(1,'BAD','2027-04-01','2027-03-31')",
    /Check constraint|chk_financial_years_dates/i
  );
  await expectSqlFailure(
    "INSERT INTO financial_years(company_id,code,start_date,end_date) VALUES(1,'FY26','2027-04-01','2028-03-31')",
    /Duplicate entry|uq_financial_years_company_code/i
  );
  await expectSqlFailure(
    "INSERT INTO financial_years(company_id,code,start_date,end_date) VALUES(1,'DUP','2026-04-01','2027-03-31')",
    /overlap|Duplicate entry/i
  );
  for (const [code, start, end] of [
    ["START", "2026-06-01", "2027-06-01"],
    ["END", "2025-06-01", "2026-06-01"],
    ["CONTAINS", "2024-01-01", "2028-01-01"],
    ["CONTAINED", "2026-06-01", "2026-09-01"],
  ]) {
    await expectSqlFailure(
      `INSERT INTO financial_years(company_id,code,start_date,end_date) VALUES(1,'${code}','${start}','${end}')`,
      /overlap/i
    );
  }

  await mysql("INSERT INTO financial_years(company_id,code,start_date,end_date,status) VALUES(1,'FY27','2027-04-01','2028-03-31','CLOSING')", DATABASE);
  await expectSqlFailure(
    "UPDATE financial_years SET is_default=1 WHERE company_id=1 AND code='FY25'",
    /Duplicate entry|uq_financial_years_one_default/i
  );
  await expectSqlFailure(
    "INSERT INTO financial_years(company_id,code,start_date,end_date) VALUES(999,'NOCO','2030-01-01','2030-12-31')",
    /foreign key constraint/i
  );

  const concurrentOverlap = await Promise.allSettled([
    mysql("INSERT INTO financial_years(company_id,code,start_date,end_date) VALUES(1,'RACE-A','2028-04-01','2029-03-31')", DATABASE),
    mysql("INSERT INTO financial_years(company_id,code,start_date,end_date) VALUES(1,'RACE-B','2028-06-01','2029-05-31')", DATABASE),
  ]);
  assert.equal(concurrentOverlap.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(await mysql("SELECT COUNT(*) FROM financial_years WHERE company_id=1 AND code IN ('RACE-A','RACE-B')", DATABASE), "1");

  await mysql("UPDATE financial_years SET is_default=0 WHERE company_id=1", DATABASE);
  const concurrentDefaults = await Promise.allSettled([
    mysql("UPDATE financial_years SET is_default=1 WHERE company_id=1 AND code='FY25'", DATABASE),
    mysql("UPDATE financial_years SET is_default=1 WHERE company_id=1 AND code='FY26'", DATABASE),
  ]);
  assert.equal(concurrentDefaults.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(await mysql("SELECT COUNT(*) FROM financial_years WHERE company_id=1 AND is_default=1", DATABASE), "1");

  const fyId = await mysql("SELECT id FROM financial_years WHERE company_id=1 AND code='FY26'", DATABASE);
  await mysql(`INSERT INTO financial_year_events
    (company_id,financial_year_id,event_type,new_status,actor_user_id,metadata)
    VALUES(1,${fyId},'CREATE','OPEN',1,JSON_OBJECT('source','TEST'))`, DATABASE);
  await expectSqlFailure(`UPDATE financial_year_events SET reason='changed' WHERE financial_year_id=${fyId}`, /append-only/i);
  await expectSqlFailure(`DELETE FROM financial_year_events WHERE financial_year_id=${fyId}`, /append-only/i);
  await expectSqlFailure(`INSERT INTO financial_year_events(company_id,financial_year_id,event_type) VALUES(2,${fyId},'CREATE')`, /foreign key constraint/i);
});
