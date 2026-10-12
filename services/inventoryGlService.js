"use strict";

// Caller owns the connection and transaction. Importing this module does not
// connect, migrate, schedule, post or repair anything. Durable envelopes reuse
// the foundation's append-only, tenant-keyed iv_operations journal.
const m = require("./inventoryValuationMath");
const v = require("./inventoryValuationService");
const p = require("./inventoryGlPlan");
const operations = require("./inventoryValuationOperationService");
const schema = require("./inventoryGlSchema");
const postingProofs = new WeakMap();
const roles = Object.freeze({ INVENTORY: "ASSET", COGS: "EXPENSE", GRNI: "LIABILITY", ACCOUNTS_PAYABLE: "LIABILITY", INPUT_TAX: "ASSET" });
const decode = value => typeof value === "string" ? JSON.parse(value) : value;
const rows = async (cx, sql, args) => (await cx.query(sql, args))[0];
const seal = value => ({ ...value, fingerprint: m.fingerprint(value) });
function verified(value) {
  const { fingerprint, ...body } = decode(value);
  if (m.fingerprint(body) !== fingerprint) m.fail("IV_GL_EVIDENCE_INVALID");
  return { ...body, fingerprint };
}
async function events(cx, company, action, locking = false) {
  const result = await rows(cx, `SELECT operation_key,result FROM iv_operations WHERE company_id=? AND action=? ORDER BY operation_key${locking ? " FOR UPDATE" : ""}`, [v.id(company), action]);
  return result.map(row => ({ ...verified(row.result), operation_key: row.operation_key }));
}
async function cutover(cx, company, locking = false) {
  const result = await events(cx, company, "GL_CUTOVER", locking);
  if (result.length > 1) m.fail("IV_GL_CUTOVER_CONFLICT");
  return result[0] || null;
}
async function transaction(cx, company) {
  const [status] = await cx.query("DO 0");
  if (!Number.isInteger(status.serverStatus) || !(status.serverStatus & 1)) m.fail("IV_TRANSACTION_REQUIRED");
  if ((await rows(cx, "SELECT id FROM companies WHERE id=? FOR UPDATE", [v.id(company)])).length !== 1) m.fail("IV_COMPANY_NOT_FOUND");
}
async function owner(cx, x) {
  const users = await rows(cx, "SELECT id,role FROM users WHERE id=? AND company_id=? AND is_active=1 FOR SHARE", [v.id(x.actor_id), v.id(x.company_id)]);
  if (users.length !== 1 || users[0].role !== "owner") m.fail("IV_OWNER_APPROVAL_REQUIRED");
}
async function bindings(cx, company, dates, locking = false) {
  const assignments = await events(cx, company, "GL_ROLE", locking), result = new Map();
  for (const date of [...new Set(dates)].sort()) {
    m.date(date);
    for (const role of Object.keys(roles)) {
      const eligible = assignments.filter(row => row.role === role && row.effective_date <= date).sort((a, b) => b.effective_date.localeCompare(a.effective_date));
      if (!eligible.length || eligible[1]?.effective_date === eligible[0].effective_date) m.fail("IV_GL_ROLE_REQUIRED");
      const binding = eligible[0];
      const account = await rows(cx, `SELECT id,account_type,status FROM accounts WHERE company_id=? AND id=?${locking ? " FOR SHARE" : ""}`, [company, binding.account_id]);
      if (account.length !== 1 || account[0].account_type !== roles[role] || String(account[0].status) !== "1") m.fail("IV_GL_ROLE_INCOMPATIBLE");
      result.set(`${date}:${role}`, binding);
    }
    const ids = Object.keys(roles).map(role => result.get(`${date}:${role}`).account_id);
    if (new Set(ids).size !== ids.length) m.fail("IV_GL_ROLE_CONFLICT");
  }
  return result;
}
async function assignRole(cx, x) {
  const date = m.date(x.effective_date), account = v.id(x.account_id);
  if (!roles[x.role]) m.fail("IV_GL_ROLE_INVALID");
  const op = await operations.begin(cx, x.company_id, x.actor_id, x.idempotency_key, "GL_ROLE", x);
  if (op.completed) return op.result;
  await owner(cx, x); await schema.assertReady(cx); await v.openDate(cx, x.company_id, date);
  const existing = await events(cx, x.company_id, "GL_ROLE", true);
  if (existing.some(r => r.role === x.role && r.effective_date >= date)) m.fail("IV_GL_ROLE_RETROACTIVE_OR_DUPLICATE");
  const posts = await events(cx, x.company_id, "GL_POST", true);
  if (posts.some(post => post.lines.some(line => line.date >= date))) m.fail("IV_GL_ROLE_ALREADY_POSTED");
  const start = await cutover(cx, x.company_id, true);
  if (start && date <= start.date) m.fail("IV_GL_ROLE_ALREADY_POSTED");
  const priorRole = existing.filter(row => row.role === x.role).sort((a, b) => b.effective_date.localeCompare(a.effective_date))[0];
  if (start && priorRole && priorRole.account_id !== account) {
    const ledger = await controlLedger(cx, x.company_id, date, true);
    if (ledger.lines.filter(line => line.account_id === priorRole.account_id).reduce((sum, line) => sum + BigInt(line.signed_minor), 0n)) m.fail("IV_GL_ROLE_BALANCE_TRANSFER_REQUIRED");
  }
  const accounts = await rows(cx, "SELECT id,account_type,status FROM accounts WHERE company_id=? AND id=? FOR SHARE", [x.company_id, account]);
  if (accounts.length !== 1 || accounts[0].account_type !== roles[x.role] || String(accounts[0].status) !== "1") m.fail("IV_GL_ROLE_INCOMPATIBLE");
  return operations.complete(cx, op, seal({ role: x.role, account_id: account, effective_date: date }));
}
function currentTargets(history) {
  const ordered = [...history].sort((a, b) => Number(a.sequence) - Number(b.sequence));
  let previous = null;
  for (let index = 0; index < ordered.length; index++) {
    const post = ordered[index];
    if (post.sequence !== String(index + 1) || post.predecessor !== previous?.fingerprint && !(index === 0 && post.predecessor === null)) m.fail("IV_GL_HISTORY_GAP");
    p.replayDeltas(post.targets, post.targets);
    const delta = p.replayDeltas(post.targets, previous?.targets || []);
    if (m.canonical(post.delta) !== m.canonical(delta)) m.fail("IV_GL_HISTORY_DELTA_INVALID");
    previous = post;
  }
  return previous;
}
async function verifyJournals(cx, company, history, locking = false) {
  const seen = new Set();
  for (const post of history) {
    const economic = p.normalize(post.delta.flatMap(delta => delta.lines));
    const roleBindings = await bindings(cx, company, economic.map(line => line.date), locking);
    if (economic.length !== post.lines.length || economic.some((line, index) => {
      const actual = post.lines[index], binding = roleBindings.get(`${line.date}:${line.role}`);
      return actual.date !== line.date || actual.role !== line.role || actual.signed_minor !== line.signed_minor || actual.account_id !== binding.account_id || actual.role_fingerprint !== binding.fingerprint;
    })) m.fail("IV_GL_JOURNAL_LINEAGE_MISMATCH");
    const actualLines = [];
    for (const journal of post.journals) {
      if (seen.has(journal.id)) m.fail("IV_GL_DUPLICATE_JOURNAL");
      seen.add(journal.id);
      const headers = await rows(cx, `SELECT id,company_id,financial_year_id,DATE_FORMAT(journal_date,'%Y-%m-%d') journal_date,CAST(total_debit AS CHAR) total_debit,CAST(total_credit AS CHAR) total_credit,status,source_type,source_id FROM journal_entries WHERE company_id=? AND id=?${locking ? " FOR UPDATE" : ""}`, [company, journal.id]);
      if (headers.length !== 1) m.fail("IV_GL_JOURNAL_MISSING");
      const header = headers[0];
      if (String(header.status) !== "1" || header.source_type !== journal.source_type || !/^inventory_valuation:[0-9a-f]{24}$/.test(journal.source_type) || String(header.source_id) !== post.product_id || header.journal_date !== journal.date || String(header.financial_year_id) !== journal.financial_year_id || m.money(header.total_debit) !== m.money(header.total_credit)) m.fail("IV_GL_JOURNAL_MISMATCH");
      const periods = await rows(cx, "SELECT id,status FROM financial_years WHERE company_id=? AND ? BETWEEN start_date AND end_date ORDER BY id", [company, journal.date]);
      if (periods.length !== 1 || String(periods[0].id) !== journal.financial_year_id || post.lines.some(line => line.date === journal.date && line.financial_year_id !== journal.financial_year_id)) m.fail("IV_GL_JOURNAL_PERIOD_MISMATCH");
      const detail = await rows(cx, `SELECT account_id,CAST(debit AS CHAR) debit,CAST(credit AS CHAR) credit FROM journal_entry_details WHERE journal_entry_id=? ORDER BY id${locking ? " FOR UPDATE" : ""}`, [journal.id]);
      let debit = 0n, credit = 0n;
      const normalized = detail.map(line => {
        const dr = m.money(line.debit), cr = m.money(line.credit); debit += dr; credit += cr;
        if (dr && cr || !dr && !cr) m.fail("IV_GL_JOURNAL_MISMATCH");
        return { account_id: String(line.account_id), signed_minor: (dr - cr).toString() };
      });
      if (debit !== credit || debit !== m.money(header.total_debit) || m.fingerprint(normalized) !== journal.details_fingerprint) m.fail("IV_GL_JOURNAL_MISMATCH");
      actualLines.push(...normalized.map(line => ({ date: journal.date, ...line })));
    }
    const expected = post.lines.map(({ date, account_id, signed_minor }) => ({ date, account_id, signed_minor }));
    if (m.canonical(actualLines) !== m.canonical(expected)) m.fail("IV_GL_JOURNAL_LINEAGE_MISMATCH");
  }
  return seen;
}
async function prepare(cx, x, prospective, { posting = false } = {}) {
  await transaction(cx, x.company_id);
  const start = await cutover(cx, x.company_id, true);
  if (!start) return null; // Legacy mode cannot pass GL/close readiness.
  await schema.assertReady(cx);
  const history = (await events(cx, x.company_id, "GL_POST", true)).filter(event => event.product_id === String(x.product_id));
  const previous = currentTargets(history);
  await verifyJournals(cx, x.company_id, history, true);
  if (!posting) {
    const priorRows = await v.records(cx, x);
    const newProduct = !priorRows.some(row => ["OPENING", "RECEIPT", "ISSUE"].includes(row.kind));
    const current = newProduct ? [] : p.expectedTargets(priorRows, start.date);
    if (p.replayDeltas(current, previous?.targets || []).length) m.fail("IV_GL_UNPOSTED_VALUATION");
  }
  const targets = p.expectedTargets(prospective, start.date);
  p.reconcileGrni(prospective, targets, "9999-12-31");
  const delta = p.replayDeltas(targets, previous?.targets || []);
  const lines = p.normalize(delta.flatMap(item => item.lines));
  const dates = [...new Set(lines.map(line => line.date))].sort(), years = new Map();
  for (const date of dates) m.moneyDecimal(lines.filter(line => line.date === date).reduce((sum, line) => sum + (p.signed(line.signed_minor) > 0n ? p.signed(line.signed_minor) : 0n), 0n));
  // Acquire ALL original-date periods before the first journal/stock write.
  for (const date of dates) years.set(date, await v.openDate(cx, x.company_id, date));
  const assigned = await bindings(cx, x.company_id, dates, true);
  return { start, history, previous, targets, delta, lines: lines.map(line => ({ ...line, account_id: assigned.get(`${line.date}:${line.role}`).account_id, role_fingerprint: assigned.get(`${line.date}:${line.role}`).fingerprint, financial_year_id: String(years.get(line.date).id) })) };
}
async function post(cx, x) {
  if (!await cutover(cx, x.company_id, true)) return null;
  const scope = `${v.id(x.company_id)}:${v.id(x.product_id)}`;
  const proof = postingProofs.get(cx)?.get(scope);
  postingProofs.get(cx)?.delete(scope);
  if (!proof) m.fail("IV_GL_POSTING_PROOF_REQUIRED");
  const evidence = await v.records(cx, x), plan = await prepare(cx, x, evidence, { posting: true });
  if ((plan.previous?.fingerprint || null) !== proof.predecessor || m.canonical(plan.lines) !== proof.lines) m.fail("IV_GL_POSTING_PROOF_MISMATCH");
  if (!plan || !plan.delta.length) return plan?.previous || null;
  const product = v.id(x.product_id), sequence = String((plan.previous ? Number(plan.previous.sequence) : 0) + 1);
  const key = `gl:${m.fingerprint({ product, predecessor: plan.previous?.fingerprint || null, targets: plan.targets })}`;
  const op = await operations.begin(cx, x.company_id, x.actor_id, key, "GL_POST", { product, sequence, targets: plan.targets });
  if (op.completed) return op.result;
  const journals = [];
  for (const date of [...new Set(plan.lines.map(line => line.date))].sort()) {
    const entries = plan.lines.filter(line => line.date === date), total = entries.reduce((sum, line) => sum + (p.signed(line.signed_minor) > 0n ? p.signed(line.signed_minor) : 0n), 0n);
    const sourceType = `inventory_valuation:${m.fingerprint({ key, date }).slice(0, 24)}`;
    const [header] = await cx.query("INSERT INTO journal_entries (journal_no,journal_date,narration,total_debit,total_credit,created_by,company_id,financial_year_id,source_type,source_id) VALUES (?,?,?,?,?,?,?,?,?,?)", [`IV-${m.fingerprint({ key, date }).slice(0, 28)}`, date, "Immutable inventory valuation", m.moneyDecimal(total), m.moneyDecimal(total), x.actor_id, x.company_id, entries[0].financial_year_id, sourceType, product]);
    const id = String(header.insertId), details = [];
    for (const line of entries) {
      const amount = p.signed(line.signed_minor);
      await cx.query("INSERT INTO journal_entry_details (journal_entry_id,account_id,debit,credit,description) VALUES (?,?,?,?,?)", [id, line.account_id, m.moneyDecimal(amount > 0n ? amount : 0n), m.moneyDecimal(amount < 0n ? -amount : 0n), "Immutable inventory valuation"]);
      details.push({ account_id: line.account_id, signed_minor: line.signed_minor });
    }
    journals.push({ id, date, source_type: sourceType, financial_year_id: entries[0].financial_year_id, details_fingerprint: m.fingerprint(details) });
  }
  const result = seal({ policy: p.POLICY, product_id: product, sequence, predecessor: plan.previous?.fingerprint || null, evidence_fingerprint: m.fingerprint(evidence.filter(row => row.kind !== "REPLAY").map(row => ({ id: row.id, fingerprint: row.fingerprint }))), targets: plan.targets, delta: plan.delta, lines: plan.lines, journals });
  await verifyJournals(cx, x.company_id, [result], true);
  return operations.complete(cx, op, result);
}

async function guardOperation(cx, x, action, input) {
  if (!await cutover(cx, x.company_id, true)) return;
  await v.prepare(cx, x);
  const evidence = await v.records(cx, x);
  const synthetic = (date, extra) => ({ id: "preview-gl", target_id: null, source_id: null, effective_date: date, sequence: String(evidence.filter(row => row.effective_date === date).reduce((n, row) => BigInt(row.sequence) > n ? BigInt(row.sequence) : n, 0n) + 1n), ...extra });
  if (action === "postMovement") {
    if (x.kind !== "ISSUE" || x.document_type !== "SALES_INVOICE") m.fail("IV_GL_OUTBOUND_UNSUPPORTED");
    const documents = await rows(cx, "SELECT ii.product_id,CAST(ii.quantity AS CHAR) quantity,DATE_FORMAT(i.invoice_date,'%Y-%m-%d') business_date FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id AND i.company_id=ii.company_id WHERE i.company_id=? AND i.id=? AND ii.id=? FOR UPDATE", [x.company_id, x.document_id, x.source_line]);
    if (documents.length !== 1 || String(documents[0].product_id) !== String(x.product_id) || documents[0].business_date !== x.date || m.operationalQuantity(documents[0].quantity).q6 !== m.operationalQuantity(x.quantity).q6) m.fail("IV_GL_SOURCE_LINEAGE_MISMATCH");
    evidence.push(synthetic(x.date, { kind: "ISSUE", document_type: x.document_type, document_id: x.document_id, source_line: x.source_line, payload: { quantity: x.quantity } }));
  } else if (action === "postAcquisition") {
    const source = v.find(evidence, x.source_id, "ACQUISITION");
    if (source.document_type === "SUPPLIER") m.fail("IV_GL_DIRECT_BILL_LINK_REQUIRED");
    evidence.push(synthetic(source.effective_date, { ...v.ref(source), kind: source.document_type === "OPENING" ? "OPENING" : "RECEIPT", payload: { revision_id: x.revision_id } }));
  } else if (action === "finalizeAcquisition") {
    const movement = v.find(evidence, x.movement_id), basis = v.appliedBasis(evidence, movement);
    if (movement.kind === "OPENING") m.fail("IV_GL_CUTOVER_IMMUTABLE");
    evidence.push(synthetic(basis.effective_date, { kind: "COST_REPLACEMENT", target_id: movement.id, payload: { revision_id: x.revision_id } }));
  } else if (action === "applyBillCost") {
    const source = v.find(evidence, input.source_id, "ACQUISITION"), revision = v.approved(evidence, v.find(evidence, input.revision_id, "COST"));
    const proof = await v.previewBillCost(cx, x, evidence, source, revision, input.bill_id, input.bill_date, input.correction_id);
    if (proof.correction) evidence.push(synthetic(source.effective_date, { kind: "STOCK_REPLACEMENT", target_id: proof.correction.movement.id, payload: { revision_id: revision.id, new_source_id: source.id } }));
    else if (!proof.movement) evidence.push(synthetic(source.effective_date, { ...v.ref(source), kind: "RECEIPT", payload: { revision_id: revision.id } }));
    else if (source.document_type !== "GRN" && v.appliedBasis(evidence, proof.movement).revision.id !== revision.id) evidence.push(synthetic(source.effective_date, { kind: "COST_REPLACEMENT", target_id: proof.movement.id, payload: { revision_id: revision.id } }));
    evidence.push({ id: "preview-gl-bill", kind: "BILL_LINK", effective_date: input.bill_date, document_id: String(input.bill_id), source_id: source.id, target_id: revision.id, supersedes_id: (proof.correction?.previous || proof.previous)?.id || null, payload: { quantity: revision.payload.quantity } });
  }
  const plan = await prepare(cx, x, evidence);
  if (!postingProofs.has(cx)) postingProofs.set(cx, new Map());
  postingProofs.get(cx).set(`${v.id(x.company_id)}:${v.id(x.product_id)}`, { predecessor: plan.previous?.fingerprint || null, lines: m.canonical(plan.lines) });
}

async function preflightSale(cx, company, actor, date, items) {
  const quantities = items.map(item => m.operationalQuantity(item.quantity));
  await transaction(cx, company);
  if (!await cutover(cx, company, true)) return false;
  const batches = new Map();
  for (let index = 0; index < items.length; index++) {
    const item = items[index], product = v.id(item.product_id), x = { company_id: company, product_id: product, actor_id: actor };
    await v.prepare(cx, x);
    const evidence = batches.get(product) || await v.records(cx, x);
    if (!batches.has(product)) {
      const physical = await rows(cx, "SELECT CAST(stock AS CHAR) stock FROM products WHERE company_id=? AND id=? FOR UPDATE", [company, product]);
      if (physical.length !== 1 || m.operationalQuantity(physical[0].stock).q6 !== m.operationalQuantity(v.projection(evidence).quantity).q6) m.fail("IV_STOCK_HISTORY_INCOMPLETE");
    }
    const sequence = String(evidence.filter(row => row.effective_date === date).reduce((n, row) => BigInt(row.sequence) > n ? BigInt(row.sequence) : n, 0n) + 1n);
    evidence.push({ id: `preview-sale-${index}`, target_id: null, source_id: null, kind: "ISSUE", effective_date: date, sequence, document_type: "SALES_INVOICE", document_id: "preview", source_line: String(index), payload: { quantity: quantities[index].sql } });
    batches.set(product, evidence);
  }
  for (const [product, evidence] of batches) await prepare(cx, { company_id: company, product_id: product, actor_id: actor }, evidence);
  return true;
}
async function rejectUnsupported(cx, company) {
  await transaction(cx, company);
  if (await cutover(cx, company, true)) m.fail("IV_GL_OUTBOUND_UNSUPPORTED");
}

async function approveCutover(cx, x) {
  const date = m.date(x.date);
  const op = await operations.begin(cx, x.company_id, x.actor_id, x.idempotency_key, "GL_CUTOVER", x);
  if (op.completed) return op.result;
  await owner(cx, x); await schema.assertReady(cx);
  await v.openDate(cx, x.company_id, date);
  if (await cutover(cx, x.company_id, true)) m.fail("IV_GL_CUTOVER_IMMUTABLE");
  const assigned = await bindings(cx, x.company_id, [date], true);
  const products = await rows(cx, "SELECT id,CAST(stock AS CHAR) stock FROM products WHERE company_id=? ORDER BY id FOR UPDATE", [x.company_id]);
  const openings = []; let value = 0n;
  for (const product of products) {
    const evidence = await v.records(cx, { company_id: x.company_id, product_id: product.id });
    if (evidence.some(row => ["RECEIPT", "ISSUE", "CUSTOMER_RETURN", "VENDOR_RETURN", "STOCK_REPLACEMENT"].includes(row.kind))) m.fail("IV_GL_HISTORICAL_GAP");
    const opening = evidence.filter(row => row.kind === "OPENING");
    if (opening.length !== 1 || opening[0].effective_date !== date) m.fail("IV_GL_CUTOVER_OPENING_REQUIRED");
    const result = v.projection(evidence);
    if (m.operationalQuantity(result.quantity).q6 !== m.operationalQuantity(product.stock).q6) m.fail("IV_STOCK_HISTORY_INCOMPLETE");
    value += p.minor(result.value_minor);
    openings.push({ product_id: String(product.id), opening_id: opening[0].id, quantity: result.quantity, value_minor: result.value_minor, fingerprint: result.fingerprint });
  }
  // No replay/backfill, guessed historical costs or stock restoration at cutover.
  for (const sql of [
    "SELECT bi.id FROM bill_items bi JOIN bills b ON b.id=bi.bill_id WHERE b.company_id=? LIMIT 1",
    "SELECT ii.id FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id WHERE i.company_id=? LIMIT 1",
    "SELECT id FROM inventory_transactions WHERE company_id=? LIMIT 1",
    "SELECT id FROM delivery_challan_items WHERE company_id=? LIMIT 1",
    "SELECT id FROM return_items WHERE company_id=? LIMIT 1",
  ]) if ((await rows(cx, sql, [x.company_id])).length) m.fail("IV_GL_HISTORICAL_GAP");
  const ledger = await controlLedger(cx, x.company_id, date, true);
  const balances = new Map();
  for (const line of ledger.lines) balances.set(line.account_id, (balances.get(line.account_id) || 0n) + BigInt(line.signed_minor));
  if ((balances.get(assigned.get(`${date}:INVENTORY`).account_id) || 0n) !== value ||
      (balances.get(assigned.get(`${date}:GRNI`).account_id) || 0n) !== 0n ||
      (balances.get(assigned.get(`${date}:COGS`).account_id) || 0n) !== 0n) m.fail("IV_GL_CUTOVER_CONTROL_MISMATCH");
  return operations.complete(cx, op, seal({ policy: p.POLICY, date, openings, journals: ledger.journals, ledger_fingerprint: ledger.fingerprint, reason: m.text(x.reason) }));
}
async function controlLedger(cx, company, asOf, locking = false) {
  const years = await rows(cx, "SELECT id,DATE_FORMAT(start_date,'%Y-%m-%d') start_date FROM financial_years WHERE company_id=? AND ? BETWEEN start_date AND end_date", [company, asOf]);
  if (years.length !== 1) m.fail("IV_GL_PERIOD_AMBIGUOUS");
  const headers = await rows(cx, `SELECT id,DATE_FORMAT(journal_date,'%Y-%m-%d') journal_date,CAST(total_debit AS CHAR) total_debit,CAST(total_credit AS CHAR) total_credit,status,source_type FROM journal_entries WHERE company_id=? AND financial_year_id=? AND journal_date<=? ORDER BY id${locking ? " FOR UPDATE" : ""}`, [company, years[0].id, asOf]);
  const lines = [], journals = [];
  for (const header of headers) {
    if (String(header.status) !== "1" || header.journal_date < years[0].start_date) m.fail("IV_GL_JOURNAL_MISMATCH");
    const detail = await rows(cx, `SELECT d.account_id,CAST(d.debit AS CHAR) debit,CAST(d.credit AS CHAR) credit FROM journal_entry_details d JOIN accounts a ON a.id=d.account_id WHERE d.journal_entry_id=? AND a.company_id=? ORDER BY d.id${locking ? " FOR UPDATE" : ""}`, [header.id, company]);
    let debit = 0n, credit = 0n;
    const normalized = detail.map(line => {
      const dr = m.money(line.debit), cr = m.money(line.credit); debit += dr; credit += cr;
      if (dr && cr) m.fail("IV_GL_JOURNAL_MISMATCH");
      return { account_id: String(line.account_id), signed_minor: (dr - cr).toString() };
    });
    if (debit !== credit || debit !== m.money(header.total_debit) || credit !== m.money(header.total_credit)) m.fail("IV_GL_JOURNAL_MISMATCH");
    journals.push({ id: String(header.id), date: header.journal_date, details_fingerprint: m.fingerprint(normalized) });
    lines.push(...normalized.map(line => ({ ...line, journal_id: String(header.id), date: header.journal_date, source_type: header.source_type || null })));
  }
  return { lines, journals, start_date: years[0].start_date, fingerprint: m.fingerprint({ lines, journals }) };
}
async function inspect(cx, company, asOf, locking = false) {
  const blockers = new Set(), inventory = [], inputs = [];
  let accountRoles = null;
  try {
    const start = await cutover(cx, company, locking);
    if (!start) m.fail("GL_COGS_RECONCILIATION_NOT_IMPLEMENTED");
    if (m.date(asOf) < start.date) m.fail("IV_GL_MIXED_BASIS_RANGE");
    // Expenses have no authoritative journal linkage contract yet. A balanced
    // ledger cannot prove their recognition; never silently omit them.
    if ((await rows(cx, "SELECT id FROM expenses WHERE company_id=? AND expense_date<=? LIMIT 1", [company, asOf])).length) m.fail("IV_GL_UNPOSTED_EXPENSE");
    await schema.assertReady(cx);
    const valuation = await require("./inventoryValuationReadinessService").inspectInventoryValuation(cx, company, { withinSnapshot: true, valuationOnly: true, allowSales: true });
    for (const code of valuation.blockers) if (code !== "GL_COGS_RECONCILIATION_NOT_IMPLEMENTED" && code !== "IV_PROVISIONAL_COST") blockers.add(code);
    inputs.push({ valuation: valuation.fingerprint || null });
    const history = await events(cx, company, "GL_POST", locking), seen = await verifyJournals(cx, company, history, locking);
    const actual = await rows(cx, "SELECT id FROM journal_entries WHERE company_id=? AND source_type LIKE 'inventory\\_valuation:%' ORDER BY id", [company]);
    if (actual.length !== seen.size || actual.some(row => !seen.has(String(row.id)))) m.fail("IV_GL_ORPHAN_JOURNAL");
    const products = await rows(cx, `SELECT id,CAST(stock AS CHAR) stock FROM products WHERE company_id=? ORDER BY id${locking ? " FOR UPDATE" : ""}`, [company]);
    if (history.some(post => !products.some(product => String(product.id) === post.product_id))) m.fail("IV_GL_HISTORY_GAP");
    let total = 0n, grni = 0n;
    const expectedCogs = [];
    for (const product of products) {
      const evidence = await v.records(cx, { company_id: company, product_id: product.id }, locking);
      const targets = p.expectedTargets(evidence, start.date), prior = currentTargets(history.filter(post => post.product_id === String(product.id)));
      expectedCogs.push(...targets.flatMap(target => target.lines).filter(line => line.role === "COGS"));
      if (p.replayDeltas(targets, prior?.targets || []).length) m.fail("IV_GL_UNPOSTED_VALUATION");
      const replay = v.projection(evidence);
      if (m.operationalQuantity(product.stock).q6 !== m.operationalQuantity(replay.quantity).q6) m.fail("IV_STOCK_HISTORY_INCOMPLETE");
      const dated = new Map(evidence.filter(row => ["OPENING", "RECEIPT", "ISSUE"].includes(row.kind)).map(row => [row.id, row.kind === "ISSUE" ? row.effective_date : v.appliedBasis(evidence, row).effective_date]));
      const at = replay.results.filter(row => dated.get(row.id) <= asOf).at(-1);
      const cutoffValue = at || postCutoffOpening(evidence, asOf);
      const reconciliation = p.reconcileGrni(evidence, targets, asOf);
      if (!reconciliation.close_ready) blockers.add("IV_GL_PROVISIONAL_GRNI_UNRESOLVED");
      total += p.minor(cutoffValue.value_minor);
      grni += reconciliation.balances.reduce((sum, row) => sum + BigInt(row.balance_minor), 0n);
      inventory.push({ product_id: String(product.id), quantity_at_cutoff: m.operationalQuantity(cutoffValue.quantity).sql, valuation_amount: m.moneyDecimal(p.minor(cutoffValue.value_minor)) });
      inputs.push({ product: String(product.id), stock: product.stock, evidence: evidence.map(row => [row.id, row.fingerprint]), post: prior?.fingerprint || null, grni: reconciliation.fingerprint });
    }
    // Exact source-line coverage; zero-net historical gaps are still gaps.
    const invoiceLines = await rows(cx, "SELECT ii.id,ii.invoice_id,ii.product_id,CAST(ii.quantity AS CHAR) quantity,DATE_FORMAT(i.invoice_date,'%Y-%m-%d') business_date FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id WHERE i.company_id=? ORDER BY ii.id", [company]);
    const billLines = await rows(cx, "SELECT bi.id,bi.bill_id,bi.product_id,CAST(bi.quantity AS CHAR) quantity,DATE_FORMAT(b.bill_date,'%Y-%m-%d') business_date FROM bill_items bi JOIN bills b ON b.id=bi.bill_id WHERE b.company_id=? ORDER BY bi.id", [company]);
    const all = (await rows(cx, "SELECT *,CAST(sequence AS CHAR) sequence,DATE_FORMAT(effective_date,'%Y-%m-%d') effective_date FROM iv_records WHERE company_id=? ORDER BY product_id,effective_date,sequence,id", [company])).map(v.decodeRecord);
    for (const [documents, kind, type, idField] of [[invoiceLines, "ISSUE", "SALES_INVOICE", "invoice_id"], [billLines, "BILL_LINK", "BILL", "bill_id"]]) {
      const active = all.filter(row => row.kind === kind && !all.some(next => next.kind === kind && next.supersedes_id === row.id));
      for (const document of documents) {
        const matches = active.filter(row => row.document_type === type && row.source_line === String(document.id) && row.document_id === String(document[idField]) && String(row.product_id) === String(document.product_id));
        if (matches.length !== 1 || matches[0].effective_date !== document.business_date || m.operationalQuantity(matches[0].payload.quantity).q6 !== m.operationalQuantity(document.quantity).q6) m.fail("IV_GL_SOURCE_LINEAGE_MISMATCH");
      }
      if (active.length !== documents.length) m.fail("IV_GL_SOURCE_LINEAGE_MISMATCH");
    }
    for (const table of ["return_items", "delivery_challan_items"]) if ((await rows(cx, `SELECT id FROM ${table} WHERE company_id=? LIMIT 1`, [company])).length) m.fail("IV_GL_OUTBOUND_UNSUPPORTED");
    const ledger = await controlLedger(cx, company, asOf, locking);
    const annualJournals = await require("./annualJournalService").verify(cx, company, locking);
    const effective = await bindings(cx, company, [asOf], locking);
    accountRoles = Object.fromEntries(Object.keys(roles).map(role => [role, effective.get(`${asOf}:${role}`).account_id]));
    const assignments = await events(cx, company, "GL_ROLE", locking);
    const sum = role => {
      const ids = new Set(assignments.filter(row => row.role === role).map(row => row.account_id));
      return ledger.lines.filter(line => ids.has(line.account_id)).reduce((s, line) => s + BigInt(line.signed_minor), 0n);
    };
    if (sum("INVENTORY") !== total || sum("GRNI") !== -grni) m.fail("IV_GL_CONTROL_RECONCILIATION_FAILED");
    const controlled = new Set(assignments.filter(row => ["INVENTORY", "COGS", "GRNI"].includes(row.role)).map(row => row.account_id));
    if (ledger.lines.some(line => line.date >= start.date && controlled.has(line.account_id) && !seen.has(line.journal_id) && !start.journals.some(j => j.id === line.journal_id) && !annualJournals.has(line.journal_id))) m.fail("IV_GL_UNLINKED_CONTROL_POSTING");
    const cogsIds = new Set(assignments.filter(row => row.role === "COGS").map(row => row.account_id));
    const cogs = ledger.lines.filter(line => cogsIds.has(line.account_id) && !["annual_fy_close", "annual_fy_opening"].includes(line.source_type)).reduce((s, line) => s + BigInt(line.signed_minor), 0n);
    if (cogs !== expectedCogs.filter(line => line.date >= ledger.start_date && line.date <= asOf).reduce((s, line) => s + BigInt(line.signed_minor), 0n)) m.fail("IV_GL_COGS_RECONCILIATION_FAILED");
    inputs.push({ cutover: start.fingerprint, ledger: ledger.fingerprint, invoiceLines, billLines, roles: assignments.map(row => row.fingerprint) });
  } catch (error) {
    blockers.add(error.code?.startsWith("IV_") || error.code === "GL_COGS_RECONCILIATION_NOT_IMPLEMENTED" ? error.code : "IV_GL_INSPECTION_FAILED");
  }
  return { ready: !blockers.size, blockers: [...blockers].sort(), inventory, account_roles: accountRoles, fingerprint: m.fingerprint(inputs) };
}

function postCutoffOpening(evidence, asOf) {
  const openings = evidence.filter(row => row.kind === "OPENING");
  if (openings.length !== 1 || openings[0].effective_date <= asOf) m.fail("IV_GL_CUTOVER_OPENING_REQUIRED");
  const basis = v.appliedBasis(evidence, openings[0]);
  const cost = v.approved(evidence, basis.revision);
  if (basis.effective_date <= asOf || m.operationalQuantity(cost.payload.quantity).q6 || p.minor(cost.payload.total_minor) ||
      evidence.some(row => ["RECEIPT", "ISSUE", "CUSTOMER_RETURN", "VENDOR_RETURN"].includes(row.kind) && row.effective_date <= asOf)) m.fail("IV_GL_HISTORICAL_GAP");
  return { quantity: "0.00", value_minor: "0" };
}

const clearProof = (cx, x) => postingProofs.get(cx)?.delete(`${v.id(x.company_id)}:${v.id(x.product_id)}`);
module.exports = { roles, seal, verified, events, cutover, bindings, assignRole, approveCutover, currentTargets, verifyJournals, guardOperation, clearProof, preflightSale, rejectUnsupported, prepare, post, inspect, controlLedger, transaction, owner, postCutoffOpening };
