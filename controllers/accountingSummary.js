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

let returnTablesReady = false;
let payrollTablesReady = false;

const ensureReturnTables = async (db) => {
  if (returnTablesReady) {
    return;
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS product_returns (
      id INT AUTO_INCREMENT PRIMARY KEY,
      company_id INT NOT NULL,
      type VARCHAR(20) NOT NULL,
      return_number VARCHAR(50) NOT NULL,
      return_date DATE NOT NULL,
      party_type VARCHAR(20) NOT NULL,
      party_id INT NULL,
      party_name VARCHAR(255) NOT NULL,
      reference_number VARCHAR(100) NULL,
      subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
      tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      notes TEXT NULL,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_product_returns_company_number (company_id, return_number)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS return_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      return_id INT NOT NULL,
      company_id INT NOT NULL,
      product_id INT NOT NULL,
      product_name VARCHAR(255) NOT NULL,
      batch_no VARCHAR(100) NULL,
      quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
      unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
      mrp DECIMAL(12,2) NOT NULL DEFAULT 0,
      gst_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
      total_price DECIMAL(12,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_return_items_return (return_id),
      INDEX idx_return_items_company_product (company_id, product_id)
    )
  `);

  returnTablesReady = true;
};

const ensurePayrollTables = async (db) => {
  if (payrollTablesReady) {
    return;
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS payroll_entries (
      id INT AUTO_INCREMENT PRIMARY KEY,
      company_id INT NOT NULL,
      employee_id INT NOT NULL,
      employee_name VARCHAR(255) NOT NULL,
      payroll_month VARCHAR(7) NOT NULL,
      payroll_date DATE NOT NULL,
      salary_mode VARCHAR(40) NOT NULL DEFAULT 'Manual',
      working_days DECIMAL(8,2) NOT NULL DEFAULT 0,
      present_days DECIMAL(8,2) NOT NULL DEFAULT 0,
      absent_days DECIMAL(8,2) NOT NULL DEFAULT 0,
      total_hours DECIMAL(10,2) NOT NULL DEFAULT 0,
      overtime_hours DECIMAL(10,2) NOT NULL DEFAULT 0,
      standard_hours DECIMAL(10,2) NOT NULL DEFAULT 0,
      basic_salary DECIMAL(12,2) NOT NULL DEFAULT 0,
      allowances DECIMAL(12,2) NOT NULL DEFAULT 0,
      deductions DECIMAL(12,2) NOT NULL DEFAULT 0,
      net_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      status VARCHAR(30) NOT NULL DEFAULT 'Unpaid',
      payment_date DATE NULL,
      notes TEXT NULL,
      attendance_import_id INT NULL,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_payroll_employee_month (company_id, employee_id, payroll_month),
      INDEX idx_payroll_entries_company_month (company_id, payroll_month),
      INDEX idx_payroll_entries_status (company_id, status)
    )
  `);

  payrollTablesReady = true;
};

exports.getAccountingSummary = async (db, companyId, filters = {}) => {
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
