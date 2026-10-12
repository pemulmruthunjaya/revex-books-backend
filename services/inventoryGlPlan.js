"use strict";

// Pure accounting plan. No connection, configuration, clock, or floating point.
const m = require("./inventoryValuationMath");
const v = require("./inventoryValuationService");
const POLICY = "IV_GL_ORIGINAL_DATE_V1";
const fail = m.fail;
const signed = value => {
  if (typeof value !== "string" || !/^(0|-?[1-9]\d{0,11})$/.test(value)) fail("IV_GL_AMOUNT_INVALID");
  return BigInt(value);
};
const minor = value => {
  const result = m.integer(value);
  if (result > 999999999999n) fail("IV_GL_AMOUNT_OVERFLOW");
  return result;
};
const line = (date, role, amount) => ({ date: m.date(date), role, signed_minor: amount.toString() });
const pair = (date, debit, credit, value) => [line(date, debit, value), line(date, credit, -value)];
function normalize(lines) {
  const totals = new Map();
  for (const item of lines) {
    m.date(item.date);
    if (!["INVENTORY", "COGS", "GRNI", "ACCOUNTS_PAYABLE", "INPUT_TAX"].includes(item.role)) fail("IV_GL_ROLE_INVALID");
    const key = `${item.date}:${item.role}`;
    totals.set(key, (totals.get(key) || 0n) + signed(item.signed_minor));
  }
  return [...totals].sort(([a], [b]) => a.localeCompare(b)).filter(([, value]) => value !== 0n).map(([key, value]) => {
    signed(value.toString());
    return line(key.slice(0, 10), key.slice(11), value);
  });
}
function balanced(lines) {
  const dates = new Map();
  for (const item of lines) dates.set(item.date, (dates.get(item.date) || 0n) + signed(item.signed_minor));
  if ([...dates.values()].some(value => value !== 0n)) fail("IV_GL_DATE_UNBALANCED");
}
function taxAmounts(cost) {
  let recoverable = 0n, nonrecoverable = 0n;
  for (const tax of cost.payload.taxes) {
    if (tax.recoverability === "RECOVERABLE") recoverable += minor(tax.amount_minor);
    else if (tax.recoverability === "NON_RECOVERABLE") nonrecoverable += minor(tax.amount_minor);
    else fail("IV_GL_TAX_CLASSIFICATION_REQUIRED");
  }
  // Components need their own exact, approved counterparty/journal lineage.
  // Neither AP nor an arbitrary expense account may absorb a balancing amount.
  if (cost.payload.allocations.length) fail("IV_GL_COMPONENT_COUNTERPARTY_REQUIRED");
  const capitalized = minor(cost.payload.purchase_minor) + nonrecoverable;
  if (capitalized !== minor(cost.payload.total_minor)) fail("IV_GL_COST_MISMATCH");
  minor((capitalized + recoverable).toString());
  return { capitalized, recoverable, payable: capitalized + recoverable };
}
function target(key, references, lines) {
  const normalized = normalize(lines);
  balanced(normalized);
  const result = { key, references: [...new Set(references)].sort(), lines: normalized };
  return { ...result, fingerprint: m.fingerprint({ policy: POLICY, ...result }) };
}

// Input must be locked, decoded/verified immutable evidence from one product.
// Opening is reconciled by the approved cutover, never posted a second time.
function expectedTargets(rows, cutoverDate) {
  m.date(cutoverDate);
  const opening = rows.filter(row => row.kind === "OPENING");
  if (opening.length !== 1 || opening[0].effective_date < cutoverDate) fail("IV_GL_CUTOVER_OPENING_REQUIRED");
  if (opening[0].effective_date !== cutoverDate) {
    const cost = v.approved(rows, v.appliedBasis(rows, opening[0]).revision);
    // A new product may enter after cutover with explicitly approved ZERO
    // opening evidence. Nonzero historical balances require the cutover proof.
    if (m.quantity(cost.payload.quantity) || minor(cost.payload.total_minor)) fail("IV_GL_CUTOVER_OPENING_REQUIRED");
  }
  if (rows.some(row => ["CUSTOMER_RETURN", "VENDOR_RETURN"].includes(row.kind))) fail("IV_GL_OUTBOUND_UNSUPPORTED");
  const replay = v.projection(rows);
  const values = new Map(replay.results.map(result => [result.id, minor(result.cost_minor)]));
  const targets = [];
  for (const movement of rows.filter(row => ["RECEIPT", "ISSUE"].includes(row.kind))) {
    if (movement.effective_date < cutoverDate) fail("IV_GL_HISTORICAL_GAP");
    const value = values.get(movement.id);
    if (value === undefined) fail("IV_GL_VALUATION_LINK_REQUIRED");
    if (movement.kind === "ISSUE") {
      if (movement.document_type !== "SALES_INVOICE") fail("IV_GL_OUTBOUND_UNSUPPORTED");
      targets.push(target(`issue:${movement.id}`, [movement.id], pair(movement.effective_date, "COGS", "INVENTORY", value)));
      continue;
    }
    const basis = v.appliedBasis(rows, movement);
    if (basis.effective_date < cutoverDate) fail("IV_GL_HISTORICAL_GAP");
    const cost = v.approved(rows, basis.revision);
    taxAmounts(cost);
    if (movement.document_type === "GRN") {
      targets.push(target(`receipt:${movement.id}`, [movement.id, cost.id, basis.source_id], pair(movement.effective_date, "INVENTORY", "GRNI", value)));
    } else if (movement.document_type !== "SUPPLIER") fail("IV_GL_SOURCE_UNSUPPORTED");
    const links = v.latestBillLinks(rows, basis.source_id);
    if (movement.document_type === "SUPPLIER" && links.length !== 1) fail("IV_GL_DIRECT_BILL_LINK_REQUIRED");
    for (const link of links) {
      const final = v.approved(rows, v.find(rows, link.target_id, "COST"));
      if (final.payload.state !== "FINAL" || final.source_id !== basis.source_id ||
          m.operationalQuantity(final.payload.quantity).q6 !== m.operationalQuantity(link.payload.quantity).q6) fail("IV_GL_BILL_LINK_MISMATCH");
      if (link.effective_date < basis.effective_date) fail("IV_GL_BILL_PRECEDES_RECEIPT");
      const amounts = taxAmounts(final);
      const direct = movement.document_type === "SUPPLIER";
      // Direct-stock recognition has no GRNI/clearing account. Its source must
      // be the same dated bill; a date-changing correction cannot be improvised.
      if (direct && (link.effective_date !== basis.effective_date || value !== amounts.capitalized)) fail("IV_GL_DIRECT_BILL_DATE_OR_VALUE_MISMATCH");
      targets.push(target(`bill:${basis.source_id}:${link.document_id}`, [movement.id, basis.source_id, link.id, final.id], [
        line(link.effective_date, direct ? "INVENTORY" : "GRNI", amounts.capitalized),
        line(link.effective_date, "INPUT_TAX", amounts.recoverable),
        line(link.effective_date, "ACCOUNTS_PAYABLE", -amounts.payable),
      ]));
    }
  }
  if (new Set(targets.map(t => t.key)).size !== targets.length) fail("IV_GL_DUPLICATE_TARGET");
  return targets.sort((a, b) => a.key.localeCompare(b.key));
}

function replayDeltas(expected, prior) {
  const previous = new Map();
  for (const item of prior) {
    if (previous.has(item.key) || target(item.key, item.references, item.lines).fingerprint !== item.fingerprint) fail("IV_GL_PRIOR_EVIDENCE_INVALID");
    previous.set(item.key, item);
  }
  if (new Set(expected.map(item => item.key)).size !== expected.length) fail("IV_GL_DUPLICATE_TARGET");
  const next = new Map(expected.map(item => [item.key, item]));
  const result = [];
  // A source replacement retires the old logical posting via an explicit
  // reversal, preserving both the predecessor and original journal dates.
  for (const key of [...new Set([...previous.keys(), ...next.keys()])].sort()) {
    const before = previous.get(key), after = next.get(key) || target(key, before.references, []);
    if (before?.fingerprint === after.fingerprint) continue;
    const lines = normalize([...after.lines, ...(before?.lines || []).map(item => ({ ...item, signed_minor: (-signed(item.signed_minor)).toString() }))]);
    balanced(lines);
    result.push({ key, predecessor: before?.fingerprint || null, target: after, lines });
  }
  return result;
}

// Independent, receipt-specific as-of reconciliation. A company-wide net GRNI
// balance cannot authorize clearing another receipt's liability.
function reconcileGrni(rows, targets, asOf) {
  m.date(asOf);
  const balances = [];
  for (const receipt of rows.filter(row => row.kind === "RECEIPT" && row.document_type === "GRN" && row.effective_date <= asOf)) {
    const basis = v.appliedBasis(rows, receipt), quantity = m.operationalQuantity(basis.revision.payload.quantity).q6;
    const receiptTargets = targets.filter(item => item.key === `receipt:${receipt.id}`);
    if (receiptTargets.length !== 1) fail("IV_GL_GRNI_RECEIPT_MISSING");
    const credits = -receiptTargets[0].lines.filter(item => item.role === "GRNI" && item.date <= asOf).reduce((sum, item) => sum + signed(item.signed_minor), 0n);
    const links = v.latestBillLinks(rows, basis.source_id).filter(link => link.effective_date <= asOf);
    let cleared = 0n, billed = 0n;
    for (const link of links) {
      const matches = targets.filter(item => item.key === `bill:${basis.source_id}:${link.document_id}`);
      if (matches.length !== 1 || !matches[0].references.includes(link.id) || !matches[0].references.includes(receipt.id)) fail("IV_GL_GRNI_BILL_LINK_MISSING");
      const amount = matches[0].lines.filter(item => item.role === "GRNI" && item.date <= asOf).reduce((sum, item) => sum + signed(item.signed_minor), 0n);
      if (amount !== taxAmounts(v.find(rows, link.target_id, "COST")).capitalized) fail("IV_GL_GRNI_CLEARANCE_MISMATCH");
      cleared += amount;
      billed += m.operationalQuantity(link.payload.quantity).q6;
    }
    if (cleared > credits || billed > quantity || cleared < 0n || (billed === quantity && cleared !== credits)) fail("IV_GL_GRNI_INSUFFICIENT_OR_MISMATCHED");
    const finalCoverage = v.latestBillLinks(rows, basis.source_id).reduce((sum, link) => {
      const final = v.approved(rows, v.find(rows, link.target_id, "COST"));
      if (final.payload.state !== "FINAL") fail("IV_GL_FINAL_COST_REQUIRED");
      return sum + m.operationalQuantity(link.payload.quantity).q6;
    }, 0n);
    if (finalCoverage > quantity) fail("IV_GL_GRNI_INSUFFICIENT_OR_MISMATCHED");
    balances.push({ receipt_id: receipt.id, acquisition_id: basis.source_id, quantity_q6: quantity.toString(), billed_q6: billed.toString(), balance_minor: (credits - cleared).toString(), unresolved: finalCoverage !== quantity });
  }
  // A later dated FINAL bill can establish the cost without clearing the
  // liability as of this cutoff. Keep that exact accrued GRNI in the report.
  return { balances, close_ready: balances.every(item => !item.unresolved), fingerprint: m.fingerprint(balances) };
}

module.exports = { POLICY, signed, minor, normalize, balanced, target, taxAmounts, expectedTargets, replayDeltas, reconcileGrni };
