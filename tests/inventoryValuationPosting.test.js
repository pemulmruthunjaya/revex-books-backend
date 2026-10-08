"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const v = require("../services/inventoryValuationService");
const p = require("../services/inventoryValuationPostingService");
const readiness = require("../services/inventoryValuationReadinessService");
const { Fixture, evidence, base, approve, opening } = require("./helpers/inventoryValuationFixture");

async function cost(cx, source, previous, key, amount = "1200") {
  const r = await v.recordCost(cx, { ...base, source_id: source.id, supersedes_id: previous?.id,
    evidence: evidence({ state: previous ? "FINAL" : "PROVISIONAL", basis: previous ? "SUPPLIER_DOCUMENT" : "PO_NET", purchase_minor: amount, total_minor: amount }), idempotency_key: key });
  await approve(cx, { ...base, actor_id: "2", revision_id: r.id, reason: "synthetic approval", idempotency_key: `${key}-approval` });
  return r;
}
function billFixture(cx, bill) {
  const query = cx.query.bind(cx);
  cx.query = async (sql, params) => {
    if (sql.startsWith("SELECT bi.id,bi.product_id")) return [[bill]];
    if (sql.startsWith("SELECT id,source_id,supersedes_id,product_id,payload")) return [cx.rows.filter(r => r.kind === "BILL_LINK" && r.document_id === params[1])];
    if (sql.startsWith("SELECT id FROM iv_records")) return [cx.rows.filter(r => r.kind === "BILL_LINK" && r.document_id === params[1])];
    return query(sql, params);
  };
}
const request = valuation_lines => ({ user: { company_id: "1", id: "1" }, body: { valuation_lines } });

test("GRN approved provisional posting then final bill and edited bill preserve acquisition identity", async () => {
  const cx = new Fixture();
  await opening(cx);
  const source = await v.createAcquisition(cx, { ...base, date: "2026-04-01", document_type: "GRN", document_id: "7", source_line: "11", reference: "grn", idempotency_key: "source" });
  const provisional = await cost(cx, source, null, "provisional", "1000");
  const receipt = { id: "7", grn_date: "2026-04-01" }, items = [{ id: "11", product_id: "1", accepted_qty: "10" }];
  await p.postGrn(cx, request([{ source_grn_item_id: "11", revision_id: provisional.id }]), receipt, items);
  const final = await cost(cx, source, provisional, "final");
  const bill = { id: "51", product_id: "1", source_grn_item_id: "11", quantity: "10.00", price: "1.20", total: "12.00" };
  billFixture(cx, bill);
  await p.finalizeBill(cx, request([{ acquisition_id: source.id, revision_id: final.id }]), "9", "2026-04-02");
  const revised = await cost(cx, source, final, "edited", "1500");
  const req = request([{ acquisition_id: source.id, revision_id: revised.id }]);
  await p.guardBillEdit(cx, req, "9", [{ product_id: "1", qty: "10" }]);
  bill.id = "63"; bill.price = "1.50"; bill.total = "15.00";
  await p.finalizeBill(cx, req, "9", "2026-04-02", true);
  const links = cx.rows.filter(r => r.kind === "BILL_LINK");
  assert.equal(links.length, 2); assert.equal(links[0].source_id, links[1].source_id);
  assert.equal(links[1].payload.previous_bill_line, "51");
  assert.equal(v.projection(await v.records(cx, base)).value_minor, "1500");
  assert.equal(cx.rows.filter(r => r.kind === "COST_REVERSAL").length, 1);
  await assert.rejects(p.guardBillDelete(cx, req, "9"), /IV_VALUED_BILL_DELETE_RESTRICTED/);
});

test("wrong/unapproved GRN evidence cannot post any valuation movement", async () => {
  const cx = new Fixture(), source = await v.createAcquisition(cx, { ...base, date: "2026-04-01", document_type: "GRN", document_id: "7", source_line: "11", reference: "grn", idempotency_key: "source" });
  const unapproved = await v.recordCost(cx, { ...base, source_id: source.id, evidence: evidence(), idempotency_key: "unapproved" });
  const start = cx.calls.length;
  await assert.rejects(p.postGrn(cx, request([{ source_grn_item_id: "11", revision_id: unapproved.id }]), { id: "7", grn_date: "2026-04-01" }, [{ id: "11", product_id: "1", accepted_qty: "10" }]), /IV_COST_NOT_APPROVED/);
  assert.equal(cx.rows.some(r => r.kind === "RECEIPT"), false);
  assert.ok(cx.calls.slice(start).every(([sql]) => !/^(INSERT|UPDATE|DELETE|CREATE|ALTER)/.test(sql)));
});

test("direct supplier bill requires approved authoritative final cost, not bill price inference", async () => {
  const cx = new Fixture(); await opening(cx);
  const source = await v.createAcquisition(cx, { ...base, date: "2026-04-01", document_type: "SUPPLIER", document_id: "supplier-evidence", source_line: "1", reference: "invoice evidence", idempotency_key: "supplier" });
  const revision = await v.recordCost(cx, { ...base, source_id: source.id, evidence: evidence({ state: "FINAL", basis: "SUPPLIER_DOCUMENT" }), idempotency_key: "final" });
  await approve(cx, { ...base, actor_id: "2", revision_id: revision.id, reason: "reviewed", idempotency_key: "approval" });
  const bill = { id: "51", product_id: "1", source_grn_item_id: null, quantity: "10.00", price: "1.00", total: "10.00" };
  billFixture(cx, bill);
  const req = request([{ acquisition_id: source.id, revision_id: revision.id }]);
  bill.price = "2.00";
  await assert.rejects(p.finalizeBill(cx, req, "9", "2026-04-01"), /IV_BILL_COST_EVIDENCE_MISMATCH/);
  bill.price = "1.00";
  await p.finalizeBill(cx, req, "9", "2026-04-01");
  assert.equal(cx.rows.filter(r => r.kind === "RECEIPT").length, 1);
  await assert.rejects(p.finalizeBill(cx, req, "10", "2026-04-01"), /IV_ACQUISITION_ALREADY_BILLED/);
});

test("readiness is read-only and remains GL/COGS blocked, including unsupported net-zero history", async () => {
  const cx = new Fixture(), original = cx.query.bind(cx);
  cx.autocommitOnly = true;
  cx.rollback = async () => {};
  let legacy = false;
  cx.query = async (sql, params) => {
    if (sql.startsWith("SET TRANSACTION") || sql.startsWith("START TRANSACTION")) return [{ serverStatus: 3 }];
    if (sql.includes("LEFT JOIN products")) return [[]];
    if (sql.startsWith("SELECT id,CAST(stock")) return [[{ id: "1", stock: "0.00", opening_stock: "0.00" }]];
    if (sql.includes("FROM inventory_transactions")) return [legacy ? [{ reference_type: "LEGACY", reference_id: "1", quantity_in: "1", quantity_out: "1" }] : []];
    if (sql.includes("FROM bill_items") || sql.includes("FROM goods_receipt_items") || sql.includes("FROM invoice_items") || sql.includes("FROM return_items") || sql.includes("FROM delivery_challan_items")) return [[]];
    return original(sql, params);
  };
  let result = await readiness.inspectInventoryValuation(cx, "1");
  assert.equal(result.ready, false); assert.deepEqual(result.blockers, ["GL_COGS_RECONCILIATION_NOT_IMPLEMENTED"]);
  legacy = true;
  result = await readiness.inspectInventoryValuation(cx, "1");
  assert.ok(result.blockers.includes("IV_UNSUPPORTED_HISTORICAL_MOVEMENT"));
  assert.ok(cx.calls.every(([sql]) => (sql.startsWith("SELECT") || sql === "DO 0") && !sql.includes("FOR UPDATE")));
});

test("cost-only bill edits do not reverse/re-add already consumed physical stock", () => {
  const fs = require("node:fs"), path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "../controllers/billController.js"), "utf8");
  const edit = source.slice(source.indexOf("exports.updateBill ="), source.indexOf("exports.updateBillStatus"));
  assert.match(edit, /guardBillEdit[\s\S]*DELETE FROM bill_items[\s\S]*finalizeBill[\s\S]*connection\.commit/);
  assert.doesNotMatch(edit, /SET stock\s*=/);
});

test("readiness fingerprints physical inputs and fails closed for counters, orphan links, corrupt evidence and read failures", async () => {
  const { operationalEvidence } = require("./helpers/inventoryValuationFixture");
  const { cx, x } = await operationalEvidence({ correction: true });
  const original = cx.query.bind(cx), statements = []; let stock = "1.00", failRead = false, failRollback = false;
  cx.autocommitOnly = true; cx.rollback = async () => { statements.push("ROLLBACK"); if (failRollback) throw Error("synthetic rollback error"); };
  cx.query = async (sql, params) => {
    statements.push(sql);
    if (sql.startsWith("SET TRANSACTION") || sql.startsWith("START TRANSACTION")) return [{}];
    if (sql.startsWith("SELECT id,CAST(stock")) return [[{ id: "9", stock, opening_stock: "0.00" }]];
    if (sql.includes("LEFT JOIN products")) return [[]];
    if (/FROM (inventory_transactions|bill_items|goods_receipt_items|invoice_items|return_items|delivery_challan_items)/.test(sql)) { if (failRead) throw Error("synthetic missing table"); return [[]]; }
    return original(sql, params);
  };
  const first = await readiness.inspectInventoryValuation(cx, x.company_id);
  assert.ok(first.blockers.includes("IV_ORPHAN_BILL_LINK"));
  assert.ok(first.blockers.includes("IV_UNAPPLIED_REVISION"));
  assert.equal((await readiness.inspectInventoryValuation(cx, x.company_id)).fingerprint, first.fingerprint);
  stock = "2.00";
  const changed = await readiness.inspectInventoryValuation(cx, x.company_id);
  assert.notEqual(changed.fingerprint, first.fingerprint); assert.ok(changed.blockers.includes("IV_STOCK_HISTORY_INCOMPLETE"));
  const key = [...cx.counters.keys()][0]; cx.counters.set(key, "9999");
  assert.ok((await readiness.inspectInventoryValuation(cx, x.company_id)).blockers.includes("IV_SEQUENCE_COUNTER_MISMATCH"));
  failRead = true; assert.ok((await readiness.inspectInventoryValuation(cx, x.company_id)).blockers.includes("IV_HISTORY_SCHEMA_NOT_READY"));
  failRead = false; failRollback = true; assert.ok((await readiness.inspectInventoryValuation(cx, x.company_id)).blockers.includes("IV_READ_SNAPSHOT_FAILED"));
  cx.rows.find(r => r.kind === "COST").payload.total_minor = "99";
  assert.ok((await readiness.inspectInventoryValuation(cx, x.company_id)).blockers.includes("IV_EVIDENCE_FINGERPRINT_MISMATCH"));
  assert.ok(statements.every(sql => /^(SELECT|DO 0|SET TRANSACTION|START TRANSACTION|ROLLBACK)/.test(sql)));
  assert.ok(statements.includes("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY"));
  assert.ok(statements.every(sql => !/FOR UPDATE|FOR SHARE/.test(sql)));
});

test("missing/provisional bill evidence and fractional operational precision reject before any business write", async () => {
  const { operationalEvidence } = require("./helpers/inventoryValuationFixture");
  const setup = await operationalEvidence({ type: "GRN", document: "31", line: "41", post: true });
  const req = { user: { company_id: "4", id: "13" }, body: { valuation_lines: [setup.valuation] } };
  const item = { product_id: "9", quantity: "2.00", price: "100.00", total: "200.00", source_grn_item_id: "41" };
  const start = setup.cx.calls.length;
  await assert.rejects(p.preflightBill(setup.cx, req, [item], "2026-08-12"), /IV_FINAL_COST_REQUIRED/);
  req.body = {};
  await assert.rejects(p.preflightBill(setup.cx, req, [item], "2026-08-12"), /IV_APPROVED_COST_EVIDENCE_REQUIRED/);
  await assert.rejects(p.preflightBill(setup.cx, req, [{ ...item, quantity: "1.234" }], "2026-08-12"), /INVENTORY_QUANTITY_PRECISION_UNSUPPORTED/);
  assert.ok(setup.cx.calls.slice(start).every(([sql]) => !/^(INSERT|UPDATE|DELETE|CREATE|ALTER)/.test(sql)));
});

test("combined receipt valuation overflow rejects the whole batch before any write", async () => {
  const cx = new Fixture(); await opening(cx);
  const lines = [], items = [];
  for (const line of ["11", "12"]) {
    const source = await v.createAcquisition(cx, { ...base, date: "2026-04-01", document_type: "GRN", document_id: "7", source_line: line, reference: "synthetic high-value source", idempotency_key: `batch-source-${line}` });
    const revision = await v.recordCost(cx, { ...base, source_id: source.id, evidence: evidence({ quantity: "1", purchase_minor: "600000000000000000000000000000", total_minor: "600000000000000000000000000000" }), idempotency_key: `batch-cost-${line}` });
    await approve(cx, { ...base, actor_id: "2", revision_id: revision.id, reason: "synthetic approval", idempotency_key: `batch-approve-${line}` });
    lines.push({ source_grn_item_id: line, revision_id: revision.id }); items.push({ id: line, product_id: "1", accepted_qty: "1" });
  }
  const start = cx.calls.length, before = structuredClone(cx.rows);
  await assert.rejects(p.postGrn(cx, request(lines), { id: "7", grn_date: "2026-04-01" }, items), /IV_VALUATION_OVERFLOW/);
  assert.deepEqual(cx.rows, before);
  assert.ok(cx.calls.slice(start).every(([sql]) => !/^(INSERT|UPDATE|DELETE|CREATE|ALTER)/.test(sql)));
});

test("readiness reconciles and fingerprints actual active bill and GRN lines, not just their IDs", async () => {
  const { operationalEvidence } = require("./helpers/inventoryValuationFixture");
  for (const type of ["SUPPLIER", "GRN"]) {
    const { cx, x, source, revision } = await operationalEvidence({ type, document: "31", line: "41", tax: "0" });
    await v.applyBillCost(cx, x, { source_id: source.id, revision_id: revision.id, bill_id: "81", bill_date: "2026-08-12", line_id: "91" });
    const bill = { id: "91", bill_id: "81", product_id: "9", quantity: "2.00", price: "100.00", total: "200.00", source_grn_item_id: type === "GRN" ? "41" : null, source_grn_id: type === "GRN" ? "31" : null, bill_date: "2026-08-12" };
    const grn = { id: "41", goods_receipt_id: "31", product_id: "9", received_qty: "2.00", rejected_qty: "0.00", accepted_qty: "2.00", status: "Posted", stock_posted: "1", grn_date: "2026-08-12" };
    let bills = [bill], grns = type === "GRN" ? [grn] : [];
    const original = cx.query.bind(cx), statements = [];
    cx.autocommitOnly = true; cx.rollback = async () => {};
    cx.query = async (sql, params) => {
      statements.push(sql);
      if (/^(SET TRANSACTION|START TRANSACTION)/.test(sql)) return [{}];
      if (sql.includes("LEFT JOIN products")) return [[]];
      if (sql.startsWith("SELECT id,CAST(stock")) return [[{ id: "9", stock: "2.00", opening_stock: "0.00" }]];
      if (sql.includes("FROM bill_items")) return [bills];
      if (sql.includes("FROM goods_receipt_items")) return [grns];
      if (sql.includes("FROM inventory_transactions")) return [type === "GRN" ? [{ reference_type: "GRN", reference_id: "31", quantity_in: "2.00", quantity_out: "0.00" }] : []];
      if (/FROM (invoice_items|return_items|delivery_challan_items)/.test(sql)) return [[]];
      return original(sql, params);
    };
    const inspect = () => readiness.inspectInventoryValuation(cx, x.company_id);
    const valid = await inspect(); assert.equal(valid.valuation_ready, true, JSON.stringify(valid));
    for (const [field, value, blocker] of [["quantity", "99.00", "IV_BILL_QUANTITY_MISMATCH"], ["price", "101.00", "IV_BILL_COST_EVIDENCE_MISMATCH"], ["total", "201.00", "IV_BILL_COST_EVIDENCE_MISMATCH"], ["bill_id", "82", "IV_UNLINKED_BILL_HISTORY"], ["bill_date", "2026-08-13", "IV_BILL_SOURCE_MISMATCH"], ["source_grn_item_id", "999", "IV_BILL_SOURCE_MISMATCH"]]) {
      const old = bill[field]; bill[field] = value;
      const result = await inspect(); assert.ok(result.blockers.includes(blocker), JSON.stringify(result)); assert.notEqual(result.fingerprint, valid.fingerprint);
      bill[field] = old;
    }
    bills = []; assert.ok((await inspect()).blockers.includes("IV_ORPHAN_BILL_LINK")); bills = [bill];
    if (type === "GRN") {
      for (const [field, value, blocker] of [["accepted_qty", "1.00", "IV_SOURCE_QUANTITY_MISMATCH"], ["grn_date", "2026-08-13", "IV_GRN_SOURCE_MISMATCH"], ["stock_posted", "0", "IV_GRN_SOURCE_MISMATCH"], ["goods_receipt_id", "32", "IV_UNLINKED_GRN_HISTORY"]]) {
        const old = grn[field]; grn[field] = value;
        const result = await inspect(); assert.ok(result.blockers.includes(blocker), JSON.stringify(result)); assert.notEqual(result.fingerprint, valid.fingerprint); grn[field] = old;
      }
      grns = []; assert.ok((await inspect()).blockers.includes("IV_ORPHAN_GRN_LINK"));
    }
    assert.ok(statements.every(sql => /^(SELECT|DO 0|SET TRANSACTION|START TRANSACTION)/.test(sql) && !/FOR UPDATE|FOR SHARE/.test(sql)));
  }
});
