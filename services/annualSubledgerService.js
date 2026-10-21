"use strict";

const { createHash } = require("node:crypto");
const error = (code, status = 409) => Object.assign(new Error("Annual subledger operation cannot be completed"), { code, status });
const fail = (code, status) => { throw error(code, status); };
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const id = value => {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) fail("ANNUAL_INVALID_ID", 400);
  return n;
};
const minor = value => {
  const s = String(value ?? "");
  if (!/^-?\d{1,13}(?:\.\d{1,2})?$/.test(s)) fail("ANNUAL_INVALID_AMOUNT", 400);
  const negative = s.startsWith("-");
  const [whole, fraction = ""] = s.replace(/^-/, "").split(".");
  return (negative ? -1n : 1n) * (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0")));
};
const money = value => `${value < 0n ? "-" : ""}${(value < 0n ? -value : value) / 100n}.${String((value < 0n ? -value : value) % 100n).padStart(2, "0")}`;
const uuid = value => {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) fail("ANNUAL_INVALID_KEY", 400);
  return value.toLowerCase();
};
const date = value => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) fail("ANNUAL_INVALID_DATE", 400);
  return value;
};
const write = async (cx, sql, args, expected = 1) => {
  const [result] = await cx.query(sql, args);
  if (result.affectedRows !== expected) fail("ANNUAL_WRITE_CONFLICT");
  return result;
};
const transaction = async (executor, work) => {
  const cx = await executor.getConnection();
  let commitStarted = false;
  let disposed = false;
  try {
    await cx.beginTransaction();
    const result = await work(cx);
    commitStarted = true;
    await cx.commit();
    return result;
  } catch (e) {
    if (commitStarted) {
      disposed = true;
      cx.destroy?.();
      throw error("ANNUAL_COMMIT_UNCERTAIN", 503);
    }
    try { await cx.rollback(); } catch { disposed = true; cx.destroy?.(); }
    throw e.code?.startsWith("ANNUAL_") ? e : error("ANNUAL_OPERATION_FAILED", 503);
  } finally { if (!disposed) cx.release?.(); }
};

const normalizeSelection = body => {
  if (body.allocations !== undefined || body.invoice_id || body.bill_id) fail("ANNUAL_MIXED_SELECTION", 400);
  if (!Array.isArray(body.opening_allocations) || !body.opening_allocations.length || body.opening_allocations.length > 100) fail("ANNUAL_MANUAL_SELECTION_REQUIRED", 400);
  const selection = body.opening_allocations.map(row => ({ id: id(row.opening_item_id), amount: money(minor(row.amount)), expectedRemaining: money(minor(row.expected_remaining)) })).sort((a, b) => a.id - b.id);
  if (new Set(selection.map(row => row.id)).size !== selection.length || selection.some(row => minor(row.amount) <= 0n)) fail("ANNUAL_INVALID_SELECTION", 400);
  if (selection.reduce((sum, row) => sum + minor(row.amount), 0n) !== minor(body.amount)) fail("ANNUAL_ALLOCATION_TOTAL_MISMATCH", 400);
  return selection;
};

const assertOpeningItemScope = (item, { companyId, fyId, partyId, partyType }) => {
  if (Number(item.company_id) !== Number(companyId) || Number(item.financial_year_id) !== Number(fyId)
    || item.party_type !== partyType || Number(item[partyType === "CUSTOMER" ? "customer_id" : "vendor_id"]) !== Number(partyId)
    || item.origin !== "ANNUAL_CARRY_FORWARD" || item.entry_kind !== "ORIGINAL") fail("ANNUAL_ITEM_SCOPE_MISMATCH");
};
const assertExpectedBalance = (balance, selected) => {
  if (balance !== selected.expectedRemaining) fail("ANNUAL_STALE_BALANCE");
  if (minor(selected.amount) > minor(balance)) fail("ANNUAL_OVER_ALLOCATION");
};
const assertReplayMatches = (prior, selection, fingerprint) => {
  if (prior.length !== selection.length || prior.some(row => row.request_fingerprint !== fingerprint)) fail("ANNUAL_IDEMPOTENCY_CONFLICT");
};

const lockScope = async (cx, companyId, userId, businessDate, owner = false) => {
  const [companies] = await cx.query("SELECT id FROM companies WHERE id=? FOR UPDATE", [companyId]);
  if (companies.length !== 1) fail("ANNUAL_SCOPE_NOT_FOUND", 404);
  const [memberships] = await cx.query(`SELECT membership_role FROM user_company_memberships WHERE company_id=? AND user_id=? AND is_active=1 LIMIT 2 FOR SHARE`, [companyId, userId]);
  if (memberships.length !== 1 || (owner && memberships[0].membership_role !== "owner")) fail("ANNUAL_NOT_AUTHORIZED", 403);
  const [years] = await cx.query("SELECT id,status FROM financial_years WHERE company_id=? AND ? BETWEEN start_date AND end_date ORDER BY id FOR UPDATE", [companyId, date(businessDate)]);
  if (years.length !== 1 || years[0].status !== "OPEN") fail("ANNUAL_OPEN_FY_REQUIRED");
  return id(years[0].id);
};

const remaining = async (cx, row, cutoff) => {
  const [totals] = await cx.query(`SELECT COALESCE(SUM(a.amount),0) allocated,
    COALESCE(SUM(CASE WHEN r.reversal_date<=? THEN r.amount ELSE 0 END),0) reversed
    FROM annual_subledger_allocations a LEFT JOIN annual_subledger_allocation_reversals r
      ON r.allocation_id=a.id AND r.company_id=a.company_id
    WHERE a.opening_item_id=? AND a.company_id=? AND a.settlement_date<=?`, [cutoff, row.id, row.company_id, cutoff]);
  const value = minor(row.original_amount) - minor(totals[0].allocated) + minor(totals[0].reversed);
  if (value < 0n || value > minor(row.original_amount)) fail("ANNUAL_BALANCE_INVALID");
  return money(value);
};

const journal = async (cx, { companyId, fyId, key, businessDate, actor, debitAccount, creditAccount, amount, source = "annual_settlement" }) => {
  if (debitAccount === creditAccount) fail("ANNUAL_ACCOUNT_INVALID");
  const prefix = source === "annual_settlement_reversal" ? "ACFR" : "ACF";
  const r = await write(cx, `INSERT INTO journal_entries
    (company_id,financial_year_id,journal_no,journal_date,narration,total_debit,total_credit,created_by,source_type,source_id)
    VALUES (?,?,?,?,?,?,?,?,?,NULL)`, [companyId, fyId, `${prefix}-${key}`, businessDate, "Annual subledger settlement", amount, amount, actor, source]);
  await write(cx, `INSERT INTO journal_entry_details (journal_entry_id,account_id,debit,credit,description)
    VALUES (?,?,?,0,?),(?,?,0,?,?)`, [r.insertId, debitAccount, amount, "Annual subledger", r.insertId, creditAccount, amount, "Annual subledger"], 2);
  return r.insertId;
};

const postSettlement = async (cx, body, user, partyType) => {
  const schema = await require("./annualSubledgerReadinessService").inspectAnnualSchema(cx);
  if (!schema.ready) fail("ANNUAL_SCHEMA_NOT_READY", 503);
  if (body.financial_year_id !== undefined || body.company_id !== undefined) fail("ANNUAL_CLIENT_SCOPE_FORBIDDEN", 400);
  const companyId = id(user.company_id), actor = id(user.user_id || user.id);
  const partyId = id(partyType === "CUSTOMER" ? body.customer_id : body.vendor_id);
  const selection = normalizeSelection(body), key = uuid(body.idempotency_key);
  const businessDate = date(partyType === "CUSTOMER" ? body.receipt_date : body.payment_date);
  const cashId = id(partyType === "CUSTOMER" ? body.received_in_account_id : body.paid_from_account_id);
  const fingerprint = digest({ partyType, partyId, businessDate, cashId, selection, method: body.payment_mode || body.payment_method, reference: body.reference_number || null });
  const fyId = await lockScope(cx, companyId, actor, businessDate);
  const [prior] = await cx.query("SELECT * FROM annual_subledger_allocations WHERE company_id=? AND idempotency_key=? ORDER BY opening_item_id FOR UPDATE", [companyId, key]);
  if (prior.length) {
    assertReplayMatches(prior, selection, fingerprint);
    return { duplicate: true, id: prior[0].receipt_entry_id || prior[0].vendor_payment_id, journal_entry_id: prior[0].journal_entry_id };
  }
  const [items] = await cx.query(`SELECT * FROM subledger_opening_items WHERE company_id=? AND id IN (${selection.map(() => "?").join(",")}) ORDER BY id FOR UPDATE`, [companyId, ...selection.map(row => row.id)]);
  if (items.length !== selection.length) fail("ANNUAL_ITEM_NOT_FOUND", 404);
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    assertOpeningItemScope(item, { companyId, fyId, partyId, partyType });
    const balance = await remaining(cx, item, "9999-12-31");
    assertExpectedBalance(balance, selection[i]);
  }
  const role = partyType === "CUSTOMER" ? "ACCOUNTS_RECEIVABLE" : "ACCOUNTS_PAYABLE";
  const receivable = partyType === "CUSTOMER"
    ? await require("./accountsReceivableResolver").resolveAccountsReceivable(cx, companyId, fyId) : null;
  const [accounts] = await cx.query(`SELECT a.*,p.account_name parent_account_name,r.role FROM accounts a
    LEFT JOIN accounts p ON p.id=a.parent_account_id AND p.company_id=a.company_id
    LEFT JOIN system_account_role_assignments r
    ON r.account_id=a.id AND r.company_id=a.company_id
      AND (SELECT fy.start_date FROM financial_years fy WHERE fy.id=?) >=
          (SELECT fy.start_date FROM financial_years fy WHERE fy.id=r.effective_from_financial_year_id)
      AND (r.effective_to_financial_year_id IS NULL OR
          (SELECT fy.end_date FROM financial_years fy WHERE fy.id=?) <=
          (SELECT fy.end_date FROM financial_years fy WHERE fy.id=r.effective_to_financial_year_id))
    WHERE a.company_id=? AND a.status=1 AND (a.id=? OR r.role=?) ORDER BY a.id FOR UPDATE`, [fyId, fyId, companyId, cashId, role]);
  const cash = accounts.find(row => Number(row.id) === cashId && ["CASH", "BANK"].includes(row.role) && row.account_type === "ASSET");
  const controls = receivable ? [receivable] : accounts.filter(row => row.role === role && row.account_type === "LIABILITY");
  if (!cash || controls.length !== 1) fail("ANNUAL_ACCOUNT_ROLE_REQUIRED");
  if (partyType === "CUSTOMER") {
    const receiptService = require("./receiptEntryService");
    const method = receiptService.normalizePaymentMethod(body.payment_mode || body.payment_method || "cash");
    receiptService.validateReceiptDestination(cash, method);
  } else {
    const vendorService = require("./vendorPaymentService");
    if (!vendorService.METHODS.includes(body.payment_method)) fail("ANNUAL_PAYMENT_METHOD_INVALID", 400);
    const { isCashBankAccount } = require("./receiptEntryService");
    if (!isCashBankAccount(cash)) fail("ANNUAL_ACCOUNT_INVALID", 400);
  }
  const amount = money(minor(body.amount));
  const journalId = await journal(cx, { companyId, fyId, key, businessDate, actor, amount,
    debitAccount: partyType === "CUSTOMER" ? cashId : controls[0].id, creditAccount: partyType === "CUSTOMER" ? controls[0].id : cashId });
  let payment;
  if (partyType === "CUSTOMER") {
    payment = await write(cx, `INSERT INTO receipt_entries (receipt_number,receipt_date,receipt_type,customer_id,received_in_account_id,received_from_account_id,
      amount,payment_mode,reference_number,narration,company_id,created_by,journal_entry_id,idempotency_key)
      VALUES (?,?,'CUSTOMER',?,?,?,?,?,?,?,?,?,?,?)`, [`ACF-${key}`, businessDate, partyId, cashId, controls[0].id, amount,
      body.payment_mode || "cash", body.reference_number || null, "Annual opening settlement", companyId, actor, journalId, key]);
  } else {
    payment = await write(cx, `INSERT INTO vendor_payments (vendor_id,amount,payment_date,payment_method,paid_from_account_id,reference_number,notes,
      company_id,financial_year_id,created_by,journal_entry_id,idempotency_key,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'SUCCESS')`,
      [partyId, amount, businessDate, body.payment_method || "cash", cashId, body.reference_number || null, "Annual opening settlement", companyId, fyId, actor, journalId, key]);
    await write(cx, `INSERT INTO ledger_entries
      (company_id,financial_year_id,entity_type,entity_id,reference_type,reference_id,debit,credit,transaction_date)
      VALUES (?,?,'vendor',?,'annual_subledger_payment',?,0,?,?)`, [companyId, fyId, partyId, payment.insertId, amount, businessDate]);
  }
  for (const item of selection) await write(cx, `INSERT INTO annual_subledger_allocations
    (company_id,financial_year_id,opening_item_id,party_type,customer_id,vendor_id,amount,settlement_date,
      receipt_entry_id,receipt_company_id,receipt_journal_entry_id,vendor_payment_id,journal_entry_id,idempotency_key,request_fingerprint,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [companyId, fyId, item.id, partyType,
    partyType === "CUSTOMER" ? partyId : null, partyType === "VENDOR" ? partyId : null, item.amount, businessDate,
    partyType === "CUSTOMER" ? payment.insertId : null, partyType === "CUSTOMER" ? companyId : null,
    partyType === "CUSTOMER" ? journalId : null, partyType === "VENDOR" ? payment.insertId : null, journalId, key, fingerprint, actor]);
  return { duplicate: false, id: payment.insertId, payment_id: partyType === "VENDOR" ? payment.insertId : null, journal_entry_id: journalId };
};

const listOpenings = async (executor, companyId, partyType, partyId, businessDate) => {
  companyId = id(companyId); partyId = id(partyId); businessDate = date(businessDate);
  if (!["CUSTOMER", "VENDOR"].includes(partyType)) fail("ANNUAL_INVALID_PARTY", 400);
  const [rows] = await executor.query(`SELECT o.*,i.invoice_number,b.bill_number FROM subledger_opening_items o
    JOIN financial_years fy ON fy.id=o.financial_year_id AND fy.company_id=o.company_id
    LEFT JOIN invoices i ON i.id=o.original_invoice_id AND i.company_id=o.company_id
    LEFT JOIN bills b ON b.id=o.original_bill_id AND b.company_id=o.company_id
    WHERE o.company_id=? AND o.party_type=? AND o.${partyType === "CUSTOMER" ? "customer_id" : "vendor_id"}=?
      AND o.origin='ANNUAL_CARRY_FORWARD' AND o.entry_kind='ORIGINAL' AND fy.status='OPEN'
      AND ? BETWEEN fy.start_date AND fy.end_date ORDER BY o.id`, [companyId, partyType, partyId, businessDate]);
  const result = [];
  for (const row of rows) {
    const balance = await remaining(executor, row, businessDate);
    if (minor(balance) > 0n) result.push({ opening_item_id: row.id, reference: row.invoice_number || row.bill_number || row.reference,
      original_financial_year_id: row.original_financial_year_id, financial_year_id: row.financial_year_id, remaining_amount: balance });
  }
  return result;
};
const reverseSettlement = async (cx, body, user) => {
  const schema = await require("./annualSubledgerReadinessService").inspectAnnualSchema(cx);
  if (!schema.ready) fail("ANNUAL_SCHEMA_NOT_READY", 503);
  const companyId = id(user.company_id), actor = id(user.user_id || user.id), paymentId = id(body.payment_id);
  const partyType = body.party_type;
  if (!["CUSTOMER", "VENDOR"].includes(partyType)) fail("ANNUAL_INVALID_PARTY", 400);
  const key = uuid(body.idempotency_key), businessDate = date(body.reversal_date);
  const reason = String(body.reason || "").trim();
  if (!reason || reason.length > 500 || body.confirmation !== "REVERSE") fail("ANNUAL_REVERSAL_CONFIRMATION_REQUIRED", 400);
  const fyId = await lockScope(cx, companyId, actor, businessDate, true);
  const [allocations] = await cx.query(`SELECT * FROM annual_subledger_allocations WHERE company_id=? AND ${partyType === "CUSTOMER" ? "receipt_entry_id" : "vendor_payment_id"}=? ORDER BY opening_item_id`, [companyId, paymentId]);
  if (!allocations.length || allocations.some(row => Number(row.financial_year_id) !== fyId || row.party_type !== partyType)) fail("ANNUAL_ITEM_SCOPE_MISMATCH");
  await cx.query(`SELECT id FROM subledger_opening_items WHERE company_id=? AND id IN (${allocations.map(() => "?").join(",")}) ORDER BY id FOR UPDATE`, [companyId, ...allocations.map(row => row.opening_item_id)]);
  const fingerprint = digest({ paymentId, partyType, businessDate, reason });
  const [prior] = await cx.query(`SELECT * FROM annual_subledger_allocation_reversals WHERE company_id=? AND allocation_id IN (${allocations.map(() => "?").join(",")}) ORDER BY allocation_id FOR UPDATE`, [companyId, ...allocations.map(row => row.id)]);
  if (prior.length) {
    if (prior.length !== allocations.length || prior.some(row => row.idempotency_key !== key || row.request_fingerprint !== fingerprint)) fail("ANNUAL_IDEMPOTENCY_CONFLICT");
    return { duplicate: true, journal_entry_id: prior[0].reversal_journal_entry_id };
  }
  const [lines] = await cx.query("SELECT account_id,debit,credit FROM journal_entry_details WHERE journal_entry_id=? ORDER BY id FOR UPDATE", [allocations[0].journal_entry_id]);
  if (lines.length !== 2 || !lines.some(row => minor(row.debit) > 0n) || !lines.some(row => minor(row.credit) > 0n)) fail("ANNUAL_ACCOUNT_INVALID");
  const total = allocations.reduce((sum, row) => sum + minor(row.amount), 0n);
  if (lines.reduce((sum, row) => sum + minor(row.debit), 0n) !== total || lines.reduce((sum, row) => sum + minor(row.credit), 0n) !== total) fail("ANNUAL_BALANCE_INVALID");
  const journalId = await journal(cx, { companyId, fyId, key, businessDate, actor, amount: money(total),
    debitAccount: lines.find(row => minor(row.credit) > 0n).account_id, creditAccount: lines.find(row => minor(row.debit) > 0n).account_id, source: "annual_settlement_reversal" });
  for (const row of allocations) await write(cx, `INSERT INTO annual_subledger_allocation_reversals
    (company_id,financial_year_id,allocation_id,amount,reversal_date,reversal_journal_entry_id,idempotency_key,request_fingerprint,reason,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?)`, [companyId, fyId, row.id, row.amount, businessDate, journalId, key, fingerprint, reason, actor]);
  return { duplicate: false, journal_entry_id: journalId };
};
module.exports = { error, fail, digest, id, minor, money, uuid, date, write, transaction, normalizeSelection, assertOpeningItemScope, assertExpectedBalance, assertReplayMatches, lockScope, remaining, journal, postSettlement, listOpenings, reverseSettlement };
