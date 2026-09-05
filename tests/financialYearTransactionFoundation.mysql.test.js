const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const test = require("node:test");

const enabled = process.env.REVEX_FY_MYSQL_INTEGRATION === "1";
const DATABASE = "revex_fy2b1_integration";
const loginPath = "revex-dryrun";
const fyMigration = path.join(__dirname, "..", "db", "migrations", "2026-09-05-financial-year-foundation.sql");
const linkMigration = path.join(__dirname, "..", "db", "migrations", "2026-09-05-core-accounting-financial-year-links.sql");

const mysql = (sql, database = null) => new Promise((resolve, reject) => {
  const args = [`--login-path=${loginPath}`, "--batch", "--raw", "--skip-column-names"];
  if (database) args.push(database);
  const child = spawn("mysql", args, { windowsHide: true });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", reject);
  child.on("close", (code) => code === 0
    ? resolve(stdout.trim())
    : reject(Object.assign(new Error(stderr.trim() || `mysql exited with ${code}`), { exitCode: code })));
  child.stdin.end(sql);
});

test("FY-2B.1 migration is idempotent, preserves legacy rows, and enforces company/FY integrity", { skip: !enabled, timeout: 60000 }, async (t) => {
  t.after(async () => mysql(`DROP DATABASE IF EXISTS ${DATABASE};`));
  const tableDefinitions = [
    "invoices (id INT PRIMARY KEY, company_id INT NOT NULL, invoice_date DATE, amount DECIMAL(12,2), status VARCHAR(30))",
    "payments (id INT PRIMARY KEY, company_id INT NOT NULL, payment_date DATE, amount DECIMAL(12,2), status VARCHAR(30))",
    "bills (id INT PRIMARY KEY, company_id INT NOT NULL, bill_date DATE, amount DECIMAL(12,2), status VARCHAR(30))",
    "vendor_payments (id INT PRIMARY KEY, company_id INT NULL, payment_date DATE NULL, amount DECIMAL(12,2), status VARCHAR(30))",
    "ledger_entries (id INT PRIMARY KEY, company_id INT NOT NULL, transaction_date DATE NULL, amount DECIMAL(12,2), status VARCHAR(30))",
    "expenses (id INT PRIMARY KEY, company_id INT NULL, expense_date DATE, amount DECIMAL(12,2), status VARCHAR(30))",
    "journal_entries (id INT PRIMARY KEY, company_id INT NOT NULL, journal_date DATE, amount DECIMAL(12,2), status VARCHAR(30))",
  ];
  await mysql(`
    DROP DATABASE IF EXISTS ${DATABASE};
    CREATE DATABASE ${DATABASE} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    USE ${DATABASE};
    CREATE TABLE companies (id INT PRIMARY KEY, name VARCHAR(100) NOT NULL) ENGINE=InnoDB;
    CREATE TABLE users (id INT PRIMARY KEY, company_id INT NULL, name VARCHAR(100) NOT NULL) ENGINE=InnoDB;
    CREATE TABLE user_company_memberships (user_id INT NOT NULL, company_id INT NOT NULL, is_active TINYINT NOT NULL DEFAULT 1, PRIMARY KEY(user_id,company_id)) ENGINE=InnoDB;
    INSERT INTO companies VALUES (1,'Alpha'),(2,'Beta');
    ${tableDefinitions.map((definition) => `CREATE TABLE ${definition} ENGINE=InnoDB;`).join("\n")}
    ${tableDefinitions.map((definition) => {
      const table = definition.split(" ")[0];
      return `INSERT INTO ${table} VALUES (1,1,'2026-04-01',123.45,'LEGACY');`;
    }).join("\n")}
  `);

  await mysql(await readFile(fyMigration, "utf8"), DATABASE);
  const before = await mysql(`SELECT GROUP_CONCAT(CONCAT(table_name,':',table_rows) ORDER BY table_name) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('invoices','payments','bills','vendor_payments','ledger_entries','expenses','journal_entries');`, DATABASE);
  const migration = await readFile(linkMigration, "utf8");
  await mysql(migration, DATABASE);
  await mysql(migration, DATABASE);

  const columns = await mysql(`SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND column_name='financial_year_id' AND column_type='bigint unsigned' AND is_nullable='YES';`, DATABASE);
  assert.equal(columns, "7");
  const indexes = await mysql(`SELECT COUNT(DISTINCT table_name,index_name) FROM information_schema.statistics WHERE table_schema=DATABASE() AND index_name LIKE 'idx\\_%\\_company\\_fy';`, DATABASE);
  assert.equal(indexes, "7");
  const constraints = await mysql(`SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema=DATABASE() AND constraint_name LIKE 'fk\\_%\\_company\\_fy';`, DATABASE);
  assert.equal(constraints, "7");
  const legacyNulls = await mysql(`SELECT ${tableDefinitions.map((definition) => `(SELECT COUNT(*) FROM ${definition.split(" ")[0]} WHERE financial_year_id IS NULL)`).join("+")};`, DATABASE);
  assert.equal(legacyNulls, "7");
  const after = await mysql(`SELECT GROUP_CONCAT(CONCAT(table_name,':',table_rows) ORDER BY table_name) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('invoices','payments','bills','vendor_payments','ledger_entries','expenses','journal_entries');`, DATABASE);
  assert.equal(after, before);

  await mysql(`INSERT INTO financial_years(company_id,code,start_date,end_date,status,is_default,source) VALUES (1,'FY26','2026-04-01','2027-03-31','LOCKED',0,'TEST'),(2,'FY26','2026-04-01','2027-03-31','DRAFT',0,'TEST');`, DATABASE);
  const fy1 = await mysql("SELECT id FROM financial_years WHERE company_id=1 AND code='FY26';", DATABASE);
  await mysql(`UPDATE invoices SET financial_year_id=${fy1} WHERE id=1 AND company_id=1;`, DATABASE);
  assert.equal(await mysql("SELECT financial_year_id FROM invoices WHERE id=1;", DATABASE), fy1);
  const fy2 = await mysql("SELECT id FROM financial_years WHERE company_id=2 AND code='FY26';", DATABASE);
  await assert.rejects(mysql(`UPDATE invoices SET financial_year_id=${fy2} WHERE id=1 AND company_id=1;`, DATABASE), /foreign key constraint fails/i);
});
