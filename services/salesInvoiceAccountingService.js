const { ensureSystemAccount } = require("./receiptEntryService");

const money = (value) => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const getSalesAccounts = async (connection, companyId) => {
  const receivable = await ensureSystemAccount(connection, companyId, {
    code: `SYS-AR-${companyId}`,
    name: "Accounts Receivable",
    type: "ASSET",
    alternateCode: "1100",
    alternateName: "Customer Receivables",
    description: "System Accounts Receivable ledger",
  });
  const sales = await ensureSystemAccount(connection, companyId, {
    code: `SYS-SALES-${companyId}`,
    name: "Sales",
    type: "INCOME",
    alternateCode: "4000",
    alternateName: "Sales Revenue",
    description: "System Sales Revenue ledger",
  });
  const gstOutput = await ensureSystemAccount(connection, companyId, {
    code: `SYS-GST-OUT-${companyId}`,
    name: "GST Output Payable",
    type: "LIABILITY",
    alternateCode: "2200",
    alternateName: "GST Payable",
    description: "System GST Output liability ledger",
  });
  return { receivable, sales, gstOutput };
};

const postSalesInvoiceJournal = async (connection, invoice) => {
  const companyId = Number(invoice.company_id);
  const invoiceId = Number(invoice.id);
  const total = money(invoice.total_amount);
  const tax = money(invoice.tax_amount);
  const salesAmount = money(total - tax);

  if (!(total >= 0) || tax < 0 || salesAmount < 0) {
    throw Object.assign(new Error("Invoice totals cannot be posted safely to Sales and GST ledgers"), {
      status: 409,
      code: "INVALID_SALES_ACCOUNTING_TOTALS",
    });
  }

  const [existing] = await connection.query(
    `SELECT id, journal_no FROM journal_entries
     WHERE company_id=? AND source_type='sales_invoice' AND source_id=? LIMIT 1`,
    [companyId, invoiceId]
  );
  if (existing.length) return { ...existing[0], duplicate: true };

  const accounts = await getSalesAccounts(connection, companyId);
  const journalNo = `SINV-${companyId}-${invoiceId}`;
  const [journalResult] = await connection.query(
    `INSERT INTO journal_entries
     (journal_no,journal_date,narration,total_debit,total_credit,created_by,
      company_id,source_type,source_id)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      journalNo,
      invoice.invoice_date,
      `Sales invoice ${invoice.invoice_number}`,
      total,
      total,
      Number(invoice.created_by),
      companyId,
      "sales_invoice",
      invoiceId,
    ]
  );
  const journalId = journalResult.insertId;
  const lines = [
    [journalId, accounts.receivable.id, total, 0, invoice.invoice_number],
    [journalId, accounts.sales.id, 0, salesAmount, invoice.invoice_number],
  ];
  if (tax > 0) lines.push([journalId, accounts.gstOutput.id, 0, tax, invoice.invoice_number]);

  for (const line of lines) {
    await connection.query(
      `INSERT INTO journal_entry_details
       (journal_entry_id,account_id,debit,credit,description)
       VALUES (?,?,?,?,?)`,
      line
    );
  }

  const debit = money(lines.reduce((sum, line) => sum + Number(line[2]), 0));
  const credit = money(lines.reduce((sum, line) => sum + Number(line[3]), 0));
  if (debit !== credit) {
    throw Object.assign(new Error("Sales invoice journal is not balanced"), {
      status: 500,
      code: "UNBALANCED_SALES_JOURNAL",
    });
  }
  return { id: journalId, journal_no: journalNo, duplicate: false, debit, credit };
};

module.exports = { getSalesAccounts, money, postSalesInvoiceJournal };
