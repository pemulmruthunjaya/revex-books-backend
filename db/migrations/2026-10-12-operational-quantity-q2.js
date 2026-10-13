"use strict";

// Explicit, import-inert prerequisite. Never imports application DB/configuration.
// MySQL DDL is not transactional: a failed invocation stops; only a separate,
// operator-authorized invocation may resume the verified compatible partial state.
const fs = require("node:fs"), path = require("node:path"), { createHash } = require("node:crypto");
const SQL_SHA256 = "7d603879628055eddbd106f848b848cd9aaa52ad1f156bdc5a6f5031dd5a0b34";
const CONFIRMATION = "APPLY_OPERATIONAL_QUANTITY_Q2_V1";
const targets = Object.freeze([{ table: "products", column: "stock", default: "0" }, { table: "bill_items", column: "quantity", default: null }]);
const fail = code => { throw Object.assign(new Error(code), { code }); };
const digest = value => createHash("sha256").update(value).digest("hex");
const quote = value => { if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) fail("Q2_SCHEMA_INCOMPATIBLE"); return `\`${value}\``; };

// Signed quantities are preserved, including historical negatives and NULLs.
// Never use Number, rounding, coercion or application nonnegative-input policy.
function exactQ2(value) {
  if (value === null) return null;
  if (typeof value !== "string" || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) || value.length > 80) fail("Q2_VALUE_NOT_EXACT");
  const negative = value.startsWith("-"), [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  if (/[1-9]/.test(fraction.slice(2))) fail("Q2_VALUE_NOT_EXACT");
  let units = BigInt(whole) * 100n + BigInt(fraction.slice(0, 2).padEnd(2, "0"));
  if (units > 999999999999n) fail("Q2_VALUE_OUT_OF_RANGE");
  if (negative) units = -units;
  return units.toString();
}
function statements() {
  const sql = fs.readFileSync(path.join(__dirname, "2026-10-12-operational-quantity-q2.sql"), "utf8").replace(/\r\n/g, "\n");
  if (digest(sql) !== SQL_SHA256) fail("Q2_MIGRATION_HASH_MISMATCH");
  const result = sql.replace(/^--[^\n]*\n/gm, "").split(";").map(s => s.trim()).filter(Boolean);
  const expected = targets.map(t => `ALTER TABLE ${quote(t.table)} MODIFY COLUMN ${quote(t.column)} DECIMAL(12,2) NULL DEFAULT ${t.default ?? "NULL"}`);
  if (JSON.stringify(result) !== JSON.stringify(expected)) fail("Q2_MIGRATION_CONTRACT_MISMATCH");
  return result;
}
const read = async (cx, sql, args = []) => (await cx.query(sql, args))[0];
function normalizedColumn(row, target) {
  const out = { ...row };
  if (row.COLUMN_NAME === target.column) {
    out.DATA_TYPE = "q2"; out.COLUMN_TYPE = "q2";
    out.NUMERIC_PRECISION = null; out.NUMERIC_SCALE = null;
    out.COLUMN_DEFAULT = target.default;
  }
  return out;
}
async function schema(cx) {
  const metadata = [], states = [];
  for (const target of targets) {
    const args = [target.table];
    const tables = await read(cx, "SELECT TABLE_TYPE,ENGINE,TABLE_COLLATION,CREATE_OPTIONS FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?", args);
    if (tables.length !== 1 || tables[0].TABLE_TYPE !== "BASE TABLE" || tables[0].ENGINE !== "InnoDB" || tables[0].CREATE_OPTIONS) fail("Q2_SCHEMA_INCOMPATIBLE");
    const columns = await read(cx, "SELECT COLUMN_NAME,ORDINAL_POSITION,DATA_TYPE,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,GENERATION_EXPRESSION,COLUMN_COMMENT,CHARACTER_SET_NAME,COLLATION_NAME,NUMERIC_PRECISION,NUMERIC_SCALE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION", args);
    const column = columns.find(c => c.COLUMN_NAME === target.column), id = columns.find(c => c.COLUMN_NAME === "id");
    const type = column?.COLUMN_TYPE.toLowerCase();
    if (!column || !["int", "int(11)", "decimal(12,2)"].includes(type) || column.IS_NULLABLE !== "YES" || column.EXTRA || column.GENERATION_EXPRESSION || column.COLUMN_COMMENT || column.CHARACTER_SET_NAME !== null || column.COLLATION_NAME !== null ||
        (target.default === null ? column.COLUMN_DEFAULT !== null : exactQ2(column.COLUMN_DEFAULT) !== "0") ||
        !id || !/^(?:int(?:\(11\))?|bigint(?:\(20\))?)(?: unsigned)?$/i.test(id.COLUMN_TYPE) || id.IS_NULLABLE !== "NO") fail("Q2_SCHEMA_INCOMPATIBLE");
    // DEFAULT_GENERATED describes an expression default (e.g. CURRENT_TIMESTAMP),
    // not a generated column. Preserve its metadata verbatim in the fingerprint.
    // Still reject actual generated/invisible dependencies without guessing equivalence.
    if (columns.some(c => c.GENERATION_EXPRESSION || /GENERATED|INVISIBLE/i.test(c.EXTRA.replace(/\bDEFAULT_GENERATED\b/gi, "")))) fail("Q2_SCHEMA_INCOMPATIBLE");
    for (const c of columns) quote(c.COLUMN_NAME);
    const indexes = await read(cx, "SELECT INDEX_NAME,SEQ_IN_INDEX,COLUMN_NAME,NON_UNIQUE,SUB_PART,INDEX_TYPE,IS_VISIBLE,EXPRESSION FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX", args);
    const pk = indexes.filter(i => i.INDEX_NAME === "PRIMARY");
    if (pk.length !== 1 || pk[0].COLUMN_NAME !== "id" || Number(pk[0].NON_UNIQUE) !== 0 || indexes.some(i => i.COLUMN_NAME === target.column || i.EXPRESSION)) fail("Q2_SCHEMA_DEPENDENCY_UNSUPPORTED");
    const fks = await read(cx, "SELECT k.TABLE_SCHEMA,k.TABLE_NAME,k.CONSTRAINT_NAME,k.COLUMN_NAME,k.ORDINAL_POSITION,k.REFERENCED_TABLE_SCHEMA,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.UPDATE_RULE,r.DELETE_RULE FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME WHERE k.REFERENCED_TABLE_NAME IS NOT NULL AND ((k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME=?) OR (k.REFERENCED_TABLE_SCHEMA=DATABASE() AND k.REFERENCED_TABLE_NAME=?)) ORDER BY k.TABLE_SCHEMA,k.TABLE_NAME,k.CONSTRAINT_NAME,k.ORDINAL_POSITION", [target.table, target.table]);
    if (fks.some(k => (k.TABLE_NAME === target.table && k.COLUMN_NAME === target.column) || (k.REFERENCED_TABLE_NAME === target.table && k.REFERENCED_COLUMN_NAME === target.column))) fail("Q2_SCHEMA_DEPENDENCY_UNSUPPORTED");
    const checks = await read(cx, "SELECT t.CONSTRAINT_NAME,t.ENFORCED,c.CHECK_CLAUSE FROM information_schema.TABLE_CONSTRAINTS t JOIN information_schema.CHECK_CONSTRAINTS c ON c.CONSTRAINT_SCHEMA=t.CONSTRAINT_SCHEMA AND c.CONSTRAINT_NAME=t.CONSTRAINT_NAME WHERE t.TABLE_SCHEMA=DATABASE() AND t.TABLE_NAME=? ORDER BY t.CONSTRAINT_NAME", args);
    if (checks.some(c => new RegExp(`\\b${target.column}\\b`, "i").test(c.CHECK_CLAUSE))) fail("Q2_SCHEMA_DEPENDENCY_UNSUPPORTED");
    const triggers = await read(cx, "SELECT TRIGGER_NAME,EVENT_MANIPULATION,ACTION_TIMING,ACTION_ORIENTATION,ACTION_STATEMENT,SQL_MODE,DEFINER,CHARACTER_SET_CLIENT,COLLATION_CONNECTION,DATABASE_COLLATION FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE=? ORDER BY TRIGGER_NAME", args);
    const ddl = await read(cx, `SHOW CREATE TABLE ${quote(target.table)}`);
    const text = ddl[0]?.["Create Table"];
    // Require exact canonical MySQL rendering of the owned column. Normalize
    // only its verified numeric type/default; retain every other table clause.
    const pattern = new RegExp(`^  ${quote(target.column)} (?:int(?:\\(11\\))?|decimal\\(12,2\\)) DEFAULT (?:'0(?:\\.00)?'|0|NULL)(,?)$`, "m");
    if (typeof text !== "string" || !pattern.test(text) || /PARTITION BY/i.test(text)) fail("Q2_SCHEMA_INCOMPATIBLE");
    metadata.push({ table: target.table, tables, columns: columns.map(c => normalizedColumn(c, target)), indexes, fks, checks, triggers,
      ddl: text.replace(pattern, `  ${quote(target.column)} Q2 DEFAULT ${target.default ?? "NULL"}$1`) });
    states.push({ ...target, applied: type === "decimal(12,2)", columns: columns.map(c => c.COLUMN_NAME) });
  }
  return { states, fingerprint: digest(JSON.stringify(metadata)) };
}
async function values(cx, states) {
  const result = {};
  for (const target of states) {
    const hash = createHash("sha256"); let last = null, count = 0n;
    const countRows = await read(cx, `SELECT CAST(COUNT(*) AS CHAR) AS row_count FROM ${quote(target.table)}`);
    if (countRows.length !== 1 || typeof countRows[0].row_count !== "string" || !/^(0|[1-9]\d*)$/.test(countRows[0].row_count)) fail("Q2_ROW_COUNT_INVALID");
    const expectedCount = BigInt(countRows[0].row_count);
    const fields = target.columns.map((c, i) => `${c === target.column ? `CAST(${quote(c)} AS CHAR)` : `HEX(CAST(${quote(c)} AS BINARY))`} AS c${i}`).join(",");
    for (;;) {
      const rows = await read(cx, `SELECT CAST(id AS CHAR) AS cursor_id,${fields} FROM ${quote(target.table)}${last === null ? "" : " WHERE id > CAST(? AS DECIMAL(20,0))"} ORDER BY id LIMIT 500`, last === null ? [] : [last]);
      if (!rows.length) break;
      for (const row of rows) {
        if (typeof row.cursor_id !== "string" || !/^-?\d+$/.test(row.cursor_id) || (last !== null && BigInt(row.cursor_id) <= BigInt(last))) fail("Q2_ROW_SNAPSHOT_INVALID");
        const canonical = target.columns.map((c, i) => c === target.column ? exactQ2(row[`c${i}`]) : row[`c${i}`]);
        if (canonical.some(v => v !== null && typeof v !== "string")) fail("Q2_ROW_SNAPSHOT_INVALID");
        hash.update(JSON.stringify(canonical) + "\n"); last = row.cursor_id; count++;
      }
    }
    const endCount = await read(cx, `SELECT CAST(COUNT(*) AS CHAR) AS row_count FROM ${quote(target.table)}`);
    if (count !== expectedCount || endCount.length !== 1 || endCount[0].row_count !== expectedCount.toString()) fail("Q2_ROW_COUNT_MISMATCH");
    result[target.table] = { count: count.toString(), sha256: hash.digest("hex") };
  }
  return result;
}
function pinPhysicalConnection(cx) {
  // Load constructors only on explicit invocation; importing never connects.
  const { PromiseConnection, PromisePoolConnection } = require("mysql2/promise");
  const { Connection } = require("mysql2");
  const core = Object.getOwnPropertyDescriptor(cx || {}, "connection")?.value;
  if (!(cx instanceof PromiseConnection) || cx instanceof PromisePoolConnection || cx.query !== PromiseConnection.prototype.query ||
      !(core instanceof Connection) || core._pool || core.query !== Connection.prototype.query ||
      !Number.isSafeInteger(core.threadId) || core.threadId <= 0 || !core.stream) fail("Q2_PINNED_CONNECTION_REQUIRED");
  const threadId = core.threadId, stream = core.stream, query = Connection.prototype.query, destroy = Connection.prototype.destroy;
  let database;
  const unchanged = () => {
    if (cx.connection !== core || cx.query !== PromiseConnection.prototype.query || core.query !== query || core.threadId !== threadId || core.stream !== stream || stream.destroyed) fail("Q2_CONNECTION_CHANGED");
  };
  // Bypass caller-supplied forwarding executors entirely; every command and
  // cleanup is dispatched to the captured physical mysql2 connection.
  const raw = (sql, args = []) => new Promise((resolve, reject) => query.call(core, sql, args, (error, rows, fields) => error ? reject(error) : resolve([rows, fields])));
  const verify = async () => {
    unchanged();
    const [rows] = await raw("SELECT CAST(CONNECTION_ID() AS CHAR) AS connection_id,DATABASE() AS db");
    unchanged();
    if (rows.length !== 1 || rows[0].connection_id !== String(threadId) || !rows[0].db || (database !== undefined && rows[0].db !== database)) fail("Q2_CONNECTION_CHANGED");
    database = rows[0].db;
  };
  return {
    async query(sql, args) { await verify(); const result = await raw(sql, args); unchanged(); return result; },
    async cleanup() {
      try { await verify(); await raw("UNLOCK TABLES"); unchanged(); }
      catch { destroy.call(core); fail("Q2_CONNECTION_CLEANUP_FAILED"); }
    },
    destroy() { destroy.call(core); },
  };
}
async function inspect(cx) {
  statements();
  const state = await schema(cx), snapshot = await values(cx, state.states);
  return { ...state, snapshot, classification: state.states.every(t => t.applied) ? "ALREADY_APPLIED" : state.states.some(t => t.applied) ? "COMPATIBLE_PARTIAL" : "MIGRATION_REQUIRED" };
}
async function migrate(cx, { confirmation, dedicatedConnection = false } = {}) {
  if (confirmation !== CONFIRMATION || dedicatedConnection !== true) fail("Q2_EXPLICIT_DEDICATED_CONNECTION_REQUIRED");
  const sql = statements();
  cx = pinPhysicalConnection(cx);
  // Use MySQL's protocol transaction status (not MariaDB's in_transaction var).
  const [status] = await cx.query("DO 0");
  if (!Number.isInteger(status?.serverStatus) || (status.serverStatus & 1) || !(status.serverStatus & 2)) fail("Q2_DEDICATED_IDLE_CONNECTION_REQUIRED");
  const identity = await read(cx, "SELECT DATABASE() AS db");
  if (identity.length !== 1 || !identity[0].db) fail("Q2_DEDICATED_IDLE_CONNECTION_REQUIRED");
  // Validate BOTH complete schemas and ALL values before even taking locks.
  await inspect(cx);
  let locked = false;
  try {
    locked = true; // includes an uncertain LOCK response: clean up the same socket
    await cx.query("LOCK TABLES `products` WRITE, `bill_items` WRITE");
    // Close the race between initial preflight and lock acquisition. Explicit
    // LOCK TABLES locks survive ALTER's implicit commit; do not BEGIN a txn.
    const before = await inspect(cx); const applied = [];
    for (let i = 0; i < targets.length; i++) if (!before.states[i].applied) {
      const [status] = await cx.query(sql[i]);
      if (!Number.isInteger(status?.warningStatus) || status.warningStatus !== 0) fail("Q2_DDL_WARNING");
      applied.push(targets[i].table + "." + targets[i].column);
      // Do not attempt the second ALTER if the first changed anything other
      // than its owned definition (DDL cannot be rolled back).
      const checkpoint = await inspect(cx);
      if (!checkpoint.states[i].applied || checkpoint.fingerprint !== before.fingerprint || JSON.stringify(checkpoint.snapshot) !== JSON.stringify(before.snapshot)) fail("Q2_POSTFLIGHT_MISMATCH");
    }
    const after = await inspect(cx);
    if (after.classification !== "ALREADY_APPLIED" || before.fingerprint !== after.fingerprint || JSON.stringify(before.snapshot) !== JSON.stringify(after.snapshot)) fail("Q2_POSTFLIGHT_MISMATCH");
    return { applied, sha256: SQL_SHA256, before: before.classification, after: after.classification, snapshot: after.snapshot, schemaFingerprint: after.fingerprint };
  } finally { if (locked) await cx.cleanup(); }
}
module.exports = { SQL_SHA256, CONFIRMATION, targets, statements, exactQ2, inspect, migrate };
