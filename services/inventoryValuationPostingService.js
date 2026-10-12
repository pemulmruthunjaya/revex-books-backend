"use strict";
const v = require("./inventoryValuationService");
const m = require("./inventoryValuationMath");
const requestProof = Symbol("bill-posting-proof");
const itemSignature = item => ({ product: String(item.product_id), quantity: m.operationalQuantity(item.quantity ?? item.qty).q6.toString(), price: minor(item.price).toString(), total: minor(item.total).toString(), grn_line: item.source_grn_item_id ? String(item.source_grn_item_id) : null });
const context = (req, product) => ({ company_id: req.user.company_id, product_id: product, actor_id: req.user.user_id || req.user.id });
const minor = value => {
  const s = String(value);
  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(s)) m.fail("IV_DOCUMENT_AMOUNT_INVALID");
  const [whole, fraction = ""] = s.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
};
const list = req => {
  const lines = req.body?.valuation_lines;
  if (!Array.isArray(lines) || !lines.length || lines.length > 500) m.fail("IV_APPROVED_COST_EVIDENCE_REQUIRED");
  if (lines.some(line => !line || Object.keys(line).some(key => !["acquisition_id", "revision_id", "source_grn_item_id", "correction_id"].includes(key)))) m.fail("IV_UNSUPPORTED_EVIDENCE_FIELD");
  return lines;
};
// Validate the combined batch, not only each line against the original pool.
// This also gives successive same-product corrections the exact intermediate
// physical balance they will encounter inside the transaction.
function previewReceipt(rows, source, revision, tag) {
  const sequence = (rows.filter(r => r.effective_date === source.effective_date).reduce((max, r) => BigInt(r.sequence) > max ? BigInt(r.sequence) : max, 0n) + 1n).toString();
  return { ...v.ref(source), id: `preview-${tag}`, kind: "RECEIPT", sequence, target_id: revision.id, payload: { revision_id: revision.id } };
}
async function postGrn(cx, req, receipt, items) {
  for (const item of items) m.operationalQuantity(item.accepted_qty);
  const evidence = list(req), accepted = items.filter(x => m.operationalQuantity(x.accepted_qty).q6 > 0n), pending = [];
  if (evidence.length !== accepted.length) m.fail("IV_LINE_COVERAGE_REQUIRED");
  for (const product of [...new Set(accepted.map(x => String(x.product_id)))].sort()) await v.prepare(cx, context(req, product));
  await checkStockCapacity(cx, req, accepted.map(item => ({ product_id: item.product_id, quantity: item.accepted_qty })));
  // Validate every line before writing the first line's evidence.
  for (const item of accepted) {
    const candidates = evidence.filter(x => String(x.source_grn_item_id) === String(item.id));
    if (candidates.length !== 1) m.fail("IV_LINE_COVERAGE_REQUIRED");
    const x = context(req, item.product_id), rows = await v.records(cx, x);
    const revision = v.approved(rows, v.find(rows, candidates[0].revision_id, "COST")), source = v.find(rows, revision.source_id, "ACQUISITION");
    const components = require("./inventoryValuationComponentService");
    components.verifyCost(await components.read(cx, x.company_id), source, revision.payload);
    const date = receipt.grn_date instanceof Date ? receipt.grn_date.toISOString().slice(0, 10) : String(receipt.grn_date).slice(0, 10);
    if (source.document_type !== "GRN" || source.document_id !== String(receipt.id) || source.source_line !== String(item.id) || source.effective_date !== date || m.operationalQuantity(revision.payload.quantity).q6 !== m.operationalQuantity(item.accepted_qty).q6) m.fail("IV_GRN_EVIDENCE_MISMATCH");
    v.requireOpening(rows, date);
    pending.push({ ...x, source_id: source.id, revision_id: revision.id, idempotency_key: `grn:${receipt.id}:${item.id}` });
  }
  const batches = new Map();
  for (const input of pending) {
    const key = String(input.product_id), rows = batches.get(key) || await v.records(cx, input);
    await v.lockReplayPeriods(cx, input, rows, v.find(rows, input.source_id, "ACQUISITION").effective_date);
    rows.push(previewReceipt(rows, v.find(rows, input.source_id, "ACQUISITION"), v.find(rows, input.revision_id, "COST"), input.source_id));
    m.operationalQuantity(v.projection(rows).quantity);
    batches.set(key, rows);
  }
  for (const [product, rows] of batches) await require("./inventoryGlService").prepare(cx, context(req, product), rows);
  for (const input of pending) await v.postAcquisition(cx, input);
}
async function preflightBill(cx, req, items, billDate, billId = null) {
  for (const item of items) m.operationalQuantity(item.quantity ?? item.qty);
  const evidence = list(req);
  if (!items.length || items.length !== evidence.length) m.fail("IV_LINE_COVERAGE_REQUIRED");
  if (new Set(evidence.map(e => e.acquisition_id)).size !== evidence.length) m.fail("IV_DUPLICATE_SOURCE_LINE");
  for (const product of [...new Set(items.map(x => String(x.product_id)))].sort()) await v.prepare(cx, context(req, product));
  if (billId === null) await checkStockCapacity(cx, req, items.filter(item => !item.source_grn_item_id));
  const proofs = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i], input = evidence[i], x = context(req, item.product_id), rows = await v.records(cx, x);
    const source = v.find(rows, input.acquisition_id, "ACQUISITION"), revision = v.approved(rows, v.find(rows, input.revision_id, "COST"));
    if (revision.source_id !== source.id || revision.payload.state !== "FINAL") m.fail("IV_FINAL_COST_REQUIRED");
    if (revision.payload.basis !== "SUPPLIER_DOCUMENT") m.fail("IV_SUPPLIER_EVIDENCE_REQUIRED");
    if (m.operationalQuantity(revision.payload.quantity).q6 !== m.operationalQuantity(item.quantity ?? item.qty).q6) m.fail("IV_BILL_QUANTITY_EVIDENCE_MISMATCH");
    const purchase = m.halfUp(m.operationalQuantity(item.quantity ?? item.qty).q6 * minor(item.price), 1000000n);
    const tax = revision.payload.taxes.reduce((sum, t) => sum + m.integer(t.amount_minor), 0n);
    if (purchase !== m.integer(revision.payload.purchase_minor) || minor(item.total) !== purchase + tax) m.fail("IV_BILL_COST_EVIDENCE_MISMATCH");
    if (item.source_grn_item_id) {
      if (source.document_type !== "GRN" || source.source_line !== String(item.source_grn_item_id)) m.fail("IV_GRN_EVIDENCE_MISMATCH");
    } else if (source.document_type !== "SUPPLIER") m.fail("IV_SUPPLIER_EVIDENCE_REQUIRED");
    proofs.push(await v.previewBillCost(cx, x, rows, source, revision, billId, billDate, input.correction_id || null));
  }
  const batches = new Map();
  for (let i = 0; i < items.length; i++) {
    const key = String(items[i].product_id), rows = batches.get(key) || await v.records(cx, context(req, key));
    const input = evidence[i], proof = proofs[i], source = v.find(rows, input.acquisition_id, "ACQUISITION"), revision = v.find(rows, input.revision_id, "COST");
    const before = v.projection(rows);
    if (proof.correction) rows.push({ kind: "STOCK_REPLACEMENT", sequence: (rows.filter(r => r.effective_date === source.effective_date).reduce((n, r) => BigInt(r.sequence) > n ? BigInt(r.sequence) : n, 0n) + 1n).toString(), target_id: proof.correction.movement.id, payload: { revision_id: revision.id, new_source_id: source.id } });
    else if (!proof.movement) rows.push(previewReceipt(rows, source, revision, i));
    else if (source.document_type !== "GRN") rows.push({ kind: "COST_REPLACEMENT", target_id: proof.movement.id, payload: { revision_id: revision.id } });
    rows.push({ kind: "BILL_LINK", id: `preview-bill-${i}`, effective_date: billDate, source_id: source.id, target_id: revision.id, document_id: String(billId), supersedes_id: (proof.correction?.previous || proof.previous)?.id || null, payload: { quantity: revision.payload.quantity } });
    const after = v.projection(rows); m.operationalQuantity(after.quantity);
    if (proof.correction) { proof.correction.before = before; proof.correction.after = after; }
    batches.set(key, rows);
  }
  for (const [product, rows] of batches) await require("./inventoryGlService").prepare(cx, context(req, product), rows);
  req[requestProof] = { cx, billDate, signatures: items.map(itemSignature), evidence: m.fingerprint(evidence), proofs };
}
async function checkStockCapacity(cx, req, items) {
  const increments = new Map();
  for (const item of items) increments.set(String(item.product_id), (increments.get(String(item.product_id)) || 0n) + m.operationalQuantity(item.quantity).q6);
  for (const [product, increment] of increments) {
    const [rows] = await cx.query("SELECT CAST(stock AS CHAR) stock FROM products WHERE company_id=? AND id=? FOR UPDATE", [req.user.company_id, product]);
    if (rows.length !== 1) m.fail("IV_PRODUCT_NOT_FOUND");
    const current = m.operationalQuantity(rows[0].stock).q6;
    const history = v.projection(await v.records(cx, context(req, product)));
    if (current !== m.operationalQuantity(history.quantity).q6) m.fail("IV_STOCK_HISTORY_INCOMPLETE");
    m.operationalQuantity(m.decimal(current + increment));
  }
}
async function finalizeBill(cx, req, billId, billDate) {
  const [items] = await cx.query("SELECT bi.id,bi.product_id,CAST(bi.quantity AS CHAR) quantity,CAST(bi.price AS CHAR) price,CAST(bi.total AS CHAR) total,bi.source_grn_item_id FROM bill_items bi INNER JOIN bills b ON b.id=bi.bill_id WHERE b.company_id=? AND b.id=? ORDER BY bi.id", [req.user.company_id, billId]);
  if (!req[requestProof]) await preflightBill(cx, req, items, billDate, billId);
  const proof = req[requestProof];
  if (proof.cx !== cx || proof.billDate !== billDate || m.canonical(proof.signatures) !== m.canonical(items.map(itemSignature)) || proof.evidence !== m.fingerprint(list(req))) m.fail("IV_POSTING_PROOF_INVALID");
  for (let i = 0; i < items.length; i++) await v.applyBillCost(cx, context(req, items[i].product_id), { source_id: req.body.valuation_lines[i].acquisition_id, revision_id: req.body.valuation_lines[i].revision_id, correction_id: req.body.valuation_lines[i].correction_id || null, bill_id: billId, bill_date: billDate, line_id: items[i].id, proof: proof.proofs[i] });
  delete req[requestProof];
}
async function guardBillEdit(cx, req, billId, items, draft = false) {
  for (const item of items) m.operationalQuantity(item.quantity ?? item.qty);
  const [history] = await cx.query("SELECT id,source_id,supersedes_id,product_id,payload FROM iv_records WHERE company_id=? AND kind='BILL_LINK' AND document_id=?", [req.user.company_id, String(billId)]);
  if (draft) { if (history.length) m.fail("IV_DRAFT_HAS_POSTED_HISTORY"); return; }
  const evidence = list(req);
  const prior = history.filter(r => !history.some(next => next.supersedes_id === r.id));
  if (req.body?.bill_date !== undefined) {
    for (const product of [...new Set(prior.map(row => String(row.product_id)))].sort()) {
      const x = context(req, product);
      await v.prepare(cx, x);
      const rows = await v.records(cx, x);
      for (const link of prior.filter(row => String(row.product_id) === product)) {
        const source = v.find(rows, link.source_id, "ACQUISITION");
        const actual = v.find(rows, link.id, "BILL_LINK");
        if (source.document_type === "SUPPLIER" && actual.effective_date !== req.body.bill_date) {
          const replacement = evidence.find(item => item.correction_id && rows.some(row => row.id === item.correction_id && row.kind === "STOCK_CORRECTION" && row.payload.previous_bill_link_id === actual.id));
          if (!replacement) m.fail("IV_DIRECT_STOCK_DATE_IMMUTABLE");
          const replacementSource = v.find(rows, replacement.acquisition_id, "ACQUISITION");
          if (replacementSource.effective_date !== req.body.bill_date) m.fail("IV_DIRECT_STOCK_DATE_MISMATCH");
          await require("./inventoryValuationCorrectionService").preview(cx, x, rows, replacement.correction_id, billId, replacement.acquisition_id, replacement.revision_id);
        }
      }
    }
  }
  const oldSources = [...new Set(prior.map(r => r.source_id))].sort();
  if (!oldSources.length || items.length !== evidence.length) m.fail("IV_HISTORICAL_BILL_UNSUPPORTED");
  const replacementSources = [];
  for (let i = 0; i < evidence.length; i++) {
    const input = evidence[i];
    if (prior.some(row => {
      const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
      return row.source_id === input.acquisition_id && payload.revision_id === input.revision_id;
    })) m.fail("IV_NEW_BILL_REVISION_REQUIRED");
    if (!input.correction_id) replacementSources.push(v.uuid(input.acquisition_id));
    else {
      const x = context(req, items[i].product_id);
      await v.prepare(cx, x);
      const rows = await v.records(cx, x), correction = v.find(rows, input.correction_id, "STOCK_CORRECTION");
      const previous = v.find(rows, correction.payload.previous_bill_link_id, "BILL_LINK");
      if (previous.document_id !== String(billId)) m.fail("IV_CORRECTION_REQUEST_MISMATCH");
      replacementSources.push(previous.source_id);
    }
  }
  if (m.canonical(replacementSources.sort()) !== m.canonical(oldSources)) m.fail("IV_BILL_SOURCE_SET_IMMUTABLE");
}
async function guardBillDelete(cx, req, billId) {
  const [rows] = await cx.query("SELECT id FROM iv_records WHERE company_id=? AND kind='BILL_LINK' AND document_id=? LIMIT 1", [req.user.company_id, String(billId)]);
  if (rows.length) m.fail("IV_VALUED_BILL_DELETE_RESTRICTED");
}
module.exports = { postGrn, preflightBill, finalizeBill, guardBillEdit, guardBillDelete };
