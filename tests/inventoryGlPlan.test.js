"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const p = require("../services/inventoryGlPlan");
const v = require("../services/inventoryValuationService");
const { Fixture, base, opening, evidence, approve } = require("./helpers/inventoryValuationFixture");

async function setup(type = "GRN") {
  const cx = new Fixture();
  await opening(cx);
  const source = await v.createAcquisition(cx, { ...base, date: "2027-03-30", document_type: type, document_id: "7", source_line: "11", reference: "synthetic", idempotency_key: "source" });
  const cost = await v.recordCost(cx, { ...base, source_id: source.id, evidence: evidence(), idempotency_key: "provisional" });
  await approve(cx, { ...base, actor_id: "2", revision_id: cost.id, reason: "reviewed", idempotency_key: "provisional-approved" });
  let prior = cost;
  if (type === "GRN") await v.postAcquisition(cx, { ...base, source_id: source.id, revision_id: cost.id, idempotency_key: "receipt" });
  const bill = async (id, quantity, amount, date = "2027-04-05") => {
    const revision = await v.recordCost(cx, { ...base, source_id: source.id, supersedes_id: prior.id, evidence: evidence({ state: "FINAL", basis: "SUPPLIER_DOCUMENT", quantity, purchase_minor: amount, total_minor: amount }), idempotency_key: `cost:${id}:${amount}` });
    await approve(cx, { ...base, actor_id: "2", revision_id: revision.id, reason: "reviewed", idempotency_key: `approve:${id}:${amount}` });
    await v.applyBillCost(cx, base, { source_id: source.id, revision_id: revision.id, bill_id: id, bill_date: date, line_id: `line:${id}:${amount}` });
    prior = revision;
  };
  const rows = () => v.records(cx, base);
  const targets = async () => p.expectedTargets(await rows(), "2026-04-01");
  return { cx, source, bill, rows, targets };
}
const net = (targets, date, role) => targets.flatMap(t => t.lines).filter(l => l.date === date && l.role === role).reduce((s, l) => s + BigInt(l.signed_minor), 0n);

test("cross-FY finalization: receipt replay uses original date; GRNI/AP settlement uses bill date", async () => {
  const f = await setup(), before = await f.targets();
  await v.postMovement(f.cx, { ...base, date: "2027-04-02", kind: "ISSUE", quantity: "4", document_type: "SALES_INVOICE", document_id: "10", source_line: "15", idempotency_key: "issue" });
  const issued = await f.targets();
  await f.bill("20", "10", "1200");
  const after = await f.targets(), changes = p.replayDeltas(after, issued);
  assert.equal(net(before, "2027-03-30", "INVENTORY"), 1000n);
  assert.equal(net(after, "2027-03-30", "INVENTORY"), 1200n);
  assert.equal(net(changes, "2027-03-30", "GRNI"), -200n);
  assert.equal(net(changes, "2027-04-02", "COGS"), 80n);
  assert.equal(net(changes, "2027-04-02", "INVENTORY"), -80n);
  assert.equal(net(changes, "2027-04-05", "GRNI"), 1200n);
  assert.equal(net(changes, "2027-04-05", "ACCOUNTS_PAYABLE"), -1200n);
  for (const delta of changes) p.balanced(delta.lines);
  assert.deepEqual(p.replayDeltas(after, after), []);
});

test("partial bills clear only linked finalized cost; residual receipt liability is not guessed", async () => {
  const f = await setup();
  await f.bill("20", "4", "600");
  let rows = await f.rows(), targets = await f.targets();
  const current = p.reconcileGrni(rows, targets, "2027-04-05");
  assert.equal(current.balances[0].balance_minor, "600");
  assert.equal(current.balances[0].billed_q6, "4000000");
  assert.equal(current.close_ready, false);
  await f.bill("21", "6", "900", "2027-04-06");
  rows = await f.rows(); targets = await f.targets();
  assert.equal(p.reconcileGrni(rows, targets, "2027-04-06").balances[0].balance_minor, "0");
  const cutoff = p.reconcileGrni(rows, targets, "2027-03-31");
  assert.equal(cutoff.balances[0].balance_minor, "1500");
  assert.equal(cutoff.balances[0].billed_q6, "0");
  assert.equal(cutoff.close_ready, true, "final cost established; later settlement must not erase earlier accrued GRNI");
});

test("missing, unrelated or insufficient receipt GRNI is rejected, never balanced using another receipt", async () => {
  const f = await setup(); await f.bill("20", "10", "1200");
  const rows = await f.rows(), targets = await f.targets();
  assert.throws(() => p.reconcileGrni(rows, targets.filter(t => !t.key.startsWith("receipt:")), "2027-04-06"), /IV_GL_GRNI_RECEIPT_MISSING/);
  const changed = structuredClone(targets), receipt = changed.find(t => t.key.startsWith("receipt:"));
  receipt.lines.find(l => l.role === "GRNI").signed_minor = "-1199";
  assert.throws(() => p.reconcileGrni(rows, changed, "2027-04-06"), /IV_GL_GRNI_INSUFFICIENT_OR_MISMATCHED/);
  const unlinked = structuredClone(targets); unlinked.find(t => t.key.startsWith("bill:")).references = [];
  assert.throws(() => p.reconcileGrni(rows, unlinked, "2027-04-06"), /IV_GL_GRNI_BILL_LINK_MISSING/);
});

test("direct-stock bill has no GRNI; date mismatch is rejected", async () => {
  const f = await setup("SUPPLIER"); await f.bill("20", "10", "1200", "2027-03-30");
  const targets = await f.targets();
  assert.equal(targets.length, 1);
  assert.equal(targets[0].lines.some(l => l.role === "GRNI"), false);
  assert.equal(net(targets, "2027-03-30", "INVENTORY"), 1200n);
  const rows = await f.rows(); rows.find(r => r.kind === "BILL_LINK").effective_date = "2027-04-05";
  assert.throws(() => p.expectedTargets(rows, "2026-04-01"), /IV_GL_DIRECT_BILL_DATE_OR_VALUE_MISMATCH/);
});

test("direct-stock date mismatch fails with a fixed error before every write", async () => {
  const f = await setup("SUPPLIER");
  const cost = await v.recordCost(f.cx, { ...base, source_id: f.source.id, supersedes_id: f.cx.rows.find(r => r.kind === "COST" && r.source_id === f.source.id).id,
    evidence: evidence({ state: "FINAL", basis: "SUPPLIER_DOCUMENT", quantity: "10", purchase_minor: "1200", total_minor: "1200" }), idempotency_key: "direct-final" });
  await approve(f.cx, { ...base, actor_id: "2", revision_id: cost.id, reason: "reviewed", idempotency_key: "direct-final-approved" });
  const input = { source_id: f.source.id, revision_id: cost.id, bill_id: "20", bill_date: "2027-04-05", line_id: "30" };
  const before = structuredClone({ rows: f.cx.rows, operations: f.cx.operations }), start = f.cx.calls.length;
  await assert.rejects(v.applyBillCost(f.cx, base, input), error => error.code === "IV_DIRECT_STOCK_DATE_MISMATCH" && error.message === error.code);
  assert.deepEqual({ rows: f.cx.rows, operations: f.cx.operations }, before);
  assert.equal(f.cx.calls.slice(start).some(([sql]) => /^(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)/.test(sql)), false);
  const valid = { ...input, bill_date: "2027-03-30" };
  await assert.rejects(f.cx.transaction(async () => { await v.applyBillCost(f.cx, base, valid); throw new Error("synthetic posting failure"); }), /synthetic posting failure/);
  assert.deepEqual({ rows: f.cx.rows, operations: f.cx.operations }, before);
  const posted = await v.applyBillCost(f.cx, base, valid), count = f.cx.rows.length;
  assert.deepEqual(await v.applyBillCost(f.cx, base, valid), posted);
  assert.equal(f.cx.rows.length, count);
});

test("posted direct-stock date edit is rejected before mutation even with a new approved cost", async () => {
  const f = await setup("SUPPLIER"); await f.bill("20", "10", "1200", "2027-03-30");
  const previous = f.cx.rows.find(r => r.kind === "BILL_LINK");
  const cost = await v.recordCost(f.cx, { ...base, source_id: f.source.id, supersedes_id: previous.target_id,
    evidence: evidence({ state: "FINAL", basis: "SUPPLIER_DOCUMENT", quantity: "10", purchase_minor: "1300", total_minor: "1300" }), idempotency_key: "edited-cost" });
  await approve(f.cx, { ...base, actor_id: "2", revision_id: cost.id, reason: "reviewed", idempotency_key: "edited-cost-approved" });
  const start = f.cx.calls.length, before = structuredClone(f.cx.rows);
  await assert.rejects(v.applyBillCost(f.cx, base, { source_id: f.source.id, revision_id: cost.id, bill_id: "20", bill_date: "2027-04-05", line_id: "31" }), error => error.code === "IV_DIRECT_STOCK_DATE_IMMUTABLE");
  await assert.rejects(require("../services/inventoryValuationPostingService").guardBillEdit(f.cx,
    { user: { company_id: "1", id: "1" }, body: { bill_date: "2027-04-05", valuation_lines: [{ acquisition_id: f.source.id, revision_id: cost.id }] } },
    "20", [{ product_id: "1", qty: "10" }]), error => error.code === "IV_DIRECT_STOCK_DATE_IMMUTABLE");
  assert.deepEqual(f.cx.rows, before);
  assert.equal(f.cx.calls.slice(start).some(([sql]) => /^(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)/.test(sql)), false);
});

test("approved direct-stock date reversal/replacement preserves history, rolls back, retries, and follows lineage rather than dates", async () => {
  const f = await setup("SUPPLIER"); await f.bill("20", "10", "1200", "2027-03-30");
  f.cx.stock.set("1:1", "10.00");
  const query = f.cx.query.bind(f.cx), corrections = require("../services/inventoryValuationCorrectionService");
  f.cx.query = async (sql, params) => {
    if (sql.startsWith("SELECT bi.id")) return [f.cx.rows.filter(r => r.kind === "BILL_LINK" && !f.cx.rows.some(n => n.supersedes_id === r.id)).map(r => ({ id: r.source_line }))];
    if (/FROM (invoice_items|return_items|delivery_challan_items|inventory_transactions)/.test(sql)) return [[]];
    return query(sql, params);
  };
  for (const [date, key] of [["2027-04-05", "forward"], ["2027-03-29", "backward"]]) {
    const rows = await f.rows(), receipt = rows.find(r => r.kind === "RECEIPT"), old = v.appliedBasis(rows, receipt);
    const prior = v.latestBillLinks(rows, old.source_id)[0], oldTargets = await f.targets();
    const source = await v.createAcquisition(f.cx, { ...base, date, document_type: "SUPPLIER", document_id: `replacement-${key}`, source_line: "11", reference: "approved replacement document", idempotency_key: `${key}:source` });
    const cost = await v.recordCost(f.cx, { ...base, source_id: source.id, evidence: evidence({ state: "FINAL", basis: "SUPPLIER_DOCUMENT", quantity: "10", purchase_minor: "1200", total_minor: "1200" }), idempotency_key: `${key}:cost` });
    await approve(f.cx, { ...base, actor_id: "2", revision_id: cost.id, reason: "reviewed", idempotency_key: `${key}:cost-approved` });
    const correction = await corrections.create(f.cx, { ...base, bill_id: "20", movement_id: receipt.id, previous_bill_link_id: prior.id, new_source_id: source.id, new_revision_id: cost.id, reason: "document date correction", idempotency_key: `${key}:correction` });
    const input = { source_id: source.id, revision_id: cost.id, correction_id: correction.id, bill_id: "20", bill_date: date, line_id: `${key}:line` };
    const calls = f.cx.calls.length;
    await assert.rejects(v.applyBillCost(f.cx, base, input), /IV_CORRECTION_NOT_APPROVED/);
    assert.equal(f.cx.calls.slice(calls).some(([sql]) => /^(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)/.test(sql)), false);
    await corrections.approve(f.cx, { ...base, actor_id: "2", correction_id: correction.id, reason: "owner approved replacement", idempotency_key: `${key}:approved` });
    const before = structuredClone(f.cx.rows), operations = structuredClone(f.cx.operations);
    await assert.rejects(f.cx.transaction(async () => { await v.applyBillCost(f.cx, base, input); throw new Error("synthetic journal failure"); }), /synthetic journal failure/);
    assert.deepEqual(f.cx.rows, before); assert.deepEqual(f.cx.operations, operations);
    await require("../services/inventoryValuationPostingService").guardBillEdit(f.cx,
      { user: { company_id: "1", id: "1" }, body: { bill_date: date, valuation_lines: [{ acquisition_id: source.id, revision_id: cost.id, correction_id: correction.id }] } }, "20", [{ product_id: "1", qty: "10" }]);
    const result = await v.applyBillCost(f.cx, base, input), count = f.cx.rows.length;
    assert.deepEqual(await v.applyBillCost(f.cx, base, input), result); assert.equal(f.cx.rows.length, count);
    assert.deepEqual(f.cx.rows.slice(0, before.length), before);
    assert.equal(f.cx.stock.get("1:1"), "10.00");
    const current = await f.rows();
    assert.equal(v.appliedBasis(current, receipt).effective_date, date);
    assert.equal(v.projection(current).quantity, "10.000000");
    const deltas = p.replayDeltas(await f.targets(), oldTargets);
    assert.equal(net(deltas, old.effective_date, "INVENTORY"), -1200n);
    assert.equal(net(deltas, date, "INVENTORY"), 1200n);
    assert.ok(deltas.flatMap(t => t.lines).every(line => line.role !== "GRNI"));
  }
});

test("replay retries are empty and predecessor tampering is rejected", async () => {
  const f = await setup(), prior = await f.targets();
  assert.deepEqual(p.replayDeltas(prior, prior), []);
  const bad = structuredClone(prior); bad[0].lines[0].signed_minor = "1";
  assert.throws(() => p.replayDeltas(prior, bad), /IV_GL_DATE_UNBALANCED|IV_GL_PRIOR_EVIDENCE_INVALID/);
  assert.throws(() => p.replayDeltas(prior, [...prior, ...prior]), /IV_GL_PRIOR_EVIDENCE_INVALID/);
});

test("approved date replacement cannot move supply past an existing issue or write into a frozen replacement FY", async () => {
  const f = await setup("SUPPLIER"); await f.bill("20", "10", "1200", "2027-03-30");
  await v.postMovement(f.cx, { ...base, date: "2027-03-31", kind: "ISSUE", quantity: "4", document_type: "SALES_INVOICE", document_id: "10", source_line: "15", idempotency_key: "dated-issue" });
  f.cx.stock.set("1:1", "6.00");
  const corrections = require("../services/inventoryValuationCorrectionService");
  const rows = await f.rows(), receipt = rows.find(row => row.kind === "RECEIPT"), previous = v.latestBillLinks(rows, f.source.id)[0];
  const source = await v.createAcquisition(f.cx, { ...base, date: "2027-04-05", document_type: "SUPPLIER", document_id: "dated-replacement", source_line: "11", reference: "synthetic", idempotency_key: "late-source" });
  const cost = await v.recordCost(f.cx, { ...base, source_id: source.id, evidence: evidence({ state: "FINAL", basis: "SUPPLIER_DOCUMENT", quantity: "10", purchase_minor: "1200", total_minor: "1200" }), idempotency_key: "late-cost" });
  await approve(f.cx, { ...base, actor_id: "2", revision_id: cost.id, reason: "reviewed", idempotency_key: "late-cost-approved" });
  const correction = await corrections.create(f.cx, { ...base, bill_id: "20", movement_id: receipt.id, previous_bill_link_id: previous.id, new_source_id: source.id, new_revision_id: cost.id, reason: "synthetic correction", idempotency_key: "late-correction" });
  await corrections.approve(f.cx, { ...base, actor_id: "2", correction_id: correction.id, reason: "reviewed", idempotency_key: "late-correction-approved" });
  const input = { source_id: source.id, revision_id: cost.id, correction_id: correction.id, bill_id: "20", bill_date: "2027-04-05", line_id: "late-line" };
  const before = structuredClone({ rows: f.cx.rows, operations: f.cx.operations }), start = f.cx.calls.length;
  await assert.rejects(v.applyBillCost(f.cx, base, input), error => error.code === "IV_NEGATIVE_STOCK");
  const query = f.cx.query.bind(f.cx);
  f.cx.query = async (sql, params = []) => sql.includes("FROM financial_years") && params[1] === "2027-04-05"
    ? [[{ id: "2", status: "LOCKED" }]] : query(sql, params);
  await assert.rejects(v.applyBillCost(f.cx, base, input), error => error.code === "IV_OPEN_FY_REQUIRED");
  assert.deepEqual({ rows: f.cx.rows, operations: f.cx.operations }, before);
  assert.equal(f.cx.stock.get("1:1"), "6.00");
  assert.equal(f.cx.calls.slice(start).some(([sql]) => /^(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)/.test(sql)), false);
});

test("target retirement emits dated reversal rather than rewriting an earlier journal", () => {
  const prior = p.target("old-source", ["old-evidence"], [
    { date: "2027-03-30", role: "INVENTORY", signed_minor: "100" },
    { date: "2027-03-30", role: "ACCOUNTS_PAYABLE", signed_minor: "-100" },
  ]);
  const [delta] = p.replayDeltas([], [prior]);
  assert.equal(delta.predecessor, prior.fingerprint);
  assert.equal(net([delta], "2027-03-30", "INVENTORY"), -100n);
  assert.deepEqual(delta.target.lines, []);
});

test("unknown tax and unlinked landed-cost counterparties fail closed", () => {
  assert.throws(() => p.taxAmounts({ payload: evidence({ taxes: [{ amount_minor: "1", recoverability: "UNKNOWN" }] }) }), /IV_GL_TAX_CLASSIFICATION_REQUIRED/);
  assert.throws(() => p.taxAmounts({ payload: evidence({ allocations: [{}] }) }), /IV_GL_COMPONENT_COUNTERPARTY_REQUIRED/);
  assert.deepEqual(p.taxAmounts({ payload: evidence({ taxes: [{ amount_minor: "240", recoverability: "RECOVERABLE" }] }) }), { capitalized: 1000n, recoverable: 240n, payable: 1240n });
});

for (const status of ["DRAFT", "RECONCILIATION", "CLOSING", "CLOSED", "LOCKED"]) {
  test(`cross-FY replay rejects ${status} in the affected issue FY before any write`, async () => {
    const f = await setup();
    await v.postMovement(f.cx, { ...base, date: "2027-04-02", kind: "ISSUE", quantity: "4", document_type: "SALES_INVOICE", document_id: "10", source_line: "15", idempotency_key: "issue" });
    const query = f.cx.query.bind(f.cx);
    f.cx.query = async (sql, params = []) => {
      if (sql.includes("FROM financial_years") && params[1] >= "2027-04-01") {
        f.cx.calls.push([sql, params]);
        return [[{ id: "2", status }]];
      }
      return query(sql, params);
    };
    const before = structuredClone({ rows: f.cx.rows, operations: f.cx.operations }), start = f.cx.calls.length;
    await assert.rejects(f.bill("20", "10", "1200"), error => error.code === "IV_OPEN_FY_REQUIRED");
    assert.deepEqual({ rows: f.cx.rows, operations: f.cx.operations }, before);
    assert.equal(f.cx.calls.slice(start).some(([sql]) => /^(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)/.test(sql)), false);
    const locks = f.cx.calls.slice(start).filter(([sql]) => sql.includes("FROM financial_years"));
    assert.ok(locks.some(([, params]) => params[1] === "2027-03-30"));
    assert.ok(locks.some(([, params]) => params[1] === "2027-04-02"));
    assert.ok(locks.every(([sql]) => sql.endsWith("FOR UPDATE")));
  });
}

test("bill FY is locked and rejected before bill-link writes, even with all replay FYs OPEN", async () => {
  const f = await setup();
  // Prepare the cost while both periods are OPEN, then close the bill period.
  const cost = await v.recordCost(f.cx, { ...base, source_id: f.source.id, supersedes_id: f.cx.rows.find(r => r.kind === "COST" && r.source_id === f.source.id).id,
    evidence: evidence({ state: "FINAL", basis: "SUPPLIER_DOCUMENT", quantity: "10", purchase_minor: "1200", total_minor: "1200" }), idempotency_key: "final" });
  await approve(f.cx, { ...base, actor_id: "2", revision_id: cost.id, reason: "reviewed", idempotency_key: "final-approved" });
  const query = f.cx.query.bind(f.cx);
  f.cx.query = async (sql, params = []) => sql.includes("FROM financial_years") && params[1] === "2027-04-05"
    ? [[{ id: "2", status: "RECONCILIATION" }]] : query(sql, params);
  const start = f.cx.calls.length;
  const input = { source_id: f.source.id, revision_id: cost.id, bill_id: "20", bill_date: "2027-04-05", line_id: "30" };
  await assert.rejects(v.applyBillCost(f.cx, base, input), error => error.code === "IV_OPEN_FY_REQUIRED");
  assert.equal(f.cx.calls.slice(start).some(([sql]) => /^(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)/.test(sql)), false);
  f.cx.query = query;
  const before = structuredClone({ rows: f.cx.rows, operations: f.cx.operations });
  await assert.rejects(f.cx.transaction(async () => {
    await v.applyBillCost(f.cx, base, input);
    p.expectedTargets(await f.rows(), "2026-04-01");
    throw new Error("synthetic downstream journal failure");
  }), /synthetic downstream journal failure/);
  assert.deepEqual({ rows: f.cx.rows, operations: f.cx.operations }, before);
  const first = await v.applyBillCost(f.cx, base, input), writes = f.cx.rows.length;
  assert.deepEqual(await v.applyBillCost(f.cx, base, input), first);
  assert.equal(f.cx.rows.length, writes);
});
