"use strict";

const a = require("./annualSubledgerService");
const { inspectAnnualSchema } = require("./annualSubledgerReadinessService");
const ALGORITHM = "FY-CLOSE-IV-GL-2";
const day = value => value instanceof Date ? value.toISOString().slice(0, 10) : String(value || "").slice(0, 10);
const adjacentDate = value => new Date(Date.parse(`${a.date(value)}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
const quantity = value => {
  const text = String(value ?? "");
  if (!/^-?\d{1,15}(?:\.\d{1,3})?$/.test(text)) a.fail("ANNUAL_INVENTORY_INVALID");
  const [whole, fraction = ""] = text.replace(/^-/, "").split(".");
  return (text.startsWith("-") ? -1n : 1n) * (BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0")));
};
const qty = value => `${value < 0n ? "-" : ""}${(value < 0n ? -value : value) / 1000n}.${String((value < 0n ? -value : value) % 1000n).padStart(3, "0")}`;
const buildPreview = input => {
  const { source, years, accounts, roles, journals, details, invoices, bills, openings, products, movements, records } = input;
  const counts = new Map();
  const block = (code, count = 1) => { if (count) counts.set(code, (counts.get(code) || 0) + count); };
  const next = years.filter(y => day(y.start_date) === adjacentDate(day(source.end_date)) && Number(y.id) !== Number(source.id));
  if (next.length !== 1) block("FY_EXACT_ADJACENT_YEAR_REQUIRED");
  const destination = next[0];
  // The opening journal is a real destination-year posting. It cannot be
  // generated into a Draft year, even though that year may be adjacent.
  if (destination && destination.status !== "OPEN") block("FY_DESTINATION_STATUS_INCOMPATIBLE");
  if (!["RECONCILIATION", "CLOSING"].includes(source.status)) block("FY_RECONCILIATION_REQUIRED");
  if (years.some((x, i) => years.some((y, j) => j > i && day(x.start_date) <= day(y.end_date) && day(x.end_date) >= day(y.start_date)))) block("FY_OVERLAP");
  const validRoles = roles.filter(r => r.from_date <= day(source.start_date) && (!r.to_date || r.to_date >= day(source.end_date)));
  const role = name => validRoles.filter(r => r.role === name);
  for (const name of ["RETAINED_EARNINGS", "OPENING_BALANCE_EQUITY", "ACCOUNTS_RECEIVABLE", "ACCOUNTS_PAYABLE"]) {
    const candidates = role(name);
    const expected = name === "ACCOUNTS_RECEIVABLE" ? "ASSET" : name === "ACCOUNTS_PAYABLE" ? "LIABILITY" : "EQUITY";
    if (candidates.length !== 1 || !accounts.some(x => Number(x.id) === Number(candidates[0].account_id) && x.account_type === expected && Number(x.status) === 1)) block("FY_SYSTEM_ACCOUNT_ROLE_INCOMPATIBLE");
  }
  const affected = journals.filter(j => Number(j.financial_year_id) === Number(source.id));
  const lines = new Map();
  for (const journal of journals) {
    const d = day(journal.journal_date);
    if (d <= day(source.end_date) && (!journal.financial_year_id || !years.some(y => Number(y.id) === Number(journal.financial_year_id) && d >= day(y.start_date) && d <= day(y.end_date)))) block("FY_ACCOUNTING_ASSIGNMENT_INVALID");
  }
  for (const journal of affected) {
    const children = details.filter(d => Number(d.journal_entry_id) === Number(journal.id));
    const debit = children.reduce((sum, row) => sum + a.minor(row.debit), 0n), credit = children.reduce((sum, row) => sum + a.minor(row.credit), 0n);
    if (Number(journal.status) !== 1 || children.length < 2 || debit !== credit || debit !== a.minor(journal.total_debit) || credit !== a.minor(journal.total_credit)) block("FY_ACCOUNTING_UNPOSTED_OR_UNBALANCED");
    for (const row of children) {
      const account = accounts.find(x => Number(x.id) === Number(row.account_id));
      if (!account || !["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"].includes(account.account_type) || a.minor(row.debit) < 0n || a.minor(row.credit) < 0n || (a.minor(row.debit) && a.minor(row.credit))) { block("FY_ACCOUNTING_LINE_INVALID"); continue; }
      lines.set(Number(account.id), (lines.get(Number(account.id)) || 0n) + a.minor(row.debit) - a.minor(row.credit));
    }
  }
  for (const record of records) {
    const d = day(record.business_date);
    if (d <= day(source.end_date) && (!record.financial_year_id || !years.some(y => Number(y.id) === Number(record.financial_year_id) && d >= day(y.start_date) && d <= day(y.end_date)))) block(record.assignment_code);
    if (Number(record.financial_year_id) === Number(source.id) && !record.posted) block(record.posting_code);
  }
  const carried = [];
  for (const [type, documents] of [["CUSTOMER", invoices], ["VENDOR", bills]]) for (const row of documents) {
    if (Number(row.financial_year_id) !== Number(source.id) || String(row.status).toLowerCase() === "cancelled") continue;
    const residual = a.minor(row.total_amount) - a.minor(row.allocated_amount);
    if (residual < 0n || !row.party_id) { block("FY_SUBLEDGER_BALANCE_AMBIGUOUS"); continue; }
    if (residual) carried.push({ party_type: type, party_id: a.id(row.party_id), amount: a.money(residual), original_amount: a.money(a.minor(row.total_amount)),
      allocated_amount: a.money(a.minor(row.allocated_amount)), reference: row.reference, effective_date: day(row.business_date), due_date: row.due_date ? day(row.due_date) : null,
      original_invoice_id: type === "CUSTOMER" ? a.id(row.id) : null, original_bill_id: type === "VENDOR" ? a.id(row.id) : null,
      original_opening_item_id: null, original_financial_year_id: a.id(source.id), predecessor_opening_item_id: null });
  }
  for (const row of openings.filter(x => Number(x.financial_year_id) === Number(source.id) && x.entry_kind === "ORIGINAL")) {
    if ((row.party_type === "CUSTOMER" && row.direction !== "DEBIT") || (row.party_type === "VENDOR" && row.direction !== "CREDIT")) { block("FY_SUBLEDGER_DIRECTION_UNSUPPORTED"); continue; }
    const residual = a.minor(row.remaining_amount);
    if (residual < 0n || residual > a.minor(row.original_amount)) { block("FY_SUBLEDGER_BALANCE_AMBIGUOUS"); continue; }
    if (residual) carried.push({ party_type: row.party_type, party_id: a.id(row.customer_id || row.vendor_id), amount: a.money(residual),
      original_amount: a.money(a.minor(row.original_amount)), allocated_amount: a.money(a.minor(row.original_amount) - residual),
      reference: row.reference, effective_date: day(row.effective_date), due_date: row.due_date ? day(row.due_date) : null,
      original_invoice_id: row.original_invoice_id || null, original_bill_id: row.original_bill_id || null,
      original_opening_item_id: row.original_opening_item_id || (row.origin !== "ANNUAL_CARRY_FORWARD" ? a.id(row.id) : null),
      original_financial_year_id: row.original_financial_year_id || a.id(row.financial_year_id), predecessor_opening_item_id: a.id(row.id) });
  }
  carried.sort((x, y) => `${x.party_type}:${x.original_invoice_id || x.original_bill_id || x.original_opening_item_id}`.localeCompare(`${y.party_type}:${y.original_invoice_id || y.original_bill_id || y.original_opening_item_id}`));
  const ar = carried.filter(x => x.party_type === "CUSTOMER").reduce((s, x) => s + a.minor(x.amount), 0n);
  const ap = carried.filter(x => x.party_type === "VENDOR").reduce((s, x) => s + a.minor(x.amount), 0n);
  const arVariance = (lines.get(Number(role("ACCOUNTS_RECEIVABLE")[0]?.account_id)) || 0n) - ar;
  const apVariance = -(lines.get(Number(role("ACCOUNTS_PAYABLE")[0]?.account_id)) || 0n) - ap;
  if (arVariance || apVariance) block("FY_SUBLEDGER_CONTROL_RECONCILIATION_FAILED");
  // Quantity-only legacy snapshots must never certify inventory/COGS. The
  // persisted bridge independently verifies source, valuation and actual GL.
  const gl = input.inventory_gl;
  if (gl?.account_roles && String(role("ACCOUNTS_PAYABLE")[0]?.account_id) !== gl.account_roles.ACCOUNTS_PAYABLE) block("FY_GL_AP_ROLE_MISMATCH");
  if (!gl?.ready || !/^[0-9a-f]{64}$/.test(gl?.fingerprint || "")) {
    for (const code of gl?.blockers || ["GL_COGS_RECONCILIATION_NOT_IMPLEMENTED"]) block(code);
    if (!gl?.blockers?.length) block("FY_INVENTORY_GL_RECONCILIATION_REQUIRED");
  }
  const inventory = (gl?.inventory || []).map(row => ({ ...row, product_id: a.id(row.product_id) }));
  if (inventory.length !== products.length || new Set(inventory.map(row => row.product_id)).size !== products.length || products.some(product => !inventory.some(row => row.product_id === Number(product.id)))) block("FY_INVENTORY_PROVENANCE_INCOMPLETE");
  if (inventory.some(row => row.valuation_amount === null || a.minor(row.valuation_amount) < 0n || quantity(row.quantity_at_cutoff) < 0n)) block("FY_INVENTORY_VALUATION_REQUIRED");
  const retainedId = Number(role("RETAINED_EARNINGS")[0]?.account_id);
  const accounting = [...lines].sort((x, y) => x[0] - y[0]).map(([accountId, balance]) => ({ account_id: accountId,
    account_type: accounts.find(x => Number(x.id) === accountId).account_type, source_closing_signed_balance: a.money(balance) }));
  const pnl = accounting.filter(x => ["INCOME", "EXPENSE"].includes(x.account_type)).reduce((s, x) => s + a.minor(x.source_closing_signed_balance), 0n);
  if (!accounting.some(x => x.account_id === retainedId) && retainedId) accounting.push({ account_id: retainedId, account_type: "EQUITY", source_closing_signed_balance: "0.00" });
  for (const line of accounting) {
    const balance = a.minor(line.source_closing_signed_balance), temporary = ["INCOME", "EXPENSE"].includes(line.account_type);
    const closing = temporary ? -balance : line.account_id === retainedId ? pnl : 0n;
    const opening = temporary ? 0n : balance + closing;
    Object.assign(line, { classification: temporary ? (line.account_type === "INCOME" ? "PNL_INCOME" : "PNL_EXPENSE") : line.account_id === retainedId ? "RETAINED_EARNINGS" : "PERMANENT",
      closing_journal_debit: a.money(closing > 0n ? closing : 0n), closing_journal_credit: a.money(closing < 0n ? -closing : 0n),
      opening_journal_debit: a.money(opening > 0n ? opening : 0n), opening_journal_credit: a.money(opening < 0n ? -opening : 0n), destination_opening_signed_balance: a.money(opening) });
  }
  if (accounting.reduce((s, x) => s + a.minor(x.source_closing_signed_balance), 0n) !== 0n) block("FY_GL_UNBALANCED");
  accounting.sort((x, y) => x.account_id - y.account_id);
  inventory.sort((x, y) => x.product_id - y.product_id);
  const blockers = [...counts].sort((x, y) => x[0].localeCompare(y[0])).map(([code, count]) => ({ code, count }));
  const evidence = { algorithm: ALGORITHM, source_id: source.id, destination_id: destination?.id || null,
    source_start: day(source.start_date), cutoff: day(source.end_date), destination_start: destination ? day(destination.start_date) : null,
    accounting, subledger: carried, inventory, inventory_gl_fingerprint: gl?.fingerprint || null, ar_variance: a.money(arVariance), ap_variance: a.money(apVariance), profit: a.money(-pnl), blockers };
  return { ...evidence, ready: !blockers.length, fingerprint: a.digest({ evidence, inputs: input.fingerprint_inputs }) };
};

const queryRows = async (cx, sql, args) => (await cx.query(sql, args))[0];
const authorize = async (cx, companyId, actor, locking) => {
  const companies = await queryRows(cx, `SELECT id FROM companies WHERE id=?${locking ? " FOR UPDATE" : ""}`, [companyId]);
  const owners = await queryRows(cx, "SELECT membership_role FROM user_company_memberships WHERE company_id=? AND user_id=? AND is_active=1", [companyId, actor]);
  if (companies.length !== 1 || owners.length !== 1 || owners[0].membership_role !== "owner") a.fail("ANNUAL_NOT_AUTHORIZED", 403);
};
const yearsAndVersion = async (cx, companyId, sourceId, locking = false) => {
  const sourceRows = await queryRows(cx, `SELECT *,DATE_FORMAT(start_date,'%Y-%m-%d') start_date,DATE_FORMAT(end_date,'%Y-%m-%d') end_date
    FROM financial_years WHERE company_id=? AND id=?${locking ? " FOR UPDATE" : ""}`, [companyId, sourceId]);
  if (sourceRows.length !== 1) a.fail("ANNUAL_SCOPE_NOT_FOUND", 404);
  const source = sourceRows[0];
  const destinationRows = await queryRows(cx, `SELECT *,DATE_FORMAT(start_date,'%Y-%m-%d') start_date,DATE_FORMAT(end_date,'%Y-%m-%d') end_date
    FROM financial_years WHERE company_id=? AND start_date=? ORDER BY id${locking ? " FOR UPDATE" : ""}`, [companyId, adjacentDate(day(source.end_date))]);
  const years = await queryRows(cx, "SELECT *,DATE_FORMAT(start_date,'%Y-%m-%d') start_date,DATE_FORMAT(end_date,'%Y-%m-%d') end_date FROM financial_years WHERE company_id=? ORDER BY start_date,id", [companyId]);
  const version = await queryRows(cx, "SELECT COALESCE(MAX(id),0) version FROM financial_year_events WHERE company_id=? AND financial_year_id=?", [companyId, sourceId]);
  return { source, destination: destinationRows.length === 1 ? destinationRows[0] : null, years, version: String(version[0].version) };
};
const loadPreview = async (cx, companyId, scope, locking = false) => {
  const suffix = locking ? " FOR UPDATE" : "";
  // Fixed table inventory. No ensure-schema helper or runtime DDL is used.
  const tables = ["accounts", "journal_entries", "invoices", "bills", "payments", "vendor_payments", "receipt_entries", "payroll_entries", "petty_cash_transactions", "products", "inventory_transactions", "goods_receipts", "delivery_challans", "product_returns", "customer_advances", "subledger_opening_items"];
  const data = {};
  for (const table of tables) data[table] = await queryRows(cx, `SELECT * FROM ${table} WHERE company_id=? ORDER BY id${suffix}`, [companyId]);
  const details = await queryRows(cx, `SELECT d.* FROM journal_entry_details d JOIN journal_entries j ON j.id=d.journal_entry_id WHERE j.company_id=? ORDER BY d.id${suffix}`, [companyId]);
  const roles = await queryRows(cx, `SELECT r.*,DATE_FORMAT(f.start_date,'%Y-%m-%d') from_date,DATE_FORMAT(t.end_date,'%Y-%m-%d') to_date
    FROM system_account_role_assignments r JOIN financial_years f ON f.id=r.effective_from_financial_year_id AND f.company_id=r.company_id
    LEFT JOIN financial_years t ON t.id=r.effective_to_financial_year_id AND t.company_id=r.company_id
    WHERE r.company_id=? ORDER BY r.id${suffix}`, [companyId]);
  const reversals = await queryRows(cx, `SELECT * FROM payment_reversals WHERE company_id=? ORDER BY id${suffix}`, [companyId]);
  const vendorReversals = await queryRows(cx, `SELECT * FROM vendor_payment_reversals WHERE company_id=? ORDER BY id${suffix}`, [companyId]);
  const cutoff = day(scope.source.end_date);
  const inventoryGl = await require("./inventoryGlService").inspect(cx, companyId, cutoff, locking);
  const glPosts = await require("./inventoryGlService").events(cx, companyId, "GL_POST", locking);
  const glTargets = new Map();
  for (const product of data.products) {
    const latest = require("./inventoryGlService").currentTargets(glPosts.filter(post => post.product_id === String(product.id)));
    for (const target of latest?.targets || []) glTargets.set(target.key, target);
  }
  const invoices = data.invoices.map(row => ({ ...row, party_id: row.customer_id, reference: row.invoice_number, business_date: day(row.invoice_date),
    allocated_amount: a.money(data.payments.filter(p => Number(p.invoice_id) === Number(row.id) && day(p.payment_date) <= cutoff).reduce((sum, p) => sum + a.minor(p.amount)
      - reversals.filter(r => Number(r.original_payment_id) === Number(p.id) && day(r.reversal_date) <= cutoff).reduce((s, r) => s + a.minor(r.reversal_amount), 0n), 0n)) }));
  const bills = data.bills.map(row => ({ ...row, party_id: row.vendor_id, reference: row.bill_number, business_date: day(row.bill_date),
    allocated_amount: a.money(data.vendor_payments.filter(p => Number(p.bill_id) === Number(row.id) && p.status === "SUCCESS" && day(p.payment_date) <= cutoff).reduce((sum, p) => sum + a.minor(p.amount)
      - vendorReversals.filter(r => Number(r.original_vendor_payment_id) === Number(p.id) && day(r.reversal_date) <= cutoff).reduce((s, r) => s + a.minor(r.reversal_amount), 0n), 0n)) }));
  const records = [];
  const add = (rows, dateField, code, posted) => rows.forEach(row => records.push({ ...row, business_date: day(row[dateField]), assignment_code: `FY_${code}_ASSIGNMENT_INVALID`, posting_code: `FY_${code}_UNPOSTED_OR_AMBIGUOUS`, posted: posted(row) }));
  const linked = (type, row) => data.journal_entries.some(j => j.source_type === type && Number(j.source_id) === Number(row.id) && Number(j.status) === 1);
  add(data.invoices, "invoice_date", "SALES", row => String(row.status).toLowerCase() === "cancelled" || linked("sales_invoice", row));
  add(data.bills, "bill_date", "PURCHASE", row => String(row.status).toLowerCase() === "cancelled" || inventoryGl.ready && [...glTargets.keys()].some(key => key.startsWith("bill:") && key.endsWith(`:${row.id}`)));
  add(data.payments, "payment_date", "PAYMENT", row => data.receipt_entries.some(r => Number(r.id) === Number(row.receipt_entry_id) && r.journal_entry_id));
  add(data.vendor_payments, "payment_date", "VENDOR_PAYMENT", row => row.status === "SUCCESS" && row.journal_entry_id);
  const payroll = data.payroll_entries.map(row => ({ ...row, financial_year_id: data.journal_entries.find(j =>
    j.source_type === "payroll" && Number(j.source_id) === Number(row.id))?.financial_year_id || row.financial_year_id }));
  add(payroll, "payroll_date", "PAYROLL", row => row.journal_entry_id && linked("payroll", row));
  add(data.petty_cash_transactions, "transaction_date", "PETTY_CASH", row => row.status === "POSTED" && row.journal_entry_id);
  // Receipt FY is derived through its authoritative journal, not guessed from a default FY.
  add(data.receipt_entries.map(row => ({ ...row, financial_year_id: data.journal_entries.find(j => Number(j.id) === Number(row.journal_entry_id))?.financial_year_id })), "receipt_date", "RECEIPT", row => Boolean(row.journal_entry_id));
  const openings = [];
  for (const row of data.subledger_opening_items) openings.push({ ...row, remaining_amount: await a.remaining(cx, row, cutoff) });
  const movements = [];
  const invoiceItems = await queryRows(cx, "SELECT ii.* FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id AND i.company_id=ii.company_id WHERE i.company_id=? ORDER BY ii.id", [companyId]);
  const billItems = await queryRows(cx, "SELECT bi.* FROM bill_items bi JOIN bills b ON b.id=bi.bill_id WHERE b.company_id=? ORDER BY bi.id", [companyId]);
  const challanItems = await queryRows(cx, "SELECT ci.* FROM delivery_challan_items ci JOIN delivery_challans c ON c.id=ci.challan_id AND c.company_id=ci.company_id WHERE c.company_id=? ORDER BY ci.id", [companyId]);
  const returnItems = await queryRows(cx, "SELECT ri.* FROM return_items ri JOIN product_returns r ON r.id=ri.return_id AND r.company_id=ri.company_id WHERE r.company_id=? ORDER BY ri.id", [companyId]);
  const movement = (productId, businessDate, input, output, ambiguous = false) => movements.push({ product_id: productId, business_date: day(businessDate), quantity_in: String(input || 0), quantity_out: String(output || 0), ambiguous });
  for (const item of invoiceItems) {
    const parent = data.invoices.find(row => Number(row.id) === Number(item.invoice_id));
    const matches = data.products.filter(p => item.product_id ? Number(p.id) === Number(item.product_id) : p.name === item.item_name);
    if (parent && String(parent.status).toLowerCase() !== "cancelled") movement(matches.length === 1 ? matches[0].id : null, parent.invoice_date, 0, item.quantity, matches.length !== 1);
  }
  for (const item of billItems) {
    const parent = data.bills.find(row => Number(row.id) === Number(item.bill_id));
    if (parent && Number(parent.stock_posted) === 1) movement(item.product_id, parent.bill_date, item.quantity, 0);
  }
  for (const row of data.inventory_transactions) {
    const parent = data.goods_receipts.find(r => Number(r.id) === Number(row.reference_id) && r.status === "Posted" && Number(r.stock_posted) === 1);
    movement(row.product_id, row.transaction_date, row.quantity_in, row.quantity_out, row.reference_type !== "GRN" || !parent);
  }
  for (const item of challanItems) {
    const p = data.delivery_challans.find(row => Number(row.id) === Number(item.challan_id));
    if (p) movement(item.product_id, p.challan_date, p.type === "in" ? item.quantity : 0, p.type === "out" ? item.quantity : 0);
  }
  for (const item of returnItems) {
    const p = data.product_returns.find(row => Number(row.id) === Number(item.return_id));
    if (p) movement(item.product_id, p.return_date, p.type === "sales" ? item.quantity : 0, p.type === "purchase" ? item.quantity : 0);
  }
  const preview = buildPreview({ source: scope.source, years: scope.years, accounts: data.accounts, roles, journals: data.journal_entries,
    details, invoices, bills, openings, products: data.products, movements, records, inventory_gl: inventoryGl,
    fingerprint_inputs: { data, details, roles, invoiceItems, billItems, challanItems, returnItems, reversals, vendorReversals, openings, inventoryGl } });
  if (data.customer_advances.some(row => a.minor(row.unapplied_amount) !== 0n)) {
    preview.blockers.push({ code: "FY_CUSTOMER_ADVANCES_RECONCILIATION_REQUIRED", count: data.customer_advances.filter(row => a.minor(row.unapplied_amount) !== 0n).length });
    preview.ready = false;
    preview.fingerprint = a.digest(preview);
  }
  return preview;
};
const event = async (cx, companyId, scope, actor, type, previous, status, reason, metadata) => a.write(cx,
  `INSERT INTO financial_year_events (company_id,financial_year_id,event_type,previous_status,new_status,reason,actor_user_id,metadata) VALUES (?,?,?,?,?,?,?,?)`,
  [companyId, scope.source.id, type, previous, status, reason, actor, JSON.stringify(metadata)]);
const validateMutation = (body, confirmation) => {
  const key = a.uuid(body.idempotency_key);
  if (body.confirmation !== confirmation || !String(body.reason || "").trim() || String(body.reason).length > 500 || !/^\d+$/.test(String(body.expected_version))) a.fail("ANNUAL_CONFIRMATION_OR_VERSION_REQUIRED", 400);
  return key;
};
const writeCloseJournal = async (cx, companyId, scope, runId, actor, preview, opening) => {
  const lines = preview.accounting.filter(x => a.minor(x[opening ? "opening_journal_debit" : "closing_journal_debit"]) || a.minor(x[opening ? "opening_journal_credit" : "closing_journal_credit"]));
  const totalDebit = lines.reduce((s, x) => s + a.minor(x[opening ? "opening_journal_debit" : "closing_journal_debit"]), 0n);
  const totalCredit = lines.reduce((s, x) => s + a.minor(x[opening ? "opening_journal_credit" : "closing_journal_credit"]), 0n);
  if (totalDebit !== totalCredit) a.fail("ANNUAL_BALANCE_INVALID");
  if (!lines.length) return { id: null, details: new Map() };
  const r = await a.write(cx, `INSERT INTO journal_entries (company_id,financial_year_id,journal_no,journal_date,narration,total_debit,total_credit,created_by,source_type,source_id)
    VALUES (?,?,?,?,?,?,?,?,?,?)`, [companyId, opening ? scope.destination.id : scope.source.id, `FY-${opening ? "OPEN" : "CLOSE"}-${companyId}-${runId}`,
    opening ? day(scope.destination.start_date) : day(scope.source.end_date), "Reviewed financial year close", a.money(totalDebit), a.money(totalCredit), actor,
    opening ? "annual_fy_opening" : "annual_fy_close", runId]);
  const ids = new Map();
  for (const line of lines) {
    const detail = await a.write(cx, "INSERT INTO journal_entry_details (journal_entry_id,account_id,debit,credit,description) VALUES (?,?,?,?,?)", [r.insertId, line.account_id,
      line[opening ? "opening_journal_debit" : "closing_journal_debit"], line[opening ? "opening_journal_credit" : "closing_journal_credit"], "Reviewed financial year close"]);
    ids.set(line.account_id, detail.insertId);
  }
  return { id: r.insertId, details: ids };
};
const createFinancialYearCloseService = executor => {
  const inspect = async (company, sourceId, actor, previewRequested = false) => {
    const companyId = a.id(company); sourceId = a.id(sourceId); actor = a.id(actor);
    const cx = await executor.getConnection();
    try {
      await cx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      await cx.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
      await authorize(cx, companyId, actor, false);
      const schema = await inspectAnnualSchema(cx);
      if (!schema.ready) return { ready: false, blockers: schema.blockers };
      const scope = await yearsAndVersion(cx, companyId, sourceId);
      const preview = await loadPreview(cx, companyId, scope);
      const runs = scope.destination ? await queryRows(cx, "SELECT id,status FROM financial_year_close_runs WHERE company_id=? AND source_financial_year_id=? AND destination_financial_year_id=? ORDER BY id", [companyId, sourceId, scope.destination.id]) : [];
      const finalized = runs.some(run => run.status === "FINALIZED");
      return previewRequested ? { ...preview, version: scope.version, source_status: scope.source.status, finalized } : { ready: preview.ready, blockers: preview.blockers, source_id: sourceId,
        source_status: scope.source.status, destination_id: scope.destination?.id || null, version: scope.version, fingerprint: preview.fingerprint, finalized };
    } catch (e) {
      if (e.code === "ANNUAL_SCOPE_NOT_FOUND") throw e;
      return { ready: false, blockers: [{ code: "FY_SOURCE_INSPECTION_FAILED", count: 1 }] };
    } finally { try { await cx.rollback(); } finally { cx.release(); } }
  };
  const mutate = async (company, sourceId, actor, body, action) => {
    const companyId = a.id(company); sourceId = a.id(sourceId); actor = a.id(actor);
    const key = validateMutation(body, action === "begin" ? "BEGIN CLOSE" : action === "finalize" ? "FINALIZE CLOSE" : "LOCK");
    const request = a.digest({ companyId, sourceId, actor, action, body: { ...body, idempotency_key: key } });
    return a.transaction(executor, async cx => {
      await authorize(cx, companyId, actor, true);
      const schema = await inspectAnnualSchema(cx);
      if (!schema.ready) a.fail("ANNUAL_SCHEMA_NOT_READY", 503);
      const scope = await yearsAndVersion(cx, companyId, sourceId, true);
      if (!scope.destination) a.fail("ANNUAL_ADJACENT_YEAR_REQUIRED");
      const runs = await queryRows(cx, "SELECT * FROM financial_year_close_runs WHERE company_id=? AND source_financial_year_id=? AND destination_financial_year_id=? ORDER BY id FOR UPDATE", [companyId, sourceId, scope.destination.id]);
      const previous = await queryRows(cx, "SELECT metadata FROM financial_year_events WHERE company_id=? AND financial_year_id=? AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.idempotency_key'))=? ORDER BY id", [companyId, sourceId, key]);
      if (previous.length) {
        const metadata = typeof previous[0].metadata === "string" ? JSON.parse(previous[0].metadata) : previous[0].metadata;
        if (metadata.request_fingerprint !== request) a.fail("ANNUAL_IDEMPOTENCY_CONFLICT");
        return { changed: false, replay: true, financialYear: scope.source, version: scope.version, close_run_id: metadata.close_run_id };
      }
      if (scope.version !== String(body.expected_version)) a.fail("ANNUAL_STALE_VERSION");
      if (action === "lock") {
        if (scope.source.status !== "CLOSED" || !runs.some(r => r.status === "FINALIZED")) a.fail("ANNUAL_FINALIZED_CLOSE_REQUIRED");
        const bridge = await require("./inventoryGlService").inspect(cx, companyId, day(scope.source.end_date), true);
        if (!bridge.ready) a.fail("ANNUAL_CLOSE_BLOCKED");
        await require("./annualJournalService").verify(cx, companyId, true);
        await a.write(cx, "UPDATE financial_years SET status='LOCKED' WHERE id=? AND company_id=? AND status='CLOSED'", [sourceId, companyId]);
        const result = await event(cx, companyId, scope, actor, "LOCK", "CLOSED", "LOCKED", body.reason, { idempotency_key: key, request_fingerprint: request });
        return { changed: true, financialYear: { ...scope.source, status: "LOCKED" }, version: String(result.insertId) };
      }
      if (scope.source.status !== (action === "begin" ? "RECONCILIATION" : "CLOSING")) a.fail("ANNUAL_CLOSE_STATE_INVALID");
      const preview = await loadPreview(cx, companyId, scope, true);
      if (!preview.ready) a.fail("ANNUAL_CLOSE_BLOCKED");
      if (preview.fingerprint !== body.preview_fingerprint) a.fail("ANNUAL_STALE_PREVIEW");
      const active = runs.filter(r => !["FAILED", "ROLLED_BACK"].includes(r.status));
      if (action === "begin") {
        if (active.length) a.fail("ANNUAL_CLOSE_ALREADY_EXISTS");
        const run = await a.write(cx, `INSERT INTO financial_year_close_runs (company_id,source_financial_year_id,destination_financial_year_id,generation_uuid,algorithm_version,source_fingerprint,status,started_by,validated_by,validated_at,attempt_no)
          VALUES (?,?,?,?,?,?,'READY',?,?,CURRENT_TIMESTAMP(6),?)`, [companyId, sourceId, scope.destination.id, key, ALGORITHM, preview.fingerprint, actor, actor, runs.length + 1]);
        await a.write(cx, "UPDATE financial_years SET status='CLOSING' WHERE id=? AND company_id=? AND status='RECONCILIATION'", [sourceId, companyId]);
        const result = await event(cx, companyId, scope, actor, "BEGIN_CLOSE", "RECONCILIATION", "CLOSING", body.reason,
          { idempotency_key: key, request_fingerprint: request, close_run_id: run.insertId, preview_fingerprint: preview.fingerprint, algorithm: ALGORITHM });
        await a.write(cx, `INSERT INTO financial_year_close_events (company_id,close_run_id,source_financial_year_id,destination_financial_year_id,generation_uuid,event_sequence,event_type,new_status,actor_user_id,request_identity,source_fingerprint,algorithm_version,metadata)
          VALUES (?,?,?,?,?,1,'READY','READY',?,?,?,?,?)`, [companyId, run.insertId, sourceId, scope.destination.id, key, actor, key, preview.fingerprint, ALGORITHM, JSON.stringify({ request_fingerprint: request })]);
        return { changed: true, financialYear: { ...scope.source, status: "CLOSING" }, version: String(result.insertId), close_run_id: run.insertId, fingerprint: preview.fingerprint };
      }
      if (active.length !== 1 || active[0].status !== "READY" || active[0].source_fingerprint !== preview.fingerprint || active[0].algorithm_version !== ALGORITHM) a.fail("ANNUAL_STALE_PREVIEW");
      const run = active[0];
      const closing = await writeCloseJournal(cx, companyId, scope, run.id, actor, preview, false);
      const opening = await writeCloseJournal(cx, companyId, scope, run.id, actor, preview, true);
      for (const line of preview.accounting) await a.write(cx, `INSERT INTO financial_year_close_lines
        (company_id,close_run_id,account_id,account_type,classification,source_closing_signed_balance,closing_journal_debit,closing_journal_credit,post_close_signed_balance,destination_opening_signed_balance,
          opening_journal_debit,opening_journal_credit,closing_journal_entry_id,closing_journal_detail_id,opening_journal_entry_id,opening_journal_detail_id,fingerprint_component)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [companyId, run.id, line.account_id, line.account_type, line.classification, line.source_closing_signed_balance,
        line.closing_journal_debit, line.closing_journal_credit, line.destination_opening_signed_balance, line.destination_opening_signed_balance, line.opening_journal_debit, line.opening_journal_credit,
        closing.details.has(line.account_id) ? closing.id : null, closing.details.get(line.account_id) || null,
        opening.details.has(line.account_id) ? opening.id : null, opening.details.get(line.account_id) || null, a.digest(line)]);
      for (const type of ["AR", "AP"]) {
        const items = preview.subledger.filter(x => x.party_type === (type === "AR" ? "CUSTOMER" : "VENDOR"));
        const snap = await a.write(cx, `INSERT INTO financial_year_subledger_snapshots (company_id,close_run_id,source_financial_year_id,cutoff_date,snapshot_type,total_amount,item_count,fingerprint) VALUES (?,?,?,?,?,?,?,?)`,
          [companyId, run.id, sourceId, day(scope.source.end_date), type, a.money(items.reduce((s, x) => s + a.minor(x.amount), 0n)), items.length, a.digest(items)]);
        for (const item of items) {
          await a.write(cx, `INSERT INTO financial_year_subledger_snapshot_items (company_id,snapshot_id,snapshot_type,party_type,customer_id,vendor_id,source_document_type,invoice_id,bill_id,subledger_opening_item_id,
            original_amount,allocated_amount_through_cutoff,residual_amount,effective_date,due_date,fingerprint_component) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [companyId, snap.insertId, type, item.party_type, type === "AR" ? item.party_id : null, type === "AP" ? item.party_id : null,
            item.predecessor_opening_item_id ? "LEGACY_OPENING_ITEM" : type === "AR" ? "INVOICE" : "BILL",
            item.predecessor_opening_item_id ? null : item.original_invoice_id, item.predecessor_opening_item_id ? null : item.original_bill_id,
            item.predecessor_opening_item_id, item.original_amount, item.allocated_amount, item.amount, item.effective_date, item.due_date, a.digest(item)]);
          await a.write(cx, `INSERT INTO subledger_opening_items
            (company_id,party_type,customer_id,vendor_id,origin,entry_kind,reference,effective_date,due_date,original_amount,direction,financial_year_id,opening_journal_entry_id,source_identity,created_by,
              original_invoice_id,original_bill_id,original_opening_item_id,original_financial_year_id,predecessor_opening_item_id,close_run_id,carry_source_financial_year_id)
            VALUES (?,?,?,?,'ANNUAL_CARRY_FORWARD','ORIGINAL',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [companyId, item.party_type, type === "AR" ? item.party_id : null, type === "AP" ? item.party_id : null, item.reference, day(scope.destination.start_date), item.due_date, item.amount,
            type === "AR" ? "DEBIT" : "CREDIT", scope.destination.id, opening.id, `annual:${run.id}:${a.digest(item)}`, actor, item.original_invoice_id, item.original_bill_id,
            item.original_opening_item_id, item.original_financial_year_id, item.predecessor_opening_item_id, run.id, sourceId]);
        }
      }
      const inv = await a.write(cx, `INSERT INTO financial_year_inventory_snapshots (company_id,close_run_id,source_financial_year_id,cutoff_date,valuation_mode,total_quantity,item_count,fingerprint)
        VALUES (?,?,?,?,'REQUIRED',?,?,?)`, [companyId, run.id, sourceId, day(scope.source.end_date), qty(preview.inventory.reduce((s, x) => s + quantity(x.quantity_at_cutoff), 0n)), preview.inventory.length, a.digest(preview.inventory)]);
      for (const item of preview.inventory) await a.write(cx, "INSERT INTO financial_year_inventory_snapshot_items (company_id,inventory_snapshot_id,product_id,quantity_at_cutoff,valuation_amount,input_version,fingerprint_component) VALUES (?,?,?,?,?,?,?)",
        [companyId, inv.insertId, item.product_id, item.quantity_at_cutoff, item.valuation_amount, ALGORITHM, a.digest(item)]);
      for (const type of ["GL_BALANCE", "PNL_ZERO", "PERMANENT_BALANCE", "AR_CONTROL", "AP_CONTROL", "INVENTORY", "OPENING_JOURNAL", "FINGERPRINT", "FY_PAIR"]) await a.write(cx,
        `INSERT INTO financial_year_close_reconciliations (company_id,close_run_id,reconciliation_type,status,evidence_fingerprint,algorithm_version,checked_by,details) VALUES (?,?,?,'PASSED',?,?,?,?)`,
        [companyId, run.id, type, preview.fingerprint, ALGORITHM, actor, JSON.stringify({ ar_variance: preview.ar_variance, ap_variance: preview.ap_variance })]);
      await a.write(cx, `UPDATE financial_year_close_runs SET status='FINALIZED',closing_journal_entry_id=?,opening_journal_entry_id=?,finalized_by=?,finalized_at=CURRENT_TIMESTAMP(6),lock_version=lock_version+1
        WHERE id=? AND company_id=? AND status='READY' AND source_fingerprint=? AND lock_version=?`, [closing.id, opening.id, actor, run.id, companyId, preview.fingerprint, run.lock_version]);
      await require("./annualJournalService").verify(cx, companyId, true);
      await a.write(cx, "UPDATE financial_years SET status='CLOSED' WHERE id=? AND company_id=? AND status='CLOSING'", [sourceId, companyId]);
      const result = await event(cx, companyId, scope, actor, "CLOSE", "CLOSING", "CLOSED", body.reason,
        { idempotency_key: key, request_fingerprint: request, close_run_id: run.id, preview_fingerprint: preview.fingerprint });
      await a.write(cx, `INSERT INTO financial_year_close_events (company_id,close_run_id,source_financial_year_id,destination_financial_year_id,generation_uuid,event_sequence,event_type,previous_status,new_status,actor_user_id,request_identity,source_fingerprint,algorithm_version,metadata)
        VALUES (?,?,?,?,?,2,'FINALIZED','READY','FINALIZED',?,?,?,?,?)`, [companyId, run.id, sourceId, scope.destination.id, run.generation_uuid, actor, key, preview.fingerprint, ALGORITHM, JSON.stringify({ request_fingerprint: request })]);
      return { changed: true, financialYear: { ...scope.source, status: "CLOSED" }, version: String(result.insertId), close_run_id: run.id };
    });
  };
  return { readiness: (company, sourceId, actor) => inspect(company, sourceId, actor), preview: (company, sourceId, actor) => inspect(company, sourceId, actor, true),
    begin: (company, sourceId, actor, body) => mutate(company, sourceId, actor, body, "begin"),
    finalize: (company, sourceId, actor, body) => mutate(company, sourceId, actor, body, "finalize"), lock: (company, sourceId, actor, body) => mutate(company, sourceId, actor, body, "lock") };
};
module.exports = { ALGORITHM, adjacentDate, quantity, qty, buildPreview, createFinancialYearCloseService };
