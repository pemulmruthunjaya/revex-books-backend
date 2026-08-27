const db = require("../db/connection");

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const numberValue = (value) => Number(value || 0);

const defaultRange = () => {
  const today = new Date();
  const to = today.toISOString().slice(0, 10);
  const from = `${to.slice(0, 7)}-01`;
  return { from, to };
};

const readRange = (query = {}) => {
  const defaults = defaultRange();
  const from = String(query.from_date || defaults.from).trim();
  const to = String(query.to_date || defaults.to).trim();
  if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to) || from > to) {
    const error = new Error("Enter a valid date range");
    error.status = 400;
    throw error;
  }
  return { from, to };
};

const getDashboardSnapshot = async (companyId, range) => {
  const { from, to } = range;
  const [
    [summaryRows],
    [trendRows],
    [expenseRows],
    [balanceRows],
    [overdueInvoiceRows],
    [overdueBillRows],
    [activityRows],
  ] = await Promise.all([
    db.query(
      `SELECT
        (SELECT COALESCE(SUM(i.total_amount),0) FROM invoices i
          WHERE i.company_id=? AND i.invoice_date BETWEEN ? AND ?) AS sales,
        (SELECT COALESCE(SUM(b.total_amount),0) FROM bills b
          WHERE b.company_id=? AND b.bill_date BETWEEN ? AND ?) AS purchases,
        (SELECT COALESCE(SUM(e.amount),0) FROM expenses e
          WHERE e.company_id=? AND e.expense_date BETWEEN ? AND ?) AS expenses,
        (SELECT COALESCE(SUM(re.amount),0) FROM receipt_entries re
          WHERE re.company_id=? AND re.receipt_date BETWEEN ? AND ?) AS receipts,
        (SELECT COALESCE(SUM(p.amount),0) FROM payments p
          WHERE p.company_id=? AND p.payment_date BETWEEN ? AND ?) AS customer_payments,
        (SELECT COALESCE(SUM(vp.amount),0) FROM vendor_payments vp
          WHERE vp.company_id=? AND vp.status='SUCCESS' AND vp.payment_date BETWEEN ? AND ?) AS vendor_payments,
        (SELECT COUNT(*) FROM invoices i
          WHERE i.company_id=? AND i.invoice_date BETWEEN ? AND ?) AS invoice_count,
        (SELECT COUNT(*) FROM bills b
          WHERE b.company_id=? AND b.bill_date BETWEEN ? AND ?) AS bill_count,
        (SELECT COUNT(*) FROM customers c WHERE c.company_id=?) AS customer_count,
        (SELECT COUNT(*) FROM vendors v
          WHERE v.company_id=? AND (v.status IS NULL OR v.status<>'Inactive')) AS vendor_count,
        (SELECT COALESCE(SUM(GREATEST(i.total_amount-
          CASE WHEN LOWER(COALESCE(i.status,''))='paid' THEN i.total_amount
               ELSE COALESCE(pt.paid_amount,0) END,0)),0)
          FROM invoices i
          LEFT JOIN (SELECT invoice_id,SUM(amount) paid_amount FROM payments
            WHERE company_id=? AND payment_date<=? GROUP BY invoice_id) pt ON pt.invoice_id=i.id
          WHERE i.company_id=? AND i.invoice_date<=?) AS receivables,
        (SELECT COALESCE(SUM(GREATEST(b.total_amount-
          GREATEST(COALESCE(vpt.paid_amount,0),COALESCE(b.paid_amount,0)),0)),0)
          FROM bills b
          LEFT JOIN (SELECT bill_id,SUM(amount) paid_amount FROM vendor_payments
            WHERE company_id=? AND status='SUCCESS' AND payment_date<=? GROUP BY bill_id) vpt ON vpt.bill_id=b.id
          WHERE b.company_id=? AND b.bill_date<=?) AS payables`,
      [
        companyId, from, to, companyId, from, to, companyId, from, to,
        companyId, from, to, companyId, from, to, companyId, from, to,
        companyId, from, to, companyId, from, to, companyId, companyId,
        companyId, to, companyId, to, companyId, to, companyId, to,
      ]
    ),
    db.query(
      `SELECT period, SUM(sales) sales, SUM(purchases) purchases
       FROM (
         SELECT DATE_FORMAT(i.invoice_date,'%Y-%m') period, SUM(i.total_amount) sales, 0 purchases
         FROM invoices i WHERE i.company_id=? AND i.invoice_date BETWEEN ? AND ?
         GROUP BY DATE_FORMAT(i.invoice_date,'%Y-%m')
         UNION ALL
         SELECT DATE_FORMAT(b.bill_date,'%Y-%m') period, 0 sales, SUM(b.total_amount) purchases
         FROM bills b WHERE b.company_id=? AND b.bill_date BETWEEN ? AND ?
         GROUP BY DATE_FORMAT(b.bill_date,'%Y-%m')
       ) movement GROUP BY period ORDER BY period`,
      [companyId, from, to, companyId, from, to]
    ),
    db.query(
      `SELECT COALESCE(NULLIF(TRIM(e.category),''),'Uncategorised') name,
              SUM(e.amount) value
       FROM expenses e
       WHERE e.company_id=? AND e.expense_date BETWEEN ? AND ?
       GROUP BY COALESCE(NULLIF(TRIM(e.category),''),'Uncategorised')
       ORDER BY value DESC LIMIT 8`,
      [companyId, from, to]
    ),
    db.query(
      `SELECT
         CASE
           WHEN LOWER(CONCAT_WS(' ',a.account_name,p.account_name,a.description)) REGEXP 'cash|petty cash' THEN 'cash'
           WHEN LOWER(CONCAT_WS(' ',a.account_name,p.account_name,a.description)) REGEXP 'bank|current account|savings account' THEN 'bank'
         END balance_type,
         COALESCE(SUM(CASE WHEN je.id IS NOT NULL THEN jed.debit-jed.credit ELSE 0 END),0) balance
       FROM accounts a
       LEFT JOIN accounts p ON p.id=a.parent_account_id AND p.company_id=a.company_id
       LEFT JOIN journal_entry_details jed ON jed.account_id=a.id
       LEFT JOIN journal_entries je ON je.id=jed.journal_entry_id
         AND je.company_id=a.company_id AND je.journal_date<=?
       WHERE a.company_id=? AND a.status=1 AND a.account_type='ASSET'
         AND LOWER(CONCAT_WS(' ',a.account_name,p.account_name,a.description))
           REGEXP 'cash|petty cash|bank|current account|savings account'
       GROUP BY balance_type`,
      [to, companyId]
    ),
    db.query(
      `SELECT i.id, i.invoice_number number, i.invoice_date date, i.customer_name party,
              GREATEST(i.total_amount-CASE
                WHEN LOWER(COALESCE(i.status,''))='paid' THEN i.total_amount
                ELSE COALESCE(pt.paid_amount,0) END,0) due_amount,
              DATEDIFF(?,DATE_ADD(i.invoice_date,INTERVAL 30 DAY)) overdue_days
       FROM invoices i
       LEFT JOIN (SELECT invoice_id,SUM(amount) paid_amount FROM payments
         WHERE company_id=? AND payment_date<=? GROUP BY invoice_id) pt ON pt.invoice_id=i.id
       WHERE i.company_id=? AND i.invoice_date<=?
         AND DATE_ADD(i.invoice_date,INTERVAL 30 DAY)<?
         AND GREATEST(i.total_amount-CASE
           WHEN LOWER(COALESCE(i.status,''))='paid' THEN i.total_amount
           ELSE COALESCE(pt.paid_amount,0) END,0)>0
       ORDER BY overdue_days DESC, i.id DESC LIMIT 6`,
      [to, companyId, to, companyId, to, to]
    ),
    db.query(
      `SELECT b.id,
              COALESCE(NULLIF(TRIM(b.bill_number),''),'Legacy Bill') number,
              b.due_date date,
              COALESCE(NULLIF(TRIM(v.name),''),'Vendor unavailable') party,
              GREATEST(b.total_amount-GREATEST(COALESCE(vpt.paid_amount,0),COALESCE(b.paid_amount,0)),0) due_amount,
              DATEDIFF(?,b.due_date) overdue_days
       FROM bills b
       LEFT JOIN vendors v ON v.id=b.vendor_id AND v.company_id=b.company_id
       LEFT JOIN (SELECT bill_id,SUM(amount) paid_amount FROM vendor_payments
         WHERE company_id=? AND status='SUCCESS' AND payment_date<=? GROUP BY bill_id) vpt ON vpt.bill_id=b.id
       WHERE b.company_id=? AND b.bill_date<=? AND b.due_date IS NOT NULL AND b.due_date<?
         AND GREATEST(b.total_amount-GREATEST(COALESCE(vpt.paid_amount,0),COALESCE(b.paid_amount,0)),0)>0
       ORDER BY overdue_days DESC, b.id DESC LIMIT 6`,
      [to, companyId, to, companyId, to, to]
    ),
    db.query(
      `SELECT activity_type, activity_date, reference, party, amount, route
       FROM (
         SELECT 'Invoice' activity_type,i.invoice_date activity_date,i.invoice_number reference,
                i.customer_name party,i.total_amount amount,CONCAT('/sales/invoice/',i.id) route
         FROM invoices i WHERE i.company_id=? AND i.invoice_date BETWEEN ? AND ?
         UNION ALL
         SELECT 'Bill',b.bill_date,b.bill_number,v.name,b.total_amount,CONCAT('/bills/',b.id)
         FROM bills b LEFT JOIN vendors v ON v.id=b.vendor_id AND v.company_id=b.company_id
         WHERE b.company_id=? AND b.bill_date BETWEEN ? AND ?
         UNION ALL
         SELECT 'Receipt',re.receipt_date,
                CONVERT(re.receipt_number USING utf8mb4) COLLATE utf8mb4_0900_ai_ci,
                COALESCE(c.name,CASE WHEN re.receipt_type='CUSTOMER' THEN 'Customer receipt' ELSE 'Receipt entry' END),re.amount,
                CONCAT('/receipt-entry/',re.id)
         FROM receipt_entries re LEFT JOIN customers c ON c.id=re.customer_id AND c.company_id=re.company_id
         WHERE re.company_id=? AND re.receipt_date BETWEEN ? AND ?
         UNION ALL
         SELECT 'Customer payment',p.payment_date,COALESCE(p.reference_number,CONCAT('PAY-',p.id)),
                i.customer_name,p.amount,CONCAT('/sales/invoice/',p.invoice_id)
         FROM payments p INNER JOIN invoices i ON i.id=p.invoice_id AND i.company_id=p.company_id
         WHERE p.company_id=? AND p.payment_date BETWEEN ? AND ?
           AND p.receipt_entry_id IS NULL
         UNION ALL
         SELECT 'Journal',je.journal_date,je.journal_no,je.narration,je.total_debit,
                '/journal-entry-history'
         FROM journal_entries je WHERE je.company_id=? AND je.journal_date BETWEEN ? AND ?
           AND NOT EXISTS (
             SELECT 1 FROM receipt_entries linked_receipt
             WHERE linked_receipt.company_id=je.company_id
               AND (linked_receipt.journal_entry_id=je.id OR
                 (linked_receipt.id=je.source_id AND je.source_type IN ('customer_receipt','receipt_entry')))
           )
       ) activity ORDER BY activity_date DESC, reference DESC LIMIT 12`,
      [
        companyId, from, to, companyId, from, to, companyId, from, to,
        companyId, from, to, companyId, from, to,
      ]
    ),
  ]);

  const summary = summaryRows[0] || {};
  const balances = balanceRows.reduce(
    (result, row) => ({ ...result, [row.balance_type]: numberValue(row.balance) }),
    { cash: 0, bank: 0 }
  );

  return {
    range: { from_date: from, to_date: to },
    kpis: {
      sales: numberValue(summary.sales),
      purchases: numberValue(summary.purchases),
      expenses: numberValue(summary.expenses),
      receipts: numberValue(summary.receipts),
      customer_payments: numberValue(summary.customer_payments),
      vendor_payments: numberValue(summary.vendor_payments),
      receivables: numberValue(summary.receivables),
      payables: numberValue(summary.payables),
      invoice_count: numberValue(summary.invoice_count),
      bill_count: numberValue(summary.bill_count),
      customer_count: numberValue(summary.customer_count),
      vendor_count: numberValue(summary.vendor_count),
      net_operating: numberValue(summary.sales)-numberValue(summary.purchases)-numberValue(summary.expenses),
    },
    sales_purchases: trendRows.map((row) => ({
      period: row.period,
      sales: numberValue(row.sales),
      purchases: numberValue(row.purchases),
    })),
    expense_breakdown: expenseRows.map((row) => ({ name: row.name, value: numberValue(row.value) })),
    balances,
    overdue: {
      invoice_basis_days: 30,
      invoices: overdueInvoiceRows.map((row) => ({ ...row, due_amount: numberValue(row.due_amount), overdue_days: numberValue(row.overdue_days) })),
      bills: overdueBillRows.map((row) => ({
        ...row,
        number: row.number || "Legacy Bill",
        party: row.party || "Vendor unavailable",
        due_amount: numberValue(row.due_amount),
        overdue_days: numberValue(row.overdue_days),
      })),
    },
    recent_activity: activityRows.map((row) => ({ ...row, amount: numberValue(row.amount) })),
  };
};

exports.getDashboardData = async (req, res) => {
  try {
    const range = readRange(req.query);
    const data = await getDashboardSnapshot(req.user.company_id, range);
    res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Dashboard error:", error.message);
    res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : "Failed to fetch dashboard data",
    });
  }
};

exports.getDashboardSnapshot = getDashboardSnapshot;
exports.readRange = readRange;
