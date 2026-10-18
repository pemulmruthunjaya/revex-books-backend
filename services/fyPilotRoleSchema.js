"use strict";
// Read-only checks for the pre-existing annual-role persistence contract.
const fs = require("node:fs"), path = require("node:path");
const fail = () => { throw Object.assign(new Error("FY_PILOT_ROLE_SCHEMA_INCOMPATIBLE"), { code: "FY_PILOT_ROLE_SCHEMA_INCOMPATIBLE" }); };
const types = {
  id: ["bigint unsigned", "NO"], company_id: ["int", "NO"],
  role: ["enum('OPENING_BALANCE_EQUITY','RETAINED_EARNINGS','ACCOUNTS_RECEIVABLE','ACCOUNTS_PAYABLE','CUSTOMER_CREDITS','VENDOR_ADVANCES','CASH','BANK','INVENTORY','INPUT_TAX','OUTPUT_TAX')", "NO"],
  account_id: ["int", "NO"], effective_from_financial_year_id: ["bigint unsigned", "NO"], effective_to_financial_year_id: ["bigint unsigned", "YES"],
  protected_at: ["timestamp(6)", "YES"], protected_by_close_run_id: ["bigint unsigned", "YES"], created_by: ["int", "NO"], created_at: ["timestamp(6)", "NO"], updated_at: ["timestamp(6)", "NO"], singleton_active_role: ["varchar(40)", "YES"],
};
const foreign = {
  company: ["company_id", "companies", "id"], account: ["account_id,company_id", "accounts", "id,company_id"],
  from_fy: ["effective_from_financial_year_id,company_id", "financial_years", "id,company_id"], to_fy: ["effective_to_financial_year_id,company_id", "financial_years", "id,company_id"],
  created_by: ["created_by,company_id", "users", "id,company_id"], protected_run: ["protected_by_close_run_id,company_id", "financial_year_close_runs", "id,company_id"],
};
const compact = s => String(s).replace(/`/g, "").replace(/\s+/g, " ").trim();
// Exact native 9.7.2 renderings of the reviewed ASCII-only expression. Do not
// strip arbitrary escapes, introducers, grouping, literal contents or collations.
const nativeExpression = "(case when ((`role` not in (_utf8mb4'CASH',_utf8mb4'BANK')) and (`effective_to_financial_year_id` is null)) then `role` else NULL end)";
const metadataExpression = nativeExpression.replace("_utf8mb4'CASH'", "_latin1\\'CASH\\'").replace("_utf8mb4'BANK'", "_latin1\\'BANK\\'");
const escapedUtf8mb4Expression = nativeExpression.replace("_utf8mb4'CASH'", "_utf8mb4\\'CASH\\'").replace("_utf8mb4'BANK'", "_utf8mb4\\'BANK\\'");
const nativeColumn = "`singleton_active_role` varchar(40) COLLATE utf8mb4_unicode_ci GENERATED ALWAYS AS (" + nativeExpression + ") STORED,";
async function assertReady(cx) {
  const [columns] = await cx.query("SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='system_account_role_assignments' ORDER BY ORDINAL_POSITION");
  if (columns.length !== Object.keys(types).length) fail();
  for (const [column, [type, nullable]] of Object.entries(types)) {
    const c = columns.find(c => c.COLUMN_NAME === column);
    if (!c || c.COLUMN_TYPE !== type || c.IS_NULLABLE !== nullable) fail();
    if (["created_at", "updated_at"].includes(column)) {
      if (String(c.COLUMN_DEFAULT).toLowerCase() !== "current_timestamp(6)" || c.EXTRA.toLowerCase() !== (column === "updated_at" ? "default_generated on update current_timestamp(6)" : "default_generated") || c.GENERATION_EXPRESSION) fail();
    } else if (column === "singleton_active_role") {
      if (![nativeExpression, metadataExpression, escapedUtf8mb4Expression].includes(c.GENERATION_EXPRESSION) || c.EXTRA !== "STORED GENERATED" || c.COLUMN_DEFAULT !== null) fail();
      const [native] = await cx.query("SHOW CREATE TABLE `system_account_role_assignments`");
      if (native.length !== 1 || native[0].Table !== "system_account_role_assignments" || typeof native[0]["Create Table"] !== "string") fail();
      const lines = native[0]["Create Table"].split(/\r?\n/).map(line => line.trim()).filter(line => line.startsWith("`singleton_active_role` "));
      if (lines.length !== 1 || lines[0] !== nativeColumn) fail();
    } else if (c.COLUMN_DEFAULT !== null || c.GENERATION_EXPRESSION || c.EXTRA !== (column === "id" ? "auto_increment" : "")) fail();
  }
  const [keys] = await cx.query("SELECT k.CONSTRAINT_NAME,k.COLUMN_NAME,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,(k.REFERENCED_TABLE_SCHEMA=DATABASE()) local_reference,r.UPDATE_RULE,r.DELETE_RULE FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME='system_account_role_assignments' ORDER BY k.CONSTRAINT_NAME,k.ORDINAL_POSITION");
  if (keys.length !== 11) fail();
  for (const [suffix, [fields, table, refs]] of Object.entries(foreign)) {
    const rows = keys.filter(k => k.CONSTRAINT_NAME === `fk_system_account_roles_${suffix}`);
    if (rows.map(k => k.COLUMN_NAME).join(",") !== fields || rows.map(k => k.REFERENCED_COLUMN_NAME).join(",") !== refs || rows.some(k => k.REFERENCED_TABLE_NAME !== table || Number(k.local_reference) !== 1 || !["RESTRICT", "NO ACTION"].includes(k.UPDATE_RULE) || !["RESTRICT", "NO ACTION"].includes(k.DELETE_RULE))) fail();
  }
  const [indexes] = await cx.query("SELECT INDEX_NAME,COLUMN_NAME,NON_UNIQUE,SUB_PART,EXPRESSION FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='system_account_role_assignments' ORDER BY INDEX_NAME,SEQ_IN_INDEX");
  const unique = { PRIMARY: "id", uq_system_account_roles_id_company: "id,company_id", uq_system_account_roles_assignment: "company_id,role,account_id,effective_from_financial_year_id", uq_system_account_roles_singleton_active: "company_id,singleton_active_role" };
  if (indexes.some(i => Number(i.NON_UNIQUE) === 0 && !Object.hasOwn(unique, i.INDEX_NAME))) fail();
  for (const [key, fields] of Object.entries(unique)) {
    const rows = indexes.filter(i => i.INDEX_NAME === key);
    if (rows.map(i => i.COLUMN_NAME).join(",") !== fields || rows.some(i => Number(i.NON_UNIQUE) !== 0 || i.SUB_PART !== null || i.EXPRESSION !== null)) fail();
  }
  const sql = fs.readFileSync(path.join(__dirname, "../db/migrations/2026-09-12-financial-year-close-foundation.sql"), "utf8");
  const [triggers] = await cx.query("SELECT TRIGGER_NAME,EVENT_MANIPULATION,ACTION_TIMING,ACTION_ORIENTATION,ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE='system_account_role_assignments'");
  const expected = [...sql.matchAll(/CREATE TRIGGER IF NOT EXISTS (trg_system_account_roles_\w+)\s+BEFORE (\w+) ON system_account_role_assignments\s+FOR EACH ROW\s+(BEGIN[\s\S]*?END)\$\$/g)];
  if (expected.length !== 3 || triggers.length !== 3) fail();
  for (const [, trigger, event, body] of expected) if (!triggers.some(t => t.TRIGGER_NAME === trigger && t.EVENT_MANIPULATION === event && t.ACTION_TIMING === "BEFORE" && t.ACTION_ORIENTATION === "ROW" && compact(t.ACTION_STATEMENT) === compact(body))) fail();
}
module.exports = { assertReady };
