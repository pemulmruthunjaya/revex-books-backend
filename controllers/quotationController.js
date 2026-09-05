const db = require("../db/connection");
const { requireFinancialYearForDate, rejectClientFinancialYear } = require("../services/financialYearService");
const { postSalesInvoiceJournal } = require("../services/salesInvoiceAccountingService");

let quotationTablesReady = false;

const ensureQuotationTables = async () => {
  if (quotationTablesReady) {
    return;
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS quotations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      company_id INT NOT NULL,
      customer_id INT NULL,
      customer_name VARCHAR(255) NOT NULL,
      quotation_number VARCHAR(100) NOT NULL,
      quotation_date DATE NOT NULL,
      valid_until DATE NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'Draft',
      notes TEXT NULL,
      subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
      discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_quotation_company_number (company_id, quotation_number),
      INDEX idx_quotation_company_customer (company_id, customer_name),
      INDEX idx_quotation_company_status (company_id, status)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS quotation_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      quotation_id INT NOT NULL,
      product_id INT NOT NULL,
      product_name VARCHAR(255) NOT NULL,
      hsn VARCHAR(100) NULL,
      mrp DECIMAL(10,2) NOT NULL DEFAULT 0,
      quantity DECIMAL(12,2) NOT NULL DEFAULT 0,
      price DECIMAL(12,2) NOT NULL DEFAULT 0,
      discount DECIMAL(12,2) NOT NULL DEFAULT 0,
      gst_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
      cgst DECIMAL(12,2) NOT NULL DEFAULT 0,
      sgst DECIMAL(12,2) NOT NULL DEFAULT 0,
      total DECIMAL(12,2) NOT NULL DEFAULT 0,
      INDEX idx_quotation_items_quote (quotation_id),
      INDEX idx_quotation_items_product (product_id)
    )
  `);

  quotationTablesReady = true;
};

const ensureInvoiceConversionColumns = async (connection) => {
  const [invoiceColumns] = await connection.query("SHOW COLUMNS FROM invoices");
  const invoiceColumnNames = new Set(invoiceColumns.map((column) => column.Field));

  if (!invoiceColumnNames.has("source_quotation_id")) {
    await connection.query(
      "ALTER TABLE invoices ADD COLUMN source_quotation_id INT NULL"
    );
  }

  const [itemColumns] = await connection.query("SHOW COLUMNS FROM invoice_items");
  const itemColumnNames = new Set(itemColumns.map((column) => column.Field));

  if (!itemColumnNames.has("mrp")) {
    await connection.query(
      "ALTER TABLE invoice_items ADD COLUMN mrp DECIMAL(10,2) NOT NULL DEFAULT 0"
    );
  }
};

const allowedStatuses = ["Draft", "Sent", "Accepted", "Rejected", "Converted"];

const getNextNumber = async (connection, companyId, prefix, table, numberColumn) => {
  const [rows] = await connection.query(
    `SELECT ${numberColumn} AS document_number
     FROM ${table}
     WHERE company_id = ? AND ${numberColumn} LIKE ?`,
    [companyId, `${prefix}-%`]
  );

  const maxNumber = rows.reduce((max, row) => {
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = String(row.document_number || "").match(
      new RegExp(`^${escapedPrefix}-?(\\d+)$`, "i")
    );
    return match ? Math.max(max, Number(match[1] || 0)) : max;
  }, 0);

  return `${prefix}-${String(maxNumber + 1).padStart(4, "0")}`;
};

const processItems = async (connection, companyId, items = []) => {
  if (!items.length) {
    throw new Error("Please add at least one item");
  }

  let subtotal = 0;
  let discountAmount = 0;
  let taxAmount = 0;
  const processedItems = [];

  for (const item of items) {
    const productId = Number(item.product_id || 0);
    const qty = Number(item.quantity || item.qty || 0);
    const price = Number(item.price || item.unit_price || 0);
    const mrp = Number(item.mrp || 0);
    const discount = Number(item.discount || 0);
    const gst = Number(item.gst_percent || item.gst_rate || item.gst || 0);

    if (!productId || qty <= 0) {
      throw new Error("Please select valid items and quantity");
    }

    const [products] = await connection.query(
      "SELECT id, name, hsn FROM products WHERE id = ? AND company_id = ? LIMIT 1",
      [productId, companyId]
    );

    if (!products.length) {
      throw new Error("Selected product was not found");
    }

    const gross = qty * price;
    const netBase = Math.max(gross - discount, 0);
    const gstValue = (netBase * gst) / 100;
    const total = netBase + gstValue;

    subtotal += gross;
    discountAmount += discount;
    taxAmount += gstValue;

    processedItems.push({
      product_id: products[0].id,
      product_name: products[0].name,
      hsn: products[0].hsn || item.hsn || null,
      mrp,
      quantity: qty,
      price,
      discount,
      gst_percent: gst,
      cgst: gstValue / 2,
      sgst: gstValue / 2,
      total,
    });
  }

  return {
    items: processedItems,
    subtotal,
    discountAmount,
    taxAmount,
    totalAmount: subtotal - discountAmount + taxAmount,
  };
};

exports.createQuotation = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await ensureQuotationTables();

    const companyId = req.user.company_id;
    const {
      customer_id,
      customer_name,
      quotation_number,
      quotation_date,
      valid_until,
      notes,
      items,
    } = req.body;

    if (!customer_name || !quotation_number || !quotation_date) {
      return res.status(400).json({
        message: "Customer, quotation number, and quotation date are required",
      });
    }

    await connection.beginTransaction();
    const processed = await processItems(connection, companyId, items);

    const [result] = await connection.query(
      `INSERT INTO quotations
        (company_id, customer_id, customer_name, quotation_number, quotation_date,
         valid_until, status, notes, subtotal, discount_amount, tax_amount,
         total_amount, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'Draft', ?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        customer_id || null,
        String(customer_name).trim(),
        String(quotation_number).trim(),
        quotation_date,
        valid_until || null,
        notes || null,
        processed.subtotal,
        processed.discountAmount,
        processed.taxAmount,
        processed.totalAmount,
        req.user.user_id || null,
      ]
    );

    for (const item of processed.items) {
      await connection.query(
        `INSERT INTO quotation_items
          (quotation_id, product_id, product_name, hsn, mrp, quantity, price,
           discount, gst_percent, cgst, sgst, total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          result.insertId,
          item.product_id,
          item.product_name,
          item.hsn,
          item.mrp,
          item.quantity,
          item.price,
          item.discount,
          item.gst_percent,
          item.cgst,
          item.sgst,
          item.total,
        ]
      );
    }

    await connection.commit();
    res.status(201).json({
      message: "Quotation created",
      quotation_id: result.insertId,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Create quotation error:", error);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Quotation number already exists" });
    }

    res.status(error.status || 500).json({
      message: error.status ? error.message : "Server error",
      ...(error.code ? { code: error.code } : {}),
    });
  } finally {
    connection.release();
  }
};

exports.getQuotations = async (req, res) => {
  try {
    await ensureQuotationTables();

    const [rows] = await db.query(
      `SELECT *
       FROM quotations
       WHERE company_id = ?
       ORDER BY id DESC`,
      [req.user.company_id]
    );

    res.json(rows);
  } catch (error) {
    console.error("Get quotations error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getQuotationById = async (req, res) => {
  try {
    await ensureQuotationTables();

    const [rows] = await db.query(
      "SELECT * FROM quotations WHERE id = ? AND company_id = ? LIMIT 1",
      [req.params.id, req.user.company_id]
    );

    if (!rows.length) {
      return res.status(404).json({ message: "Quotation not found" });
    }

    const [items] = await db.query(
      "SELECT * FROM quotation_items WHERE quotation_id = ? ORDER BY id ASC",
      [req.params.id]
    );

    res.json({ ...rows[0], items });
  } catch (error) {
    console.error("Get quotation error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.updateQuotation = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await ensureQuotationTables();

    const companyId = req.user.company_id;
    const {
      customer_id,
      customer_name,
      quotation_number,
      quotation_date,
      valid_until,
      notes,
      items,
    } = req.body;

    if (!customer_name || !quotation_number || !quotation_date) {
      return res.status(400).json({
        message: "Customer, quotation number, and quotation date are required",
      });
    }

    await connection.beginTransaction();

    const [existing] = await connection.query(
      "SELECT id, status FROM quotations WHERE id = ? AND company_id = ? LIMIT 1",
      [req.params.id, companyId]
    );

    if (!existing.length) {
      await connection.rollback();
      return res.status(404).json({ message: "Quotation not found" });
    }

    if (existing[0].status === "Converted") {
      await connection.rollback();
      return res.status(400).json({ message: "Converted quotation cannot be edited" });
    }

    const processed = await processItems(connection, companyId, items);

    await connection.query(
      `UPDATE quotations
       SET customer_id = ?, customer_name = ?, quotation_number = ?,
           quotation_date = ?, valid_until = ?, notes = ?, subtotal = ?,
           discount_amount = ?, tax_amount = ?, total_amount = ?
       WHERE id = ? AND company_id = ?`,
      [
        customer_id || null,
        String(customer_name).trim(),
        String(quotation_number).trim(),
        quotation_date,
        valid_until || null,
        notes || null,
        processed.subtotal,
        processed.discountAmount,
        processed.taxAmount,
        processed.totalAmount,
        req.params.id,
        companyId,
      ]
    );

    await connection.query("DELETE FROM quotation_items WHERE quotation_id = ?", [
      req.params.id,
    ]);

    for (const item of processed.items) {
      await connection.query(
        `INSERT INTO quotation_items
          (quotation_id, product_id, product_name, hsn, mrp, quantity, price,
           discount, gst_percent, cgst, sgst, total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.params.id,
          item.product_id,
          item.product_name,
          item.hsn,
          item.mrp,
          item.quantity,
          item.price,
          item.discount,
          item.gst_percent,
          item.cgst,
          item.sgst,
          item.total,
        ]
      );
    }

    await connection.commit();
    res.json({ message: "Quotation updated" });
  } catch (error) {
    await connection.rollback();
    console.error("Update quotation error:", error);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Quotation number already exists" });
    }

    res.status(500).json({ message: error.message || "Server error" });
  } finally {
    connection.release();
  }
};

exports.updateQuotationStatus = async (req, res) => {
  try {
    await ensureQuotationTables();

    const status = String(req.body.status || "").trim();

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid quotation status" });
    }

    const [existing] = await db.query(
      "SELECT status FROM quotations WHERE id = ? AND company_id = ? LIMIT 1",
      [req.params.id, req.user.company_id]
    );

    if (!existing.length) {
      return res.status(404).json({ message: "Quotation not found" });
    }

    if (existing[0].status === "Converted") {
      return res.status(400).json({ message: "Converted quotation status cannot be changed" });
    }

    if (status === "Converted") {
      return res.status(400).json({ message: "Use Convert to Invoice for this status" });
    }

    const [result] = await db.query(
      "UPDATE quotations SET status = ? WHERE id = ? AND company_id = ?",
      [status, req.params.id, req.user.company_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Quotation not found" });
    }

    res.json({ message: "Quotation status updated" });
  } catch (error) {
    console.error("Update quotation status error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.convertQuotationToInvoice = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await ensureQuotationTables();

    const companyId = req.user.company_id;
    rejectClientFinancialYear(req.body);
    const invoiceDate = req.body.invoice_date || new Date().toISOString().slice(0, 10);

    await ensureInvoiceConversionColumns(connection);
    await connection.beginTransaction();
    const financialYear = await requireFinancialYearForDate(companyId, invoiceDate, connection);

    const [quotations] = await connection.query(
      `SELECT *
       FROM quotations
       WHERE id = ? AND company_id = ?
       LIMIT 1
       FOR UPDATE`,
      [req.params.id, companyId]
    );

    if (!quotations.length) {
      await connection.rollback();
      return res.status(404).json({ message: "Quotation not found" });
    }

    const quotation = quotations[0];

    if (quotation.status === "Converted") {
      await connection.rollback();
      return res.status(400).json({ message: "This quotation is already converted" });
    }

    if (quotation.status === "Rejected") {
      await connection.rollback();
      return res.status(400).json({ message: "Rejected quotation cannot be converted" });
    }

    const [existingInvoices] = await connection.query(
      `SELECT id, invoice_number
       FROM invoices
       WHERE company_id = ? AND source_quotation_id = ?
       LIMIT 1`,
      [companyId, req.params.id]
    );

    if (existingInvoices.length) {
      await connection.rollback();
      return res.status(409).json({
        message: `This quotation is already converted to invoice ${existingInvoices[0].invoice_number}`,
        invoice_id: existingInvoices[0].id,
      });
    }

    const [items] = await connection.query(
      "SELECT * FROM quotation_items WHERE quotation_id = ? ORDER BY id ASC",
      [req.params.id]
    );

    if (!items.length) {
      await connection.rollback();
      return res.status(400).json({ message: "Quotation has no items to convert" });
    }

    for (const item of items) {
      const [products] = await connection.query(
        "SELECT stock FROM products WHERE id = ? AND company_id = ? LIMIT 1",
        [item.product_id, companyId]
      );

      if (!products.length) {
        await connection.rollback();
        return res.status(400).json({ message: `Product not found: ${item.product_name}` });
      }

      if (Number(products[0].stock || 0) < Number(item.quantity || 0)) {
        await connection.rollback();
        return res.status(400).json({
          message: `Insufficient stock for ${item.product_name}. Available: ${products[0].stock}`,
        });
      }
    }

    const invoiceNumber = await getNextNumber(
      connection,
      companyId,
      "INV",
      "invoices",
      "invoice_number"
    );

    const [invoiceResult] = await connection.query(
      `INSERT INTO invoices
        (company_id, financial_year_id, created_by, invoice_number, invoice_date, customer_name,
         subtotal, tax_amount, cgst, sgst, igst, total_amount, status, source_quotation_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'pending', ?)`,
      [
        companyId,
        financialYear.id,
        req.user.user_id || null,
        invoiceNumber,
        invoiceDate,
        quotation.customer_name,
        Number(quotation.subtotal || 0) - Number(quotation.discount_amount || 0),
        quotation.tax_amount,
        Number(quotation.tax_amount || 0) / 2,
        Number(quotation.tax_amount || 0) / 2,
        quotation.total_amount,
        req.params.id,
      ]
    );

    const invoiceId = invoiceResult.insertId;

    for (const item of items) {
      await connection.query(
        `INSERT INTO invoice_items
          (invoice_id, company_id, item_name, quantity, unit_price, mrp, total_price, gst_rate)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          invoiceId,
          companyId,
          item.product_name,
          item.quantity,
          item.price,
          item.mrp,
          item.total,
          item.gst_percent,
        ]
      );

      await connection.query(
        "UPDATE products SET stock = stock - ? WHERE id = ? AND company_id = ?",
        [item.quantity, item.product_id, companyId]
      );
    }

    await postSalesInvoiceJournal(connection, {
      id: invoiceId,
      company_id: companyId,
      financial_year_id: financialYear.id,
      created_by: req.user.user_id || null,
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      total_amount: quotation.total_amount,
      tax_amount: quotation.tax_amount,
    });

    await connection.query(
      "UPDATE quotations SET status = 'Converted' WHERE id = ? AND company_id = ?",
      [req.params.id, companyId]
    );

    await connection.commit();
    res.status(201).json({
      message: "Quotation converted to invoice",
      invoice_id: invoiceId,
      invoice_number: invoiceNumber,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Convert quotation error:", error);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Invoice number already exists" });
    }

    res.status(500).json({ message: error.message || "Server error" });
  } finally {
    connection.release();
  }
};

exports.deleteQuotation = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await ensureQuotationTables();

    await connection.beginTransaction();

    const [existing] = await connection.query(
      "SELECT id, status FROM quotations WHERE id = ? AND company_id = ? LIMIT 1",
      [req.params.id, req.user.company_id]
    );

    if (!existing.length) {
      await connection.rollback();
      return res.status(404).json({ message: "Quotation not found" });
    }

    if (existing[0].status === "Converted") {
      await connection.rollback();
      return res.status(400).json({ message: "Converted quotation cannot be deleted" });
    }

    await connection.query("DELETE FROM quotation_items WHERE quotation_id = ?", [
      req.params.id,
    ]);
    await connection.query("DELETE FROM quotations WHERE id = ? AND company_id = ?", [
      req.params.id,
      req.user.company_id,
    ]);

    await connection.commit();
    res.json({ message: "Quotation deleted" });
  } catch (error) {
    await connection.rollback();
    console.error("Delete quotation error:", error);
    res.status(500).json({ message: "Server error" });
  } finally {
    connection.release();
  }
};
