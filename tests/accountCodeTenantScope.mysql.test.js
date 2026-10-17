"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const migration = require("../db/migrations/2026-10-17-account-code-tenant-scope"), guard = require("./helpers/accountCodeMysqlGuard");
const { requiredCase } = require("./helpers/requiredMysqlCase");
test("isolated account-code tenant migration and atomic opening workflows", { skip: process.env.ACCOUNT_MYSQL_PROOF !== "DISPOSABLE_LOOPBACK_ONLY" }, async t => {
  const config = guard.target(process.env), mysql = require("mysql2/promise"), cx = await mysql.createConnection(config);
  let pool, restore, other;
  try {
    const [[id]] = await cx.query("SELECT VERSION() version,@@port port,DATABASE() db,CURRENT_USER() user,@@hostname hostname");
    guard.identity(id, config); guard.grants((await cx.query("SHOW GRANTS"))[0], config);
    const [[empty]] = await cx.query("SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()"); assert.equal(Number(empty.n), 0);
    const options = { confirmation: migration.CONFIRMATION, transactionOwnership: "EXCLUSIVE_IDLE_CONNECTION", identity: { host: config.host, port: config.port, database: config.database, hostname: id.hostname, version: "9.7.2", serverPort: 3306 } };
    other = await mysql.createConnection(config);
    await other.query("SET SESSION lock_wait_timeout=1");
    const observeAfterDDL = async (hook, work) => {
      const prototype = require("mysql2").Connection.prototype, original = prototype.query;
      prototype.query = function(sql, args, done) {
        if (this !== cx.connection || !/^ALTER TABLE accounts/.test(sql)) return original.call(this, sql, args, done);
        return original.call(this, sql, args, (error, rows, fields) => {
          if (error) return done(error);
          Promise.resolve().then(hook).then(() => done(null, rows, fields), done);
        });
      };
      try { return await work(); } finally { prototype.query = original; }
    };
    const schema = fs.readFileSync(path.join(__dirname, "fixtures/runtime-schema.sql"), "utf8");
    for (const name of ["accounts", "financial_years", "journal_entries", "journal_entry_details"]) {
      const line = schema.split(/\r?\n/).find(s => s.startsWith(`CREATE TABLE ${name} (`)); assert.ok(line); await cx.query(line);
    }
    await cx.query(fs.readFileSync(path.join(__dirname, "../db/migrations/2026-08-02-opening-balance-equity.sql"), "utf8").replace(/^--.*\n/gm, ""));
    await cx.query("ALTER TABLE accounts ADD CONSTRAINT account_parent FOREIGN KEY(parent_account_id) REFERENCES accounts(id)");
    for (let i = 0; i < 502; i++) await cx.query("INSERT INTO accounts(account_code,account_name,account_type,company_id,description,opening_balance) VALUES (?,?,'LIABILITY',1,?,?)", [`S${i}`, `Synthetic ${i}`, i % 2 ? null : "UTF8 evidence Ω", i % 2 ? "123.45" : "0.00"]);
    await cx.query("ALTER TABLE accounts AUTO_INCREMENT=9000, COMMENT='Synthetic preserved metadata'");
    const snapshot = (await migration.inspect(cx)).snapshot;
    if (!await requiredCase(t, "fresh atomic index swap preserves 502 paginated rows and schema; rerun is inert", async () => {
      const before = await migration.inspect(cx); assert.equal(before.classification, "MIGRATION_REQUIRED");
      const result = await observeAfterDDL(async () => {
        await assert.rejects(other.query("INSERT INTO accounts(account_code,account_name,account_type,company_id) VALUES ('LOCK-PROBE','Synthetic','ASSET',9)"), { code: "ER_LOCK_WAIT_TIMEOUT" });
      }, () => migration.migrate(cx, options)); assert.deepEqual(result.snapshot, snapshot);
      assert.equal((await migration.inspect(cx)).schemaFingerprint, before.schemaFingerprint);
      assert.match((await cx.query("SHOW CREATE TABLE accounts"))[0][0]["Create Table"], /AUTO_INCREMENT=9000/);
      assert.equal((await migration.migrate(cx, options)).before, "ALREADY_APPLIED");
    })) return;
    if (!await requiredCase(t, "functional/generated alternate global keys reject before any DDL", async () => {
      await cx.query("CREATE UNIQUE INDEX alternate_global ON accounts ((UPPER(account_code)))");
      let before = (await cx.query("SHOW CREATE TABLE accounts"))[0];
      await assert.rejects(migration.migrate(cx, options), { code: "ACCOUNT_SCHEMA_INCOMPATIBLE" });
      assert.deepEqual((await cx.query("SHOW CREATE TABLE accounts"))[0], before);
      await cx.query("ALTER TABLE accounts DROP INDEX alternate_global, ADD code_alias VARCHAR(50) GENERATED ALWAYS AS (account_code) VIRTUAL, ADD UNIQUE KEY alias_global(code_alias)");
      before = (await cx.query("SHOW CREATE TABLE accounts"))[0];
      await assert.rejects(migration.migrate(cx, options), { code: "ACCOUNT_SCHEMA_INCOMPATIBLE" });
      assert.deepEqual((await cx.query("SHOW CREATE TABLE accounts"))[0], before);
      await cx.query("ALTER TABLE accounts DROP INDEX alias_global, DROP COLUMN code_alias");
    })) return;
    if (!await requiredCase(t, "post-ALTER interruption releases locks; separately inspected applied state resumes without rewriting", async () => {
      await cx.query("ALTER TABLE accounts ADD UNIQUE INDEX account_code(account_code)");
      const before = await migration.inspect(cx);
      await assert.rejects(observeAfterDDL(() => { throw Error("synthetic lost acknowledgement"); }, () => migration.migrate(cx, options)), e => e.code === "ACCOUNT_MIGRATION_STOPPED_REQUIRES_INSPECTION" && e.stage === "ALTER_INDEX");
      // An independent connection can now take the lock, proving cleanup.
      await other.query("LOCK TABLES accounts WRITE"); await other.query("UNLOCK TABLES");
      const after = await migration.inspect(cx); assert.equal(after.classification, "ALREADY_APPLIED");
      assert.deepEqual(after.snapshot, before.snapshot); assert.equal(after.schemaFingerprint, before.schemaFingerprint);
      assert.equal((await migration.migrate(cx, options)).before, "ALREADY_APPLIED");
    })) return;
    if (!await requiredCase(t, "compatible partial resumes; malformed tenant index rejects without DDL", async () => {
      await cx.query("ALTER TABLE accounts ADD UNIQUE INDEX account_code(account_code)");
      assert.equal((await migration.inspect(cx)).classification, "COMPATIBLE_PARTIAL");
      assert.deepEqual((await migration.migrate(cx, options)).snapshot, snapshot);
      await cx.query("ALTER TABLE accounts ADD UNIQUE INDEX account_code(account_code), DROP INDEX uq_accounts_company_code, ADD UNIQUE INDEX uq_accounts_company_code(account_code,company_id)");
      const [before] = await cx.query("SHOW CREATE TABLE accounts");
      await assert.rejects(migration.migrate(cx, options), { code: "ACCOUNT_SCHEMA_INCOMPATIBLE" });
      assert.deepEqual((await cx.query("SHOW CREATE TABLE accounts"))[0], before);
      await cx.query("ALTER TABLE accounts DROP INDEX uq_accounts_company_code, ADD UNIQUE INDEX uq_accounts_company_code(company_id,account_code)");
      await migration.migrate(cx, options);
    })) return;
    pool = mysql.createPool(config);
    const db = require("../db/connection"), original = db.getConnection;
    db.getConnection = pool.getConnection.bind(pool); restore = () => { db.getConnection = original; };
    const controller = require("../controllers/accountController");
    async function request(method, company, code, amount = 0, accountId) {
      let result;
      await controller[method]({ user: { company_id: company }, params: { id: accountId }, body: { account_code: code, account_name: "Synthetic Payable", account_type: "LIABILITY", opening_balance: amount } }, { status(status) { return { json(body) { result = { status, body }; } }; } });
      return result;
    }
    const counts = async () => {
      const out = {};
      for (const table of ["accounts", "opening_balance_events", "journal_entries", "journal_entry_details"]) out[table] = (await cx.query(`SELECT CAST(COUNT(*) AS CHAR) n FROM ${table}`))[0][0].n;
      return out;
    };
    if (!await requiredCase(t, "cross-tenant same code, same-tenant duplicates/retries and NULL zero openings", async () => {
      for (const company of [1, 9]) assert.equal((await request("createAccount", company, "2000")).status, 201);
      const before = await counts();
      for (let i = 0; i < 2; i++) assert.equal((await request("createAccount", 9, "2000")).body.code, "ACCOUNT_CODE_ALREADY_EXISTS");
      assert.deepEqual(await counts(), before); assert.equal(before.opening_balance_events, "0");
      for (let i = 0; i < 2; i++) assert.equal((await request("createAccount", 9, null)).status, 201);
    })) return;
    await cx.query("INSERT INTO financial_years(company_id,code,start_date,end_date,status) VALUES (1,'SYN',DATE_SUB(CURDATE(),INTERVAL 1 YEAR),DATE_ADD(CURDATE(),INTERVAL 1 YEAR),'OPEN'),(9,'SYN',DATE_SUB(CURDATE(),INTERVAL 1 YEAR),DATE_ADD(CURDATE(),INTERVAL 1 YEAR),'OPEN')");
    if (!await requiredCase(t, "nonzero openings balanced and tenant-scoped, repeated account creation cannot double-post", async () => {
      for (const company of [1, 9]) assert.equal((await request("createAccount", company, "2100", 100)).status, 201);
      const before = await counts(); assert.equal(before.opening_balance_events, "2");
      assert.equal((await request("createAccount", 9, "2100", 100)).status, 409); assert.deepEqual(await counts(), before);
      const [journals] = await cx.query("SELECT company_id,total_debit,total_credit FROM journal_entries ORDER BY company_id");
      assert.deepEqual(journals.map(j => [j.company_id, j.total_debit, j.total_credit]), [[1, "100.00", "100.00"], [9, "100.00", "100.00"]]);
      const [events] = await cx.query("SELECT company_id,entity_type,entity_id,sequence_no FROM opening_balance_events ORDER BY company_id");
      assert.ok(events.every(e => Number(e.sequence_no) === 1));
      const a = events[0];
      await assert.rejects(cx.query("INSERT INTO opening_balance_events(company_id,entity_type,entity_id,sequence_no,event_kind,signed_delta,target_account_id) VALUES (?,?,?,?,'initial',1,?)", [a.company_id, a.entity_type, a.entity_id, a.sequence_no, a.entity_id]), { code: "ER_DUP_ENTRY" });
      await cx.beginTransaction();
      await cx.query("INSERT INTO opening_balance_events(company_id,entity_type,entity_id,sequence_no,event_kind,signed_delta,target_account_id) VALUES (9,?,?,?,'initial',1,?)", [a.entity_type, a.entity_id, a.sequence_no, a.entity_id]);
      await cx.rollback(); assert.deepEqual(await counts(), before);
    })) return;
    if (!await requiredCase(t, "failed opening journal and conflicting edit rollback all tables; repeat update posts no extra event", async () => {
      await cx.query("CREATE TRIGGER synthetic_fail BEFORE INSERT ON journal_entry_details FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic rollback'");
      const before = await counts(); assert.equal((await request("createAccount", 9, "2200", 25)).status, 500); assert.deepEqual(await counts(), before);
      await cx.query("DROP TRIGGER synthetic_fail");
      const created = await request("createAccount", 9, "2200"); assert.equal(created.status, 201);
      const stable = await counts();
      assert.equal((await request("updateAccount", 9, "2000", 25, created.body.account_id)).status, 409); assert.deepEqual(await counts(), stable);
      assert.equal((await request("updateAccount", 9, "2200", 25, created.body.account_id)).status, 200);
      const updated = await counts(); assert.equal((await request("updateAccount", 9, "2200", 25, created.body.account_id)).status, 200); assert.deepEqual(await counts(), updated);
      assert.equal((await cx.query("SELECT opening_balance FROM accounts WHERE id=?", [created.body.account_id]))[0][0].opening_balance, "25.00");
    })) return;
    if (!await requiredCase(t, "concurrent same-company creates yield one winner; cross-company codes stay independent", async () => {
      const responses = await Promise.all([request("createAccount", 9, "2300"), request("createAccount", 9, "2300")]);
      assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
      assert.equal((await request("createAccount", 1, "2300")).status, 201);
      assert.equal((await migration.migrate(cx, options)).after, "ALREADY_APPLIED");
    })) return;
  } finally { if (restore) restore(); if (pool) await pool.end(); if (other) await other.end(); await cx.end(); }
});
