"use strict";
const { tables, ownedTriggers } = require("../../services/inventoryValuationSchema");

// No connection module, environment or network imports. Synthetic SQL executor.
class Fixture {
  constructor() { this.rows = []; this.operations = []; this.stock = new Map(); this.counters = new Map(); this.calls = []; this.status = "OPEN"; this.owner = "2"; this.conflict = null; this.missing = new Set(); }
  async query(sql, p = []) {
    this.calls.push([sql, p]);
    if (sql === "DO 0") return [{ serverStatus: this.autocommitOnly ? 2 : 3 }];
    const table = tables[p[0]];
    if (sql.includes("NUMERIC_PRECISION")) return [[{ DATA_TYPE: "decimal", NUMERIC_PRECISION: 12, NUMERIC_SCALE: 2, IS_NULLABLE: "NO", EXTRA: "" }]];
    if (sql.includes("information_schema.TABLES")) return [this.missing.has(p[0]) ? [] : [{ ENGINE: "InnoDB", TABLE_COLLATION: "utf8mb4_bin", TABLE_TYPE: "BASE TABLE" }]];
    if (sql.includes("information_schema.COLUMNS")) return [Object.entries(table.columns).map(([n, c]) => ({ COLUMN_NAME: n, COLUMN_TYPE: this.conflict === n ? "int" : c.type, IS_NULLABLE: c.nullable ? "YES" : "NO", COLUMN_DEFAULT: null, EXTRA: "", COLLATION_NAME: /^(char|varchar|enum)\(/.test(c.type) ? "utf8mb4_bin" : null, GENERATION_EXPRESSION: "" }))];
    if (sql.includes("information_schema.STATISTICS")) return [Object.entries(table.indexes).flatMap(([n, i]) => i.columns.map((c, j) => ({ INDEX_NAME: n, NON_UNIQUE: i.unique ? 0 : 1, COLUMN_NAME: c, SEQ_IN_INDEX: j + 1, SUB_PART: null, INDEX_TYPE: "BTREE", COLLATION: "A", IS_VISIBLE: "YES", EXPRESSION: null })))];
    if (sql.includes("information_schema.TABLE_CONSTRAINTS")) return [[...Object.entries(table.indexes).filter(([, i]) => i.unique).map(([n]) => ({ CONSTRAINT_NAME: n, CONSTRAINT_TYPE: n === "PRIMARY" ? "PRIMARY KEY" : "UNIQUE" })), ...table.foreign.map(f => ({ CONSTRAINT_NAME: f.name, CONSTRAINT_TYPE: "FOREIGN KEY" }))]];
    if (sql.includes("information_schema.KEY_COLUMN_USAGE")) return [table.foreign.flatMap(f => f.columns.map((c, i) => ({ CONSTRAINT_NAME: f.name, COLUMN_NAME: c, REFERENCED_TABLE_NAME: f.table, REFERENCED_COLUMN_NAME: f.references[i], DELETE_RULE: "RESTRICT", UPDATE_RULE: "RESTRICT", LOCAL_REFERENCE: 1 })))];
    if (sql.includes("information_schema.TRIGGERS")) return [ownedTriggers.filter(t => sql.includes("TRIGGER_NAME=?") ? t.name === p[0] : t.table === p[0]).map(t => ({ TRIGGER_NAME: t.name, EVENT_MANIPULATION: t.event, ACTION_TIMING: "BEFORE", ACTION_ORIENTATION: "ROW", ACTION_STATEMENT: t.body }))];
    if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
    if (sql.includes("RELEASE_LOCK")) return [[{ released: 1 }]];
    if (sql.includes("FROM companies")) return [[{ id: p[0] }]];
    if (sql.includes("FROM iv_operations")) return [this.operations.filter(r => String(r.company_id) === String(p[0]) && r.operation_key === p[1])];
    if (sql.startsWith("INSERT INTO iv_operations")) { this.operations.push({ company_id: p[0], operation_key: p[1], actor_id: p[2], action: p[3], fingerprint: p[4], result: JSON.parse(p[5]) }); return [{ affectedRows: 1 }]; }
    if (sql.includes("FROM users")) return [[{ id: p[0], role: String(p[0]) === this.owner ? "owner" : "accountant" }]];
    if (sql.includes("FROM financial_years")) return [[{ id: "1", status: this.status }]];
    if (sql.startsWith("SELECT id FROM products")) return [[{ id: p[1] }]];
    if (sql.startsWith("SELECT CAST(stock AS CHAR)")) return [[{ stock: this.stock.get(`${p[0]}:${p[1]}`) || "0.00" }]];
    if (sql.startsWith("UPDATE products SET stock=stock+?")) {
      const m = require("../../services/inventoryValuationMath"), key = `${p[2]}:${p[1]}`, current = this.stock.get(key) || "0.00";
      if (p[3] !== undefined && m.quantity(current) !== m.quantity(p[3])) return [{ affectedRows: 0 }];
      const change = String(p[0]), negative = change.startsWith("-"), units = m.quantity(negative ? change.slice(1) : change);
      this.stock.set(key, m.operationalQuantity(m.decimal(m.quantity(current) + (negative ? -units : units))).sql);
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("FROM goods_receipt_items")) return [[{ id: p.at(-1) }]];
    if (sql.includes("FROM iv_product_locks")) return [[{ product_id: p[1] }]];
    if (sql.startsWith("INSERT INTO iv_product_locks")) return [{ affectedRows: 1 }];
    if (sql.startsWith("INSERT INTO iv_date_sequences")) { if (!this.counters.has(p.join(":"))) this.counters.set(p.join(":"), "0"); return [{ affectedRows: 1 }]; }
    if (sql.includes("FROM iv_date_sequences")) return [sql.includes("ORDER BY effective_date") ? [...this.counters].filter(([key]) => key.startsWith(`${p[0]}:${p[1]}:`)).map(([key, value]) => ({ effective_date: key.split(":")[2], last_sequence: value })).sort((a,b) => a.effective_date.localeCompare(b.effective_date)) : [{ last_sequence: this.counters.get(p.join(":")) }]];
    if (sql.startsWith("UPDATE iv_date_sequences")) { this.counters.set(p.slice(1).join(":"), p[0]); return [{ affectedRows: 1 }]; }
    if (sql.startsWith("INSERT INTO iv_records")) {
      const names = ["company_id", "product_id", "id", "kind", "effective_date", "sequence", "source_id", "supersedes_id", "target_id", "document_type", "document_id", "source_line", "acquisition_key", "idempotency_key", "fingerprint", "payload", "creator_id"];
      this.rows.push(Object.fromEntries(names.map((n,i) => [n, n === "payload" ? JSON.parse(p[i]) : p[i]])));
      return [{ affectedRows: 1 }];
    }
    if (sql.includes("FROM iv_records")) {
      let rows = this.rows.filter(r => r.company_id === String(p[0]) && (!sql.includes("AND product_id=?") || r.product_id === String(p[1])));
      if (sql.includes("kind='BILL_LINK'")) rows = rows.filter(r => r.kind === "BILL_LINK" && r.document_id === String(p[1]));
      if (sql.includes("idempotency_key=?")) rows = rows.filter(r => r.idempotency_key === p[2]);
      return [structuredClone(rows).sort((a,b) => a.effective_date.localeCompare(b.effective_date) || Number(BigInt(a.sequence) - BigInt(b.sequence)))];
    }
    throw new Error(`Unexpected fixture SQL: ${sql}`);
  }
  async transaction(fn) {
    const before = structuredClone(this.rows), operations = structuredClone(this.operations), counters = new Map(this.counters), stock = new Map(this.stock);
    try { return await fn(this); } catch (e) { this.rows = before; this.operations = operations; this.counters = counters; this.stock = stock; throw e; }
  }
}
const evidence = (overrides = {}) => ({ currency: "INR", state: "PROVISIONAL", basis: "PO_NET", reference: "synthetic-po", reason: "synthetic approved cost", quantity: "10.000000", purchase_minor: "1000", taxes: [], allocations: [], total_minor: "1000", ...overrides });
const base = { company_id: "1", product_id: "1", actor_id: "1" };
async function approve(cx, input) {
  const v = require("../../services/inventoryValuationService");
  await v.submitCost(cx, { ...input, actor_id: "1", idempotency_key: `${input.idempotency_key}:submit` });
  return v.approveCost(cx, input);
}
async function opening(cx, x = base) {
  const v = require("../../services/inventoryValuationService");
  const key = `zero-opening:${x.product_id}`;
  const source = await v.createAcquisition(cx, { ...x, date: "2026-04-01", document_type: "OPENING", document_id: "synthetic-opening", source_line: String(x.product_id), reference: "explicit zero opening", idempotency_key: key });
  const cost = await v.recordCost(cx, { ...x, source_id: source.id, evidence: evidence({ state: "FINAL", basis: "OPENING", quantity: "0", purchase_minor: "0", total_minor: "0" }), idempotency_key: `${key}:cost` });
  await approve(cx, { ...x, actor_id: cx.owner, revision_id: cost.id, reason: "explicit independent approval", idempotency_key: `${key}:approval` });
  return v.postAcquisition(cx, { ...x, source_id: source.id, revision_id: cost.id, idempotency_key: `${key}:post` });
}
// Build approved evidence through the same public service operations as callers;
// controller regression fixtures must not bypass the evidence contract.
async function operationalEvidence({ company = "4", product = "9", actor = "13", owner = "14", type = "SUPPLIER", date = "2026-08-12", document = "fixture-supplier", line = "fixture-line", quantity = "2", receiptQuantity = quantity, tax = "3600", correction = false, post = false } = {}) {
  const v = require("../../services/inventoryValuationService"), components = require("../../services/inventoryValuationComponentService");
  const cx = new Fixture(); cx.owner = owner;
  const x = { company_id: company, product_id: product, actor_id: actor };
  await opening(cx, x);
  const source = await v.createAcquisition(cx, { ...x, date, document_type: type, document_id: document, source_line: line, reference: "synthetic source document", idempotency_key: "fixture-source" });
  const cost = async (qty, key, supersedes = null, provisional = false, taxMinor = tax) => {
    let taxes = [];
    if (taxMinor !== "0") {
      const component = await components.create(cx, { ...x, date, kind: "TAX", reference: key, document_id: key, component_line: "tax", total_minor: taxMinor, basis: "QUANTITY", recipients: [{ acquisition_id: source.id, weight: "1" }], recoverability: "RECOVERABLE", idempotency_key: `${key}-tax` });
      taxes = [{ component_id: component.id, reference: key, amount_minor: taxMinor, recoverability: "RECOVERABLE" }];
    }
    const m = require("../../services/inventoryValuationMath"), purchase = (m.operationalQuantity(qty).q6 * 10000n / 1000000n).toString();
    const revision = await v.recordCost(cx, { ...x, source_id: source.id, ...(supersedes ? { supersedes_id: supersedes.id } : {}), evidence: evidence({ state: provisional ? "PROVISIONAL" : "FINAL", basis: provisional ? "PO_NET" : "SUPPLIER_DOCUMENT", quantity: qty, purchase_minor: purchase, total_minor: purchase, taxes }), idempotency_key: key });
    await approve(cx, { ...x, actor_id: owner, revision_id: revision.id, reason: "synthetic owner approval", idempotency_key: `${key}-approved` });
    return revision;
  };
  let prior = null, oldLink = null;
  if (type === "GRN" || correction) {
    prior = await cost(correction ? "1" : receiptQuantity, "fixture-initial", null, type === "GRN", "0");
    if (correction) oldLink = await v.applyBillCost(cx, x, { source_id: source.id, revision_id: prior.id, bill_id: "81", bill_date: date, line_id: "90" });
    else if (!post) await v.postAcquisition(cx, { ...x, source_id: source.id, revision_id: prior.id, idempotency_key: "fixture-receipt" });
    if (!post) cx.stock.set(`${company}:${product}`, correction ? "1.00" : require("../../services/inventoryValuationMath").operationalQuantity(receiptQuantity).sql);
  }
  const revision = post ? prior : await cost(quantity, "fixture-final", prior);
  const valuation = { acquisition_id: source.id, revision_id: revision.id, ...(type === "GRN" ? { source_grn_item_id: line } : {}) };
  if (correction) {
    const corrections = require("../../services/inventoryValuationCorrectionService");
    const movement = cx.rows.find(r => r.kind === "RECEIPT");
    const record = await corrections.create(cx, { ...x, bill_id: "81", movement_id: movement.id, previous_bill_link_id: oldLink.id, new_source_id: source.id, new_revision_id: revision.id, reason: "approved quantity correction", idempotency_key: "fixture-correction" });
    await corrections.approve(cx, { ...x, actor_id: owner, correction_id: record.id, reason: "owner approval", idempotency_key: "fixture-correction-approved" });
    valuation.correction_id = record.id;
  }
  return { cx, x, source, revision, valuation };
}
module.exports = { Fixture, evidence, base, approve, opening, operationalEvidence };
