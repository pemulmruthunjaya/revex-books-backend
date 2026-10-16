"use strict";
// Explicit/import-inert. No CLI, environment loading, startup wiring or retry.
const { createHash } = require("node:crypto");
const contract = require("../../services/internalPilotSchemaContract");
const { assertTrialInvitationReadiness } = require("../../services/trialInvitationReadinessService");
const { pin, identity } = require("../../utils/pinnedMysqlConnection");
const CONFIRMATION = "APPLY_INTERNAL_PILOT_PROVENANCE_V1";
const fail = code => { throw Object.assign(new Error(code), { code }); };
const digest = v => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const read = async (cx, sql, args = []) => (await cx.query(sql, args))[0];
const quote = s => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) fail("PILOT_MIGRATION_METADATA_INVALID"); return `\`${s}\``; };
async function snapshot(cx, columns) {
  const hash = createHash("sha256"); let last = null, count = 0n;
  const countQuery = "SELECT CAST(COUNT(*) AS CHAR) row_count FROM trial_invitations";
  const counts = await read(cx, countQuery);
  if (counts.length !== 1 || !/^(0|[1-9]\d*)$/.test(counts[0].row_count) || typeof counts[0].row_count !== "string") fail("PILOT_MIGRATION_COUNT_INVALID");
  const expected = BigInt(counts[0].row_count);
  const names = [...columns.map(c => c.COLUMN_NAME).filter(n => !Object.hasOwn(contract.extraColumns, n)), ...Object.keys(contract.extraColumns)];
  const fields = names.map((n, i) => {
    const value = columns.some(c => c.COLUMN_NAME === n) ? quote(n) : n === "provenance" ? "'PUBLIC_TRIAL_REQUEST'" : "NULL";
    return `HEX(CAST(${value} AS BINARY)) AS c${i}`;
  }).join(",");
  for (;;) {
    const rows = await read(cx, `SELECT CAST(id AS CHAR) cursor_id,${fields} FROM trial_invitations${last === null ? "" : " WHERE id > CAST(? AS DECIMAL(20,0))"} ORDER BY id LIMIT 500`, last === null ? [] : [last]);
    if (!rows.length) break;
    for (const row of rows) {
      if (typeof row.cursor_id !== "string" || !/^[1-9]\d*$/.test(row.cursor_id) || (last !== null && BigInt(row.cursor_id) <= BigInt(last))) fail("PILOT_MIGRATION_CURSOR_INVALID");
      const values = names.map((_, i) => row[`c${i}`]);
      if (values.some(v => v !== null && (typeof v !== "string" || !/^(?:[0-9A-F]{2})*$/.test(v)))) fail("PILOT_MIGRATION_VALUE_INVALID");
      hash.update(JSON.stringify(values) + "\n"); last = row.cursor_id; count++;
    }
  }
  const end = await read(cx, countQuery);
  if (count !== expected || end.length !== 1 || end[0].row_count !== expected.toString()) fail("PILOT_MIGRATION_COUNT_MISMATCH");
  return { count: count.toString(), sha256: hash.digest("hex") };
}
async function inspect(cx) {
  contract.statements();
  await assertTrialInvitationReadiness({ executor: cx, schemaOnly: true, allowMissingInternalTriggers: true });
  const columns = await read(cx, "SELECT COLUMN_NAME,ORDINAL_POSITION,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,GENERATION_EXPRESSION,COLUMN_COMMENT,CHARACTER_SET_NAME,COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='trial_invitations' ORDER BY ORDINAL_POSITION");
  if (!columns.length || columns.some(c => c.GENERATION_EXPRESSION || c.COLUMN_COMMENT)) fail("PILOT_MIGRATION_SCHEMA_INCOMPATIBLE");
  const applied = columns.some(c => c.COLUMN_NAME === "provenance");
  const tables = await read(cx, "SELECT TABLE_NAME,TABLE_TYPE,ENGINE,TABLE_COLLATION,CREATE_OPTIONS FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('trial_invitations','trial_invitation_operations') ORDER BY TABLE_NAME");
  if (tables.length !== 2 || tables.some(t => t.TABLE_TYPE !== "BASE TABLE" || t.ENGINE !== "InnoDB" || t.TABLE_COLLATION !== "utf8mb4_unicode_ci" || t.CREATE_OPTIONS)) fail("PILOT_MIGRATION_SCHEMA_INCOMPATIBLE");
  const checks = await read(cx, "SELECT CONSTRAINT_NAME,ENFORCED FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME IN ('trial_invitations','trial_invitation_operations') AND CONSTRAINT_TYPE='CHECK' ORDER BY CONSTRAINT_NAME");
  if (checks.some(c => c.ENFORCED !== "YES")) fail("PILOT_MIGRATION_CHECK_NOT_ENFORCED");
  const triggers = await read(cx, "SELECT TRIGGER_NAME,ACTION_TIMING,EVENT_MANIPULATION,EVENT_OBJECT_TABLE,ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE IN ('trial_invitations','trial_invitation_operations')");
  if (!applied && triggers.length) fail("PILOT_MIGRATION_SCHEMA_INCOMPATIBLE");
  const missingTriggers = applied ? contract.verifyTriggers(triggers, true) : contract.verifyTriggers([], true);
  // Reject referenced dependencies on either column being altered, including
  // external FKs to those columns. The original request FK itself is preserved.
  const dependencies = await read(cx, "SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME='trial_invitations' AND REFERENCED_COLUMN_NAME IN ('trial_request_id','last_sent_at')");
  if (dependencies.length) fail("PILOT_MIGRATION_DEPENDENCY_UNSUPPORTED");
  if (applied) {
    const invalid = await read(cx, "SELECT CAST(COUNT(*) AS CHAR) invalid_count FROM trial_invitations WHERE NOT ((provenance='PUBLIC_TRIAL_REQUEST' AND trial_request_id IS NOT NULL AND internal_key_hash IS NULL AND internal_reason IS NULL AND last_sent_at IS NOT NULL) OR (provenance='INTERNAL_PILOT' AND trial_request_id IS NULL AND internal_key_hash IS NOT NULL AND internal_reason IS NOT NULL AND CHAR_LENGTH(TRIM(internal_reason))>0 AND last_sent_at IS NULL))");
    if (invalid.length !== 1 || invalid[0].invalid_count !== "0") fail("PILOT_MIGRATION_PROVENANCE_INVALID");
  }
  const metadata = columns.filter(c => !Object.hasOwn(contract.extraColumns, c.COLUMN_NAME)).map(c => ({ ...c, IS_NULLABLE: ["trial_request_id", "last_sent_at"].includes(c.COLUMN_NAME) ? "NO" : c.IS_NULLABLE }));
  return { applied, missingTriggers, classification: !applied ? "MIGRATION_REQUIRED" : missingTriggers.length ? "COMPATIBLE_PARTIAL" : "ALREADY_APPLIED", schemaFingerprint: digest({ tables, columns: metadata, checks: checks.filter(c => c.CONSTRAINT_NAME !== contract.checkName) }), snapshot: await snapshot(cx, columns) };
}
async function migrate(connection, options = {}) {
  if (options.confirmation !== CONFIRMATION || options.transactionOwnership !== "EXCLUSIVE_IDLE_CONNECTION") fail("PILOT_MIGRATION_AUTHORIZATION_REQUIRED");
  const cx = pin(connection); await identity(cx, options.identity);
  await inspect(cx); let locked = false, stage = "LOCK_TABLES", warningCodes = [];
  try {
    locked = true;
    await cx.query("LOCK TABLES trial_invitations WRITE, trial_invitation_operations WRITE");
    stage = "LOCKED_PREFLIGHT";
    const before = await inspect(cx), sql = contract.statements();
    const execute = async (statement, label) => {
      stage = label; warningCodes = [];
      const [result, codes] = await cx.queryWithWarnings(statement);
      warningCodes = codes;
      if (result.warningStatus !== 0) fail("PILOT_MIGRATION_DDL_WARNING");
    };
    if (!before.applied) await execute(sql[0], "ALTER_INVITATIONS");
    stage = "POST_ALTER_VERIFICATION";
    const partial = await inspect(cx);
    if (!partial.applied || JSON.stringify(before.snapshot) !== JSON.stringify(partial.snapshot) || before.schemaFingerprint !== partial.schemaFingerprint) fail("PILOT_MIGRATION_PRESERVATION_FAILED");
    for (const [index, statement] of sql.slice(1).entries()) {
      const name = /^CREATE TRIGGER (\w+)/.exec(statement)[1];
      if (partial.missingTriggers.includes(name)) await execute(statement, `CREATE_TRIGGER_${index + 1}`);
    }
    stage = "FINAL_VERIFICATION";
    const after = await inspect(cx);
    if (after.classification !== "ALREADY_APPLIED" || JSON.stringify(before.snapshot) !== JSON.stringify(after.snapshot) || before.schemaFingerprint !== after.schemaFingerprint) fail("PILOT_MIGRATION_PRESERVATION_FAILED");
    return { before: before.classification, after: after.classification, snapshot: after.snapshot, sha256: contract.SQL_SHA256 };
  } catch (error) {
    const code = "PILOT_MIGRATION_STOPPED_REQUIRES_INSPECTION";
    throw Object.assign(new Error(code), { code, stage,
      mysqlCode: Number.isInteger(error.errno) && error.errno >= 1000 && error.errno <= 65535 ? error.errno : null,
      warningCodes });
  } finally {
    if (locked) try { await cx.cleanup("UNLOCK TABLES"); }
    catch { const code = "PILOT_CLEANUP_FAILED"; throw Object.assign(new Error(code), { code, stage: "UNLOCK_TABLES", mysqlCode: null, warningCodes: [] }); }
  }
}
module.exports = { CONFIRMATION, SQL_SHA256: contract.SQL_SHA256, inspect, migrate, snapshot };
