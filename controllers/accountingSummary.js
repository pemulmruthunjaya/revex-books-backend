const { assertReportSchemaReady } = require("../services/reportSchemaService");

const ACCOUNTING_REPORT_SCHEMA = Object.freeze([
  { table: "product_returns", columns: ["company_id", "type", "return_date", "subtotal", "tax_amount", "total_amount"] },
  { table: "payroll_entries", columns: ["company_id", "payroll_date", "net_amount", "status"] },
  { table: "opening_balance_events", columns: ["company_id", "financial_year_id", "account_id", "opening_date", "debit", "credit"] },
]);

const toNumber = (value) => Number(value || 0);

const buildDateClause = (column, fromDate, toDate, params) => {
  const clauses = [];

  if (fromDate) {
    clauses.push(`${column} >= ?`);
    params.push(fromDate);
  }

  if (toDate) {
    clauses.push(`${column} <= ?`);
    params.push(toDate);
  }

  return clauses.length ? ` AND ${clauses.join(" AND ")}` : "";
};

const money = (value) => Math.round(toNumber(value) * 100) / 100;

exports.getAccountingSummary = async (db, companyId, filters = {}) => {
  await assertReportSchemaReady(db, ACCOUNTING_REPORT_SCHEMA);
  const { from_date, to_date } = filters;

  const invoiceParams = [companyId];
  const invoiceDateClause = buildDateClause(
    "i.invoice_date",
    from_date,
    to_date,
    invoiceParams
  );

  const [invoiceRows] = await db.query(
    `
    SELECT
      COALESCE(SUM(subtotal - COALESCE(discount_amount, 0)), 0) AS sales,
      COALESCE(SUM(tax_amount), 0) AS gst_output,
      COALESCE(SUM(total_amount), 0) AS total_sales,
      COALESCE(SUM(
        CASE
          WHEN LOWER(COALESCE(i.status, '')) = 'paid'
            THEN i.total_amount
          ELSE LEAST(COALESCE(payment_totals.paid_amount, 0), i.total_amount)
        END
      ), 0) AS paid_sales,
      COALESCE(SUM(
        GREATEST(
          i.total_amount -
          CASE
            WHEN LOWER(COALESCE(i.status, '')) = 'paid'
              THEN i.total_amount
            ELSE LEAST(COALESCE(payment_totals.paid_amount, 0), i.total_amount)
          END,
          0
        )
      ), 0) AS receivables
    FROM invoices i
    LEFT JOIN (
      SELECT
        invoice_id,
        company_id,
        SUM(amount) AS paid_amount
      FROM payments
      GROUP BY invoice_id, company_id
    ) payment_totals
      ON payment_totals.invoice_id = i.id
     AND payment_totals.company_id = i.company_id
    WHERE i.company_id = ?
    ${invoiceDateClause}
    `,
    invoiceParams
  );

  const billParams = [companyId];
  const billDateClause = buildDateClause("b.bill_date", from_date, to_date, billParams);

  const [billRows] = await db.query(
    `
    SELECT
      COALESCE(SUM(COALESCE(item_totals.taxable, b.total_amount)), 0) AS purchases,
      COALESCE(SUM(COALESCE(item_totals.gst_amount, 0)), 0) AS gst_input,
      COALESCE(SUM(b.total_amount), 0) AS total_purchases,
      COALESCE(SUM(
        CASE
          WHEN LOWER(COALESCE(b.status, '')) = 'paid'
            THEN b.total_amount
          ELSE LEAST(COALESCE(payment_totals.paid_amount, 0), b.total_amount)
        END
      ), 0) AS paid_purchases,
      COALESCE(SUM(
        GREATEST(
          b.total_amount -
          CASE
            WHEN LOWER(COALESCE(b.status, '')) = 'paid'
              THEN b.total_amount
            ELSE LEAST(COALESCE(payment_totals.paid_amount, 0), b.total_amount)
          END,
          0
        )
      ), 0) AS payables
    FROM bills b
    INNER JOIN vendors v
      ON v.id = b.vendor_id
     AND v.company_id = b.company_id
     AND (v.status IS NULL OR v.status <> 'Inactive')
    LEFT JOIN (
      SELECT
        bill_id,
        SUM(quantity * price) AS taxable,
        SUM(total - (quantity * price)) AS gst_amount
      FROM bill_items
      GROUP BY bill_id
    ) item_totals ON item_totals.bill_id = b.id
    LEFT JOIN (
      SELECT
        bill_id,
        company_id,
        SUM(amount) AS paid_amount
      FROM vendor_payments
      GROUP BY bill_id, company_id
    ) payment_totals
      ON payment_totals.bill_id = b.id
     AND payment_totals.company_id = b.company_id
    WHERE b.company_id = ?
      AND b.total_amount > 0
    ${billDateClause}
    `,
    billParams
  );

  const invoices = invoiceRows[0] || {};
  const bills = billRows[0] || {};

  const returnParams = [companyId];
  const returnDateClause = buildDateClause("return_date", from_date, to_date, returnParams);

  const [returnRows] = await db.query(
    `
    SELECT
      COALESCE(SUM(CASE WHEN type = 'sales' THEN subtotal ELSE 0 END), 0) AS sales_return_subtotal,
      COALESCE(SUM(CASE WHEN type = 'sales' THEN tax_amount ELSE 0 END), 0) AS sales_return_tax,
      COALESCE(SUM(CASE WHEN type = 'sales' THEN total_amount ELSE 0 END), 0) AS sales_return_total,
      COALESCE(SUM(CASE WHEN type = 'purchase' THEN subtotal ELSE 0 END), 0) AS purchase_return_subtotal,
      COALESCE(SUM(CASE WHEN type = 'purchase' THEN tax_amount ELSE 0 END), 0) AS purchase_return_tax,
      COALESCE(SUM(CASE WHEN type = 'purchase' THEN total_amount ELSE 0 END), 0) AS purchase_return_total
    FROM product_returns
    WHERE company_id = ?
    ${returnDateClause}
    `,
    returnParams
  );

  const returns = returnRows[0] || {};

  const sales = money(toNumber(invoices.sales) - toNumber(returns.sales_return_subtotal));
  const gstOutput = money(toNumber(invoices.gst_output) - toNumber(returns.sales_return_tax));
  const receivablesRaw = money(toNumber(invoices.receivables) - toNumber(returns.sales_return_total));
  const receivables = money(Math.max(receivablesRaw, 0));
  const customerCredits = money(Math.max(-receivablesRaw, 0));
  const paidSales = money(invoices.paid_sales);

  const purchases = money(toNumber(bills.purchases) - toNumber(returns.purchase_return_subtotal));
  const gstInput = money(toNumber(bills.gst_input) - toNumber(returns.purchase_return_tax));
  const payablesRaw = money(toNumber(bills.payables) - toNumber(returns.purchase_return_total));
  const payables = money(Math.max(payablesRaw, 0));
  const vendorCredits = money(Math.max(-payablesRaw, 0));
  const paidPurchases = money(bills.paid_purchases);

  const payrollParams = [companyId];
  const payrollDateClause = buildDateClause(
    "payroll_date",
    from_date,
    to_date,
    payrollParams
  );

  const [payrollRows] = await db.query(
    `
    SELECT
      COALESCE(SUM(net_amount), 0) AS payroll_expense,
      COALESCE(SUM(CASE WHEN status = 'Paid' THEN net_amount ELSE 0 END), 0) AS paid_payroll,
      COALESCE(SUM(CASE WHEN status <> 'Paid' THEN net_amount ELSE 0 END), 0) AS salary_payable
    FROM payroll_entries
    WHERE company_id = ?
    ${payrollDateClause}
    `,
    payrollParams
  );

  const payroll = payrollRows[0] || {};
  const payrollExpense = money(payroll.payroll_expense);
  const paidPayroll = money(payroll.paid_payroll);
  const salaryPayable = money(payroll.salary_payable);

  const openingParams = [companyId];
  const openingDateClause = to_date ? " AND je.journal_date <= ?" : "";
  if (to_date) openingParams.push(to_date);
  const [openingRows] = await db.query(
    `SELECT a.id,a.account_code,a.account_name,a.account_type,
            COALESCE(SUM(jed.debit),0) debit,COALESCE(SUM(jed.credit),0) credit
     FROM opening_balance_events obe
     INNER JOIN journal_entries je
       ON je.id=obe.journal_entry_id AND je.company_id=obe.company_id
     INNER JOIN journal_entry_details jed ON jed.journal_entry_id=je.id
     INNER JOIN accounts a ON a.id=jed.account_id AND a.company_id=obe.company_id
     WHERE obe.company_id=? ${openingDateClause}
     GROUP BY a.id,a.account_code,a.account_name,a.account_type
     ORDER BY a.account_type,a.account_name`,
    openingParams
  );

  const cash = money(paidSales - paidPurchases - paidPayroll);
  const profit = money(sales - purchases - payrollExpense);

  return {
    sales,
    gstOutput,
    receivables,
    customerCredits,
    paidSales,
    purchases,
    gstInput,
    payables,
    vendorCredits,
    paidPurchases,
    payrollExpense,
    paidPayroll,
    salaryPayable,
    cash,
    profit,
    openingBalances: openingRows.map((row) => ({
      ...row,
      debit: money(row.debit),
      credit: money(row.credit),
    }))
  };
};

exports.toTrialRow = ({ id, code, name, type, amount, normal }) => {
  const value = money(amount);
  const isDebitNormal = normal === "DEBIT";

  return {
    id,
    account_code: code,
    account_name: name,
    account_type: type,
    debit: value >= 0 ? (isDebitNormal ? value : 0) : (isDebitNormal ? 0 : Math.abs(value)),
    credit: value >= 0 ? (isDebitNormal ? 0 : value) : (isDebitNormal ? Math.abs(value) : 0)
  };
};
