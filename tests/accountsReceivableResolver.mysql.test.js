"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolveAccountsReceivable } = require("../services/accountsReceivableResolver");

test("isolated MySQL authoritative AR role contract", { skip: process.env.AR_ROLE_MYSQL_ENABLED !== "1" }, async t => {
  const url = new URL(process.env.AR_ROLE_MYSQL_URL || "invalid:");
  assert.equal(url.protocol, "mysql:"); assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "3407");
  assert.match(url.pathname, /^\/ar_role_proof_[a-f0-9]{32}$/); assert.equal(url.search + url.hash, "");
  assert.ok(url.username && decodeURIComponent(url.username).toLowerCase() !== "root");
  const mysql = require("mysql2/promise");
  const options = { host: url.hostname, port: 3407, user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: url.pathname.slice(1) };
  const cx = await mysql.createConnection(options);
  try {
    const [[identity]] = await cx.query("SELECT VERSION() version,@@port port,DATABASE() db,CURRENT_USER() user");
    assert.equal(identity.version, "9.7.2"); assert.equal(Number(identity.port), 3306); assert.equal(identity.db, options.database);
    assert.ok(identity.user.startsWith(options.user + "@"));
    const [grants] = await cx.query("SHOW GRANTS");
    const expected = ["SELECT", "INSERT", "UPDATE", "DELETE", "CREATE", "REFERENCES", "INDEX", "ALTER", "TRIGGER"].sort();
    let scoped = 0;
    for (const row of grants) {
      const grant = Object.values(row)[0];
      if (/^GRANT USAGE ON \*\.\* TO /.test(grant)) continue;
      const match = /^GRANT (.+) ON `([^`]+)`\.\* TO /.exec(grant);
      assert.ok(match && !grant.includes("WITH GRANT OPTION")); assert.equal(match[2], options.database);
      assert.deepEqual(match[1].split(", ").sort(), expected); scoped++;
    }
    assert.equal(scoped, 1);
    const [[empty]] = await cx.query("SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()");
    assert.equal(Number(empty.n), 0);
    // Synthetic prerequisites only; the reviewed annual migration is executed solely in this disposable database.
    const { Schema } = require("./helpers/annualMigrationSchemaFixture");
    const base = new Schema();
    for (const [table, clauses] of base.tables) await cx.query(`CREATE TABLE \`${table}\` (${clauses.join(",")}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${base.tableCollations.get(table) || "utf8mb4_bin"}`);
    await require("../db/migrations/2026-10-04-annual-subledger-carry-forward").migrate(cx, { confirmation: "APPLY_ANNUAL_CARRY_FORWARD_V1" });
    await cx.query("CREATE TABLE companies(id INT PRIMARY KEY) ENGINE=InnoDB");
    await cx.query("CREATE TABLE financial_years(id BIGINT UNSIGNED PRIMARY KEY,company_id INT NOT NULL,start_date DATE NOT NULL,end_date DATE NOT NULL,UNIQUE KEY tenant(id,company_id)) ENGINE=InnoDB");
    await cx.query("CREATE TABLE accounts(id INT PRIMARY KEY,company_id INT NOT NULL,account_code VARCHAR(30),account_name VARCHAR(100),account_type VARCHAR(30),status INT,UNIQUE KEY tenant(id,company_id)) ENGINE=InnoDB");
    await cx.query("CREATE TABLE iv_operations(id INT PRIMARY KEY,company_id INT NOT NULL,action VARCHAR(30),result JSON) ENGINE=InnoDB");
    const sql = readFileSync(require.resolve("../db/migrations/2026-09-12-financial-year-close-foundation.sql"), "utf8");
    const roleDDL = sql.match(/CREATE TABLE IF NOT EXISTS system_account_role_assignments \([\s\S]*?;/)[0];
    await cx.query(roleDDL);
    await cx.query("INSERT INTO companies VALUES (9),(10)");
    await cx.query("INSERT INTO financial_years VALUES (14,9,'2025-04-01','2026-03-31'),(15,9,'2026-04-01','2027-03-31'),(16,9,'2027-04-01','2028-03-31')");
    await cx.query("INSERT INTO users(id,company_id,financial_year_id) VALUES (19,9,15)");
    await cx.query("INSERT INTO accounts VALUES (30,9,'1100','Inventory','ASSET',1),(32,9,'1300','Accounts Receivable','ASSET',1),(33,9,'1301','Synthetic alternative','ASSET',1)");
    await cx.query("INSERT INTO iv_operations VALUES (1,9,'GL_ROLE',JSON_OBJECT('role','INVENTORY','account_id',30))");
    await cx.query("INSERT INTO system_account_role_assignments(company_id,role,account_id,effective_from_financial_year_id,created_by) VALUES (9,'ACCOUNTS_RECEIVABLE',32,15,19)");
    const snapshot = async () => JSON.stringify((await cx.query("SELECT * FROM system_account_role_assignments ORDER BY id"))[0]);
    const before = await snapshot();
    await t.test("Company 9 selects 1300, not lower-ID Inventory; cross-tenant scope denied", async () => {
      await cx.beginTransaction();
      try { assert.equal(Number((await resolveAccountsReceivable(cx, 9, 15)).id), 32); await assert.rejects(resolveAccountsReceivable(cx, 10, 15), { code: "AR_ROLE_SCOPE_INVALID" }); }
      finally { await cx.rollback(); }
    });
    await t.test("missing, future, expired, overlapping and incompatible mappings fail and rollback", async () => {
      const cases = [
        ["DELETE FROM system_account_role_assignments", "AR_ROLE_MAPPING_REQUIRED"],
        ["UPDATE system_account_role_assignments SET effective_from_financial_year_id=16", "AR_ROLE_MAPPING_REQUIRED"],
        ["UPDATE system_account_role_assignments SET effective_from_financial_year_id=14,effective_to_financial_year_id=14", "AR_ROLE_MAPPING_REQUIRED"],
        ["UPDATE accounts SET status=0 WHERE id=32", "AR_ROLE_ACCOUNT_INCOMPATIBLE"],
        ["UPDATE accounts SET account_type='LIABILITY' WHERE id=32", "AR_ROLE_ACCOUNT_INCOMPATIBLE"],
        ["UPDATE system_account_role_assignments SET account_id=30", "AR_ROLE_ACCOUNT_INCOMPATIBLE"],
      ];
      for (const [change, code] of cases) {
        await cx.beginTransaction();
        try { await cx.query(change); await assert.rejects(resolveAccountsReceivable(cx, 9, 15), { code }); }
        finally { await cx.rollback(); }
        assert.equal(await snapshot(), before);
        assert.equal(Number((await resolveAccountsReceivable(cx, 9, 15)).id), 32);
      }
      await cx.beginTransaction();
      try {
        await cx.query("UPDATE system_account_role_assignments SET effective_to_financial_year_id=16");
        await cx.query("INSERT INTO system_account_role_assignments(company_id,role,account_id,effective_from_financial_year_id,effective_to_financial_year_id,created_by) VALUES (9,'ACCOUNTS_RECEIVABLE',33,15,16,19)");
        await assert.rejects(resolveAccountsReceivable(cx, 9, 15), { code: "AR_ROLE_MAPPING_AMBIGUOUS" });
      } finally { await cx.rollback(); }
      assert.equal(await snapshot(), before);
    });
    await t.test("resolution holds account metadata stable until transaction ends", async () => {
      const other = await mysql.createConnection(options);
      try {
        await cx.beginTransaction(); await resolveAccountsReceivable(cx, 9, 15);
        await other.beginTransaction(); await other.query("SET SESSION innodb_lock_wait_timeout=1");
        await assert.rejects(other.query("UPDATE accounts SET status=0 WHERE id=32"), { code: "ER_LOCK_WAIT_TIMEOUT" });
      } finally { await other.rollback(); await other.end(); await cx.rollback(); }
      assert.equal(await snapshot(), before);
    });
  } finally { await cx.end(); }
});
