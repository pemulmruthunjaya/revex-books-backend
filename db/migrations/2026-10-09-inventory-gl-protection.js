"use strict";
// Explicit additive runner. No CLI, environment, connection, or startup hook.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const SQL_SHA256 = "df83e2c20a336ac8ab19c49c26ec0c92c2e62f1652847ed0f6ceb1479b96da49";
const schema = (() => {
"use strict";
// Additive journal protection only. Persistence uses the already immutable
// iv_operations contract. This module issues SELECTs only.
const { fail } = require("../../services/inventoryValuationMath");
const linked = expression => `(EXISTS (SELECT 1 FROM iv_operations o JOIN JSON_TABLE(o.result,'$.journals[*]' COLUMNS(journal_id BIGINT PATH '$.id')) j ON j.journal_id=${expression} WHERE o.action IN ('GL_POST','GL_CUTOVER')) OR EXISTS (SELECT 1 FROM financial_year_close_runs r WHERE r.status='FINALIZED' AND (r.closing_journal_entry_id=${expression} OR r.opening_journal_entry_id=${expression})))`;
const triggers = [];
triggers.push({ name: "iv_gl_finalized_run_no_update", table: "financial_year_close_runs", event: "UPDATE",
  body: "BEGIN IF OLD.status='FINALIZED' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_GL_FINALIZED_RUN_IMMUTABLE'; END IF; END" });
for (const event of ["UPDATE", "DELETE"]) {
  triggers.push({ name: `iv_gl_journal_no_${event.toLowerCase()}`, table: "journal_entries", event,
    body: `BEGIN IF ${linked("OLD.id")} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_GL_LINKED_JOURNAL_IMMUTABLE'; END IF; END` });
  triggers.push({ name: `iv_gl_detail_no_${event.toLowerCase()}`, table: "journal_entry_details", event,
    body: `BEGIN IF ${linked("OLD.journal_entry_id")}${event === "UPDATE" ? ` OR ${linked("NEW.journal_entry_id")}` : ""} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_GL_LINKED_JOURNAL_IMMUTABLE'; END IF; END` });
}
triggers.push({ name: "iv_gl_detail_no_insert", table: "journal_entry_details", event: "INSERT",
  body: `BEGIN IF ${linked("NEW.journal_entry_id")} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_GL_LINKED_JOURNAL_IMMUTABLE'; END IF; END` });
for (const event of ["UPDATE", "DELETE"]) triggers.push({ name: `iv_gl_account_no_${event.toLowerCase()}`, table: "accounts", event,
  body: `BEGIN IF ${event === "UPDATE" ? "(NOT(NEW.id <=> OLD.id) OR NOT(NEW.company_id <=> OLD.company_id) OR NOT(NEW.account_type <=> OLD.account_type) OR NOT(NEW.status <=> OLD.status)) AND " : ""}EXISTS (SELECT 1 FROM iv_operations WHERE company_id=OLD.company_id AND action='GL_ROLE' AND JSON_UNQUOTE(JSON_EXTRACT(result,'$.account_id'))=CAST(OLD.id AS CHAR)) THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='IV_GL_ROLE_ACCOUNT_IMMUTABLE'; END IF; END` });
const normalize = value => String(value).replace(/`/g, "").replace(/\s+/g, " ").trim();
async function inspect(cx) {
  const missing = [], conflicts = [];
  for (const expected of triggers) {
    const [actual] = await cx.query("SELECT EVENT_OBJECT_TABLE,EVENT_MANIPULATION,ACTION_TIMING,ACTION_ORIENTATION,ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME=?", [expected.name]);
    if (!actual.length) missing.push(expected.name);
    else if (actual.length !== 1 || actual[0].EVENT_OBJECT_TABLE !== expected.table || actual[0].EVENT_MANIPULATION !== expected.event || actual[0].ACTION_TIMING !== "BEFORE" || actual[0].ACTION_ORIENTATION !== "ROW" || normalize(actual[0].ACTION_STATEMENT) !== normalize(expected.body)) conflicts.push(expected.name);
  }
  return { ready: !missing.length && !conflicts.length, missing, conflicts };
}
async function assertReady(cx) {
  const state = await inspect(cx);
  if (!state.ready) fail(state.conflicts.length ? "IV_GL_SCHEMA_INCOMPATIBLE" : "IV_GL_SCHEMA_NOT_READY");
}
return { triggers, inspect, assertReady };

})();
function statements() {
  // Pin canonical LF text so a Windows checkout cannot change the contract.
  const sql = Buffer.from(fs.readFileSync(path.join(__dirname, "2026-10-09-inventory-gl-protection.sql"), "utf8").replace(/\r\n/g, "\n"), "utf8");
  if (createHash("sha256").update(sql).digest("hex") !== SQL_SHA256) throw new Error("IV_GL_MIGRATION_HASH_MISMATCH");
  const body = sql.toString("utf8").split("DELIMITER $$\n")[1]?.split("DELIMITER ;")[0];
  if (!body) throw new Error("IV_GL_MIGRATION_FORMAT_INVALID");
  const result = body.split("$$").map(s => s.trim()).filter(Boolean);
  const expected = schema.triggers.map(t => `CREATE TRIGGER ${t.name} BEFORE ${t.event} ON ${t.table} FOR EACH ROW ${t.body}`);
  if (JSON.stringify(result) !== JSON.stringify(expected)) throw new Error("IV_GL_MIGRATION_CONTRACT_MISMATCH");
  return result;
}
async function migrate(executor, { confirmation } = {}) {
  if (confirmation !== "APPLY_INVENTORY_GL_PROTECTION_V1") throw new Error("IV_GL_EXPLICIT_MIGRATION_REQUIRED");
  const sql = statements(), before = await schema.inspect(executor);
  // Inspect the complete object set first, never repair incompatible triggers.
  if (before.conflicts.length) throw new Error("IV_GL_SCHEMA_INCOMPATIBLE");
  await require("../../services/inventoryValuationSchema").assertReady(executor);
  for (let index = 0; index < schema.triggers.length; index++) if (before.missing.includes(schema.triggers[index].name)) await executor.query(sql[index]);
  await schema.assertReady(executor);
  return { applied: before.missing, sha256: SQL_SHA256 };
}
module.exports = { SQL_SHA256, statements, migrate };
