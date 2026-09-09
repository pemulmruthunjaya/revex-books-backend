const db = require("../db/connection");
const { requireFinancialYearForMutation } = require("../services/financialYearService");

const sendMutationError = (res, error) => res.status(error.status || 500).json({
  message: error.status ? error.message : "Invoice item operation failed",
  ...(error.code ? { code: error.code } : {}),
});

/**
 * 🔐 ADD INVOICE ITEM
 */
exports.addInvoiceItem = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const { invoiceId } = req.params;
    const { item_name, description, quantity, unit_price } = req.body;

    if (!item_name || !quantity || !unit_price) {
      return res.status(400).json({
        message: "item_name, quantity, unit_price are required"
      });
    }

    const company_id = req.user.company_id;
    const total_price = Number(quantity) * Number(unit_price);

    // 1️⃣ Validate invoice
    await connection.beginTransaction();
    const [invoices] = await connection.query(
      `SELECT id, status, tax_rate, financial_year_id
       FROM invoices
       WHERE id = ? AND company_id = ? FOR UPDATE`,
      [invoiceId, company_id]
    );

    if (invoices.length === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Invoice not found" });
    }

    const invoice = invoices[0];
    await requireFinancialYearForMutation(company_id, invoice.financial_year_id, connection);

    if (invoice.status !== "draft") {
      await connection.rollback();
      return res.status(400).json({
        message: "Invoice cannot be modified once paid"
      });
    }

    // 2️⃣ Insert item
    const [itemResult] = await connection.query(
      `INSERT INTO invoice_items (
        invoice_id,
        company_id,
        item_name,
        description,
        quantity,
        unit_price,
        total_price
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        invoiceId,
        company_id,
        item_name,
        description || null,
        quantity,
        unit_price,
        total_price
      ]
    );

    // 3️⃣ Recalculate totals
    const [[sum]] = await connection.query(
      `SELECT IFNULL(SUM(total_price), 0) AS subtotal
       FROM invoice_items
       WHERE invoice_id = ? AND company_id = ?`,
      [invoiceId, company_id]
    );

    const subtotal = Number(sum.subtotal);
    const tax_rate = Number(invoice.tax_rate);
    const tax_amount = Number(((subtotal * tax_rate) / 100).toFixed(2));
    const total_amount = Number((subtotal + tax_amount).toFixed(2));

    // 4️⃣ Update invoice
    await connection.query(
      `UPDATE invoices
       SET subtotal = ?, tax_amount = ?, total_amount = ?
       WHERE id = ? AND company_id = ?`,
      [subtotal, tax_amount, total_amount, invoiceId, company_id]
    );

    await connection.commit();
    res.status(201).json({
      message: "Invoice item added & totals updated",
      item_id: itemResult.insertId
    });

  } catch (error) {
    await connection.rollback();
    console.error("❌ Add invoice item error:", error);
    sendMutationError(res, error);
  } finally {
    connection.release();
  }
};

/**
 * 🔐 LIST INVOICE ITEMS
 */
exports.getInvoiceItems = async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const company_id = req.user.company_id;

    const [items] = await db.query(
      `SELECT id, item_name, description, quantity, unit_price, total_price
       FROM invoice_items
       WHERE invoice_id = ? AND company_id = ?`,
      [invoiceId, company_id]
    );

    res.json({
      count: items.length,
      items
    });
  } catch (error) {
    console.error("❌ Get invoice items error:", error);
    res.status(500).json({
      message: "Failed to fetch invoice items"
    });
  }
};

/**
 * 🔐 UPDATE INVOICE ITEM
 */
exports.updateInvoiceItem = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const { invoiceId, itemId } = req.params;
    const { item_name, description, quantity, unit_price } = req.body;
    const company_id = req.user.company_id;

    const total_price = Number(quantity) * Number(unit_price);

    // Check invoice status
    await connection.beginTransaction();
    const [[invoice]] = await connection.query(
      `SELECT status, tax_rate, financial_year_id
       FROM invoices
       WHERE id = ? AND company_id = ? FOR UPDATE`,
      [invoiceId, company_id]
    );

    if (!invoice) {
      await connection.rollback();
      return res.status(404).json({ message: "Invoice not found" });
    }
    await requireFinancialYearForMutation(company_id, invoice.financial_year_id, connection);
    if (invoice.status !== "draft") {
      await connection.rollback();
      return res.status(400).json({
        message: "Invoice cannot be modified once paid"
      });
    }

    // Update item
    await connection.query(
      `UPDATE invoice_items
       SET item_name = ?, description = ?, quantity = ?, unit_price = ?, total_price = ?
       WHERE id = ? AND invoice_id = ? AND company_id = ?`,
      [
        item_name,
        description || null,
        quantity,
        unit_price,
        total_price,
        itemId,
        invoiceId,
        company_id
      ]
    );

    // Recalculate totals
    const [[sum]] = await connection.query(
      `SELECT IFNULL(SUM(total_price), 0) AS subtotal
       FROM invoice_items
       WHERE invoice_id = ? AND company_id = ?`,
      [invoiceId, company_id]
    );

    const subtotal = Number(sum.subtotal);
    const tax_amount = Number(((subtotal * invoice.tax_rate) / 100).toFixed(2));
    const total_amount = Number((subtotal + tax_amount).toFixed(2));

    await connection.query(
      `UPDATE invoices
       SET subtotal = ?, tax_amount = ?, total_amount = ?
       WHERE id = ? AND company_id = ?`,
      [subtotal, tax_amount, total_amount, invoiceId, company_id]
    );

    await connection.commit();
    res.json({
      message: "Invoice item updated & totals recalculated"
    });

  } catch (error) {
    await connection.rollback();
    console.error("❌ Update invoice item error:", error);
    sendMutationError(res, error);
  } finally {
    connection.release();
  }
};

/**
 * 🔐 DELETE INVOICE ITEM
 */
exports.deleteInvoiceItem = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const { invoiceId, itemId } = req.params;
    const company_id = req.user.company_id;

    await connection.beginTransaction();
    const [[invoice]] = await connection.query(
      `SELECT status, tax_rate, financial_year_id
       FROM invoices
       WHERE id = ? AND company_id = ? FOR UPDATE`,
      [invoiceId, company_id]
    );

    if (!invoice) {
      await connection.rollback();
      return res.status(404).json({ message: "Invoice not found" });
    }
    await requireFinancialYearForMutation(company_id, invoice.financial_year_id, connection);
    if (invoice.status !== "draft") {
      await connection.rollback();
      return res.status(400).json({
        message: "Invoice cannot be modified once paid"
      });
    }

    await connection.query(
      `DELETE FROM invoice_items
       WHERE id = ? AND invoice_id = ? AND company_id = ?`,
      [itemId, invoiceId, company_id]
    );

    const [[sum]] = await connection.query(
      `SELECT IFNULL(SUM(total_price), 0) AS subtotal
       FROM invoice_items
       WHERE invoice_id = ? AND company_id = ?`,
      [invoiceId, company_id]
    );

    const subtotal = Number(sum.subtotal);
    const tax_amount = Number(((subtotal * invoice.tax_rate) / 100).toFixed(2));
    const total_amount = Number((subtotal + tax_amount).toFixed(2));

    await connection.query(
      `UPDATE invoices
       SET subtotal = ?, tax_amount = ?, total_amount = ?
       WHERE id = ? AND company_id = ?`,
      [subtotal, tax_amount, total_amount, invoiceId, company_id]
    );

    await connection.commit();
    res.json({
      message: "Invoice item deleted & totals recalculated"
    });

  } catch (error) {
    await connection.rollback();
    console.error("❌ Delete invoice item error:", error);
    sendMutationError(res, error);
  } finally {
    connection.release();
  }
};
