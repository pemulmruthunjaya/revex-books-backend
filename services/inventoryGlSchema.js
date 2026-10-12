"use strict";
// Additive journal protection only. Persistence uses the already immutable
// iv_operations contract. This module issues SELECTs only.
const { fail } = require("./inventoryValuationMath");
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
module.exports = { triggers, inspect, assertReady };
