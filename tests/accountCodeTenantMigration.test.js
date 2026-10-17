"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), crypto = require("node:crypto");
const path = require.resolve("../db/migrations/2026-10-17-account-code-tenant-scope");
const real = require(path);
function fixture() {
  const columns = [["id", "int", "NO", "auto_increment"], ["account_code", "varchar(50)", "YES", ""], ["company_id", "int", "NO", ""]].map(([COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, EXTRA], i) => ({ COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, EXTRA, ORDINAL_POSITION: i + 1, GENERATION_EXPRESSION: "" }));
  const index = (name, cols) => cols.map((COLUMN_NAME, i) => ({ INDEX_NAME: name, COLUMN_NAME, SEQ_IN_INDEX: i + 1, NON_UNIQUE: 0, SUB_PART: null, EXPRESSION: null, INDEX_TYPE: "BTREE", IS_VISIBLE: "YES", COLLATION: "A" }));
  const f = { columns, index, legacy: true, scoped: false, writes: [], invalid: false, dependency: false, loseRow: false, failDDL: false, locked: false, autoIncrement: 10 };
  f.indexes = () => [...index("PRIMARY", ["id"]), ...(f.legacy ? index("account_code", ["account_code"]) : []), ...(f.scoped ? index("uq_accounts_company_code", ["company_id", "account_code"]) : [])];
  f.query = async (sql, args = []) => {
    if (sql.startsWith("LOCK TABLES")) { f.locked = true; f.writes.push(sql); return [{}]; }
    if (sql.includes("information_schema.TABLES")) return [[{ TABLE_NAME: "accounts", TABLE_TYPE: "BASE TABLE", ENGINE: "InnoDB", CREATE_OPTIONS: "", AUTO_INCREMENT: f.autoIncrement, ROW_FORMAT: "Dynamic", TABLE_COMMENT: "preserved comment" }]];
    if (sql.includes("information_schema.COLUMNS")) return [f.columns];
    if (sql.includes("information_schema.STATISTICS")) return [f.indexes()];
    if (sql.includes("KEY_COLUMN_USAGE")) return [f.dependency ? [{ REFERENCED_TABLE_NAME: "accounts", REFERENCED_COLUMN_NAME: "account_code" }] : []];
    if (/information_schema\.(REFERENTIAL_CONSTRAINTS|TABLE_CONSTRAINTS|TRIGGERS)/.test(sql)) return [[]];
    if (sql.includes("WHERE company_id IS NULL")) return [[{ n: f.invalid ? "1" : "0" }]];
    if (sql.includes("duplicate_found")) return [[]];
    if (sql.includes("COUNT(*)")) return [[{ n: "1" }]];
    if (sql.includes("cursor_id")) return [args.length || f.loseRow ? [] : [{ cursor_id: "1", c0: "31", c1: "32303030", c2: "39" }]];
    throw Error("Unexpected fixture SQL");
  };
  f.queryWithWarnings = async sql => { f.writes.push(sql); if (f.failDDL) throw Object.assign(Error(), { errno: 1205 }); f.legacy = false; f.scoped = true; return [{ warningStatus: 0 }, []]; };
  f.cleanup = async sql => { f.writes.push(sql); f.locked = false; };
  return f;
}
function mockedRunner(f) {
  const p = require.resolve("../utils/pinnedMysqlConnection"), prior = require.cache[p];
  require.cache[p] = { id: p, filename: p, loaded: true, exports: { pin: c => { assert.equal(c, f); return c; }, identity: async () => {} } };
  delete require.cache[path]; const runner = require(path); require.cache[p] = prior; delete require.cache[path]; return runner;
}
test("frozen SQL pinned, index-only, no DML or automatic execution", () => {
  const sql = fs.readFileSync(path.replace(/\.js$/, ".sql"), "utf8").replace(/\r\n/g, "\n");
  assert.equal(crypto.createHash("sha256").update(sql).digest("hex"), real.SQL_SHA256);
  assert.equal(real.statements().length, 2); assert.doesNotMatch(real.statements().join("\n"), /INSERT|UPDATE|DELETE|MODIFY|DROP TABLE/i);
});
test("fresh, already-applied and compatible partial preserve every value and remaining schema", async () => {
  for (const [legacy, scoped, classification, ddls] of [[true, false, "MIGRATION_REQUIRED", 1], [true, true, "COMPATIBLE_PARTIAL", 1], [false, true, "ALREADY_APPLIED", 0]]) {
    const f = fixture(); Object.assign(f, { legacy, scoped }); const runner = mockedRunner(f);
    const before = await runner.inspect(f); assert.equal(before.classification, classification);
    const result = await runner.migrate(f, { confirmation: runner.CONFIRMATION, transactionOwnership: "EXCLUSIVE_IDLE_CONNECTION" });
    assert.deepEqual(result.snapshot, before.snapshot); assert.equal(result.after, "ALREADY_APPLIED");
    assert.equal(f.writes.filter(s => /^ALTER/.test(s)).length, ddls); assert.equal(f.locked, false);
    assert.deepEqual((await runner.migrate(f, { confirmation: runner.CONFIRMATION, transactionOwnership: "EXCLUSIVE_IDLE_CONNECTION" })).snapshot, before.snapshot);
  }
});
test("incompatible indexes, nullable tenant, prefix, generated and cross-table dependency reject before lock/DDL", async () => {
  for (const change of [f => { f.columns[2].IS_NULLABLE = "YES"; }, f => { f.columns[1].GENERATION_EXPRESSION = "1"; }, f => { f.legacy = false; }, f => { f.invalid = true; }, f => { f.dependency = true; }, f => { const original = f.indexes; f.indexes = () => original().map(r => ({ ...r, SUB_PART: r.COLUMN_NAME === "account_code" ? 10 : null })); }]) {
    const f = fixture(); change(f); const runner = mockedRunner(f);
    await assert.rejects(runner.migrate(f, { confirmation: runner.CONFIRMATION, transactionOwnership: "EXCLUSIVE_IDLE_CONNECTION" })); assert.deepEqual(f.writes, []);
  }
});
test("independent snapshot count catches omitted rows", async () => {
  const f = fixture(); f.loseRow = true; await assert.rejects(real.inspect(f), { code: "ACCOUNT_COUNT_MISMATCH" });
});
test("functional and generated-alias uniqueness are rejected before lock/DDL", async () => {
  for (const change of [
    f => { const original = f.indexes; f.indexes = () => [...original(), { ...f.index("other_global", [null])[0], EXPRESSION: "upper(account_code)" }]; },
    f => { f.columns.push({ COLUMN_NAME: "code_alias", COLUMN_TYPE: "varchar(50)", GENERATION_EXPRESSION: "account_code", EXTRA: "VIRTUAL GENERATED" }); },
  ]) {
    const f = fixture(); change(f); const r = mockedRunner(f);
    await assert.rejects(r.migrate(f, { confirmation: r.CONFIRMATION, transactionOwnership: "EXCLUSIVE_IDLE_CONNECTION" }), { code: "ACCOUNT_SCHEMA_INCOMPATIBLE" });
    assert.deepEqual(f.writes, []);
  }
});
test("locked revalidation catches schema drift before ALTER and releases the lock", async () => {
  const f = fixture(), original = f.query;
  f.query = async (...args) => { const result = await original(...args); if (args[0].startsWith("LOCK TABLES")) f.columns[2].IS_NULLABLE = "YES"; return result; };
  const r = mockedRunner(f);
  await assert.rejects(r.migrate(f, { confirmation: r.CONFIRMATION, transactionOwnership: "EXCLUSIVE_IDLE_CONNECTION" }), e => e.stage === "LOCKED_PREFLIGHT");
  assert.equal(f.writes.some(s => /^ALTER/.test(s)), false); assert.equal(f.locked, false);
});
test("postflight detects changed next-ID state; warnings and cleanup failure fail closed", async () => {
  for (const mode of ["counter", "warning", "cleanup"]) {
    const f = fixture(), original = f.queryWithWarnings;
    f.queryWithWarnings = async sql => { const result = await original(sql); if (mode === "counter") f.autoIncrement--; if (mode === "warning") return [{ warningStatus: 1 }, [1681]]; return result; };
    if (mode === "cleanup") f.cleanup = async () => { throw Object.assign(Error("sanitized"), { code: "PILOT_CLEANUP_FAILED" }); };
    const r = mockedRunner(f);
    await assert.rejects(r.migrate(f, { confirmation: r.CONFIRMATION, transactionOwnership: "EXCLUSIVE_IDLE_CONNECTION" }), e => mode === "counter" ? e.stage === "POSTFLIGHT" : mode === "warning" ? e.stage === "ALTER_INDEX" && e.warningCodes[0] === 1681 : e.code === "PILOT_CLEANUP_FAILED");
    if (mode !== "cleanup") assert.equal(f.locked, false);
  }
});
test("DDL interruption reports only sanitized stage/code, releases locks and permits explicit inspection", async () => {
  const f = fixture(); f.failDDL = true; const r = mockedRunner(f);
  await assert.rejects(r.migrate(f, { confirmation: r.CONFIRMATION, transactionOwnership: "EXCLUSIVE_IDLE_CONNECTION" }), e => e.stage === "ALTER_INDEX" && e.mysqlCode === 1205);
  assert.equal(f.locked, false); assert.equal((await r.inspect(f)).classification, "MIGRATION_REQUIRED");
});
test("real runner rejects pool/forwarder before SQL", async () => {
  let queries = 0;
  await assert.rejects(real.migrate({ query() { queries++; } }, { confirmation: real.CONFIRMATION, transactionOwnership: "EXCLUSIVE_IDLE_CONNECTION", identity: {} }), { code: "PILOT_PINNED_CONNECTION_REQUIRED" }); assert.equal(queries, 0);
});
test("isolated proof guard rejects public hosts, shared schemas, host 3306 and excessive grants", () => {
  const guard = require("./helpers/accountCodeMysqlGuard");
  const env = { ACCOUNT_MYSQL_PROOF: "DISPOSABLE_LOOPBACK_ONLY", ACCOUNT_MYSQL_HOST: "127.0.0.1", ACCOUNT_MYSQL_PORT: "3407", ACCOUNT_MYSQL_DATABASE: "account_proof_" + "a".repeat(32), ACCOUNT_MYSQL_USER: "account_test_" + "b".repeat(16), ACCOUNT_MYSQL_PASSWORD: "c".repeat(64) };
  const config = guard.target(env);
  for (const [key, value] of [["ACCOUNT_MYSQL_HOST", "mysql.railway.internal"], ["ACCOUNT_MYSQL_PORT", "3306"], ["ACCOUNT_MYSQL_DATABASE", "railway"], ["ACCOUNT_MYSQL_HOST", "127.0.0.1?x"], ["ACCOUNT_MYSQL_DATABASE", env.ACCOUNT_MYSQL_DATABASE + "#x"]]) assert.throws(() => guard.target({ ...env, [key]: value }));
  guard.identity({ version: "9.7.2", port: 3306, db: config.database, user: config.user + "@%" }, config);
  assert.throws(() => guard.identity({ version: "9.7.1", port: 3306, db: config.database, user: config.user + "@%" }, config));
  const who = `\`${config.user}\`@\`%\``;
  const rows = [{ grant: `GRANT USAGE ON *.* TO ${who}` }, { grant: `GRANT ${guard.privileges.join(", ")} ON \`${config.database.replace(/_/g, "\\_")}\`.* TO ${who}` }];
  guard.grants(rows, config);
  assert.throws(() => guard.grants([...rows, { grant: `GRANT SELECT ON *.* TO ${who}` }], config));
});
