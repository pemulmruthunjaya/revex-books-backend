"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const createController = require("../controllers/inventoryValuationController");
const v = require("../services/inventoryValuationService");
const p = require("../services/inventoryValuationPostingService");
const { Fixture, evidence, base, opening, approve, operationalEvidence } = require("./helpers/inventoryValuationFixture");
const m = require("../services/inventoryValuationMath");
const components = require("../services/inventoryValuationComponentService");
const ops = require("../services/inventoryValuationOperationService");

test("mocked evidence API prepares, submits, separately approves and posts an opening and GRN", async () => {
  const cx = new Fixture();
  cx.beginTransaction = async () => {};
  cx.commit = async () => {};
  cx.rollback = async () => {};
  cx.release = () => {};
  const controller = createController({ getConnection: async () => cx });
  const call = async (method, body, owner = false) => {
    const res = { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } };
    await controller[method]({ user: { company_id: "1", id: owner ? "2" : "1", role: owner ? "owner" : "staff" }, body }, res);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    return res.body.evidence;
  };
  for (const sourceType of ["OPENING", "GRN"]) {
    const zero = sourceType === "OPENING", key = sourceType.toLowerCase();
    const source = await call("acquisition", { product_id: "1", date: "2026-04-01", document_type: sourceType, document_id: zero ? "opening" : "7", source_line: zero ? "1" : "11", reference: "synthetic evidence", idempotency_key: `${key}-source` });
    const cost = await call("cost", { product_id: "1", source_id: source.id, evidence: evidence(zero ? { state: "FINAL", basis: "OPENING", quantity: "0", purchase_minor: "0", total_minor: "0" } : {}), idempotency_key: `${key}-cost` });
    await call("submit", { product_id: "1", revision_id: cost.id, reason: "deliberate submission", idempotency_key: `${key}-submit` });
    await call("approve", { product_id: "1", revision_id: cost.id, reason: "deliberate owner approval", idempotency_key: `${key}-approval` }, true);
    if (zero) await call("opening", { product_id: "1", source_id: source.id, revision_id: cost.id, idempotency_key: "opening-post" });
    else await p.postGrn(cx, { user: { company_id: "1", id: "1" }, body: { valuation_lines: [{ source_grn_item_id: "11", revision_id: cost.id }] } }, { id: "7", grn_date: "2026-04-01" }, [{ id: "11", product_id: "1", accepted_qty: "10" }]);
  }
  assert.equal(v.projection(await v.records(cx, base)).quantity, "10.000000");
  assert.equal(cx.rows.filter(r => r.kind === "OPENING").length, 1);
  assert.equal(cx.rows.filter(r => r.kind === "RECEIPT").length, 1);
});

test("partial bill coverage retains unbilled provisional value; edit and retry preserve history", async () => {
  const cx = new Fixture(); await opening(cx);
  const source = await v.createAcquisition(cx, { ...base, date: "2026-04-01", document_type: "GRN", document_id: "7", source_line: "11", reference: "synthetic", idempotency_key: "partial-source" });
  const provisional = await v.recordCost(cx, { ...base, source_id: source.id, evidence: evidence(), idempotency_key: "partial-provisional" });
  await approve(cx, { ...base, actor_id: "2", revision_id: provisional.id, reason: "reviewed", idempotency_key: "partial-provisional-approve" });
  await v.postAcquisition(cx, { ...base, source_id: source.id, revision_id: provisional.id, idempotency_key: "partial-receipt" });
  let prior = provisional;
  const finalize = async (billId, quantity, value, key) => {
    const revision = await v.recordCost(cx, { ...base, source_id: source.id, supersedes_id: prior.id, evidence: evidence({ state: "FINAL", basis: "SUPPLIER_DOCUMENT", quantity, purchase_minor: value, total_minor: value }), idempotency_key: key });
    await approve(cx, { ...base, actor_id: "2", revision_id: revision.id, reason: "final bill evidence", idempotency_key: `${key}-approve` });
    const input = { source_id: source.id, revision_id: revision.id, bill_id: billId, bill_date: "2026-04-02", line_id: key };
    const result = await v.applyBillCost(cx, base, input);
    const count = cx.rows.length;
    assert.equal((await v.applyBillCost(cx, base, input)).id, result.id);
    assert.equal(cx.rows.length, count);
    prior = revision;
    return v.projection(await v.records(cx, base));
  };
  assert.equal((await finalize("1", "4", "600", "bill-one")).value_minor, "1200");
  assert.equal((await finalize("2", "6", "900", "bill-two")).value_minor, "1500");
  assert.equal((await finalize("1", "2", "300", "bill-one-reduced")).value_minor, "1400");
  assert.equal(v.projection(await v.records(cx, base)).quantity, "10.000000");
  assert.equal(cx.rows.filter(r => r.kind === "COST_REVERSAL").length, 1);
});

test("document components conserve one authoritative total across products and correct by immutable lineage", async () => {
  const cx = new Fixture(), sources = [];
  for (const product_id of ["1", "2"]) sources.push(await v.createAcquisition(cx, { ...base, product_id, date: "2026-04-01", document_type: "SUPPLIER", document_id: "supplier-document", source_line: product_id, reference: "synthetic document", idempotency_key: `source-${product_id}` }));
  const input = { ...base, date: "2026-04-01", kind: "FREIGHT_INWARD", document_id: "freight-document", component_line: "1", reference: "freight receipt", total_minor: "101", basis: "WEIGHT", recipients: sources.map(s => ({ acquisition_id: s.id, weight: "1" })), idempotency_key: "freight" };
  const first = await components.create(cx, input), before = m.canonical(first);
  assert.equal(first.payload.calculated.reduce((sum, r) => sum + BigInt(r.amount_minor), 0n), 101n);
  assert.equal((await components.create(cx, input)).id, first.id);
  await assert.rejects(components.create(cx, { ...input, idempotency_key: "other-key" }), /IV_COMPONENT_IDENTITY_CONFLICT/);
  await assert.rejects(components.create(cx, { ...input, total_minor: "102" }), /IV_IDEMPOTENCY_CONFLICT/);
  await assert.rejects(components.create(cx, { ...input, idempotency_key: "duplicate", recipients: [input.recipients[0], input.recipients[0]] }), /IV_DUPLICATE_LINE/);
  await assert.rejects(components.create(cx, { ...input, company_id: "2", idempotency_key: "foreign" }), /IV_LINK_NOT_FOUND/);
  const allocation = component => ({ component_id: component.id, kind: component.payload.kind, reference: component.payload.reference, total_minor: component.payload.total_minor, basis: component.payload.basis, lines: component.payload.lines, calculated: component.payload.calculated, line: sources[0].id });
  const share = first.payload.calculated.find(a => a.line === sources[0].id).amount_minor;
  const payload = evidence({ allocations: [allocation(first)], total_minor: (1000n + BigInt(share)).toString() });
  const cost = await v.recordCost(cx, { ...base, source_id: sources[0].id, evidence: payload, idempotency_key: "allocated-cost" });
  const next = await components.create(cx, { ...input, supersedes_id: first.id, total_minor: "103", idempotency_key: "freight-corrected" });
  assert.deepEqual(next.payload.reversal, { revision_id: first.id, calculated: first.payload.calculated });
  assert.equal(m.canonical(cx.rows.find(r => r.id === first.id)), before);
  await assert.rejects(v.recordCost(cx, { ...base, source_id: sources[0].id, supersedes_id: cost.id, evidence: payload, idempotency_key: "stale-component" }), /IV_COMPONENT_REVISION_SUPERSEDED/);
  const calls = cx.calls.length;
  await assert.rejects(components.create(cx, { ...input, supersedes_id: first.id, total_minor: "104", idempotency_key: "fork" }), /IV_REVISION_CONFLICT/);
  assert.ok(cx.calls.slice(calls).every(([sql]) => !/^(INSERT|UPDATE|DELETE|CREATE|ALTER)/.test(sql)));
});

test("partial bills cannot allocate the same document component twice", async () => {
  const setup = await operationalEvidence({ type: "GRN", document: "31", line: "41", receiptQuantity: "3" });
  await v.applyBillCost(setup.cx, setup.x, { source_id: setup.source.id, revision_id: setup.revision.id, bill_id: "81", bill_date: "2026-08-12", line_id: "91" });
  const cost = await v.recordCost(setup.cx, { ...setup.x, source_id: setup.source.id, supersedes_id: setup.revision.id, evidence: { ...setup.revision.payload, quantity: "1", purchase_minor: "10000", total_minor: "10000" }, idempotency_key: "second-cost" });
  await approve(setup.cx, { ...setup.x, actor_id: "14", revision_id: cost.id, reason: "reviewed", idempotency_key: "second-approval" });
  const start = setup.cx.calls.length;
  await assert.rejects(v.applyBillCost(setup.cx, setup.x, { source_id: setup.source.id, revision_id: cost.id, bill_id: "82", bill_date: "2026-08-12", line_id: "92" }), /IV_COMPONENT_OVERALLOCATED/);
  assert.ok(setup.cx.calls.slice(start).every(([sql]) => !/^(INSERT|UPDATE|DELETE|CREATE|ALTER)/.test(sql)));
});

function correctionQueries(cx) {
  const query = cx.query.bind(cx);
  cx.query = async (sql, params) => {
    if (sql.startsWith("SELECT bi.id")) return [[{ id: "90" }]];
    if (/FROM (invoice_items|return_items|delivery_challan_items|inventory_transactions)/.test(sql)) return [[]];
    return query(sql, params);
  };
}
test("approved quantity correction atomically reverses/replaces stock, retains source UUID and survives uncertain commit retry", async () => {
  const { cx, x, valuation, source, revision } = await operationalEvidence({ correction: true }); correctionQueries(cx);
  const before = structuredClone(cx.rows), input = { source_id: source.id, revision_id: revision.id, correction_id: valuation.correction_id, bill_id: "81", bill_date: "2026-08-12", line_id: "92" };
  const result = await cx.transaction(() => v.applyBillCost(cx, x, input));
  assert.equal(cx.stock.get("4:9"), "2.00");
  assert.equal(v.projection(await v.records(cx, x)).quantity, "2.000000");
  assert.equal(cx.rows.filter(r => r.kind === "RECEIPT").length, 1);
  assert.equal(cx.rows.filter(r => r.kind === "STOCK_REVERSAL").length, 1);
  assert.equal(cx.rows.filter(r => r.kind === "STOCK_REPLACEMENT").length, 1);
  assert.deepEqual(cx.rows.slice(0, before.length), before);
  const count = cx.rows.length;
  assert.equal((await v.applyBillCost(cx, x, input)).id, result.id);
  assert.equal(cx.rows.length, count); assert.equal(cx.stock.get("4:9"), "2.00");
  assert.equal(result.source_id, source.id);
  await costEditAfterCorrection(cx, x, source, revision, "quantity");
});

test("correction failure rolls back evidence, counters, request result and physical delta", async () => {
  const { cx, x, valuation, source, revision } = await operationalEvidence({ correction: true }); correctionQueries(cx);
  const before = structuredClone({ rows: cx.rows, operations: cx.operations, counters: [...cx.counters], stock: [...cx.stock] });
  await assert.rejects(cx.transaction(async () => {
    await v.applyBillCost(cx, x, { source_id: source.id, revision_id: revision.id, correction_id: valuation.correction_id, bill_id: "81", bill_date: "2026-08-12", line_id: "92" });
    throw Error("synthetic commit failure before commit");
  }), /synthetic commit failure/);
  assert.deepEqual({ rows: cx.rows, operations: cx.operations, counters: [...cx.counters], stock: [...cx.stock] }, before);
  cx.status = "RECONCILIATION"; const start = cx.calls.length;
  await assert.rejects(v.applyBillCost(cx, x, { source_id: source.id, revision_id: revision.id, correction_id: valuation.correction_id, bill_id: "81", bill_date: "2026-08-12", line_id: "92" }), /IV_OPEN_FY_REQUIRED/);
  assert.ok(cx.calls.slice(start).every(([sql]) => !/^(INSERT|UPDATE|DELETE|CREATE|ALTER)/.test(sql)));
});

test("owner-approved supplier source correction replaces the link without rewriting the receipt or reusing the retired source", async () => {
  const { cx, x, source: oldSource, revision: oldCost } = await operationalEvidence({ tax: "0" });
  const oldLink = await v.applyBillCost(cx, x, { source_id: oldSource.id, revision_id: oldCost.id, bill_id: "81", bill_date: "2026-08-12", line_id: "90" });
  cx.stock.set("4:9", "2.00"); correctionQueries(cx);
  const source = await v.createAcquisition(cx, { ...x, date: "2026-08-12", document_type: "SUPPLIER", document_id: "correct-source", source_line: "2", reference: "corrected supplier document", idempotency_key: "source-replacement" });
  const revision = await v.recordCost(cx, { ...x, source_id: source.id, evidence: oldCost.payload, idempotency_key: "source-replacement-cost" });
  await approve(cx, { ...x, actor_id: "14", revision_id: revision.id, reason: "approved", idempotency_key: "source-replacement-review" });
  const corrections = require("../services/inventoryValuationCorrectionService"), receipt = cx.rows.find(r => r.kind === "RECEIPT"), original = structuredClone(receipt);
  const correction = await corrections.create(cx, { ...x, bill_id: "81", movement_id: receipt.id, previous_bill_link_id: oldLink.id, new_source_id: source.id, new_revision_id: revision.id, reason: "wrong supplier line corrected", idempotency_key: "source-correction" });
  const input = { source_id: source.id, revision_id: revision.id, correction_id: correction.id, bill_id: "81", bill_date: "2026-08-12", line_id: "93" };
  const start = cx.calls.length;
  await assert.rejects(v.applyBillCost(cx, x, input), /IV_CORRECTION_NOT_APPROVED/);
  assert.ok(cx.calls.slice(start).every(([sql]) => !/^(INSERT|UPDATE|DELETE|CREATE|ALTER)/.test(sql)));
  await corrections.approve(cx, { ...x, actor_id: "14", correction_id: correction.id, reason: "owner approved", idempotency_key: "source-correction-review" });
  const link = await v.applyBillCost(cx, x, input);
  assert.equal(link.supersedes_id, oldLink.id); assert.equal(link.source_id, source.id);
  assert.deepEqual(cx.rows.find(r => r.id === receipt.id), original);
  assert.equal(v.latestBillLinks(cx.rows, oldSource.id).length, 0);
  assert.equal(cx.stock.get("4:9"), "2.00");
  await assert.rejects(v.applyBillCost(cx, x, { source_id: oldSource.id, revision_id: oldCost.id, bill_id: "82", bill_date: "2026-08-12", line_id: "94" }), /IV_SOURCE_REPLACED/);
  await costEditAfterCorrection(cx, x, source, revision, "source");
});

async function costEditAfterCorrection(cx, x, source, prior, key) {
  const revision = await v.recordCost(cx, { ...x, source_id: source.id, supersedes_id: prior.id, evidence: { ...prior.payload, purchase_minor: (BigInt(prior.payload.purchase_minor) + 100n).toString(), total_minor: (BigInt(prior.payload.total_minor) + 100n).toString() }, idempotency_key: `${key}-later-cost` });
  await approve(cx, { ...x, actor_id: "14", revision_id: revision.id, reason: "cost-only correction", idempotency_key: `${key}-later-approve` });
  const before = structuredClone(cx.rows), stock = [...cx.stock], calls = cx.calls.length;
  const input = { source_id: source.id, revision_id: revision.id, bill_id: "81", bill_date: "2026-08-12", line_id: "95" };
  const result = await cx.transaction(() => v.applyBillCost(cx, x, input));
  assert.deepEqual(cx.rows.slice(0, before.length), before);
  assert.deepEqual([...cx.stock], stock);
  assert.ok(cx.calls.slice(calls).every(([sql]) => !/^UPDATE products/.test(sql)));
  assert.equal(v.projection(await v.records(cx, x)).value_minor, revision.payload.total_minor);
  const receipt = cx.rows.find(r => r.kind === "RECEIPT");
  assert.equal(v.appliedBasis(await v.records(cx, x), receipt).source_id, source.id);
  const count = cx.rows.length;
  assert.equal((await v.applyBillCost(cx, x, input)).id, result.id);
  assert.equal(cx.rows.length, count);
}

test("partial finalization consumes component shares once, including revised freight, discounts and nonrecoverable tax", async () => {
  const cx = new Fixture(); await opening(cx);
  const source = await v.createAcquisition(cx, { ...base, date: "2026-04-01", document_type: "GRN", document_id: "7", source_line: "11", reference: "synthetic", idempotency_key: "components-source" });
  const costs = [];
  for (const [kind, amount] of [["FREIGHT_INWARD", "100"], ["TRADE_DISCOUNT", "20"], ["TAX", "40"]]) costs.push(await components.create(cx, { ...base, date: "2026-04-01", kind, document_id: kind, component_line: "1", reference: "synthetic document", total_minor: amount, basis: "QUANTITY", recipients: [{ acquisition_id: source.id, weight: "10" }], ...(kind === "TAX" ? { recoverability: "NON_RECOVERABLE" } : {}), idempotency_key: `component-${kind}` }));
  const parts = values => ({ allocations: values.filter(c => c.payload.kind !== "TAX").map(c => ({ component_id: c.id, kind: c.payload.kind, reference: c.payload.reference, total_minor: c.payload.total_minor, basis: c.payload.basis, lines: c.payload.lines, calculated: c.payload.calculated, line: source.id })), taxes: values.filter(c => c.payload.kind === "TAX").map(c => ({ component_id: c.id, reference: c.payload.reference, recoverability: c.payload.recoverability, amount_minor: c.payload.total_minor })) });
  let prior = await v.recordCost(cx, { ...base, source_id: source.id, evidence: evidence({ ...parts(costs), total_minor: "1120" }), idempotency_key: "component-provisional" });
  await approve(cx, { ...base, actor_id: "2", revision_id: prior.id, reason: "approved", idempotency_key: "component-provisional-approval" });
  await v.postAcquisition(cx, { ...base, source_id: source.id, revision_id: prior.id, idempotency_key: "component-receipt" });
  const finalize = async (bill, quantity, purchase, values, total, key) => {
    const revision = await v.recordCost(cx, { ...base, source_id: source.id, supersedes_id: prior.id, evidence: evidence({ state: "FINAL", basis: "SUPPLIER_DOCUMENT", quantity, purchase_minor: purchase, total_minor: total, ...parts(values) }), idempotency_key: key });
    await approve(cx, { ...base, actor_id: "2", revision_id: revision.id, reason: "approved", idempotency_key: `${key}-approval` });
    const input = { source_id: source.id, revision_id: revision.id, bill_id: bill, line_id: key, bill_date: "2026-04-02" };
    const link = await v.applyBillCost(cx, base, input), count = cx.rows.length;
    assert.equal((await v.applyBillCost(cx, base, input)).id, link.id); assert.equal(cx.rows.length, count);
    prior = revision;
    return v.projection(await v.records(cx, base)).value_minor;
  };
  assert.equal(await finalize("1", "5", "500", costs, "620", "component-partial"), "1120");
  assert.equal(await finalize("2", "5", "500", [], "500", "component-full"), "1120");
  assert.equal(await finalize("1", "2", "200", costs, "320", "component-reduced"), "1120");
  const revised = await components.create(cx, { ...base, date: "2026-04-01", kind: "FREIGHT_INWARD", document_id: "FREIGHT_INWARD", component_line: "1", reference: "synthetic document", total_minor: "150", basis: "QUANTITY", recipients: [{ acquisition_id: source.id, weight: "10" }], supersedes_id: costs[0].id, idempotency_key: "freight-revised" });
  assert.equal(await finalize("1", "2", "200", [revised, ...costs.slice(1)], "370", "component-revised-bill"), "1170");
});

test("request retries return original result; conflicting reuse fails before writes", async () => {
  const cx = new Fixture(), request = () => ({ user: { company_id: "1", id: "1" }, headers: { "idempotency-key": "same-request" }, body: { quantity: "1.20" } });
  let req = request(); assert.equal(await ops.beginRequest(cx, req, "create-bill"), null);
  await ops.completeRequest(cx, req, 201, { id: 123 });
  req = request(); assert.deepEqual(await ops.beginRequest(cx, req, "create-bill"), { status: 201, body: { id: 123 } });
  const start = cx.calls.length; req.body.quantity = "1.21";
  await assert.rejects(ops.beginRequest(cx, req, "create-bill"), /IV_IDEMPOTENCY_CONFLICT/);
  assert.ok(cx.calls.slice(start).every(([sql]) => !/^(INSERT|UPDATE|DELETE|CREATE|ALTER)/.test(sql)));
});

test("submission/approval/rejection retries remain stable after later state changes", async () => {
  const cx = new Fixture(), source = await v.createAcquisition(cx, { ...base, date: "2026-04-01", document_type: "SUPPLIER", document_id: "review", source_line: "1", reference: "synthetic", idempotency_key: "review-source" });
  const costInput = { ...base, source_id: source.id, evidence: evidence(), idempotency_key: "review-cost" }, cost = await v.recordCost(cx, costInput);
  const submitted = { ...base, revision_id: cost.id, reason: "review", idempotency_key: "submitted" }, first = await v.submitCost(cx, submitted);
  const rejected = { ...base, actor_id: "2", revision_id: cost.id, reason: "reject", idempotency_key: "rejected" }, decision = await v.rejectCost(cx, rejected);
  assert.equal((await v.submitCost(cx, submitted)).id, first.id);
  assert.equal((await v.rejectCost(cx, rejected)).id, decision.id);
  assert.equal((await v.recordCost(cx, costInput)).id, cost.id);
  await assert.rejects(v.approveCost(cx, { ...rejected, idempotency_key: "approve-rejected" }), /IV_COST_REJECTED/);
});
