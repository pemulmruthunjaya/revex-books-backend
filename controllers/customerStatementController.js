const db = require("../db/connection");

/**
 * =========================================================
 * CUSTOMER STATEMENT
 * =========================================================
 */

exports.getCustomerStatement = async (req, res) => {
  try {
    const {
      customer_id,
      from_date,
      to_date
    } = req.query;

    if (!customer_id) {
      return res.status(400).json({
        success: false,
        message: "Customer is required"
      });
    }

    const company_id = req.user.company_id;

    /**
     * =====================================================
     * CUSTOMER DETAILS
     * =====================================================
     */

    const [customerRows] = await db.query(
      `
      SELECT
        id,
        name
      FROM customers
      WHERE id = ?
      AND company_id = ?
      `,
      [customer_id, company_id]
    );

    if (!customerRows.length) {
      return res.status(404).json({
        success: false,
        message: "Customer not found"
      });
    }

    const customerName = customerRows[0].name;

    /**
     * =====================================================
     * SALES INVOICES
     * =====================================================
     */

    let invoiceFilter = "";
    const invoiceParams = [customerName, company_id];

    if (from_date && to_date) {
      invoiceFilter = `
        AND invoice_date BETWEEN ? AND ?
      `;

      invoiceParams.push(
        from_date,
        to_date
      );
    }

    const [invoiceRows] = await db.query(
      `
      SELECT
        id,
        invoice_number,
        invoice_date,
        total_amount,
        status
      FROM invoices
      WHERE customer_name = ?
      AND company_id = ?
      ${invoiceFilter}
      ORDER BY invoice_date ASC
      `,
      invoiceParams
    );

    /**
     * =====================================================
     * CUSTOMER PAYMENTS
     * =====================================================
     */

    let paymentFilter = "";
    const paymentParams = [customerName, company_id];

    if (from_date && to_date) {
      paymentFilter = `
        AND p.payment_date BETWEEN ? AND ?
      `;

      paymentParams.push(
        from_date,
        to_date
      );
    }

    const [paymentRows] = await db.query(
      `
      SELECT
        p.id,
        p.payment_date,
        p.amount,
        p.invoice_id,
        re.receipt_number
      FROM payments p
      INNER JOIN invoices i
        ON p.invoice_id = i.id
      LEFT JOIN receipt_entries re
        ON re.id = p.receipt_entry_id
       AND re.company_id = p.company_id
      WHERE i.customer_name = ?
      AND i.company_id = ?
      AND p.company_id = ?
      ${paymentFilter}
      ORDER BY p.payment_date ASC
      `,
      [customerName, company_id, company_id, ...paymentParams.slice(2)]
    );

    const advanceParams = [customer_id, company_id];
    let advanceFilter = "";
    if (from_date && to_date) {
      advanceFilter = "AND re.receipt_date BETWEEN ? AND ?";
      advanceParams.push(from_date, to_date);
    }
    const [advanceRows] = await db.query(
      `SELECT ca.id, re.receipt_date, re.receipt_number,
              ca.original_amount, ca.unapplied_amount, ca.status
       FROM customer_advances ca
       INNER JOIN receipt_entries re
         ON re.id = ca.receipt_entry_id AND re.company_id = ca.company_id
       WHERE ca.customer_id = ? AND ca.company_id = ?
       ${advanceFilter}
       ORDER BY re.receipt_date, ca.id`,
      advanceParams
    );

    /**
     * =====================================================
     * COMBINE TRANSACTIONS
     * =====================================================
     */

    const transactions = [];
    const invoiceIdsWithPayments = new Set(
      paymentRows.map((payment) => Number(payment.invoice_id))
    );

    invoiceRows.forEach((invoice) => {
      transactions.push({
        date: invoice.invoice_date,
        voucher_no: invoice.invoice_number,
        type: "INVOICE",
        debit: Number(invoice.total_amount || 0),
        credit: 0
      });

      if (
        String(invoice.status || "").toLowerCase() === "paid" &&
        !invoiceIdsWithPayments.has(Number(invoice.id))
      ) {
        transactions.push({
          date: invoice.invoice_date,
          voucher_no: invoice.invoice_number,
          type: "PAYMENT",
          debit: 0,
          credit: Number(invoice.total_amount || 0)
        });
      }
    });

    paymentRows.forEach((payment) => {
      transactions.push({
        date: payment.payment_date,
        voucher_no: payment.receipt_number || `PAY-${payment.id}`,
        type: "PAYMENT",
        debit: 0,
        credit: Number(payment.amount || 0)
      });
    });

    advanceRows.forEach((advance) => {
      transactions.push({
        date: advance.receipt_date,
        voucher_no: advance.receipt_number,
        type: "ADVANCE RECEIPT",
        debit: 0,
        credit: Number(advance.original_amount || 0),
        unapplied_amount: Number(advance.unapplied_amount || 0),
        advance_status: advance.status,
      });
    });

    /**
     * =====================================================
     * SORT DATE WISE
     * =====================================================
     */

    transactions.sort(
      (a, b) =>
        new Date(a.date) - new Date(b.date)
    );

    /**
     * =====================================================
     * RUNNING BALANCE
     * =====================================================
     */

    let runningBalance = 0;

    const statement = transactions.map((row) => {
      runningBalance += Number(row.debit || 0);
      runningBalance -= Number(row.credit || 0);

      return {
        ...row,
        balance: runningBalance
      };
    });

    /**
     * =====================================================
     * SUMMARY
     * =====================================================
     */

    const totalDebit = statement.reduce(
      (sum, row) => sum + Number(row.debit || 0),
      0
    );

    const totalCredit = statement.reduce(
      (sum, row) => sum + Number(row.credit || 0),
      0
    );

    /**
     * =====================================================
     * RESPONSE
     * =====================================================
     */

    res.status(200).json({
      success: true,
      customer: customerRows[0],

      summary: {
        total_debit: totalDebit,
        total_credit: totalCredit,
        closing_balance: runningBalance
      },

      data: statement
    });

  } catch (error) {
    console.error(
      "Customer Statement Error:",
      error
    );

    res.status(500).json({
      success: false,
      message: "Failed to fetch customer statement",
      error: error.message
    });
  }
};
