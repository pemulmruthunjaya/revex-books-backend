"use strict";

const { createHash } = require("node:crypto");
const fail = (code) => { throw Object.assign(new Error(code), { code, status: 409 }); };
const canonical = (v) => {
  if (typeof v === "bigint") return JSON.stringify(v.toString());
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  if (v === undefined || (typeof v === "number" && !Number.isSafeInteger(v))) fail("IV_INVALID_VALUE");
  return JSON.stringify(v);
};
const fingerprint = v => createHash("sha256").update(canonical(v)).digest("hex");
const acquisitionKey = r => createHash("sha256").update([r.document_type, r.document_id, r.source_line].map(s => Buffer.from(s, "utf8").toString("hex").toUpperCase()).join(":")).digest("hex");
const integer = v => {
  if (typeof v !== "string" || !/^(0|[1-9]\d{0,29})$/.test(v)) fail("IV_INTEGER_STRING_REQUIRED");
  return BigInt(v);
};
const quantity = v => {
  if (typeof v !== "string" || !/^(0|[1-9]\d{0,23})(\.\d{1,6})?$/.test(v)) fail("IV_QUANTITY_INVALID");
  const [w, f = ""] = v.split(".");
  return BigInt(w) * 1000000n + BigInt(f.padEnd(6, "0"));
};
const decimal = q => `${q / 1000000n}.${String(q % 1000000n).padStart(6, "0")}`;
// The narrow operational adapter is capped at DECIMAL(10,2), the smallest
// supported stock/opening contract. The valuation engine remains Q6.
const OPERATIONAL_MAX_Q2 = 9999999999n;
const operationalQuantity = input => {
  // Existing clients may send whole JSON numbers. Fractional input must be a
  // decimal string: a parsed JSON float cannot preserve its original spelling.
  const original = typeof input === "number" && Number.isSafeInteger(input) && input >= 0 && !Object.is(input, -0)
    ? String(input) : input;
  if (typeof original !== "string" || !/^(0|[1-9]\d{0,7})(\.\d{1,6})?$/.test(original)) fail("INVENTORY_QUANTITY_PRECISION_UNSUPPORTED");
  const q6 = quantity(original);
  if (q6 % 10000n || q6 / 10000n > OPERATIONAL_MAX_Q2) fail("INVENTORY_QUANTITY_PRECISION_UNSUPPORTED");
  const q2 = q6 / 10000n;
  return Object.freeze({ original, q6, q2, sql: `${q2 / 100n}.${String(q2 % 100n).padStart(2, "0")}` });
};
const halfUp = (n, d) => {
  if (n < 0n || d <= 0n) fail("IV_ARITHMETIC_INVALID");
  return (2n * n + d) / (2n * d);
};
const money = value => {
  const input = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
  if (typeof input !== "string" || !/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(input)) fail("IV_DOCUMENT_AMOUNT_INVALID");
  const [whole, fraction = ""] = input.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
};
const moneyDecimal = value => {
  if (typeof value !== "bigint" || value < 0n || value > 999999999999n) fail("IV_DOCUMENT_AMOUNT_OVERFLOW");
  return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
};
const billAmounts = (quantityValue, priceValue, gstValue) => {
  const q = operationalQuantity(quantityValue), price = money(priceValue), gst = money(gstValue);
  if (!q.q6 || gst > 10000n) fail("IV_DOCUMENT_AMOUNT_INVALID");
  const base = halfUp(q.q6 * price, 1000000n), tax = halfUp(base * gst, 10000n), total = base + tax;
  if (total > 999999999999n) fail("IV_DOCUMENT_AMOUNT_OVERFLOW");
  const cgst = halfUp(tax, 2n);
  return { quantity: q.sql, price: moneyDecimal(price), gst: moneyDecimal(gst), total: moneyDecimal(total), cgst: moneyDecimal(cgst), sgst: moneyDecimal(tax - cgst) };
};
const text = (v, max = 200) => {
  if (typeof v !== "string" || !v.trim() || v.length > max || /[\x00-\x1f]/.test(v)) fail("IV_EVIDENCE_REQUIRED");
  return v;
};
const date = v => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v) fail("IV_DATE_INVALID");
  return v;
};
const shape = (value, fields) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !fields.includes(k))) fail("IV_UNSUPPORTED_EVIDENCE_FIELD");
};

// Ordered cumulative half-up allocation conserves every minor unit. The caller
// supplies the basis and the complete document line weights; no default basis.
function allocate(total, basis, lines) {
  if (!["LINE_VALUE", "QUANTITY", "WEIGHT"].includes(basis) || !Array.isArray(lines) || !lines.length || lines.length > 500) fail("IV_ALLOCATION_BASIS_REQUIRED");
  const rows = lines.map(x => { shape(x, ["line", "weight"]); return { line: text(x.line), weight: integer(x.weight) }; }).sort((a, b) => a.line < b.line ? -1 : a.line > b.line ? 1 : 0);
  if (new Set(rows.map(x => x.line)).size !== rows.length) fail("IV_DUPLICATE_LINE");
  const denominator = rows.reduce((s, x) => s + x.weight, 0n), amount = integer(total);
  if (!denominator) fail("IV_ALLOCATION_BASIS_REQUIRED");
  let cumulative = 0n, allocated = 0n;
  return rows.map(x => {
    cumulative += x.weight;
    const next = halfUp(amount * cumulative, denominator), share = next - allocated;
    allocated = next;
    return { line: x.line, weight: x.weight.toString(), amount_minor: share.toString() };
  });
}

function validateCost(e) {
  shape(e, ["currency", "state", "basis", "reference", "reason", "quantity", "purchase_minor", "taxes", "allocations", "total_minor"]);
  if (!e || e.currency !== "INR" || !["PROVISIONAL", "FINAL"].includes(e.state)) fail("IV_COST_EVIDENCE_REQUIRED");
  text(e.reference); text(e.reason); operationalQuantity(e.quantity);
  if (!["PO_NET", "SUPPLIER_DOCUMENT", "APPROVED_ACQUISITION", "OPENING"].includes(e.basis)) fail("IV_COST_BASIS_REQUIRED");
  let value = integer(e.purchase_minor);
  if (!Array.isArray(e.taxes) || !Array.isArray(e.allocations) || e.taxes.length > 50 || e.allocations.length > 50) fail("IV_EXPLICIT_COST_COMPONENTS_REQUIRED");
  let unknown = false;
  const componentReferences = new Set();
  for (const component of [...e.taxes, ...e.allocations]) {
    const identity = component.component_id || component.reference;
    if (componentReferences.has(identity)) fail("IV_DUPLICATE_COST_COMPONENT");
    componentReferences.add(identity);
  }
  for (const tax of e.taxes) {
    shape(tax, ["component_id", "reference", "amount_minor", "recoverability"]);
    text(tax.reference);
    const amount = integer(tax.amount_minor);
    if (!["RECOVERABLE", "NON_RECOVERABLE", "UNKNOWN"].includes(tax.recoverability)) fail("IV_TAX_CLASSIFICATION_REQUIRED");
    if (tax.recoverability === "NON_RECOVERABLE") value += amount;
    if (tax.recoverability === "UNKNOWN") unknown = true;
  }
  for (const allocation of e.allocations) {
    shape(allocation, ["component_id", "kind", "reference", "total_minor", "basis", "lines", "calculated", "line"]);
    if (!["TRADE_DISCOUNT", "SUPPLIER_COST_CREDIT", "FREIGHT_INWARD", "HANDLING", "DIRECT_ACQUISITION"].includes(allocation.kind)) fail("IV_COST_COMPONENT_UNSUPPORTED");
    text(allocation.reference);
    const calculated = allocate(allocation.total_minor, allocation.basis, allocation.lines);
    if (canonical(calculated) !== canonical(allocation.calculated)) fail("IV_ALLOCATION_MISMATCH");
    const line = calculated.find(x => x.line === allocation.line);
    if (!line) fail("IV_ALLOCATION_LINE_MISSING");
    const amount = integer(line.amount_minor);
    value += ["TRADE_DISCOUNT", "SUPPLIER_COST_CREDIT"].includes(allocation.kind) ? -amount : amount;
  }
  if (value < 0n || integer(e.total_minor) !== value || (!quantity(e.quantity) && value)) fail("IV_COST_TOTAL_INVALID");
  if (unknown && e.state === "FINAL") fail("IV_TAX_RECOVERABILITY_UNKNOWN");
  return e;
}

// Pure replay takes immutable, already authorized evidence, not product prices.
// Revision records replace the effective receipt basis, never the evidence itself.
function replay(movements) {
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const ordered = [...movements].sort((a, b) => compare(date(a.date), date(b.date)) ||
    compare(integer(a.sequence), integer(b.sequence)) || compare(a.id, b.id));
  let q = 0n, value = 0n;
  const seen = new Map(), returned = new Map(), results = [];
  for (const m of ordered) {
    if (seen.has(m.id)) fail("IV_DUPLICATE_MOVEMENT");
    const amount = quantity(m.quantity);
    if (!amount && m.kind !== "OPENING") fail("IV_ZERO_MOVEMENT");
    let cost;
    if (["OPENING", "RECEIPT"].includes(m.kind)) {
      if (m.kind === "OPENING" && results.length) fail("IV_OPENING_NOT_FIRST");
      cost = integer(m.total_minor);
      if (!amount && cost) fail("IV_COST_TOTAL_INVALID");
      q += amount; value += cost;
    } else if (m.kind === "ISSUE") {
      if (!q || amount > q) fail("IV_NEGATIVE_STOCK");
      cost = amount === q ? value : halfUp(value * amount, q);
      q -= amount; value -= cost;
    } else if (["CUSTOMER_RETURN", "VENDOR_RETURN"].includes(m.kind)) {
      const original = seen.get(m.target);
      const expected = m.kind === "CUSTOMER_RETURN" ? ["ISSUE"] : ["RECEIPT"];
      if (!original || !expected.includes(original.kind) || m.source_line !== original.source_line) fail("IV_RETURN_LINK_REQUIRED");
      const prior = returned.get(m.target) || { quantity: 0n, cost: 0n };
      const cumulative = prior.quantity + amount;
      if (cumulative > original.amount) fail("IV_EXCESS_RETURN");
      const cumulativeCost = cumulative === original.amount ? original.cost : halfUp(original.cost * cumulative, original.amount);
      cost = cumulativeCost - prior.cost;
      returned.set(m.target, { quantity: cumulative, cost: cumulativeCost });
      if (m.kind === "CUSTOMER_RETURN") { q += amount; value += cost; }
      else { q -= amount; value -= cost; }
    } else fail("IV_UNSUPPORTED_MOVEMENT");
    if (q < 0n || value < 0n || (!q && value)) fail("IV_NEGATIVE_OR_RESIDUAL_VALUE");
    if (q >= 10n ** 30n || value >= 10n ** 30n) fail("IV_VALUATION_OVERFLOW");
    seen.set(m.id, { ...m, amount, cost });
    results.push({ id: m.id, cost_minor: cost.toString(), quantity: decimal(q), value_minor: value.toString() });
  }
  return { quantity: decimal(q), value_minor: value.toString(), results, fingerprint: fingerprint(ordered) };
}

module.exports = { fail, canonical, fingerprint, acquisitionKey, integer, quantity, decimal, operationalQuantity, OPERATIONAL_MAX_Q2, halfUp, money, moneyDecimal, billAmounts, text, date, allocate, validateCost, replay };
