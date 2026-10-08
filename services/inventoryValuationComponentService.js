"use strict";
const m = require("./inventoryValuationMath");
const v = () => require("./inventoryValuationService");
const componentKinds = ["TRADE_DISCOUNT", "SUPPLIER_COST_CREDIT", "FREIGHT_INWARD", "HANDLING", "DIRECT_ACQUISITION", "TAX"];
const componentRoot = r => r.kind === "COMPONENT" ? r.id : r.source_id;
async function read(cx, company, locking = true) {
  const [rows] = await cx.query(`SELECT *,CAST(sequence AS CHAR) sequence,DATE_FORMAT(effective_date,'%Y-%m-%d') effective_date FROM iv_records WHERE company_id=? ORDER BY product_id,effective_date,iv_records.sequence,id${locking ? " FOR UPDATE" : ""}`, [v().id(company)]);
  return rows.map(v().decodeRecord);
}
function validateDefinition(p) {
  if (!componentKinds.includes(p.kind)) m.fail("IV_COST_COMPONENT_UNSUPPORTED");
  m.text(p.reference); m.integer(p.total_minor);
  const expected = m.allocate(p.total_minor, p.basis, p.lines);
  if (m.canonical(expected) !== m.canonical(p.calculated)) m.fail("IV_ALLOCATION_MISMATCH");
  if (p.kind === "TAX" && !["RECOVERABLE", "NON_RECOVERABLE", "UNKNOWN"].includes(p.recoverability)) m.fail("IV_TAX_CLASSIFICATION_REQUIRED");
  if (p.kind !== "TAX" && p.recoverability !== null) m.fail("IV_TAX_CLASSIFICATION_REQUIRED");
  if (p.reversal && (!p.reversal.revision_id || !Array.isArray(p.reversal.calculated))) m.fail("IV_COMPONENT_REVERSAL_REQUIRED");
  return p;
}
async function create(cx, x) {
  const valuation = v();
  if (!componentKinds.includes(x.kind) || !Array.isArray(x.recipients) || !x.recipients.length || x.recipients.length > 500) m.fail("IV_COMPONENT_EVIDENCE_REQUIRED");
  const lines = x.recipients.map(r => {
    if (Object.keys(r).some(k => !["acquisition_id", "weight"].includes(k))) m.fail("IV_UNSUPPORTED_EVIDENCE_FIELD");
    return { line: valuation.uuid(r.acquisition_id), weight: m.integer(r.weight).toString() };
  });
  const calculated = m.allocate(x.total_minor, x.basis, lines);
  await valuation.prepare(cx, x);
  const rows = await read(cx, x.company_id);
  const sources = lines.map(line => valuation.find(rows, line.line, "ACQUISITION"));
  const products = [...new Set(sources.map(r => String(r.product_id)))].sort();
  if (products[0] !== String(x.product_id)) m.fail("IV_COMPONENT_ANCHOR_PRODUCT_MISMATCH");
  for (const product_id of products) await valuation.prepare(cx, { ...x, product_id });
  const previous = x.supersedes_id ? valuation.find(rows, x.supersedes_id) : null;
  if (previous && (!["COMPONENT", "COMPONENT_REVISION"].includes(previous.kind) || previous.document_id !== x.document_id || previous.source_line !== x.component_line || String(previous.product_id) !== String(x.product_id))) m.fail("IV_COMPONENT_IDENTITY_CONFLICT");
  if (previous && rows.some(r => r.supersedes_id === previous.id)) m.fail("IV_REVISION_CONFLICT");
  if (!previous && rows.some(r => r.kind === "COMPONENT" && r.document_id === x.document_id && r.source_line === x.component_line)) m.fail("IV_COMPONENT_IDENTITY_CONFLICT");
  const payload = validateDefinition({ kind: x.kind, reference: m.text(x.reference), total_minor: x.total_minor, basis: x.basis, lines,
    calculated, recoverability: x.kind === "TAX" ? x.recoverability : null,
    reversal: previous ? { revision_id: previous.id, calculated: previous.payload.calculated } : null });
  return valuation.append(cx, x, { kind: previous ? "COMPONENT_REVISION" : "COMPONENT", effective_date: m.date(x.date),
    source_id: previous ? componentRoot(previous) : null, supersedes_id: previous?.id || null, target_id: previous?.id || null,
    document_type: "COST_COMPONENT", document_id: m.text(x.document_id, 100), source_line: m.text(x.component_line, 100), idempotency_key: x.idempotency_key, payload });
}
function verifyCost(rows, source, evidence, { current = true } = {}) {
  const roots = new Set();
  for (const input of [...evidence.taxes, ...evidence.allocations]) {
    const component = v().find(rows, input.component_id);
    if (!["COMPONENT", "COMPONENT_REVISION"].includes(component.kind)) m.fail("IV_COMPONENT_REFERENCE_REQUIRED");
    validateDefinition(component.payload);
    const root = componentRoot(component);
    if (roots.has(root)) m.fail("IV_DUPLICATE_COST_COMPONENT");
    roots.add(root);
    if (current && rows.some(r => r.kind === "COMPONENT_REVISION" && r.supersedes_id === component.id)) m.fail("IV_COMPONENT_REVISION_SUPERSEDED");
    const allocation = component.payload.calculated.find(r => r.line === source.id);
    if (!allocation) m.fail("IV_COMPONENT_SOURCE_MISMATCH");
    if (evidence.taxes.includes(input)) {
      if (component.payload.kind !== "TAX" || input.amount_minor !== allocation.amount_minor || input.reference !== component.payload.reference || input.recoverability !== component.payload.recoverability) m.fail("IV_COMPONENT_ALLOCATION_MISMATCH");
    } else {
      const expected = { component_id: component.id, kind: component.payload.kind, reference: component.payload.reference, total_minor: component.payload.total_minor,
        basis: component.payload.basis, lines: component.payload.lines, calculated: component.payload.calculated, line: source.id };
      if (component.payload.kind === "TAX" || m.canonical(input) !== m.canonical(expected)) m.fail("IV_COMPONENT_ALLOCATION_MISMATCH");
    }
  }
}
function verifyBillClaims(rows, source, revision, billId) {
  const active = v().latestBillLinks(rows, source.id).filter(link => link.document_id !== String(billId));
  const consumed = new Set();
  for (const cost of [...active.map(link => v().find(rows, link.target_id, "COST")), revision]) {
    for (const item of [...cost.payload.taxes, ...cost.payload.allocations]) {
      const root = componentRoot(v().find(rows, item.component_id));
      if (consumed.has(root)) m.fail("IV_COMPONENT_OVERALLOCATED");
      consumed.add(root);
    }
  }
}
module.exports = { create: require("./inventoryValuationOperationService").wrap("component", create), read, validateDefinition, verifyCost, verifyBillClaims, componentRoot };
