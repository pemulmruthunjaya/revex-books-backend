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
    COUNT(DISTINCT p.id) AS allocation_count,
    COALESCE(SUM(p.amount), 0.00) AS allocated_amount,
    GROUP_CONCAT(DISTINCT i.invoice_number ORDER BY i.invoice_number SEPARATOR '||')
      AS invoice_numbers,
    COALESCE(advance_totals.unapplied_amount, 0.00) AS unapplied_amount
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
    advance_totals.unapplied_amount
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

const buildFinancialSummary = (customer, invoiceRows, advanceAmount) => {
  const invoices = invoiceRows.map(normalizeInvoice);
  const totals = invoices.reduce(
    (result, invoice) => ({
      invoiced: result.invoiced + invoice._totalMinor,
      received: result.received + invoice._paidMinor,
      outstanding: result.outstanding + invoice._outstandingMinor,
      overdue: result.overdue + (invoice.is_overdue ? invoice._outstandingMinor : 0),
      outstandingCount: result.outstandingCount + (invoice._outstandingMinor > 0 ? 1 : 0),
      overdueCount: result.overdueCount + (invoice.is_overdue ? 1 : 0),
    }),
    { invoiced: 0, received: 0, outstanding: 0, overdue: 0, outstandingCount: 0, overdueCount: 0 }
  );

  const outstandingInvoices = invoices
    .filter((invoice) => invoice._outstandingMinor > 0)
    .map(({ _totalMinor, _paidMinor, _outstandingMinor, ...invoice }) => invoice);

  return {
    customer: {
      id: Number(customer.id),
      name: customer.name,
      credit_period_days: Number(customer.credit_period_days || 0),
      credit_limit: minorToMoney(moneyToMinor(customer.credit_limit || 0, "Credit limit")),
    },
    summary: {
      total_invoiced: minorToMoney(totals.invoiced),
      total_received: minorToMoney(totals.received),
      total_outstanding: minorToMoney(totals.outstanding),
      outstanding_invoice_count: totals.outstandingCount,
      overdue_amount: minorToMoney(totals.overdue),
      overdue_invoice_count: totals.overdueCount,
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

  return buildFinancialSummary(
    customerRows[0],
    invoiceRows,
    advanceRows[0]?.unapplied_advance_balance || 0
  );
};

const normalizePaymentHistoryRow = (row) => {
  const invoiceNumbers = row.invoice_numbers
    ? [...new Set(String(row.invoice_numbers).split("||").filter(Boolean))]
    : [];
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
    invoice_numbers: isAdvance ? [] : invoiceNumbers,
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
  CUSTOMER_SQL,
  ELIGIBLE_INVOICES_SQL,
  PAYMENT_HISTORY_SQL,
  buildFinancialSummary,
  getCustomerFinancialSummary,
  getCustomerPaymentHistory,
  normalizeDateOnly,
  normalizePaymentHistoryRow,
};
