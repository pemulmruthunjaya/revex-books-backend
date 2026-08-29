const db = require("../db/connection");
const {
  createReceipt,
  ensureReceiptEntrySchema,
  getCustomerOpenInvoices,
  listAccountOptions,
} = require("../services/receiptEntryService");
const { normalizeDateOnly } = require("../services/customerFinancialService");

const normalizeAllocation = (row) => ({
  payment_id: Number(row.payment_id),
  invoice_id: Number(row.invoice_id),
  invoice_number: row.invoice_number,
  invoice_date: normalizeDateOnly(row.invoice_date),
  invoice_total: Number(row.invoice_total || 0),
  allocation_amount: Number(row.allocation_amount || 0),
});

const loadReceiptEntryDetail = async (receiptId, companyId, executor = db) => {
  const [rows] = await executor.query(
    `SELECT re.id, re.receipt_number AS receipt_no, re.receipt_date,
            re.receipt_type, re.amount, re.payment_mode, re.reference_number,
            re.narration, re.customer_id, re.invoice_id, re.journal_entry_id,
            received_in.account_name AS received_in_account_name,
            received_in.account_code AS received_in_account_code,
            received_from.account_name AS received_from_account_name,
            received_from.account_code AS received_from_account_code,
            c.name AS customer_name, i.invoice_number,
            advance_totals.original_amount AS advance_original_amount,
            advance_totals.unapplied_amount AS advance_unapplied_amount,
            advance_totals.advance_status
     FROM receipt_entries re
     INNER JOIN accounts received_in
       ON received_in.id = re.received_in_account_id
      AND received_in.company_id = re.company_id
     INNER JOIN accounts received_from
       ON received_from.id = re.received_from_account_id
      AND received_from.company_id = re.company_id
     LEFT JOIN customers c
       ON c.id = re.customer_id AND c.company_id = re.company_id
     LEFT JOIN invoices i
       ON i.id = re.invoice_id AND i.company_id = re.company_id
     LEFT JOIN (
       SELECT company_id, customer_id, receipt_entry_id,
              SUM(original_amount) AS original_amount,
              SUM(unapplied_amount) AS unapplied_amount,
              MAX(status) AS advance_status
       FROM customer_advances
       GROUP BY company_id, customer_id, receipt_entry_id
     ) advance_totals
       ON advance_totals.receipt_entry_id = re.id
      AND advance_totals.company_id = re.company_id
      AND advance_totals.customer_id = re.customer_id
     WHERE re.id = ? AND re.company_id = ?
     LIMIT 1`,
    [receiptId, companyId]
  );
  if (!rows.length) return null;

  const [allocationRows] = await executor.query(
    `SELECT p.id AS payment_id, p.invoice_id, i.invoice_number,
            i.invoice_date, i.total_amount AS invoice_total,
            p.amount AS allocation_amount
     FROM payments p
     INNER JOIN invoices i
       ON i.id = p.invoice_id
      AND i.company_id = p.company_id
     WHERE p.receipt_entry_id = ?
       AND p.company_id = ?
     ORDER BY i.invoice_date, i.id`,
    [receiptId, companyId]
  );

  return {
    ...rows[0],
    receipt_date: normalizeDateOnly(rows[0].receipt_date),
    allocations: allocationRows.map(normalizeAllocation),
  };
};

exports.getReceiptOptions = async (req, res) => {
  try {
    await ensureReceiptEntrySchema();
    const [{ received_in_accounts, other_credit_accounts }, [customers]] =
      await Promise.all([
        listAccountOptions(req.user.company_id),
        db.query(
          `SELECT id, name
           FROM customers
           WHERE company_id = ?
           ORDER BY name`,
          [req.user.company_id]
        ),
      ]);

    res.json({
      success: true,
      data: {
        received_in_accounts,
        other_credit_accounts,
        customers,
      },
    });
  } catch (error) {
    console.error("Receipt options error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to load receipt options",
    });
  }
};

exports.getCustomerInvoices = async (req, res) => {
  try {
    await ensureReceiptEntrySchema();
    const result = await getCustomerOpenInvoices(
      req.user.company_id,
      req.params.customerId
    );
    if (!result) {
      return res.status(404).json({
        success: false,
        message: "Customer not found",
      });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    console.error("Receipt customer invoices error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to load customer invoices",
    });
  }
};

exports.createReceiptEntry = async (req, res) => {
  try {
    const result = await createReceipt(req.body, req.user);
    res.status(result.duplicate ? 200 : 201).json({
      success: true,
      message: result.duplicate
        ? "This receipt was already saved"
        : "Receipt created successfully",
      ...result,
    });
  } catch (error) {
    console.error("Receipt creation error:", {
      companyId: req.user.company_id,
      status: error.status || 500,
      message: error.status ? error.message : "Internal receipt error",
    });
    res.status(error.status || 500).json({
      success: false,
      message: error.status ? error.message : "Failed to create receipt",
    });
  }
};

exports.getReceiptEntryById = async (req, res) => {
  try {
    await ensureReceiptEntrySchema();
    const receipt = await loadReceiptEntryDetail(
      req.params.id,
      req.user.company_id
    );

    if (!receipt) {
      const [legacyRows] = await db.query(
        `SELECT je.id, je.journal_no AS receipt_no,
                je.journal_date AS receipt_date, je.narration,
                je.total_debit AS amount,
                received_in.account_name AS received_in_account_name,
                received_in.account_code AS received_in_account_code,
                received_from.account_name AS received_from_account_name,
                received_from.account_code AS received_from_account_code
         FROM journal_entries je
         LEFT JOIN journal_entry_details debit_line
           ON debit_line.journal_entry_id = je.id AND debit_line.debit > 0
         LEFT JOIN accounts received_in
           ON received_in.id = debit_line.account_id
          AND received_in.company_id = je.company_id
         LEFT JOIN journal_entry_details credit_line
           ON credit_line.journal_entry_id = je.id AND credit_line.credit > 0
         LEFT JOIN accounts received_from
           ON received_from.id = credit_line.account_id
          AND received_from.company_id = je.company_id
         WHERE je.id = ? AND je.company_id = ?
           AND je.journal_no LIKE 'RCPT-%'
         LIMIT 1`,
        [req.params.id, req.user.company_id]
      );
      if (!legacyRows.length) {
        return res.status(404).json({
          success: false,
          message: "Receipt voucher not found",
        });
      }
      return res.json({
        success: true,
        data: {
          ...legacyRows[0],
          receipt_date: normalizeDateOnly(legacyRows[0].receipt_date),
          allocations: [],
        },
      });
    }
    res.json({ success: true, data: receipt });
  } catch (error) {
    console.error("Get receipt voucher error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to load receipt voucher",
    });
  }
};

exports.loadReceiptEntryDetail = loadReceiptEntryDetail;
exports.normalizeAllocation = normalizeAllocation;
