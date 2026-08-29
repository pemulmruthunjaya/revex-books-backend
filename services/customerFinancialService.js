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

module.exports = {
  ADVANCE_BALANCE_SQL,
  CUSTOMER_SQL,
  ELIGIBLE_INVOICES_SQL,
  buildFinancialSummary,
  getCustomerFinancialSummary,
  normalizeDateOnly,
};
