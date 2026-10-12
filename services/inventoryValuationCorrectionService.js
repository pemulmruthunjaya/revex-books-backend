"use strict";
const m = require("./inventoryValuationMath");
const ops = require("./inventoryValuationOperationService");
const v = () => require("./inventoryValuationService");
function basis(rows, movement) {
  return v().appliedBasis(rows, movement);
}
function validate(rows, x, requireApproval = false) {
  const valuation = v();
  const movement = valuation.find(rows, x.movement_id, "RECEIPT");
  const previous = valuation.find(rows, x.previous_bill_link_id, "BILL_LINK");
  const old = basis(rows, movement);
  const source = valuation.find(rows, x.new_source_id, "ACQUISITION");
  const revision = valuation.approved(rows, valuation.find(rows, x.new_revision_id, "COST"));
  if (movement.document_type !== "SUPPLIER" || source.document_type !== "SUPPLIER" || revision.source_id !== source.id || revision.payload.state !== "FINAL" || revision.payload.basis !== "SUPPLIER_DOCUMENT") m.fail("IV_CORRECTION_SOURCE_INVALID");
  if (previous.document_id !== String(x.bill_id) || previous.source_id !== old.source_id || previous.target_id !== old.revision.id || rows.some(r => r.kind === "BILL_LINK" && r.supersedes_id === previous.id)) m.fail("IV_CORRECTION_STALE");
  if (source.id === old.source_id && revision.supersedes_id !== old.revision.id) m.fail("IV_REVISION_CONFLICT");
  if (source.id !== old.source_id && rows.some(r => (r.kind === "RECEIPT" && r.source_id === source.id) || (r.kind === "STOCK_REPLACEMENT" && r.payload.new_source_id === source.id) || (r.kind === "BILL_LINK" && r.source_id === source.id))) m.fail("IV_SOURCE_ALREADY_POSTED");
  if (requireApproval && !rows.some(r => r.kind === "CORRECTION_APPROVAL" && r.target_id === x.correction_id)) m.fail("IV_CORRECTION_NOT_APPROVED");
  return { movement, previous, old, source, revision };
}
async function create(cx, x) {
  await v().prepare(cx, x);
  const rows = await v().records(cx, x), plan = validate(rows, x);
  await v().lockReplayPeriods(cx, x, rows, [plan.old.effective_date, plan.source.effective_date].sort()[0], [plan.old.effective_date, plan.source.effective_date, plan.previous.effective_date]);
  return v().append(cx, x, { ...v().ref(plan.movement), effective_date: plan.old.effective_date, kind: "STOCK_CORRECTION", target_id: plan.movement.id, idempotency_key: x.idempotency_key,
    payload: { bill_id: String(x.bill_id), previous_bill_link_id: plan.previous.id, old_revision_id: plan.old.revision.id,
      new_source_id: plan.source.id, new_revision_id: plan.revision.id, reason: m.text(x.reason),
      old_quantity: plan.old.revision.payload.quantity, new_quantity: plan.revision.payload.quantity } });
}
async function approve(cx, x) {
  await v().prepare(cx, x); await v().actor(cx, x.company_id, x.actor_id, true);
  const rows = await v().records(cx, x), correction = v().find(rows, x.correction_id, "STOCK_CORRECTION");
  const plan = validate(rows, { ...correction.payload, movement_id: correction.target_id });
  await v().lockReplayPeriods(cx, x, rows, [plan.old.effective_date, plan.source.effective_date].sort()[0], [plan.old.effective_date, plan.source.effective_date, plan.previous.effective_date]);
  if (rows.some(r => r.kind === "CORRECTION_APPROVAL" && r.target_id === correction.id)) m.fail("IV_ALREADY_APPROVED");
  return v().append(cx, x, { ...v().ref(correction), kind: "CORRECTION_APPROVAL", target_id: correction.id, idempotency_key: x.idempotency_key, payload: { reason: m.text(x.reason) } });
}
async function preview(cx, x, rows, correctionId, billId, sourceId, revisionId) {
  const correction = v().find(rows, correctionId, "STOCK_CORRECTION");
  if (correction.payload.bill_id !== String(billId) || correction.payload.new_source_id !== sourceId || correction.payload.new_revision_id !== revisionId) m.fail("IV_CORRECTION_REQUEST_MISMATCH");
  const plan = validate(rows, { ...correction.payload, movement_id: correction.target_id, correction_id: correction.id }, true);
  await v().lockReplayPeriods(cx, x, rows, [plan.old.effective_date, plan.source.effective_date].sort()[0], [plan.old.effective_date, plan.source.effective_date, plan.previous.effective_date]);
  const before = v().projection(rows);
  const sequence = (rows.filter(r => r.effective_date === plan.source.effective_date).reduce((maximum, row) => BigInt(row.sequence) > maximum ? BigInt(row.sequence) : maximum, 0n) + 1n).toString();
  const replacement = { kind: "STOCK_REPLACEMENT", sequence, target_id: plan.movement.id, payload: { revision_id: revisionId, new_source_id: sourceId } };
  const after = v().projection([...rows, replacement]);
  const [products] = await cx.query("SELECT CAST(stock AS CHAR) stock FROM products WHERE company_id=? AND id=? FOR UPDATE", [x.company_id, x.product_id]);
  if (products.length !== 1 || m.operationalQuantity(products[0].stock).q6 !== m.operationalQuantity(before.quantity).q6) m.fail("IV_STOCK_HISTORY_INCOMPLETE");
  m.operationalQuantity(after.quantity);
  // Any uninventoried sale/return/challan or bill makes correction unsafe,
  // including opposing movements that happen to net to the same current stock.
  const [bills] = await cx.query("SELECT bi.id FROM bill_items bi INNER JOIN bills b ON b.id=bi.bill_id WHERE b.company_id=? AND bi.product_id=?", [x.company_id, x.product_id]);
  if (bills.some(b => !rows.some(r => r.kind === "BILL_LINK" && r.source_line === String(b.id)))) m.fail("IV_UNLINKED_BILL_HISTORY");
  const [sales] = await cx.query("SELECT ii.id FROM invoice_items ii INNER JOIN invoices i ON i.id=ii.invoice_id WHERE i.company_id=? AND ii.product_id=?", [x.company_id, x.product_id]);
  if (sales.some(s => !rows.some(r => r.kind === "ISSUE" && r.source_line === String(s.id)))) m.fail("IV_UNSUPPORTED_HISTORICAL_MOVEMENT");
  const [inventory] = await cx.query("SELECT reference_type,reference_id,CAST(quantity_in AS CHAR) quantity_in,CAST(quantity_out AS CHAR) quantity_out FROM inventory_transactions WHERE company_id=? AND product_id=?", [x.company_id, x.product_id]);
  const seen = new Set();
  for (const item of inventory) {
    const key = `${item.reference_type}:${item.reference_id}`;
    const linked = rows.filter(r => r.kind === "RECEIPT" && r.document_type === "GRN" && r.document_id === String(item.reference_id));
    if (seen.has(key) || item.reference_type !== "GRN" || m.operationalQuantity(item.quantity_out).q6 || !linked.length || linked.reduce((sum, r) => sum + m.operationalQuantity(v().find(rows, r.payload.revision_id, "COST").payload.quantity).q6, 0n) !== m.operationalQuantity(item.quantity_in).q6) m.fail("IV_UNSUPPORTED_HISTORICAL_MOVEMENT");
    seen.add(key);
  }
  for (const table of ["return_items", "delivery_challan_items"]) {
    const [unsupported] = await cx.query(`SELECT id FROM ${table} WHERE company_id=? AND product_id=? LIMIT 1`, [x.company_id, x.product_id]);
    if (unsupported.length) m.fail("IV_UNSUPPORTED_HISTORICAL_MOVEMENT");
  }
  return { ...plan, correction, before, after };
}
async function apply(cx, x, plan, key) {
  const reverse = await v().append(cx, x, { ...v().ref(plan.movement), effective_date: plan.old.effective_date, kind: "STOCK_REVERSAL", target_id: plan.movement.id, idempotency_key: `${key}:stock-reverse`,
    payload: { correction_id: plan.correction.id, revision_id: plan.old.revision.id, quantity: plan.old.revision.payload.quantity, total_minor: plan.old.revision.payload.total_minor } });
  const replacement = await v().append(cx, x, { ...v().ref(plan.movement), effective_date: plan.source.effective_date, kind: "STOCK_REPLACEMENT", target_id: plan.movement.id, idempotency_key: `${key}:stock-replace`,
    payload: { correction_id: plan.correction.id, reversal_id: reverse.id, revision_id: plan.revision.id, new_source_id: plan.source.id,
      quantity: plan.revision.payload.quantity, total_minor: plan.revision.payload.total_minor } });
  const delta = m.operationalQuantity(plan.after.quantity).q6 - m.operationalQuantity(plan.before.quantity).q6;
  if (delta) {
    const amount = `${delta < 0n ? "-" : ""}${m.operationalQuantity(m.decimal(delta < 0n ? -delta : delta)).sql}`;
    const [result] = await cx.query("UPDATE products SET stock=stock+? WHERE id=? AND company_id=? AND stock=?", [amount, x.product_id, x.company_id, m.operationalQuantity(plan.before.quantity).sql]);
    if (result.affectedRows !== 1) m.fail("IV_STOCK_CONFLICT");
  }
  return replacement;
}
module.exports = { create: ops.wrap("stock-correction", create), approve: ops.wrap("approve-stock-correction", approve), preview, apply, basis };
