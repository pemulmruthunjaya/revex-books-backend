"use strict";
// Explicit programmatic runner only. No CLI, connection factory, email or DDL.
const { pin, identity } = require("../utils/pinnedMysqlConnection");
const m = require("../services/inventoryValuationMath");
const gl = require("../services/inventoryGlService");
const ops = require("../services/inventoryValuationOperationService");
const CONFIRMATION = "ACTIVATE_COMPANY_9_FY_PILOT_V1";
const COMPANY = 9, OWNER = 19, DATE = "2026-10-17";
const accounts = Object.freeze({
  INVENTORY: ["1100", "Inventory", "ASSET"],
  INPUT_TAX: ["1200", "Recoverable Input Tax", "ASSET"],
  ACCOUNTS_RECEIVABLE: ["1300", "Accounts Receivable", "ASSET"],
  ACCOUNTS_PAYABLE: ["2000", "Accounts Payable", "LIABILITY"],
  GRNI: ["2100", "Goods Received Not Invoiced", "LIABILITY"],
  RETAINED_EARNINGS: ["3100", "Retained Earnings", "EQUITY"],
  OPENING_BALANCE_EQUITY: ["3200", "Opening Balance Equity", "EQUITY"],
  COGS: ["5100", "Cost of Goods Sold", "EXPENSE"],
});
const annualRoles = ["ACCOUNTS_PAYABLE", "ACCOUNTS_RECEIVABLE", "OPENING_BALANCE_EQUITY", "RETAINED_EARNINGS"];
const setupTables = new Set(["users", "user_company_memberships", "branches", "user_branch_memberships", "company_business_settings", "company_subscriptions", "subscription_events", "trial_invitations", "trial_invitation_internal_provenance", "financial_years", "financial_year_events", "accounts", "iv_operations", "system_account_role_assignments"]);
const validatedSetupTables = new Set(["business_profiles", "subscription_periods", "audit_logs"]);
const requiredTables = ["companies", "users", "user_company_memberships", "accounts", "financial_years", "system_account_role_assignments", "iv_operations", "products", "invoices", "bills", "goods_receipts", "inventory_transactions", "journal_entries", "journal_entry_details", "opening_balance_events", "expenses", "subledger_opening_items"];
const fail = code => { throw Object.assign(new Error(code), { code }); };
const read = async (cx, sql, args = []) => (await cx.query(sql, args))[0];
const name = value => { if (!/^[a-zA-Z0-9_]+$/.test(value)) fail("FY_PILOT_SCHEMA_INCOMPATIBLE"); return `\`${value}\``; };
function validate(x) {
  const keys = ["confirmation", "transactionOwnership", "identity", "idempotencyKey"];
  if (!x || Object.keys(x).some(k => !keys.includes(k)) || x.confirmation !== CONFIRMATION || x.transactionOwnership !== "EXCLUSIVE_IDLE_CONNECTION" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(x.idempotencyKey || "")) fail("FY_PILOT_AUTHORIZATION_REQUIRED");
}
async function schema(cx) {
  // Read/planning APIs only: never call any migration entrypoint.
  if ((await require("../db/migrations/2026-10-12-operational-quantity-q2").inspect(cx)).classification !== "ALREADY_APPLIED" ||
      (await require("../db/migrations/2026-10-17-account-code-tenant-scope").inspect(cx)).classification !== "ALREADY_APPLIED" ||
      (await require("../db/migrations/2026-10-04-annual-subledger-carry-forward").plan(cx)).length) fail("FY_PILOT_SCHEMA_NOT_READY");
  await require("../services/inventoryValuationSchema").assertReady(cx);
  await require("../services/inventoryGlSchema").assertReady(cx);
  await require("../services/fyPilotRoleSchema").assertReady(cx);
  if (!(await require("../services/annualSubledgerReadinessService").inspectAnnualSchema(cx)).ready) fail("FY_PILOT_SCHEMA_NOT_READY");
}
async function lockSchema(cx) {
  const tables = await read(cx, "SELECT TABLE_NAME,ENGINE,TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME");
  if (requiredTables.some(n => !tables.some(t => t.TABLE_NAME === n))) fail("FY_PILOT_SCHEMA_NOT_READY");
  // Deterministic order, transaction-held MDL. Strictly reject views/nontransactional
  // storage; metadata used by readiness cannot change between checking and writing.
  for (const table of tables) {
    if (table.TABLE_TYPE !== "BASE TABLE" || table.ENGINE !== "InnoDB") fail("FY_PILOT_SCHEMA_INCOMPATIBLE");
    await cx.query(`SELECT 1 FROM ${name(table.TABLE_NAME)} LIMIT 0`);
  }
  return tables.map(t => t.TABLE_NAME);
}
async function base(cx, tables) {
  const company = await read(cx, "SELECT id,name,status FROM companies WHERE id=9 FOR UPDATE");
  const user = await read(cx, "SELECT id,company_id,role,is_active FROM users WHERE id=19 FOR UPDATE");
  const membership = await read(cx, "SELECT membership_role,is_active FROM user_company_memberships WHERE company_id=9 AND user_id=19 FOR UPDATE");
  if (company.length !== 1 || company[0].name !== "RevEx FY Pilot" || company[0].status !== "active" || user.length !== 1 || String(user[0].company_id) !== "9" || user[0].role !== "owner" || String(user[0].is_active) !== "1" || membership.length !== 1 || membership[0].membership_role !== "owner" || String(membership[0].is_active) !== "1") fail("FY_PILOT_IDENTITY_MISMATCH");
  const years = await read(cx, "SELECT CAST(id AS CHAR) id,code,DATE_FORMAT(start_date,'%Y-%m-%d') start_date,DATE_FORMAT(end_date,'%Y-%m-%d') end_date,status,is_default FROM financial_years WHERE company_id=9 ORDER BY id FOR UPDATE");
  const fy = years.filter(y => y.code === "FY2026-27" && y.start_date === "2026-04-01" && y.end_date === "2027-03-31" && y.status === "OPEN" && String(y.is_default) === "1");
  if (fy.length !== 1 || years.filter(y => String(y.is_default) === "1").length !== 1 || years.some(y => y.id !== fy[0].id && y.start_date <= fy[0].end_date && y.end_date >= fy[0].start_date)) fail("FY_PILOT_FY_MISMATCH");
  const found = await read(cx, "SELECT CAST(id AS CHAR) id,account_code,account_name,account_type,status,CAST(opening_balance AS CHAR) opening_balance FROM accounts WHERE company_id=9 ORDER BY id FOR UPDATE");
  const mapping = {};
  if (found.length !== 8) fail("FY_PILOT_ACCOUNTS_MISMATCH");
  for (const [role, [code, label, type]] of Object.entries(accounts)) {
    const matches = found.filter(a => a.account_code === code && a.account_name === label && a.account_type === type && String(a.status) === "1" && a.opening_balance !== null && m.money(a.opening_balance) === 0n);
    if (matches.length !== 1) fail("FY_PILOT_ACCOUNTS_MISMATCH");
    mapping[role] = matches[0].id;
  }
  if (new Set(Object.values(mapping)).size !== 8) fail("FY_PILOT_ACCOUNTS_MISMATCH");
  const setup = await setupEvidence(cx, fy[0], found);
  // Every tenant-bearing table outside the explicitly enumerated setup contracts
  // is empty. Unknown tenant tables therefore fail closed, not silently ignored.
  const columns = await read(cx, "SELECT TABLE_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_NAME='company_id' ORDER BY TABLE_NAME");
  for (const row of columns) {
    if (!tables.includes(row.TABLE_NAME)) fail("FY_PILOT_SCHEMA_CHANGED");
    if (!setupTables.has(row.TABLE_NAME) && !validatedSetupTables.has(row.TABLE_NAME) && (await read(cx, `SELECT company_id FROM ${name(row.TABLE_NAME)} WHERE company_id=9 FOR UPDATE`)).length) fail("FY_PILOT_HISTORY_EXISTS");
  }
  if ((await read(cx, "SELECT d.id FROM journal_entry_details d JOIN accounts a ON a.id=d.account_id WHERE a.company_id=9 FOR UPDATE")).length) fail("FY_PILOT_HISTORY_EXISTS");
  return { fy: fy[0].id, mapping, accounts: found, company, user, membership, years, setup };
}
async function setupEvidence(cx, fy, found) {
  // These are validated setup records, never a blanket history exemption.
  // All reads run under the same transaction/MDL as base(), and all returned
  // evidence participates in the before/after preservation fingerprint.
  const reject = () => fail("FY_PILOT_SETUP_EVIDENCE_MISMATCH");
  const start = "2026-10-16 06:23:21", end = "2026-10-30 06:23:21";
  const profiles = await read(cx, "SELECT * FROM business_profiles WHERE company_id=9 ORDER BY id FOR UPDATE");
  if (profiles.length !== 1 || String(profiles[0].company_id) !== "9" || profiles[0].name !== "RevEx FY Pilot" || profiles[0].email !== "pilot.owner@revexbooks.com" || profiles[0].created_at !== start) reject();
  const plans = await read(cx, "SELECT id,code,name,is_active,default_trial_days FROM plans WHERE code='PLAN_2' ORDER BY id FOR UPDATE");
  if (plans.length !== 1 || plans[0].code !== "PLAN_2" || plans[0].name !== "Pro" || String(plans[0].is_active) !== "1" || String(plans[0].default_trial_days) !== "14") reject();
  const subscriptions = await read(cx, "SELECT * FROM company_subscriptions WHERE company_id=9 ORDER BY id FOR UPDATE");
  if (subscriptions.length !== 1) reject();
  const sub = subscriptions[0];
  if (String(sub.company_id) !== "9" || String(sub.plan_id) !== String(plans[0].id) || sub.status !== "trialing" || sub.billing_cycle !== "none" || String(sub.trial_duration_days) !== "14" || sub.trial_start_at !== start || sub.trial_end_at !== end || sub.current_period_start_at !== start || sub.current_period_end_at !== end) reject();
  const periods = await read(cx, "SELECT * FROM subscription_periods WHERE company_id=9 ORDER BY id FOR UPDATE");
  if (periods.length !== 1) reject();
  const period = periods[0];
  if (String(period.company_id) !== "9" || String(period.subscription_id) !== String(sub.id) || String(period.plan_id) !== String(plans[0].id) || period.period_type !== "trial" || period.billing_cycle !== "none" || period.status !== "active" || period.starts_at !== start || period.ends_at !== end) reject();
  const audits = await read(cx, "SELECT * FROM audit_logs WHERE company_id=9 ORDER BY id FOR UPDATE");
  if (audits.length !== 11 || new Set(audits.map(a => String(a.id))).size !== 11) reject();
  const seen = new Set();
  for (const a of audits) {
    if (String(a.company_id) !== "9" || String(a.user_id) !== "19" || a.method !== "POST" || a.action !== "create") reject();
    let details;
    try { details = typeof a.details === "string" ? JSON.parse(a.details) : a.details; } catch { reject(); }
    if (!details || !details.body || typeof details.body !== "object" || Array.isArray(details.body)) reject();
    const body = details.body;
    let key;
    if (a.path === "/api/accounts") {
      if (a.module_key !== "accounting" || Number(a.status_code) !== 201 || a.resource_id !== null) reject();
      const account = found.find(r => r.account_code === body.account_code);
      const opening = body.opening_balance ?? "0";
      // Match the complete string (including rejecting a trailing newline), without coercing arrays/objects.
      const zeroOpening = opening === 0 || (typeof opening === "string" && (opening === "" || /^0+(?:\.0+)?(?![\s\S])/.test(opening)));
      if (!account || body.account_name !== account.account_name || body.account_type !== account.account_type || !zeroOpening) reject();
      key = `account:${account.account_code}`;
    } else {
      if (a.module_key !== "system") reject();
      if (a.path === "/api/financial-years") {
        if (Number(a.status_code) !== 201 || a.resource_id !== null || body.code !== fy.code || body.start_date !== fy.start_date || body.end_date !== fy.end_date || (body.status !== undefined && body.status !== "DRAFT")) reject();
        key = "fy:create";
      } else if (a.path === `/api/financial-years/${fy.id}/transitions`) {
        if (Number(a.status_code) !== 200 || String(a.resource_id) !== fy.id || body.target_status !== "OPEN") reject();
        key = "fy:open";
      } else if (a.path === `/api/financial-years/${fy.id}/default`) {
        if (Number(a.status_code) !== 200 || String(a.resource_id) !== fy.id || Object.keys(body).length) reject();
        key = "fy:default";
      } else reject();
    }
    if (seen.has(key)) reject();
    seen.add(key);
  }
  if (seen.size !== 11) reject();
  return { profiles, plans, subscriptions, periods, audits };
}
async function annual(cx) {
  return read(cx, "SELECT role,CAST(account_id AS CHAR) account_id,CAST(effective_from_financial_year_id AS CHAR) fy,effective_to_financial_year_id,protected_at,protected_by_close_run_id,CAST(created_by AS CHAR) created_by FROM system_account_role_assignments WHERE company_id=9 ORDER BY role FOR UPDATE");
}
async function verify(cx, state, key, result, includeReceipt) {
  const roles = await annual(cx);
  const seen = new Set();
  if (roles.length !== annualRoles.length || roles.some(r => {
    const role = typeof r.role === "string" ? r.role.trim().toUpperCase() : "";
    if (!annualRoles.includes(role) || seen.has(role)) return true;
    seen.add(role);
    return String(r.account_id) !== state.mapping[role] || String(r.fy) !== state.fy || r.effective_to_financial_year_id !== null || r.protected_at !== null || r.protected_by_close_run_id !== null || String(r.created_by) !== "19";
  })) fail("FY_PILOT_POSTFLIGHT_MISMATCH");
  const rows = await read(cx, "SELECT operation_key,action,result FROM iv_operations WHERE company_id=9 ORDER BY operation_key FOR UPDATE");
  const expected = new Map(Object.keys(gl.roles).map(role => [`${key}:${role}`, ["GL_ROLE", gl.seal({ role, account_id: state.mapping[role], effective_date: DATE })]]));
  expected.set(`${key}:cutover`, ["GL_CUTOVER", result.cutover]);
  if (includeReceipt) expected.set(key, ["FY_PILOT_ACTIVATION", result]);
  if (rows.length !== expected.size) fail("FY_PILOT_POSTFLIGHT_MISMATCH");
  for (const row of rows) {
    const e = expected.get(row.operation_key);
    if (!e || row.action !== e[0] || m.canonical(gl.verified(row.result)) !== m.canonical(e[1])) fail("FY_PILOT_POSTFLIGHT_MISMATCH");
  }
  if (result.cutover.date !== DATE || result.cutover.openings.length || result.cutover.journals.length) fail("FY_PILOT_POSTFLIGHT_MISMATCH");
}
async function activate(connection, input) {
  validate(input);
  const cx = pin(connection);
  let transaction = false, committing = false;
  try {
    await identity(cx, input.identity);
    await schema(cx);
    await cx.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    transaction = true; await cx.query("START TRANSACTION");
    // Company lock precedes all tenant row locks, matching valuation operations.
    await cx.query("SELECT id FROM companies WHERE id=9 FOR UPDATE");
    const tables = await lockSchema(cx);
    await schema(cx);
    const before = await base(cx, tables);
    const op = await ops.begin(cx, COMPANY, OWNER, input.idempotencyKey, "FY_PILOT_ACTIVATION", { date: DATE, fy: before.fy, mapping: before.mapping });
    if (op.completed) {
      const result = gl.verified(op.result);
      await verify(cx, before, input.idempotencyKey, result, true);
      await cx.query("ROLLBACK"); transaction = false;
      return { ...result, replay: true };
    }
    if ((await annual(cx)).length || (await read(cx, "SELECT operation_key FROM iv_operations WHERE company_id=9 FOR UPDATE")).length) fail("FY_PILOT_EXISTING_OR_PARTIAL_STATE");
    for (const role of Object.keys(gl.roles)) await gl.assignRole(cx, { company_id: COMPANY, actor_id: OWNER, role, account_id: before.mapping[role], effective_date: DATE, idempotency_key: `${input.idempotencyKey}:${role}` });
    for (const role of annualRoles) {
      const [insert] = await cx.query("INSERT INTO system_account_role_assignments (company_id,role,account_id,effective_from_financial_year_id,created_by) VALUES (9,?,?,?,19)", [role, before.mapping[role], before.fy]);
      if (insert.affectedRows !== 1 || insert.warningStatus) fail("FY_PILOT_POSTFLIGHT_MISMATCH");
    }
    const cutover = await gl.approveCutover(cx, { company_id: COMPANY, actor_id: OWNER, date: DATE, reason: "Approved history-free Company 9 FY pilot", idempotency_key: `${input.idempotencyKey}:cutover` });
    const result = gl.seal({ company_id: "9", owner_id: "19", financial_year_id: before.fy, mapping: before.mapping, cutover });
    await verify(cx, before, input.idempotencyKey, result, false);
    await ops.complete(cx, op, result);
    await verify(cx, before, input.idempotencyKey, result, true);
    if (m.canonical(before) !== m.canonical(await base(cx, tables))) fail("FY_PILOT_POSTFLIGHT_MISMATCH");
    committing = true; await cx.query("COMMIT"); transaction = false;
    return { ...result, replay: false };
  } catch (error) {
    if (transaction) { try { await cx.cleanup("ROLLBACK"); } catch { fail("FY_PILOT_CLEANUP_FAILED_REQUIRES_INSPECTION"); } }
    if (committing) fail("FY_PILOT_COMMIT_UNCERTAIN_DO_NOT_RETRY_AUTOMATICALLY");
    if (/^FY_PILOT_[A-Z_]+$/.test(error.code || "")) fail(error.code);
    fail("FY_PILOT_ACTIVATION_REJECTED");
  }
}
module.exports = { activate, CONFIRMATION };
