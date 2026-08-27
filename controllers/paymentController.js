const db = require("../db/connection");
const { createReceipt } = require("../services/receiptEntryService");

/**
 * ADD PAYMENT
 * OWNER & STAFF
 */
exports.addPayment = async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const { amount, payment_date, payment_method, reference_number, account_id, request_id } = req.body;
    const paymentAmount = Number(amount || 0);

    if (!paymentAmount || !payment_date || !payment_method || !account_id || !request_id) {
      return res.status(400).json({
        message: "amount, payment_date, payment_method, account_id and request_id are required"
      });
    }

    if (paymentAmount <= 0) {
      return res.status(400).json({
        message: "Payment amount must be greater than zero"
      });
    }

    const company_id = req.user.company_id;
    const [invoices] = await db.query(
      "SELECT id,customer_id,total_amount,status FROM invoices WHERE id=? AND company_id=?",
      [invoiceId, company_id]
    );

    if (invoices.length === 0) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    const invoice = invoices[0];

    if (invoice.status === "cancelled") {
      return res.status(400).json({ message: "Cannot pay a cancelled invoice" });
    }

    const result = await createReceipt({
      receipt_date: payment_date,
      receipt_type: "CUSTOMER",
      customer_id: invoice.customer_id,
      invoice_id: Number(invoiceId),
      received_in_account_id: Number(account_id),
      amount: paymentAmount,
      payment_method,
      reference_number: reference_number || null,
      narration: `Invoice payment ${invoiceId}`,
      idempotency_key: String(request_id),
    }, req.user);

    res.status(result.duplicate ? 200 : 201).json({
      message: result.duplicate ? "Payment request already processed" : "Payment recorded successfully",
      ...result,
    });

  } catch (error) {
    console.error("Add payment error:", error);
    res.status(error.status || 500).json({
      message: error.status ? error.message : "Failed to record payment",
      ...(error.code ? { code: error.code } : {}),
    });
  }
};

/**
 * LIST PAYMENTS FOR AN INVOICE
 */
exports.getPaymentsByInvoice = async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const company_id = req.user.company_id;

    const [payments] = await db.query(
      `SELECT id, amount, payment_date, payment_method, reference_number
       FROM payments
       WHERE invoice_id = ? AND company_id = ?
       ORDER BY created_at DESC`,
      [invoiceId, company_id]
    );

    res.json({
      count: payments.length,
      payments
    });

  } catch (error) {
    console.error("Get payments error:", error);
    res.status(500).json({
      message: "Failed to fetch payments"
    });
  }
};
