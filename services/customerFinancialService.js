const db = require("../db/connection");
const { moneyToMinor, minorToMoney } = require("./receiptEntryService");

const CUSTOMER_SQL = `
  SELECT id, name, credit_period_days, credit_limit
  FROM customers
  WHERE id = ? AND company_id = ?
  LIMIT 1`;

const ELIGIBLE_INVOICES_SQL = `
  SELECT
    i.id AS invoice_id,
    i.invoice_number,
    i.invoice_type,
    i.invoice_date,
    i.due_date,
    i.total_amount,
    COALESCE(payment_totals.paid_amount, 0.00) AS paid_amount,
    CASE
      WHEN i.due_date IS NULL THEN NULL
      WHEN i.due_date < CURRENT_DATE THEN DATEDIFF(CURRENT_DATE, i.due_date)
      ELSE 0
    END AS overdue_days
  FROM invoices i
  LEFT JOIN (
    SELECT company_id, invoice_id, SUM(amount) AS paid_amount
    FROM payments
    WHERE company_id = ?
    GROUP BY company_id, invoice_id
  ) payment_totals
    ON payment_totals.company_id = i.company_id
   AND payment_totals.invoice_id = i.id
  WHERE i.company_id = ?
    AND i.customer_id = ?
    AND (i.invoice_type = 'CREDIT' OR i.invoice_type IS NULL)
    AND LOWER(COALESCE(i.status, 'pending')) <> 'cancelled'
  ORDER BY
    CASE WHEN i.due_date IS NULL THEN 1 ELSE 0 END,
    i.due_date ASC,
    i.invoice_date ASC,
    i.id ASC`;

const ADVANCE_BALANCE_SQL = `
  SELECT COALESCE(SUM(unapplied_amount), 0.00) AS unapplied_advance_balance
  FROM customer_advances
  WHERE company_id = ?
    AND customer_id = ?
    AND status IN ('UNAPPLIED', 'PARTIALLY_APPLIED')`;

const ANNUAL_CUSTOMER_OPENINGS_SQL = `
  SELECT o.id AS opening_item_id,o.predecessor_opening_item_id,o.original_invoice_id,o.original_opening_item_id,
    o.original_financial_year_id,o.financial_year_id,o.reference,o.effective_date,o.due_date,
    o.original_amount,i.invoice_number,
    COALESCE((SELECT SUM(a.amount) FROM annual_subledger_allocations a
      WHERE a.company_id=o.company_id AND a.opening_item_id=o.id),0) AS allocated_amount,
    COALESCE((SELECT SUM(r.amount) FROM annual_subledger_allocation_reversals r
      JOIN annual_subledger_allocations a ON a.id=r.allocation_id AND a.company_id=r.company_id
      WHERE a.company_id=o.company_id AND a.opening_item_id=o.id),0) AS reversed_amount
  FROM subledger_opening_items o
  LEFT JOIN invoices i ON i.id=o.original_invoice_id AND i.company_id=o.company_id
  WHERE o.company_id=? AND o.party_type='CUSTOMER' AND o.customer_id=?
    AND o.origin='ANNUAL_CARRY_FORWARD' AND o.entry_kind='ORIGINAL'
  ORDER BY o.id`;

const PAYMENT_HISTORY_SQL = `
  SELECT
    re.id AS receipt_entry_id,
    re.receipt_number,
    re.receipt_date,
    re.receipt_type,
    re.amount,
    re.payment_mode,
    re.received_in_account_id,
    received_in.account_name AS received_in_account_name,
    received_in.account_code AS received_in_account_code,
    re.reference_number,
    re.narration,
    COUNT(DISTINCT p.id) + COALESCE(MAX(annual.allocation_count), 0) AS allocation_count,
    COALESCE(SUM(p.amount), 0.00) + COALESCE(MAX(annual.allocated_amount), 0.00) AS allocated_amount,
    GROUP_CONCAT(DISTINCT i.invoice_number ORDER BY i.invoice_number SEPARATOR '||')
      AS invoice_numbers,
    COALESCE(advance_totals.unapplied_amount, 0.00) AS unapplied_amount,
    annual.opening_references AS opening_references
  FROM receipt_entries re
  INNER JOIN accounts received_in
    ON received_in.id = re.received_in_account_id
   AND received_in.company_id = re.company_id
  LEFT JOIN payments p
    ON p.receipt_entry_id = re.id
   AND p.company_id = re.company_id
   AND re.receipt_type = 'CUSTOMER'
  LEFT JOIN invoices i
    ON i.id = p.invoice_id
   AND i.company_id = p.company_id
  LEFT JOIN (
    SELECT a.company_id,a.receipt_entry_id,COUNT(*) allocation_count,SUM(a.amount-COALESCE(r.reversed_amount,0)) allocated_amount,
      GROUP_CONCAT(DISTINCT COALESCE(i.invoice_number,o.reference) ORDER BY o.id SEPARATOR '||') opening_references
    FROM annual_subledger_allocations a
    JOIN subledger_opening_items o ON o.id=a.opening_item_id AND o.company_id=a.company_id
    LEFT JOIN invoices i ON i.id=o.original_invoice_id AND i.company_id=o.company_id
    LEFT JOIN (SELECT allocation_id,company_id,SUM(amount) reversed_amount FROM annual_subledger_allocation_reversals GROUP BY allocation_id,company_id) r
      ON r.allocation_id=a.id AND r.company_id=a.company_id
    WHERE a.party_type='CUSTOMER' AND a.receipt_entry_id IS NOT NULL
    GROUP BY a.company_id,a.receipt_entry_id
  ) annual ON annual.company_id=re.company_id AND annual.receipt_entry_id=re.id
  LEFT JOIN (
    SELECT company_id, customer_id, receipt_entry_id, SUM(unapplied_amount) AS unapplied_amount
    FROM customer_advances
    GROUP BY company_id, customer_id, receipt_entry_id
  ) advance_totals
    ON advance_totals.receipt_entry_id = re.id
   AND advance_totals.company_id = re.company_id
   AND advance_totals.customer_id = re.customer_id
  WHERE re.company_id = ?
    AND re.customer_id = ?
    AND re.receipt_type IN ('CUSTOMER', 'ADVANCE')
  GROUP BY
    re.id, re.receipt_number, re.receipt_date, re.receipt_type, re.amount,
    re.payment_mode, re.received_in_account_id, received_in.account_name,
    received_in.account_code, re.reference_number, re.narration,
    advance_totals.unapplied_amount, annual.opening_references
  ORDER BY re.receipt_date DESC, re.id DESC
  LIMIT ? OFFSET ?`;

const normalizeDateOnly = (value) => {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const year = String(value.getFullYear()).padStart(4, "0");
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})(?:[ T].*)?$/);
  return match ? match[1] : null;
};

const normalizeInvoice = (row) => {
  const totalMinor = moneyToMinor(row.total_amount || 0, "Invoice total");
  const paidMinor = moneyToMinor(row.paid_amount || 0, "Paid amount");
  const outstandingMinor = Math.max(totalMinor - paidMinor, 0);
  const overdueDays = row.overdue_days === null || row.overdue_days === undefined
    ? null
    : Math.max(Number(row.overdue_days), 0);
  const isOverdue = outstandingMinor > 0 && overdueDays !== null && overdueDays > 0;

  return {
    invoice_id: Number(row.invoice_id),
    invoice_number: row.invoice_number,
    invoice_type: row.invoice_type || null,
    invoice_date: normalizeDateOnly(row.invoice_date),
    due_date: normalizeDateOnly(row.due_date),
    total_amount: minorToMoney(totalMinor),
    paid_amount: minorToMoney(paidMinor),
    outstanding_amount: minorToMoney(outstandingMinor),
    payment_status: paidMinor <= 0
      ? "UNPAID"
      : paidMinor < totalMinor
        ? "PARTIAL"
        : "PAID",
    is_overdue: isOverdue,
    overdue_days: overdueDays,
    _totalMinor: totalMinor,
    _paidMinor: paidMinor,
    _outstandingMinor: outstandingMinor,
  };
};

const buildFinancialSummary = (customer, invoiceRows, advanceAmount, annualOpeningRows = []) => {
  const invoices = invoiceRows.map(normalizeInvoice);
  const annual = annualOpeningRows.map((row) => {
    const original = moneyToMinor(row.original_amount || 0, "Opening amount");
    const allocated = moneyToMinor(row.allocated_amount || 0, "Opening allocations");
    const reversed = moneyToMinor(row.reversed_amount || 0, "Opening reversals");
    const remaining = original - allocated + reversed;
    if (remaining < 0 || remaining > original) throw new Error("Annual opening balance is invalid");
    return { ...row, remaining, netAllocated: allocated - reversed };
  });
  const carriedInvoiceIds = new Set(annual.filter((row) => row.original_invoice_id).map((row) => Number(row.original_invoice_id)));
  const totals = invoices.reduce(
    (result, invoice) => ({
      invoiced: result.invoiced + invoice._totalMinor,
      received: result.received + invoice._paidMinor,
      outstanding: result.outstanding + (!carriedInvoiceIds.has(invoice.invoice_id) ? invoice._outstandingMinor : 0),
      overdue: result.overdue + (!carriedInvoiceIds.has(invoice.invoice_id) && invoice.is_overdue ? invoice._outstandingMinor : 0),
      outstandingCount: result.outstandingCount + (!carriedInvoiceIds.has(invoice.invoice_id) && invoice._outstandingMinor > 0 ? 1 : 0),
      overdueCount: result.overdueCount + (!carriedInvoiceIds.has(invoice.invoice_id) && invoice.is_overdue ? 1 : 0),
    }),
    { invoiced: 0, received: 0, outstanding: 0, overdue: 0, outstandingCount: 0, overdueCount: 0 }
  );

  const outstandingInvoices = invoices
    .filter((invoice) => invoice._outstandingMinor > 0 && !carriedInvoiceIds.has(invoice.invoice_id))
    .map(({ _totalMinor, _paidMinor, _outstandingMinor, ...invoice }) => invoice);
  const carriedForwardLeaves = annual.filter((row) => !annual.some((child) => Number(child.predecessor_opening_item_id) === Number(row.opening_item_id)));
  carriedForwardLeaves.filter((row) => row.remaining > 0).forEach((row) => outstandingInvoices.push({
    invoice_id: null,
    opening_item_id: Number(row.opening_item_id),
    invoice_number: row.invoice_number || row.reference,
    source_type: "ANNUAL_CARRY_FORWARD",
    original_invoice_id: row.original_invoice_id === null ? null : Number(row.original_invoice_id),
    original_financial_year_id: Number(row.original_financial_year_id),
    invoice_date: normalizeDateOnly(row.effective_date),
    due_date: normalizeDateOnly(row.due_date),
    total_amount: minorToMoney(row.remaining),
    paid_amount: 0,
    outstanding_amount: minorToMoney(row.remaining),
    payment_status: "UNPAID",
    is_overdue: Boolean(row.due_date && normalizeDateOnly(row.due_date) < new Date().toISOString().slice(0, 10)),
    overdue_days: null,
  }));
  const annualReceived = annual.reduce((sum, row) => sum + row.netAllocated, 0);
  const annualInvoiced = annual.filter((row) => !row.original_invoice_id && !row.predecessor_opening_item_id)
    .reduce((sum, row) => sum + moneyToMinor(row.original_amount || 0, "Opening amount"), 0);

  return {
    customer: {
      id: Number(customer.id),
      name: customer.name,
      credit_period_days: Number(customer.credit_period_days || 0),
      credit_limit: minorToMoney(moneyToMinor(customer.credit_limit || 0, "Credit limit")),
    },
    summary: {
      total_invoiced: minorToMoney(totals.invoiced + annualInvoiced),
      total_received: minorToMoney(totals.received + annualReceived),
      total_outstanding: minorToMoney(totals.outstanding + carriedForwardLeaves.reduce((sum, row) => sum + row.remaining, 0)),
      outstanding_invoice_count: totals.outstandingCount + carriedForwardLeaves.filter((row) => row.remaining > 0).length,
      overdue_amount: minorToMoney(totals.overdue + carriedForwardLeaves.reduce((sum, row) => sum + (row.due_date && normalizeDateOnly(row.due_date) < new Date().toISOString().slice(0, 10) ? row.remaining : 0), 0)),
      overdue_invoice_count: totals.overdueCount + carriedForwardLeaves.filter((row) => row.remaining > 0 && row.due_date && normalizeDateOnly(row.due_date) < new Date().toISOString().slice(0, 10)).length,
      unapplied_advance_balance: minorToMoney(
        moneyToMinor(advanceAmount || 0, "Unapplied advance balance")
      ),
    },
    outstanding_invoices: outstandingInvoices,
  };
};

const getCustomerFinancialSummary = async (companyId, customerId, executor = db) => {
  const [customerRows] = await executor.query(CUSTOMER_SQL, [customerId, companyId]);
  if (!customerRows.length) return null;

  const [invoiceRows] = await executor.query(
    ELIGIBLE_INVOICES_SQL,
    [companyId, companyId, customerId]
  );
  const [advanceRows] = await executor.query(
    ADVANCE_BALANCE_SQL,
    [companyId, customerId]
  );
  let annualOpeningRows = [];
  try {
    [annualOpeningRows] = await executor.query(ANNUAL_CUSTOMER_OPENINGS_SQL, [companyId, customerId]);
  } catch (error) {
    if (!["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(error?.code)) throw error;
  }

  return buildFinancialSummary(
    customerRows[0],
    invoiceRows,
    advanceRows[0]?.unapplied_advance_balance || 0,
    annualOpeningRows
  );
};

const normalizePaymentHistoryRow = (row) => {
  const invoiceNumbers = [row.invoice_numbers, row.opening_references]
    .filter(Boolean)
    .flatMap((value) => String(value).split("||").filter(Boolean));
  const uniqueInvoiceNumbers = [...new Set(invoiceNumbers)];
  const isAdvance = row.receipt_type === "ADVANCE";

  return {
    receipt_entry_id: Number(row.receipt_entry_id),
    receipt_number: row.receipt_number,
    receipt_date: normalizeDateOnly(row.receipt_date),
    receipt_type: row.receipt_type,
    amount: minorToMoney(moneyToMinor(row.amount || 0, "Receipt amount")),
    payment_mode: row.payment_mode || null,
    received_in_account_id: Number(row.received_in_account_id),
    received_in_account_name: row.received_in_account_name,
    received_in_account_code: row.received_in_account_code || null,
    reference_number: row.reference_number || null,
    narration: row.narration || null,
    allocation_count: isAdvance ? 0 : Number(row.allocation_count || 0),
    allocated_amount: isAdvance
      ? 0
      : minorToMoney(moneyToMinor(row.allocated_amount || 0, "Allocated amount")),
    invoice_numbers: isAdvance ? [] : uniqueInvoiceNumbers,
    unapplied_amount: isAdvance
      ? minorToMoney(moneyToMinor(row.unapplied_amount || 0, "Unapplied amount"))
      : 0,
  };
};

const getCustomerPaymentHistory = async (
  companyId,
  customerId,
  { limit = 10, offset = 0 } = {},
  executor = db
) => {
  const [customerRows] = await executor.query(CUSTOMER_SQL, [customerId, companyId]);
  if (!customerRows.length) return null;

  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 10, 1), 50);
  const parsedOffset = Number.parseInt(offset, 10);
  const safeOffset = Number.isSafeInteger(parsedOffset) && parsedOffset >= 0 ? parsedOffset : 0;
  const [rows] = await executor.query(PAYMENT_HISTORY_SQL, [
    companyId,
    customerId,
    safeLimit,
    safeOffset,
  ]);

  return {
    customer: {
      id: Number(customerRows[0].id),
      name: customerRows[0].name,
    },
    payments: rows.map(normalizePaymentHistoryRow),
    pagination: { limit: safeLimit, offset: safeOffset },
  };
};

module.exports = {
  ADVANCE_BALANCE_SQL,
  ANNUAL_CUSTOMER_OPENINGS_SQL,
  CUSTOMER_SQL,
  ELIGIBLE_INVOICES_SQL,
  PAYMENT_HISTORY_SQL,
  buildFinancialSummary,
  getCustomerFinancialSummary,
  getCustomerPaymentHistory,
  normalizeDateOnly,
  normalizePaymentHistoryRow,
};
