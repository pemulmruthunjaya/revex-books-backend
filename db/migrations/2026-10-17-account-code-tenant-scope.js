"use strict";
// Import-inert; no connection creation, CLI, startup hook or automatic retry.
const fs = require("node:fs"), path = require("node:path"), { createHash } = require("node:crypto");
const { pin, identity } = require("../../utils/pinnedMysqlConnection");
const SQL_SHA256 = "536ce5d9788c75bf34f56775c606659c64e6f6fab22edeb523f24c537b72d447";
const CONFIRMATION = "APPLY_ACCOUNT_CODE_TENANT_SCOPE_V1";
const fail = code => { throw Object.assign(new Error(code), { code }); };
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const q = name => { if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) fail("ACCOUNT_SCHEMA_INCOMPATIBLE"); return `\`${name}\``; };
const read = async (cx, sql, args = []) => (await cx.query(sql, args))[0];
function statements() {
  const sql = fs.readFileSync(path.join(__dirname, "2026-10-17-account-code-tenant-scope.sql"), "utf8").replace(/\r\n/g, "\n");
  if (createHash("sha256").update(sql).digest("hex") !== SQL_SHA256) fail("ACCOUNT_MIGRATION_HASH_MISMATCH");
  return sql.split("-- @statement").slice(1).map(s => s.trim().replace(/;$/, ""));
}
function classify(columns, indexes) {
  // A functional key or generated alias can silently retain global code
  // uniqueness under a different name. Do not guess expression dependencies.
  if (columns.some(c => c.GENERATION_EXPRESSION || /(?:VIRTUAL|STORED) GENERATED/i.test(c.EXTRA)) || indexes.some(r => r.EXPRESSION !== null)) fail("ACCOUNT_SCHEMA_INCOMPATIBLE");
  const byName = Object.fromEntries(columns.map(c => [c.COLUMN_NAME, c]));
  for (const [name, type, nullable] of [["id", "int", "NO"], ["company_id", "int", "NO"], ["account_code", "varchar(50)", "YES"]]) {
    const c = byName[name];
    if (!c || c.COLUMN_TYPE !== type || c.IS_NULLABLE !== nullable || c.GENERATION_EXPRESSION || /(?:VIRTUAL|STORED) GENERATED/i.test(c.EXTRA)) fail("ACCOUNT_SCHEMA_INCOMPATIBLE");
  }
  if (byName.id.EXTRA !== "auto_increment") fail("ACCOUNT_SCHEMA_INCOMPATIBLE");
  const groups = Object.create(null);
  for (const row of indexes) (groups[row.INDEX_NAME] ||= []).push(row);
  function exact(name, names) {
    const rows = groups[name];
    if (!rows) return false;
    if (rows.length !== names.length || rows.some((r, i) => r.COLUMN_NAME !== names[i] || Number(r.SEQ_IN_INDEX) !== i + 1 || Number(r.NON_UNIQUE) !== 0 || r.SUB_PART !== null || r.EXPRESSION !== null || r.INDEX_TYPE !== "BTREE" || r.IS_VISIBLE !== "YES" || r.COLLATION !== "A")) fail("ACCOUNT_SCHEMA_INCOMPATIBLE");
    return true;
  }
  if (!exact("PRIMARY", ["id"])) fail("ACCOUNT_SCHEMA_INCOMPATIBLE");
  const legacy = exact("account_code", ["account_code"]), scoped = exact("uq_accounts_company_code", ["company_id", "account_code"]);
  if (!legacy && !scoped) fail("ACCOUNT_SCHEMA_INCOMPATIBLE");
  for (const [name, rows] of Object.entries(groups)) {
    if (!["account_code", "uq_accounts_company_code"].includes(name) && rows.some(r => r.COLUMN_NAME === "account_code" && Number(r.NON_UNIQUE) === 0)) fail("ACCOUNT_SCHEMA_INCOMPATIBLE");
  }
  return !legacy ? "ALREADY_APPLIED" : scoped ? "COMPATIBLE_PARTIAL" : "MIGRATION_REQUIRED";
}
async function snapshot(cx, columns) {
  const countSql = "SELECT CAST(COUNT(*) AS CHAR) n FROM accounts";
  const before = await read(cx, countSql);
  if (before.length !== 1 || typeof before[0].n !== "string" || !/^(0|[1-9]\d*)$/.test(before[0].n)) fail("ACCOUNT_COUNT_INVALID");
  const digest = createHash("sha256"); let last = null, count = 0n;
  const fields = columns.map((c, i) => `HEX(CAST(${q(c.COLUMN_NAME)} AS BINARY)) c${i}`).join(",");
  for (;;) {
    const rows = await read(cx, `SELECT CAST(id AS CHAR) cursor_id,${fields} FROM accounts${last === null ? "" : " WHERE id>CAST(? AS DECIMAL(20,0))"} ORDER BY id LIMIT 500`, last === null ? [] : [last]);
    if (!rows.length) break;
    for (const row of rows) {
      if (typeof row.cursor_id !== "string" || !/^[1-9]\d*$/.test(row.cursor_id) || (last !== null && BigInt(row.cursor_id) <= BigInt(last))) fail("ACCOUNT_CURSOR_INVALID");
      const values = columns.map((_, i) => row[`c${i}`]);
      if (values.some(v => v !== null && (typeof v !== "string" || !/^(?:[0-9A-F]{2})*$/.test(v)))) fail("ACCOUNT_VALUE_INVALID");
      digest.update(JSON.stringify(values) + "\n"); count++; last = row.cursor_id;
    }
  }
  const after = await read(cx, countSql);
  if (count !== BigInt(before[0].n) || after.length !== 1 || after[0].n !== before[0].n) fail("ACCOUNT_COUNT_MISMATCH");
  return { count: count.toString(), sha256: digest.digest("hex") };
}
async function inspect(cx) {
  statements();
  const tables = await read(cx, "SELECT TABLE_NAME,TABLE_TYPE,ENGINE,TABLE_COLLATION,CREATE_OPTIONS,AUTO_INCREMENT,ROW_FORMAT,TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='accounts'");
  if (tables.length !== 1 || tables[0].TABLE_TYPE !== "BASE TABLE" || tables[0].ENGINE !== "InnoDB" || tables[0].CREATE_OPTIONS) fail("ACCOUNT_SCHEMA_INCOMPATIBLE");
  const columns = await read(cx, "SELECT COLUMN_NAME,ORDINAL_POSITION,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,GENERATION_EXPRESSION,CHARACTER_SET_NAME,COLLATION_NAME,COLUMN_COMMENT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='accounts' ORDER BY ORDINAL_POSITION");
  const indexes = await read(cx, "SELECT INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,COLLATION,SUB_PART,INDEX_TYPE,IS_VISIBLE,EXPRESSION,INDEX_COMMENT FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='accounts' ORDER BY INDEX_NAME,SEQ_IN_INDEX");
  const classification = classify(columns, indexes);
  const dependencies = await read(cx, "SELECT TABLE_SCHEMA,TABLE_NAME,CONSTRAINT_NAME,COLUMN_NAME,REFERENCED_TABLE_SCHEMA,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME,ORDINAL_POSITION FROM information_schema.KEY_COLUMN_USAGE WHERE (TABLE_SCHEMA=DATABASE() AND TABLE_NAME='accounts' AND REFERENCED_TABLE_NAME IS NOT NULL) OR (REFERENCED_TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME='accounts') ORDER BY TABLE_SCHEMA,TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION");
  if (dependencies.some(r => (r.REFERENCED_TABLE_NAME === "accounts" && r.REFERENCED_COLUMN_NAME === "account_code") || (r.TABLE_NAME === "accounts" && r.COLUMN_NAME === "account_code"))) fail("ACCOUNT_CODE_DEPENDENCY_UNSUPPORTED");
  const foreignKeys = await read(cx, "SELECT CONSTRAINT_SCHEMA,CONSTRAINT_NAME,TABLE_NAME,REFERENCED_TABLE_NAME,UNIQUE_CONSTRAINT_SCHEMA,UNIQUE_CONSTRAINT_NAME,UPDATE_RULE,DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE (CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='accounts') OR (UNIQUE_CONSTRAINT_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME='accounts') ORDER BY CONSTRAINT_SCHEMA,TABLE_NAME,CONSTRAINT_NAME");
  const checks = await read(cx, "SELECT t.CONSTRAINT_NAME,t.ENFORCED,c.CHECK_CLAUSE FROM information_schema.TABLE_CONSTRAINTS t JOIN information_schema.CHECK_CONSTRAINTS c ON c.CONSTRAINT_SCHEMA=t.CONSTRAINT_SCHEMA AND c.CONSTRAINT_NAME=t.CONSTRAINT_NAME WHERE t.TABLE_SCHEMA=DATABASE() AND t.TABLE_NAME='accounts' AND t.CONSTRAINT_TYPE='CHECK' ORDER BY t.CONSTRAINT_NAME");
  const triggers = await read(cx, "SELECT TRIGGER_NAME,ACTION_TIMING,EVENT_MANIPULATION,ACTION_ORDER,ACTION_STATEMENT,SQL_MODE,DEFINER,CHARACTER_SET_CLIENT,COLLATION_CONNECTION,DATABASE_COLLATION FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE='accounts' ORDER BY TRIGGER_NAME");
  const invalid = await read(cx, "SELECT CAST(COUNT(*) AS CHAR) n FROM accounts WHERE company_id IS NULL OR company_id<=0 OR id<=0");
  const duplicates = await read(cx, "SELECT 1 duplicate_found FROM accounts WHERE account_code IS NOT NULL GROUP BY company_id,account_code HAVING COUNT(*)>1 LIMIT 1");
  if (invalid.length !== 1 || invalid[0].n !== "0" || duplicates.length) fail("ACCOUNT_DATA_INCOMPATIBLE");
  const schemaFingerprint = hash({ tables, columns, indexes: indexes.filter(r => !["account_code", "uq_accounts_company_code"].includes(r.INDEX_NAME)), dependencies, foreignKeys, checks, triggers });
  return { classification, schemaFingerprint, snapshot: await snapshot(cx, columns) };
}
async function migrate(connection, options = {}) {
  if (options.confirmation !== CONFIRMATION || options.transactionOwnership !== "EXCLUSIVE_IDLE_CONNECTION") fail("ACCOUNT_MIGRATION_AUTHORIZATION_REQUIRED");
  const cx = pin(connection); await identity(cx, options.identity);
  await inspect(cx); let locked = false, stage = "LOCK_TABLES";
  try {
    locked = true; await cx.query("LOCK TABLES accounts WRITE");
    stage = "LOCKED_PREFLIGHT"; const before = await inspect(cx);
    if (before.classification !== "ALREADY_APPLIED") {
      stage = "ALTER_INDEX";
      const [result, warningCodes] = await cx.queryWithWarnings(statements()[before.classification === "COMPATIBLE_PARTIAL" ? 1 : 0]);
      if (result.warningStatus !== 0) throw Object.assign(new Error(), { code: "ACCOUNT_MIGRATION_WARNING", warningCodes });
    }
    stage = "POSTFLIGHT"; const after = await inspect(cx);
    if (after.classification !== "ALREADY_APPLIED" || before.schemaFingerprint !== after.schemaFingerprint || JSON.stringify(before.snapshot) !== JSON.stringify(after.snapshot)) fail("ACCOUNT_MIGRATION_PRESERVATION_FAILED");
    return { before: before.classification, after: after.classification, snapshot: after.snapshot, sha256: SQL_SHA256 };
  } catch (error) {
    throw Object.assign(new Error("ACCOUNT_MIGRATION_STOPPED_REQUIRES_INSPECTION"), { code: "ACCOUNT_MIGRATION_STOPPED_REQUIRES_INSPECTION", stage, mysqlCode: Number.isInteger(error.errno) ? error.errno : null, warningCodes: error.warningCodes || [] });
  } finally { if (locked) await cx.cleanup("UNLOCK TABLES"); }
}
module.exports = { CONFIRMATION, SQL_SHA256, statements, classify, snapshot, inspect, migrate };
