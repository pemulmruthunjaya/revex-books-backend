"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { Fixture, base, opening, evidence, approve } = require("./helpers/inventoryValuationFixture");
const gl = require("../services/inventoryGlService");
const v = require("../services/inventoryValuationService");
const m = require("../services/inventoryValuationMath");
const schema = require("../services/inventoryGlSchema");
const { render, range } = require("../services/inventoryGlReportService");

class GlFixture extends Fixture {
  constructor() {
    super(); this.journals = []; this.details = []; this.invoiceLines = []; this.billLines = []; this.grnLines = []; this.legacy = [];
    this.accounts = Object.entries(gl.roles).map(([role, account_type], index) => ({ id: String(index + 10), role, account_type, status: 1 }));
  }
  async query(sql, args = []) {
    if (sql.includes("FROM expenses")) return [this.expenses || []];
    if (sql.includes("FROM financial_year_close_runs")) return [[]];
    if (sql.includes("LEFT JOIN products") && sql.includes("p.id IS NULL")) return [[]];
    if (sql.includes("information_schema.TRIGGERS") && schema.triggers.some(t => t.name === args[0])) {
      const t = schema.triggers.find(t => t.name === args[0]);
      return [[{ EVENT_OBJECT_TABLE: t.table, EVENT_MANIPULATION: t.event, ACTION_TIMING: "BEFORE", ACTION_ORIENTATION: "ROW", ACTION_STATEMENT: t.body }]];
    }
    if (sql.includes("FROM iv_operations") && sql.includes("action=?")) return [this.operations.filter(op => String(op.company_id) === String(args[0]) && op.action === args[1]).map(op => structuredClone(op))];
    if (sql.includes("FROM accounts")) return [this.accounts.filter(account => String(account.id) === String(args[1]))];
    if (sql.startsWith("SELECT id,CAST(stock")) return [[{ id: "1", stock: this.stock.get("1:1") || "0.00", opening_stock: "0.00" }]];
    if (sql.includes("FROM financial_years")) return [[{ id: args[1] >= "2027-04-01" ? "2" : "1", status: this.blockedDate && args[1] >= this.blockedDate ? "LOCKED" : "OPEN", start_date: args[1] >= "2027-04-01" ? "2027-04-01" : "2026-04-01" }]];
    if (sql.startsWith("INSERT INTO journal_entries")) {
      this.calls.push([sql, args]);
      const id = String(this.journals.length + 1);
      this.journals.push({ id, journal_date: args[1], total_debit: args[3], total_credit: args[4], company_id: String(args[6]), financial_year_id: String(args[7]), status: 1, source_type: args[8], source_id: String(args[9]) });
      return [{ insertId: id, affectedRows: 1 }];
    }
    if (sql.startsWith("INSERT INTO journal_entry_details")) {
      this.calls.push([sql, args]);
      if (this.failDetail) throw new Error("synthetic detail failure");
      this.details.push({ journal_entry_id: String(args[0]), account_id: String(args[1]), debit: args[2], credit: args[3] });
      return [{ affectedRows: 1, insertId: this.details.length }];
    }
    if (sql.includes("FROM journal_entry_details")) return [this.details.filter(d => d.journal_entry_id === String(args[0]))];
    if (sql.includes("FROM journal_entries")) {
      if (sql.includes("source_type IN ('annual_fy_close'")) return [[]];
      let found = this.journals.filter(j => j.company_id === String(args[0]));
      if (sql.includes("AND id=?")) found = found.filter(j => j.id === String(args[1]));
      if (sql.includes("AND financial_year_id=?")) found = found.filter(j => j.financial_year_id === String(args[1]) && j.journal_date <= args[2]);
      return [structuredClone(found)];
    }
    if (sql.includes("FROM invoice_items")) return [this.invoiceLines.filter(line => !sql.includes("AND ii.id=?") || String(line.invoice_id) === String(args[1]) && String(line.id) === String(args[2]))];
    if (sql.includes("FROM bill_items")) return [this.billLines];
    if (sql.includes("FROM goods_receipt_items") && sql.includes("CAST(gri.received_qty")) return [this.grnLines];
    if (sql.includes("FROM inventory_transactions")) return [sql.includes("LEFT JOIN products") ? [] : this.legacy];
    if (sql.includes("FROM delivery_challan_items") || sql.includes("FROM return_items")) return [[]];
    return super.query(sql, args);
  }
  async transaction(fn) {
    const journals = structuredClone(this.journals), details = structuredClone(this.details);
    try { return await super.transaction(fn); } catch (error) { this.journals = journals; this.details = details; throw error; }
  }
}
async function setup(type = "GRN") {
  const cx = new GlFixture(); await opening(cx);
  for (const account of cx.accounts) await gl.assignRole(cx, { company_id: "1", actor_id: "2", role: account.role, account_id: account.id, effective_date: "2026-04-01", idempotency_key: `role:${account.role}` });
  await gl.approveCutover(cx, { company_id: "1", actor_id: "2", date: "2026-04-01", reason: "synthetic independently approved zero cutover", idempotency_key: "cutover" });
  const source = await v.createAcquisition(cx, { ...base, date: "2027-03-30", document_type: type, document_id: "7", source_line: "11", reference: "synthetic", idempotency_key: "source" });
  const cost = await v.recordCost(cx, { ...base, source_id: source.id, evidence: evidence(), idempotency_key: "cost" });
  await approve(cx, { ...base, actor_id: "2", revision_id: cost.id, reason: "approved", idempotency_key: "approved" });
  const receipt = { ...base, source_id: source.id, revision_id: cost.id, idempotency_key: "receipt" };
  return { cx, source, cost, receipt };
}
const businessWrites = calls => calls.filter(([sql]) => /^(INSERT|UPDATE|DELETE|CREATE|ALTER)/.test(sql));

test("persisted receipt bridge creates exact linked journal once and identical retry performs no write", async () => {
  const f = await setup();
  await v.postAcquisition(f.cx, f.receipt);
  assert.equal(f.cx.journals.length, 1);
  assert.equal(f.cx.journals[0].journal_date, "2027-03-30");
  assert.deepEqual(f.cx.details.map(d => [d.account_id, d.debit, d.credit]), [["12", "0.00", "10.00"], ["10", "10.00", "0.00"]]);
  const posts = await gl.events(f.cx, "1", "GL_POST");
  assert.equal(posts.length, 1); assert.equal(posts[0].targets[0].references.includes(f.source.id), true);
  const writes = businessWrites(f.cx.calls).length;
  await v.postAcquisition(f.cx, f.receipt);
  assert.equal(businessWrites(f.cx.calls).length, writes);
  await gl.verifyJournals(f.cx, "1", posts);
});

test("cross-FY final bill persists original-date replay and bill-date clearance; retry and rollback are atomic", async () => {
  const f = await setup(); await v.postAcquisition(f.cx, f.receipt);
  f.cx.invoiceLines.push({ id: "15", invoice_id: "10", product_id: "1", quantity: "4.00", business_date: "2027-04-02" });
  await v.postMovement(f.cx, { ...base, kind: "ISSUE", date: "2027-04-02", quantity: "4", document_type: "SALES_INVOICE", document_id: "10", source_line: "15", idempotency_key: "issue" });
  const final = await v.recordCost(f.cx, { ...base, source_id: f.source.id, supersedes_id: f.cost.id, evidence: evidence({ state: "FINAL", basis: "SUPPLIER_DOCUMENT", purchase_minor: "1200", total_minor: "1200" }), idempotency_key: "final" });
  await approve(f.cx, { ...base, actor_id: "2", revision_id: final.id, reason: "approved", idempotency_key: "final-approved" });
  const input = { source_id: f.source.id, revision_id: final.id, bill_id: "20", bill_date: "2027-04-05", line_id: "25" };
  const before = m.canonical({ records: f.cx.rows, operations: f.cx.operations, journals: f.cx.journals, details: f.cx.details });
  f.cx.failDetail = true;
  await assert.rejects(f.cx.transaction(cx => v.applyBillCost(cx, base, input)), /synthetic detail failure/);
  assert.equal(m.canonical({ records: f.cx.rows, operations: f.cx.operations, journals: f.cx.journals, details: f.cx.details }), before);
  f.cx.failDetail = false;
  await f.cx.transaction(cx => v.applyBillCost(cx, base, input));
  const head = gl.currentTargets(await gl.events(f.cx, "1", "GL_POST"));
  assert.deepEqual(head.journals.map(j => j.date), ["2027-03-30", "2027-04-02", "2027-04-05"]);
  assert.equal(head.lines.find(l => l.date === "2027-04-02" && l.role === "COGS").signed_minor, "80");
  assert.equal(head.lines.find(l => l.date === "2027-04-05" && l.role === "GRNI").signed_minor, "1200");
  const count = f.cx.journals.length;
  await v.applyBillCost(f.cx, base, input); assert.equal(f.cx.journals.length, count);
});

test("missing role, non-OPEN original date and modified linked journal fail before valuation writes", async () => {
  const f = await setup();
  f.cx.blockedDate = "2027-03-30";
  let start = f.cx.calls.length;
  await assert.rejects(v.postAcquisition(f.cx, f.receipt), { code: "IV_OPEN_FY_REQUIRED" });
  assert.deepEqual(businessWrites(f.cx.calls.slice(start)), []);
  f.cx.blockedDate = null;
  await v.postAcquisition(f.cx, f.receipt);
  f.cx.details[0].credit = "9.99";
  start = f.cx.calls.length;
  await assert.rejects(gl.prepare(f.cx, base, await v.records(f.cx, base)), { code: "IV_GL_JOURNAL_MISMATCH" });
  assert.deepEqual(businessWrites(f.cx.calls.slice(start)), []);
  const g = await setup(); g.cx.accounts.find(a => a.role === "COGS").status = 0;
  start = g.cx.calls.length;
  await assert.rejects(v.postAcquisition(g.cx, g.receipt), { code: "IV_GL_ROLE_INCOMPATIBLE" });
  assert.deepEqual(businessWrites(g.cx.calls.slice(start)), []);
});

test("cutover and account roles require owner approval and refuse retroactive relabeling", async () => {
  const f = await setup();
  await assert.rejects(gl.assignRole(f.cx, { company_id: "1", actor_id: "1", role: "COGS", account_id: "11", effective_date: "2027-01-01", idempotency_key: "unauthorized" }), { code: "IV_OWNER_APPROVAL_REQUIRED" });
  await v.postAcquisition(f.cx, f.receipt);
  await assert.rejects(gl.assignRole(f.cx, { company_id: "1", actor_id: "2", role: "COGS", account_id: "11", effective_date: "2027-01-01", idempotency_key: "retroactive" }), { code: "IV_GL_ROLE_ALREADY_POSTED" });
  await assert.rejects(gl.approveCutover(f.cx, { company_id: "1", actor_id: "2", date: "2026-04-01", reason: "new", idempotency_key: "another-cutover" }), { code: "IV_GL_CUTOVER_IMMUTABLE" });
});

test("GL report uses journals, not purchases as COGS, and forbids mixed-basis/multi-FY ranges", () => {
  const accounts = [{ id: "1", account_type: "ASSET" }, { id: "2", account_type: "INCOME" }, { id: "3", account_type: "EXPENSE" }];
  const lines = [{ account_id: "1", signed_minor: "6000" }, { account_id: "2", signed_minor: "-10000" }, { account_id: "3", signed_minor: "4000" }].map(line => ({ ...line, date: "2027-01-01", source_type: "synthetic" }));
  const result = render("profit-loss", accounts, lines, { from_date: "2026-04-01", to_date: "2027-03-31" });
  assert.equal(result.summary.net_profit, 60); assert.equal(result.summary.total_expense, 40);
  const years = [{ start_date: "2026-04-01", end_date: "2027-03-31" }];
  assert.throws(() => range({ date: "2026-04-01" }, { from_date: "2026-03-31", to_date: "2027-03-31" }, years), { code: "IV_GL_MIXED_BASIS_RANGE" });
  assert.throws(() => range({ date: "2026-04-01" }, { from_date: "2026-04-01", to_date: "2027-04-01" }, years), { code: "IV_GL_SINGLE_FY_REPORT_REQUIRED" });
});

test("additive protection migration is pinned, import inert and refuses execution without confirmation", async () => {
  const migration = require("../db/migrations/2026-10-09-inventory-gl-protection");
  assert.equal(migration.statements().length, schema.triggers.length);
  let calls = 0;
  await assert.rejects(migration.migrate({ query() { calls++; throw new Error("not authorized"); } }), /IV_GL_EXPLICIT_MIGRATION_REQUIRED/);
  assert.equal(calls, 0);
  for (const trigger of schema.triggers) assert.match(trigger.body, /SIGNAL SQLSTATE '45000'/);
});

test("readiness reconciles actual journals and source lines, blocks unresolved GRNI and detects manual control postings", async () => {
  const f = await setup(); await v.postAcquisition(f.cx, f.receipt);
  f.cx.stock.set("1:1", "10.00");
  f.cx.legacy.push({ reference_type: "GRN", reference_id: "7", quantity_in: "10.00", quantity_out: "0.00" });
  f.cx.grnLines.push({ id: "11", goods_receipt_id: "7", product_id: "1", received_qty: "10.00", rejected_qty: "0.00", accepted_qty: "10.00", status: "Posted", stock_posted: "1", grn_date: "2027-03-30" });
  let proof = await gl.inspect(f.cx, "1", "2027-03-31");
  assert.deepEqual(proof.blockers, ["IV_GL_PROVISIONAL_GRNI_UNRESOLVED"]);
  const final = await v.recordCost(f.cx, { ...base, source_id: f.source.id, supersedes_id: f.cost.id, evidence: evidence({ state: "FINAL", basis: "SUPPLIER_DOCUMENT", purchase_minor: "1200", total_minor: "1200" }), idempotency_key: "readiness-final" });
  await approve(f.cx, { ...base, actor_id: "2", revision_id: final.id, reason: "approved", idempotency_key: "readiness-approved" });
  await v.applyBillCost(f.cx, base, { source_id: f.source.id, revision_id: final.id, bill_id: "20", bill_date: "2027-04-05", line_id: "25" });
  f.cx.billLines.push({ id: "25", bill_id: "20", product_id: "1", quantity: "10.00", price: "1.20", total: "12.00", source_grn_item_id: "11", source_grn_id: "7", bill_date: "2027-04-05", business_date: "2027-04-05" });
  proof = await gl.inspect(f.cx, "1", "2027-03-31");
  assert.deepEqual(proof.blockers, []); assert.equal(proof.ready, true);
  assert.equal(proof.inventory[0].valuation_amount, "12.00");
  assert.equal((await gl.inspect(f.cx, "1", "2027-03-31")).fingerprint, proof.fingerprint);
  f.cx.billLines[0].quantity = "9.00";
  assert.equal((await gl.inspect(f.cx, "1", "2027-03-31")).ready, false);
  f.cx.billLines[0].quantity = "10.00";
  // Balanced manual posting can net to zero in inventory yet be unsupported.
  f.cx.journals.push({ id: "99", company_id: "1", financial_year_id: "1", journal_date: "2027-03-31", status: 1, source_type: "manual", source_id: "99", total_debit: "1.00", total_credit: "1.00" });
  f.cx.details.push({ journal_entry_id: "99", account_id: "10", debit: "1.00", credit: "0.00" }, { journal_entry_id: "99", account_id: "10", debit: "0.00", credit: "1.00" });
  assert.equal((await gl.inspect(f.cx, "1", "2027-03-31")).ready, false);
});

test("FY close cannot certify a quantity-only snapshot or unresolved GL reconciliation", () => {
  const fs = require("node:fs"), path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "../services/financialYearCloseService.js"), "utf8");
  assert.match(source, /inventory_gl: inventoryGl/);
  assert.match(source, /'REQUIRED'/);
  assert.doesNotMatch(source, /'NOT_AVAILABLE'/);
  assert.match(source, /WITH CONSISTENT SNAPSHOT, READ ONLY/);
});

test("direct-stock persisted bills and approved date replacement reverse exact original GL without GRNI", async () => {
  const f = await setup("SUPPLIER");
  const final = await v.recordCost(f.cx, { ...base, source_id: f.source.id, supersedes_id: f.cost.id, evidence: evidence({ state: "FINAL", basis: "SUPPLIER_DOCUMENT" }), idempotency_key: "direct-final" });
  await approve(f.cx, { ...base, actor_id: "2", revision_id: final.id, reason: "approved", idempotency_key: "direct-approved" });
  const input = { source_id: f.source.id, revision_id: final.id, bill_id: "20", bill_date: "2027-03-30", line_id: "25" };
  const link = await v.applyBillCost(f.cx, base, input);
  f.cx.stock.set("1:1", "10.00");
  const before = structuredClone(f.cx.journals), receipt = f.cx.rows.find(row => row.kind === "RECEIPT");
  const replacementSource = await v.createAcquisition(f.cx, { ...base, date: "2027-04-05", document_type: "SUPPLIER", document_id: "replacement", source_line: "replacement", reference: "synthetic approved corrected bill", idempotency_key: "replacement-source" });
  const replacementCost = await v.recordCost(f.cx, { ...base, source_id: replacementSource.id, evidence: evidence({ state: "FINAL", basis: "SUPPLIER_DOCUMENT", purchase_minor: "1200", total_minor: "1200" }), idempotency_key: "replacement-cost" });
  await approve(f.cx, { ...base, actor_id: "2", revision_id: replacementCost.id, reason: "approved", idempotency_key: "replacement-approved" });
  const corrections = require("../services/inventoryValuationCorrectionService");
  const correction = await corrections.create(f.cx, { ...base, bill_id: "20", movement_id: receipt.id, previous_bill_link_id: link.id, new_source_id: replacementSource.id, new_revision_id: replacementCost.id, reason: "synthetic corrected receipt and bill date", idempotency_key: "direct-correction" });
  await corrections.approve(f.cx, { ...base, actor_id: "2", correction_id: correction.id, reason: "approved", idempotency_key: "direct-correction-approved" });
  await v.applyBillCost(f.cx, base, { ...input, source_id: replacementSource.id, revision_id: replacementCost.id, correction_id: correction.id, bill_date: "2027-04-05", line_id: "26" });
  const latest = gl.currentTargets(await gl.events(f.cx, "1", "GL_POST"));
  assert.deepEqual(latest.journals.map(row => row.date), ["2027-03-30", "2027-04-05"]);
  assert.equal(latest.lines.some(line => line.role === "GRNI"), false);
  assert.equal(latest.lines.find(line => line.role === "INVENTORY" && line.date === "2027-03-30").signed_minor, "-1000");
  assert.equal(latest.lines.find(line => line.role === "INVENTORY" && line.date === "2027-04-05").signed_minor, "1200");
  assert.deepEqual(f.cx.journals.slice(0, before.length), before);
  assert.equal(f.cx.stock.get("1:1"), "10.00");
});

test("GL posting cannot be invoked as an unapproved historical repair", async () => {
  const f = await setup();
  const start = f.cx.calls.length;
  await assert.rejects(gl.post(f.cx, base), { code: "IV_GL_POSTING_PROOF_REQUIRED" });
  assert.deepEqual(businessWrites(f.cx.calls.slice(start)), []);
});

test("unposted expenses fail report/close readiness even when the inventory ledger balances", async () => {
  const f = await setup();
  f.cx.expenses = [{ id: "88" }];
  const result = await gl.inspect(f.cx, "1", "2027-03-31");
  assert.equal(result.ready, false);
  assert.deepEqual(result.blockers, ["IV_GL_UNPOSTED_EXPENSE"]);
});

test("approved later zero opening is zero at an earlier cutoff, not a missing historical opening", async () => {
  const cx = new GlFixture(); await opening(cx);
  const rows = await v.records(cx, base);
  const moved = rows.map(row => ({ ...row, effective_date: "2027-04-01" }));
  assert.deepEqual(gl.postCutoffOpening(moved, "2027-03-31"), {quantity:"0.00",value_minor:"0"});
  assert.throws(() => gl.postCutoffOpening(moved, "2027-04-02"), {code:"IV_GL_CUTOVER_OPENING_REQUIRED"});
  assert.throws(() => gl.postCutoffOpening([...moved,{kind:"ISSUE",effective_date:"2027-03-01"}], "2027-03-31"), {code:"IV_GL_HISTORICAL_GAP"});
  const nonzero = moved.map(row => row.kind === "COST" ? {...row,payload:{...row.payload,quantity:"1.00"}} : row);
  assert.throws(() => gl.postCutoffOpening(nonzero, "2027-03-31"), {code:"IV_GL_HISTORICAL_GAP"});
});

module.exports = { GlFixture, setup };
