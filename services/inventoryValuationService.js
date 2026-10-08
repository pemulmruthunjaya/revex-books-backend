"use strict";

const { randomUUID } = require("node:crypto");
const m = require("./inventoryValuationMath");
const schema = require("./inventoryValuationSchema");
const uuid = v => {
  if (typeof v !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)) m.fail("IV_UUID_REQUIRED");
  return v.toLowerCase();
};
const id = v => { const s = String(v); if (!/^[1-9]\d{0,14}$/.test(s)) m.fail("IV_ID_INVALID"); return s; };
const scope = x => [id(x.company_id), id(x.product_id)];
const day = d => d instanceof Date ? d.toISOString().slice(0, 10) : String(d);
const billProofs = new WeakMap();
const costComponentRoots = new WeakMap();
const decode = row => ({ ...row, effective_date: day(row.effective_date), payload: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload });
function decodeRecord(row) {
  row = decode(row);
  if (m.fingerprint(recordInput(row)) !== row.fingerprint || row.acquisition_key !== (["ACQUISITION", "COMPONENT"].includes(row.kind) ? m.acquisitionKey(row) : null)) m.fail("IV_EVIDENCE_FINGERPRINT_MISMATCH");
  if (row.kind === "COST") m.validateCost(row.payload);
  return row;
}
const recordInput = r => ({ kind: r.kind, date: r.effective_date, source: r.source_id || null, supersedes: r.supersedes_id || null, target: r.target_id || null,
  document_type: r.document_type, document_id: r.document_id, source_line: r.source_line, creator: String(r.creator_id), payload: r.payload });

async function actor(cx, company, actorId, owner = false) {
  const [rows] = await cx.query("SELECT id,role FROM users WHERE id=? AND company_id=? AND is_active=1 FOR SHARE", [id(actorId), id(company)]);
  if (rows.length !== 1 || (owner && rows[0].role !== "owner")) m.fail("IV_ACTOR_NOT_AUTHORIZED");
}
async function openDate(cx, company, date) {
  const [years] = await cx.query("SELECT id,status FROM financial_years WHERE company_id=? AND ? BETWEEN start_date AND end_date ORDER BY id FOR SHARE", [id(company), m.date(date)]);
  if (years.length !== 1 || years[0].status !== "OPEN") m.fail("IV_OPEN_FY_REQUIRED");
  return years[0];
}
async function lock(cx, x) {
  const params = scope(x);
  const [products] = await cx.query("SELECT id FROM products WHERE company_id=? AND id=? FOR UPDATE", params);
  if (products.length !== 1) m.fail("IV_PRODUCT_NOT_FOUND");
  // The authoritative product row serializes preparation without any DML.
  // Coordination rows are created only once validation reaches append().
}
async function records(cx, x, locking = true) {
  const [rows] = await cx.query(`SELECT *,CAST(sequence AS CHAR) sequence,DATE_FORMAT(effective_date,'%Y-%m-%d') effective_date FROM iv_records WHERE company_id=? AND product_id=? ORDER BY effective_date,iv_records.sequence,id${locking ? " FOR UPDATE" : ""}`, scope(x));
  const decoded = rows.map(decodeRecord);
  const costs = decoded.filter(r => r.kind === "COST" && [...r.payload.taxes, ...r.payload.allocations].length);
  if (costs.length) {
    const components = require("./inventoryValuationComponentService");
    const companyRows = await components.read(cx, x.company_id, locking);
    for (const cost of costs) costComponentRoots.set(cost, new Map([...cost.payload.taxes, ...cost.payload.allocations].map(item => [item.component_id, components.componentRoot(find(companyRows, item.component_id))])));
  }
  return decoded;
}
async function append(cx, x, r) {
  const record = { ...r, company_id: id(x.company_id), product_id: id(x.product_id), creator_id: id(x.actor_id),
    effective_date: m.date(r.effective_date), source_id: r.source_id || null, supersedes_id: r.supersedes_id || null, target_id: r.target_id || null };
  m.text(r.idempotency_key, 128); m.text(r.document_type, 30); m.text(r.document_id, 100); m.text(r.source_line, 100);
  record.fingerprint = m.fingerprint(recordInput(record));
  record.acquisition_key = ["ACQUISITION", "COMPONENT"].includes(record.kind) ? m.acquisitionKey(record) : null;
  const [prior] = await cx.query("SELECT *,CAST(sequence AS CHAR) sequence,DATE_FORMAT(effective_date,'%Y-%m-%d') effective_date FROM iv_records WHERE company_id=? AND product_id=? AND idempotency_key=? FOR UPDATE", [...scope(x), r.idempotency_key]);
  if (prior.length) {
    if (prior[0].fingerprint !== record.fingerprint) m.fail("IV_IDEMPOTENCY_CONFLICT");
    return decode(prior[0]);
  }
  await openDate(cx, x.company_id, record.effective_date);
  await cx.query("INSERT INTO iv_product_locks (company_id,product_id) VALUES (?,?) ON DUPLICATE KEY UPDATE product_id=product_id", scope(x));
  await cx.query("INSERT INTO iv_date_sequences (company_id,product_id,effective_date,last_sequence) VALUES (?,?,?,0) ON DUPLICATE KEY UPDATE last_sequence=last_sequence", [...scope(x), record.effective_date]);
  const [[counter]] = await cx.query("SELECT CAST(last_sequence AS CHAR) last_sequence FROM iv_date_sequences WHERE company_id=? AND product_id=? AND effective_date=? FOR UPDATE", [...scope(x), record.effective_date]);
  record.sequence = (BigInt(counter.last_sequence) + 1n).toString();
  if (BigInt(record.sequence) > 18446744073709551615n) m.fail("IV_SEQUENCE_EXHAUSTED");
  record.id = randomUUID();
  await cx.query("UPDATE iv_date_sequences SET last_sequence=? WHERE company_id=? AND product_id=? AND effective_date=?", [record.sequence, ...scope(x), record.effective_date]);
  try {
    await cx.query(`INSERT INTO iv_records (company_id,product_id,id,kind,effective_date,sequence,source_id,supersedes_id,target_id,document_type,document_id,source_line,acquisition_key,idempotency_key,fingerprint,payload,creator_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [record.company_id, record.product_id, record.id, record.kind, record.effective_date, record.sequence, record.source_id, record.supersedes_id, record.target_id,
      record.document_type, record.document_id, record.source_line, record.acquisition_key, r.idempotency_key, record.fingerprint, m.canonical(record.payload), record.creator_id]);
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") m.fail("IV_DUPLICATE_EVIDENCE");
    throw error;
  }
  return record;
}
async function prepare(cx, x) {
  // MySQL OK-packet SERVER_STATUS_IN_TRANS (0x0001). A no-op statement
  // checks the caller's transaction without starting or committing one.
  const [status] = await cx.query("DO 0");
  if (!Number.isInteger(status.serverStatus) || !(status.serverStatus & 1)) m.fail("IV_TRANSACTION_REQUIRED");
  await schema.assertReady(cx);
  const [companies] = await cx.query("SELECT id FROM companies WHERE id=? FOR UPDATE", [id(x.company_id)]);
  if (companies.length !== 1) m.fail("IV_COMPANY_NOT_FOUND");
  await actor(cx, x.company_id, x.actor_id);
  await lock(cx, x);
}
const find = (rows, value, kind) => {
  const r = rows.find(r => r.id === uuid(value) && (!kind || r.kind === kind));
  if (!r) m.fail("IV_LINK_NOT_FOUND");
  return r;
};
const approved = (rows, revision) => {
  if (rows.some(r => r.kind === "REJECTION" && r.target_id === revision.id)) m.fail("IV_COST_REJECTED");
  if (!rows.some(r => r.kind === "APPROVAL" && r.target_id === revision.id)) m.fail("IV_COST_NOT_APPROVED");
  return revision;
};
const requireOpening = (rows, date) => {
  const openings = rows.filter(r => r.kind === "OPENING");
  if (openings.length !== 1 || openings[0].effective_date > date) m.fail("IV_OPENING_EVIDENCE_REQUIRED");
  approved(rows, find(rows, openings[0].payload.revision_id, "COST"));
};
const ref = r => ({ effective_date: r.effective_date, source_id: r.kind === "ACQUISITION" ? r.id : r.source_id,
  document_type: r.document_type, document_id: r.document_id, source_line: r.source_line });

// All mutation APIs require the caller's existing transaction and authenticated
// actor ID. They never BEGIN/COMMIT, so stock, bills and evidence rollback together.
async function createAcquisition(cx, x) {
  await prepare(cx, x);
  if (!["GRN", "SUPPLIER", "OPENING"].includes(x.document_type)) m.fail("IV_SOURCE_UNSUPPORTED");
  if (x.document_type === "GRN") {
    const [rows] = await cx.query("SELECT gri.id FROM goods_receipt_items gri INNER JOIN goods_receipts gr ON gr.id=gri.goods_receipt_id AND gr.company_id=gri.company_id WHERE gri.company_id=? AND gri.product_id=? AND gri.goods_receipt_id=? AND gri.id=? AND gr.status='Draft' FOR UPDATE", [...scope(x), id(x.document_id), id(x.source_line)]);
    if (rows.length !== 1) m.fail("IV_GRN_LINE_NOT_DRAFT");
  }
  const existing = await records(cx, x);
  if (existing.some(r => r.kind === "ACQUISITION" && r.document_type === x.document_type && r.document_id === x.document_id && r.source_line === x.source_line && r.idempotency_key !== x.idempotency_key)) m.fail("IV_SOURCE_ALREADY_EXISTS");
  return append(cx, x, { kind: "ACQUISITION", effective_date: x.date, document_type: x.document_type, document_id: x.document_id, source_line: x.source_line,
    idempotency_key: x.idempotency_key, payload: { reference: m.text(x.reference), currency: "INR" } });
}
async function recordCost(cx, x) {
  m.validateCost(x.evidence);
  await prepare(cx, x);
  const rows = await records(cx, x), source = find(rows, x.source_id, "ACQUISITION");
  m.validateCost(x.evidence);
  if (x.evidence.allocations.some(a => a.line !== source.id)) m.fail("IV_ALLOCATION_SOURCE_LINE_MISMATCH");
  const components = require("./inventoryValuationComponentService");
  components.verifyCost(await components.read(cx, x.company_id), source, x.evidence);
  if ((source.document_type === "OPENING") !== (x.evidence.basis === "OPENING")) m.fail("IV_COST_BASIS_REQUIRED");
  const costs = rows.filter(r => r.kind === "COST" && r.source_id === source.id);
  const previous = x.supersedes_id ? find(rows, x.supersedes_id, "COST") : null;
  if (previous && previous.source_id !== source.id) m.fail("IV_REVISION_SOURCE_MISMATCH");
  const duplicate = costs.find(r => r.idempotency_key === x.idempotency_key);
  if (!duplicate && ((costs.length && !previous) || costs.some(r => r.supersedes_id === previous?.id))) m.fail("IV_REVISION_CONFLICT");
  return append(cx, x, { ...ref(source), kind: "COST", supersedes_id: previous?.id || null, idempotency_key: x.idempotency_key, payload: x.evidence });
}
async function approveCost(cx, x) {
  await prepare(cx, x); await actor(cx, x.company_id, x.actor_id, true);
  const rows = await records(cx, x), revision = find(rows, x.revision_id, "COST"), source = find(rows, revision.source_id, "ACQUISITION");
  const components = require("./inventoryValuationComponentService");
  components.verifyCost(await components.read(cx, x.company_id), source, revision.payload);
  if (source.document_type === "OPENING" && String(revision.creator_id) === String(x.actor_id)) m.fail("IV_SEPARATE_OPENING_APPROVER_REQUIRED");
  if (!rows.some(r => r.kind === "SUBMISSION" && r.target_id === revision.id)) m.fail("IV_SUBMISSION_REQUIRED");
  if (rows.some(r => r.kind === "REJECTION" && r.target_id === revision.id)) m.fail("IV_COST_REJECTED");
  if (rows.some(r => r.kind === "APPROVAL" && r.target_id === revision.id && r.idempotency_key !== x.idempotency_key)) m.fail("IV_ALREADY_APPROVED");
  return append(cx, x, { ...ref(revision), kind: "APPROVAL", target_id: revision.id, idempotency_key: x.idempotency_key, payload: { reason: m.text(x.reason) } });
}

async function submitCost(cx, x) {
  await prepare(cx, x);
  const rows = await records(cx, x), revision = find(rows, x.revision_id, "COST");
  if (rows.some(r => r.kind === "COST" && r.supersedes_id === revision.id)) m.fail("IV_REVISION_SUPERSEDED");
  if (rows.some(r => ["APPROVAL", "REJECTION"].includes(r.kind) && r.target_id === revision.id)) m.fail("IV_REVIEW_ALREADY_COMPLETED");
  return append(cx, x, { ...ref(revision), kind: "SUBMISSION", target_id: revision.id, idempotency_key: x.idempotency_key, payload: { reason: m.text(x.reason) } });
}
async function rejectCost(cx, x) {
  await prepare(cx, x); await actor(cx, x.company_id, x.actor_id, true);
  const rows = await records(cx, x), revision = find(rows, x.revision_id, "COST");
  if (!rows.some(r => r.kind === "SUBMISSION" && r.target_id === revision.id)) m.fail("IV_SUBMISSION_REQUIRED");
  if (rows.some(r => r.kind === "APPROVAL" && r.target_id === revision.id)) m.fail("IV_REVIEW_ALREADY_COMPLETED");
  return append(cx, x, { ...ref(revision), kind: "REJECTION", target_id: revision.id, idempotency_key: x.idempotency_key, payload: { reason: m.text(x.reason) } });
}

function appliedBasis(rows, movement) {
  let revision = find(rows, movement.payload.revision_id, "COST"), sourceId = movement.source_id;
  for (const change of rows.filter(r => ["COST_REPLACEMENT", "STOCK_REPLACEMENT"].includes(r.kind) && r.target_id === movement.id && !r.payload.partial)) {
    if (change.kind === "STOCK_REPLACEMENT") sourceId = change.payload.new_source_id;
    revision = find(rows, change.payload.revision_id, "COST");
    if (revision.source_id !== sourceId) m.fail("IV_REVISION_SOURCE_MISMATCH");
  }
  if (revision.source_id !== sourceId) m.fail("IV_REVISION_SOURCE_MISMATCH");
  return { revision, source_id: sourceId };
}
function provisionalRemainder(rows, cost, links, received, covered) {
  const components = require("./inventoryValuationComponentService");
  const root = (cost, item) => costComponentRoots.get(cost)?.get(item.component_id) || components.componentRoot(find(rows, item.component_id));
  const claimed = new Set(links.flatMap(link => {
    const final = approved(rows, find(rows, link.target_id, "COST"));
    return [...final.payload.taxes, ...final.payload.allocations].map(item => root(final, item));
  }));
  let basis = m.integer(cost.payload.total_minor);
  // A finalized document component consumes its entire allocated source share.
  // Only the still-unclaimed provisional basis may be quantity-prorated.
  for (const item of [...cost.payload.taxes, ...cost.payload.allocations]) {
    if (!claimed.has(root(cost, item))) continue;
    const amount = item.recoverability !== undefined
      ? (item.recoverability === "NON_RECOVERABLE" ? m.integer(item.amount_minor) : 0n)
      : m.integer(item.calculated.find(a => a.line === item.line).amount_minor) * (["TRADE_DISCOUNT", "SUPPLIER_COST_CREDIT"].includes(item.kind) ? -1n : 1n);
    basis -= amount;
  }
  if (basis < 0n) m.fail("IV_COST_NEGATIVE");
  return received ? m.halfUp(basis * (received - covered), received) : 0n;
}
function projection(rows) {
  const movements = [];
  for (const row of rows.filter(r => ["OPENING", "RECEIPT", "ISSUE", "CUSTOMER_RETURN", "VENDOR_RETURN"].includes(r.kind))) {
    let payload = row.payload;
    if (["OPENING", "RECEIPT"].includes(row.kind)) {
      const cost = approved(rows, appliedBasis(rows, row).revision);
      payload = { ...payload, quantity: cost.payload.quantity, total_minor: cost.payload.total_minor };
      if (row.document_type === "GRN") {
        const links = latestBillLinks(rows, row.source_id);
        const received = m.operationalQuantity(cost.payload.quantity).q6;
        const covered = links.reduce((sum, link) => sum + m.operationalQuantity(link.payload.quantity).q6, 0n);
        if (covered > received) m.fail("IV_EXCESS_FINALIZED_QUANTITY");
        const finalValue = links.reduce((sum, link) => sum + m.integer(approved(rows, find(rows, link.target_id, "COST")).payload.total_minor), 0n);
        payload.total_minor = (finalValue + provisionalRemainder(rows, cost, links, received, covered)).toString();
      }
    }
    movements.push({ id: row.id, kind: row.kind, date: row.effective_date, sequence: String(row.sequence), source_line: row.source_line, target: row.target_id, ...payload });
  }
  return m.replay(movements);
}
function latestBillLinks(rows, sourceId) {
  const links = rows.filter(r => r.kind === "BILL_LINK");
  return links.filter(r => r.source_id === sourceId && !links.some(next => next.supersedes_id === r.id));
}
function currentReceipt(rows, sourceId) {
  for (const receipt of rows.filter(r => r.kind === "RECEIPT")) {
    const currentSource = appliedBasis(rows, receipt).source_id;
    if (currentSource === sourceId) return receipt;
    if (receipt.source_id === sourceId) m.fail("IV_SOURCE_REPLACED");
  }
  return null;
}
async function previewBillCost(cx, x, rows, source, revision, billId, billDate, correctionId = null) {
  const components = require("./inventoryValuationComponentService");
  const companyRows = await components.read(cx, x.company_id);
  components.verifyCost(companyRows, source, revision.payload);
  components.verifyBillClaims(companyRows, source, revision, billId);
  const movement = currentReceipt(rows, source.id);
  requireOpening(rows, source.effective_date);
  await openDate(cx, x.company_id, source.effective_date);
  await openDate(cx, x.company_id, billDate);
  for (const date of new Set(rows.filter(r => r.effective_date >= source.effective_date && ["OPENING", "RECEIPT", "ISSUE", "CUSTOMER_RETURN", "VENDOR_RETURN"].includes(r.kind)).map(r => r.effective_date))) await openDate(cx, x.company_id, date);
  const previous = latestBillLinks(rows, source.id).find(r => r.document_id === String(billId));
  const seal = result => {
    billProofs.set(result, { cx, company: String(x.company_id), product: String(x.product_id), source: source.id, revision: revision.id, billId: billId === null ? null : String(billId), billDate, correctionId });
    return result;
  };
  if (correctionId) return seal({ correction: await require("./inventoryValuationCorrectionService").preview(cx, x, rows, correctionId, billId, source.id, revision.id) });
  if (source.document_type === "GRN") {
    if (!movement) m.fail("IV_RECEIPT_LINK_REQUIRED");
    const synthetic = { kind: "BILL_LINK", id: "preview-link", source_id: source.id, target_id: revision.id, document_id: String(billId), supersedes_id: previous?.id || null, payload: { quantity: revision.payload.quantity } };
    projection([...rows, synthetic]);
  } else {
    if (latestBillLinks(rows, source.id).some(r => r.document_id !== String(billId))) m.fail("IV_ACQUISITION_ALREADY_BILLED");
    if (movement) {
      const current = latestBillLinks(rows, source.id).find(r => r.document_id === String(billId));
      if (!current) m.fail("IV_HISTORICAL_BILL_UNSUPPORTED");
      if (m.quantity(current.payload.quantity) !== m.quantity(revision.payload.quantity)) m.fail("IV_APPROVED_STOCK_CORRECTION_REQUIRED");
      const applied = appliedBasis(rows, movement).revision.id;
      if (revision.id !== applied && revision.supersedes_id !== applied) m.fail("IV_REVISION_CONFLICT");
      if (revision.id !== applied) projection([...rows, { kind: "COST_REPLACEMENT", target_id: movement.id, payload: { revision_id: revision.id } }]);
    }
  }
  return seal({ movement, previous });
}
async function applyBillCost(cx, x, input) {
  await prepare(cx, x);
  const rows = await records(cx, x), source = find(rows, input.source_id, "ACQUISITION"), revision = approved(rows, find(rows, input.revision_id, "COST"));
  const key = `bill-link:${input.bill_id}:${revision.id}`;
  const retry = rows.find(r => r.idempotency_key === key);
  if (retry) {
    if (retry.source_id !== source.id || retry.payload.quantity !== revision.payload.quantity || retry.effective_date !== input.bill_date) m.fail("IV_IDEMPOTENCY_CONFLICT");
    return retry;
  }
  let checked = input.proof;
  if (checked) {
    const seal = billProofs.get(checked);
    if (!seal || seal.cx !== cx || seal.company !== String(x.company_id) || seal.product !== String(x.product_id) || seal.source !== source.id || seal.revision !== revision.id || (seal.billId !== null && seal.billId !== String(input.bill_id)) || seal.billDate !== input.bill_date || seal.correctionId !== (input.correction_id || null)) m.fail("IV_POSTING_PROOF_INVALID");
  } else checked = await previewBillCost(cx, x, rows, source, revision, input.bill_id, input.bill_date, input.correction_id);
  const { movement, correction } = checked, previous = correction?.previous || checked.previous;
  if (correction) await require("./inventoryValuationCorrectionService").apply(cx, x, correction, key);
  else if (source.document_type !== "GRN") {
    if (!movement) await postAcquisition(cx, { ...x, source_id: source.id, revision_id: revision.id, idempotency_key: `bill-receipt:${source.id}` });
    else {
      const applied = appliedBasis(rows, movement).revision.id;
      if (applied !== revision.id) await finalizeAcquisition(cx, { ...x, movement_id: movement.id, revision_id: revision.id, idempotency_key: `bill-cost:${revision.id}` });
    }
  }
  let reverse;
  if (previous && !correction) reverse = await append(cx, x, { ...ref(source), kind: "COST_REVERSAL", target_id: previous.target_id, idempotency_key: `${key}:reverse`,
    payload: { bill_link_id: previous.id, revision_id: previous.target_id, quantity: previous.payload.quantity, total_minor: find(rows, previous.target_id, "COST").payload.total_minor } });
  const link = await linkBill(cx, x, { kind: "BILL_LINK", effective_date: input.bill_date, source_id: source.id, target_id: revision.id, supersedes_id: previous?.id || null,
    document_type: "BILL", document_id: String(input.bill_id), source_line: String(input.line_id), idempotency_key: key,
    payload: { revision_id: revision.id, quantity: revision.payload.quantity, previous_bill_line: previous?.source_line || null, reversal_id: reverse?.id || null, correction_id: correction?.correction.id || null } });
  await saveReplay(cx, x, source.effective_date, `${key}:replay`);
  return link;
}
async function saveReplay(cx, x, effectiveDate, key) {
  const rows = await records(cx, x);
  // Revising an early receipt must not silently rewrite a subsequent frozen FY.
  for (const date of new Set(rows.filter(r => r.effective_date >= effectiveDate && ["OPENING", "RECEIPT", "ISSUE", "CUSTOMER_RETURN", "VENDOR_RETURN"].includes(r.kind)).map(r => r.effective_date))) await openDate(cx, x.company_id, date);
  const result = projection(rows);
  const inputFingerprint = m.fingerprint(rows.filter(r => r.kind !== "REPLAY").map(r => ({ id: r.id, fingerprint: r.fingerprint })));
  return append(cx, x, { kind: "REPLAY", effective_date: effectiveDate, document_type: "VALUATION", document_id: id(x.product_id), source_line: id(x.product_id), idempotency_key: key,
    payload: { ...result, input_fingerprint: inputFingerprint, algorithm: "PERPETUAL_HALF_UP_Q6_MINOR_V1", blockers: ["GL_COGS_RECONCILIATION_NOT_IMPLEMENTED"] } });
}
async function validateReplayBeforeWrite(cx, x, rows, date, synthetic) {
  await openDate(cx, x.company_id, date);
  for (const affected of new Set(rows.filter(r => r.effective_date >= date && ["OPENING", "RECEIPT", "ISSUE", "CUSTOMER_RETURN", "VENDOR_RETURN"].includes(r.kind)).map(r => r.effective_date))) await openDate(cx, x.company_id, affected);
  const sequence = (rows.filter(r => r.effective_date === date).reduce((max, r) => BigInt(r.sequence) > max ? BigInt(r.sequence) : max, 0n) + 1n).toString();
  return projection([...rows, { id: "preview", effective_date: date, sequence, target_id: null, source_id: null, source_line: "preview", ...synthetic }]);
}
async function postAcquisition(cx, x) {
  await prepare(cx, x);
  const rows = await records(cx, x), source = find(rows, x.source_id, "ACQUISITION"), cost = approved(rows, find(rows, x.revision_id, "COST"));
  const components = require("./inventoryValuationComponentService");
  components.verifyCost(await components.read(cx, x.company_id), source, cost.payload);
  if (cost.source_id !== source.id) m.fail("IV_REVISION_SOURCE_MISMATCH");
  const kind = source.document_type === "OPENING" ? "OPENING" : "RECEIPT";
  const existing = rows.find(r => r.kind === kind && r.source_id === source.id);
  if (existing && existing.idempotency_key !== x.idempotency_key) m.fail("IV_SOURCE_ALREADY_POSTED");
  if (kind === "OPENING" && cost.payload.state !== "FINAL") m.fail("IV_OPENING_FINAL_REQUIRED");
  if (kind === "OPENING" && !existing && rows.some(r => ["OPENING", "RECEIPT", "ISSUE", "CUSTOMER_RETURN", "VENDOR_RETURN"].includes(r.kind))) m.fail("IV_OPENING_NOT_FIRST");
  if (kind !== "OPENING") requireOpening(rows, source.effective_date);
  if (!existing) await validateReplayBeforeWrite(cx, x, rows, source.effective_date, { ...ref(source), kind, payload: { revision_id: cost.id } });
  const movement = await append(cx, x, { ...ref(source), kind, target_id: cost.id, idempotency_key: x.idempotency_key, payload: { revision_id: cost.id } });
  if (!existing) await saveReplay(cx, x, source.effective_date, `${x.idempotency_key}:replay`);
  return movement;
}
async function finalizeAcquisition(cx, x) {
  await prepare(cx, x);
  const rows = await records(cx, x), movement = find(rows, x.movement_id), revision = approved(rows, find(rows, x.revision_id, "COST"));
  const basis = appliedBasis(rows, movement);
  if (!["OPENING", "RECEIPT"].includes(movement.kind) || revision.source_id !== basis.source_id || revision.payload.state !== "FINAL") m.fail("IV_FINALIZATION_INVALID");
  const priorId = basis.revision.id;
  const retry = rows.find(r => r.idempotency_key === `${x.idempotency_key}:replace`);
  if (!retry && revision.supersedes_id !== priorId) m.fail("IV_REVISION_CONFLICT");
  const prior = find(rows, revision.supersedes_id, "COST");
  if (movement.kind === "RECEIPT" && m.quantity(prior.payload.quantity) !== m.quantity(revision.payload.quantity)) m.fail("IV_RECEIPT_QUANTITY_REVISION_UNSUPPORTED");
  const components = require("./inventoryValuationComponentService");
  components.verifyCost(await components.read(cx, x.company_id), find(rows, revision.source_id, "ACQUISITION"), revision.payload);
  if (!retry) await validateReplayBeforeWrite(cx, x, rows, movement.effective_date, { kind: "COST_REPLACEMENT", target_id: movement.id, payload: { revision_id: revision.id } });
  const currentRef = ref(find(rows, basis.source_id, "ACQUISITION"));
  const reverse = await append(cx, x, { ...currentRef, kind: "COST_REVERSAL", target_id: prior.id, idempotency_key: `${x.idempotency_key}:reverse`, payload: { movement_id: movement.id, revision_id: prior.id, total_minor: prior.payload.total_minor, quantity: prior.payload.quantity } });
  const replacement = await append(cx, x, { ...currentRef, kind: "COST_REPLACEMENT", target_id: movement.id, idempotency_key: `${x.idempotency_key}:replace`, payload: { reversal_id: reverse.id, revision_id: revision.id, variance_minor: (BigInt(revision.payload.total_minor) - BigInt(prior.payload.total_minor)).toString() } });
  if (!retry) await saveReplay(cx, x, movement.effective_date, `${x.idempotency_key}:replay`);
  return replacement;
}
async function postMovement(cx, x) {
  m.operationalQuantity(x.quantity);
  await prepare(cx, x);
  if (!["ISSUE", "CUSTOMER_RETURN", "VENDOR_RETURN"].includes(x.kind)) m.fail("IV_UNSUPPORTED_MOVEMENT");
  m.quantity(x.quantity);
  const rows = await records(cx, x);
  requireOpening(rows, x.date);
  const original = x.target_id ? find(rows, x.target_id) : null;
  if (x.kind !== "ISSUE" && !original) m.fail("IV_RETURN_LINK_REQUIRED");
  const existing = rows.find(r => r.idempotency_key === x.idempotency_key);
  if (!existing && rows.some(r => r.kind === x.kind && r.document_type === x.document_type && r.document_id === x.document_id && r.source_line === x.source_line)) m.fail("IV_DUPLICATE_SOURCE_LINE");
  if (!existing) await validateReplayBeforeWrite(cx, x, rows, x.date, { kind: x.kind, source_line: x.source_line, target_id: original?.id || null, payload: { quantity: x.quantity, source_line: original?.source_line || x.source_line } });
  const movement = await append(cx, x, { kind: x.kind, effective_date: x.date, source_id: original?.source_id || null, target_id: original?.id || null,
    document_type: x.document_type, document_id: x.document_id, source_line: x.source_line, idempotency_key: x.idempotency_key,
    payload: { quantity: x.quantity, source_line: original?.source_line || x.source_line } });
  if (!existing) await saveReplay(cx, x, x.date, `${x.idempotency_key}:replay`);
  return movement;
}

async function linkBill(cx, x, record) {
  await prepare(cx, x);
  const rows = await records(cx, x), revision = approved(rows, find(rows, record.target_id, "COST"));
  if (revision.source_id !== record.source_id || revision.payload.state !== "FINAL") m.fail("IV_FINALIZATION_INVALID");
  if (record.kind !== "BILL_LINK" || record.document_type !== "BILL") m.fail("IV_SOURCE_UNSUPPORTED");
  return append(cx, x, record);
}

const { wrap } = require("./inventoryValuationOperationService");
module.exports = { ...Object.fromEntries(Object.entries({ createAcquisition, recordCost, submitCost, rejectCost, approveCost, postAcquisition, finalizeAcquisition, postMovement, applyBillCost }).map(([name, fn]) => [name, wrap(name, fn)])),
  appliedBasis, latestBillLinks, currentReceipt, previewBillCost, projection, records, prepare, linkBill, find, approved, requireOpening, openDate, id, uuid, append, actor, saveReplay, ref, decodeRecord };
