const db = require("../db/connection");

let invoiceStatusColumnReady = false;
let invoiceMrpColumnsReady = false;
let invoiceDiscountColumnsReady = false;

const ensureInvoiceStatusColumn = async () => {
  if (invoiceStatusColumnReady) {
    return;
  }

  await db.query(
    "ALTER TABLE invoices MODIFY status VARCHAR(30) NOT NULL DEFAULT 'pending'"
  );

  invoiceStatusColumnReady = true;
};

const ensureInvoiceMrpColumns = async () => {
  if (invoiceMrpColumnsReady) {
    return;
  }

  const [productColumns] = await db.query("SHOW COLUMNS FROM products LIKE 'mrp'");
  if (!productColumns.length) {
    await db.query(
      "ALTER TABLE products ADD COLUMN mrp DECIMAL(10,2) NOT NULL DEFAULT 0"
    );
  }

  const [invoiceItemColumns] = await db.query("SHOW COLUMNS FROM invoice_items LIKE 'mrp'");
  if (!invoiceItemColumns.length) {
    await db.query(
      "ALTER TABLE invoice_items ADD COLUMN mrp DECIMAL(10,2) NOT NULL DEFAULT 0"
    );
  }

  invoiceMrpColumnsReady = true;
};

const ensureInvoiceDiscountColumns = async () => {
  if (invoiceDiscountColumnsReady) return;

  const [invoiceColumns] = await db.query("SHOW COLUMNS FROM invoices");
  const invoiceColumnNames = new Set(invoiceColumns.map((column) => column.Field));
  if (!invoiceColumnNames.has("discount_amount")) {
    await db.query(
      "ALTER TABLE invoices ADD COLUMN discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER subtotal"
    );
  }

  const [itemColumns] = await db.query("SHOW COLUMNS FROM invoice_items");
  const itemColumnNames = new Set(itemColumns.map((column) => column.Field));
  if (!itemColumnNames.has("discount_type")) {
    await db.query(
      "ALTER TABLE invoice_items ADD COLUMN discount_type VARCHAR(10) NOT NULL DEFAULT 'AMOUNT' AFTER mrp"
    );
  }
  if (!itemColumnNames.has("discount_value")) {
    await db.query(
      "ALTER TABLE invoice_items ADD COLUMN discount_value DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER discount_type"
    );
  }
  if (!itemColumnNames.has("discount_amount")) {
    await db.query(
      "ALTER TABLE invoice_items ADD COLUMN discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER discount_value"
    );
  }

  invoiceDiscountColumnsReady = true;
};

const calculateItemDiscount = (item, grossAmount) => {
  const discountType =
    String(item.discount_type || "AMOUNT").toUpperCase() === "PERCENT"
      ? "PERCENT"
      : "AMOUNT";
  const rawValue = Math.max(0, Number(item.discount_value ?? item.discount ?? 0));
  const discountValue =
    discountType === "PERCENT" ? Math.min(rawValue, 100) : rawValue;
  const discountAmount =
    discountType === "PERCENT"
      ? (grossAmount * discountValue) / 100
      : Math.min(discountValue, grossAmount);

  return { discountType, discountValue, discountAmount };
};

const normalizeBillDiscount = (type, value, available, label) => {
  const normalizedType = String(type || "amount").toLowerCase();
  if (!["percent", "amount"].includes(normalizedType)) {
    throw invoiceCreationError(`${label} discount type must be percent or amount`);
  }
  const normalizedValue = Number(value || 0);
  if (!Number.isFinite(normalizedValue) || normalizedValue < 0 || (normalizedType === "percent" && normalizedValue > 100)) {
    throw invoiceCreationError(`${label} discount value is invalid`);
  }
  const amount = normalizedType === "percent"
    ? (available * normalizedValue) / 100
    : Math.min(normalizedValue, available);
  return { type: normalizedType, value: normalizedValue, amount };
};

const parseSerialNumbers = (value, quantity) => {
  let serials = value ?? [];
  if (typeof serials === "string") {
    try { serials = JSON.parse(serials); } catch { serials = serials.split(/[\n,]+/); }
  }
  if (!Array.isArray(serials)) throw invoiceCreationError("Serial/IMEI values must be an array");
  serials = serials.map((serial) => String(serial).trim()).filter(Boolean);
  if (serials.some((serial) => serial.length > 100)) throw invoiceCreationError("Serial/IMEI values must not exceed 100 characters");
  if (serials.length > Number(quantity)) throw invoiceCreationError("Serial/IMEI count cannot exceed item quantity");
  return serials;
};

const normalizeDate = (value, label) => {
  if (!value) return null;
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw invoiceCreationError(`${label} is invalid`);
  }
  return text;
};

const normalizeAdvancedItem = (item, quantity) => {
  const unit = String(item.unit || "").trim() || null;
  const batchNo = String(item.batch_no || "").trim() || null;
  if (unit && unit.length > 30) throw invoiceCreationError("Unit must not exceed 30 characters");
  if (batchNo && batchNo.length > 100) throw invoiceCreationError("Batch number must not exceed 100 characters");
  const manufacturedDate = normalizeDate(item.manufactured_date, "Manufacturing date");
  const expiryDate = normalizeDate(item.expiry_date, "Expiry date");
  if (manufacturedDate && expiryDate && expiryDate < manufacturedDate) {
    throw invoiceCreationError("Expiry date cannot precede manufacturing date");
  }
  return {
    description: String(item.description || "").slice(0, 2000) || null,
    unit,
    serials: parseSerialNumbers(item.serial_numbers ?? item.serial_numbers_json, quantity),
    batchNo,
    manufacturedDate,
    expiryDate,
  };
};

const calculateInvoiceLevelTotals = ({ subtotal, itemDiscount, tax, body }) => {
  const afterItemsAndTax = subtotal - itemDiscount + tax;
  const overall = normalizeBillDiscount(body.overall_discount_type, body.overall_discount_value, afterItemsAndTax, "Overall");
  const afterOverall = Math.max(0, afterItemsAndTax - overall.amount);
  const additional = normalizeBillDiscount(body.additional_discount_type, body.additional_discount_value, afterOverall, "Additional");
  const beforeRoundOff = Math.max(0, afterOverall - additional.amount);
  const roundOff = Number(body.round_off_amount || 0);
  if (!Number.isFinite(roundOff) || Math.abs(roundOff) > 1) throw invoiceCreationError("Round-off amount must be between -1 and 1");
  return { overall, additional, roundOff, total: Math.max(0, beforeRoundOff + roundOff) };
};

/**
 * 🔢 AUTO INVOICE NUMBER GENERATOR
 */
const getNextInvoiceNumberFromExisting = async (company_id, prefix, executor = db) => {
  const likePattern = `${prefix}-%`;
  const [rows] = await executor.query(
    `SELECT MAX(CAST(SUBSTRING_INDEX(invoice_number, '-', -1) AS UNSIGNED)) AS max_number
     FROM invoices
     WHERE company_id = ? AND invoice_number LIKE ?`,
    [company_id, likePattern]
  );

  return Number(rows[0]?.max_number || 0) + 1;
};

const generateInvoiceNumber = async (company_id, executor = db) => {
  const [settings] = await executor.query(
    "SELECT * FROM invoice_settings WHERE company_id=? LIMIT 1 FOR UPDATE",
    [company_id]
  );

  if (!settings.length) {
    const prefix = "INV";
    const nextNumber = await getNextInvoiceNumberFromExisting(company_id, prefix, executor);

    await executor.query(
      `INSERT INTO invoice_settings (company_id, prefix, current_number)
       VALUES (?, ?, ?)`,
      [company_id, prefix, nextNumber]
    );

    return generateInvoiceNumber(company_id, executor);
  }

  const { prefix, current_number } = settings[0];
  const nextNumberFromExisting =
    await getNextInvoiceNumberFromExisting(company_id, prefix, executor);
  const invoiceNumberValue = Math.max(
    Number(current_number || 1),
    nextNumberFromExisting
  );

  const invoiceNumber =
    `${prefix}-${String(invoiceNumberValue).padStart(4, "0")}`;

  await executor.query(
    "UPDATE invoice_settings SET current_number = ? WHERE company_id=?",
    [invoiceNumberValue + 1, company_id]
  );

  return invoiceNumber;
};

/**
 * ===============================
 * ✅ CREATE INVOICE + STOCK FIX
 * ===============================
 */
const invoiceCreationError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const ensureInvoiceCreationSchema = async () => {
  await ensureInvoiceMrpColumns();
  await ensureInvoiceDiscountColumns();
};

const createInvoiceRecord = async ({ body, user, connection = db }) => {
    await ensureInvoiceCreationSchema();

    const { invoice_date, customer_id, customer_name, items } = body;
    const company_id = user.company_id;
    const created_by = user.user_id;

    if (!invoice_date || !customer_name || !items?.length) {
      throw invoiceCreationError("Missing required fields");
    }

    const invoice_number = await generateInvoiceNumber(company_id, connection);

    let subtotal = 0;
    let discount_amount = 0;
    let tax_amount = 0;

    const processedItems = [];

    // ✅ VALIDATE STOCK
    for (let item of items) {
      console.log("👉 Checking item:", item);

      if (!item.product_id) {
        throw invoiceCreationError(`product_id missing for ${item.name}`);
      }

      const [productRows] = await connection.query(
        "SELECT id, name, stock FROM products WHERE id=? AND company_id=? FOR UPDATE",
        [item.product_id, company_id]
      );

      if (!productRows.length) {
        throw invoiceCreationError(`Product not found: ${item.name}`);
      }

      const availableStock = productRows[0].stock;

      if (availableStock < item.quantity) {
        throw invoiceCreationError(
          `Insufficient stock for ${item.name}. Available: ${availableStock}`
        );
      }

      const qty = Number(item.quantity || 0);
      const price = Number(item.unit_price || 0);
      const mrp = Number(item.mrp || 0);
      const gst = Number(item.gst_rate || 0);
      if (!Number.isFinite(gst) || gst < 0 || gst > 100) {
        throw invoiceCreationError("GST rate is invalid");
      }
      const advanced = normalizeAdvancedItem(item, qty);

      const base = qty * price;
      const discount = calculateItemDiscount(item, base);
      const taxableBase = base - discount.discountAmount;
      const gstAmount = (taxableBase * gst) / 100;
      const total = taxableBase + gstAmount;

      subtotal += base;
      discount_amount += discount.discountAmount;
      tax_amount += gstAmount;

      processedItems.push({
        product_id: item.product_id,
        name: String(item.name || productRows[0].name).trim(),
        ...advanced,
        quantity: qty,
        price,
        mrp,
        discount_type: discount.discountType,
        discount_value: discount.discountValue,
        discount_amount: discount.discountAmount,
        gst,
        total
      });
    }

    const invoiceLevel = calculateInvoiceLevelTotals({ subtotal, itemDiscount: discount_amount, tax: tax_amount, body });
    const cgst = tax_amount / 2;
    const sgst = tax_amount / 2;
    const igst = 0;
    const total_amount = invoiceLevel.total;

    // ✅ INSERT INVOICE
    const [invoiceResult] = await connection.query(
      `INSERT INTO invoices 
      (company_id, created_by, invoice_number, invoice_date, customer_id, customer_name, subtotal, discount_amount, tax_amount, cgst, sgst, igst,
       overall_discount_type, overall_discount_value, overall_discount_amount, additional_discount_type, additional_discount_value, additional_discount_amount, round_off_amount, total_amount)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        company_id,
        created_by,
        invoice_number,
        invoice_date,
        customer_id || null,
        customer_name,
        subtotal,
        discount_amount,
        tax_amount,
        cgst,
        sgst,
        igst,
        invoiceLevel.overall.type,
        invoiceLevel.overall.value,
        invoiceLevel.overall.amount,
        invoiceLevel.additional.type,
        invoiceLevel.additional.value,
        invoiceLevel.additional.amount,
        invoiceLevel.roundOff,
        total_amount
      ]
    );

    const invoice_id = invoiceResult.insertId;

    // ✅ INSERT ITEMS + DEDUCT STOCK
    for (let item of processedItems) {
      await connection.query(
        `INSERT INTO invoice_items 
        (invoice_id, company_id, product_id, item_name, description, quantity, unit, serial_numbers_json, batch_no, manufactured_date, expiry_date,
         unit_price, mrp, discount_type, discount_value, discount_amount, total_price, gst_rate)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          invoice_id,
          company_id,
          item.product_id,
          item.name,
          item.description,
          item.quantity,
          item.unit,
          item.serials.length ? JSON.stringify(item.serials) : null,
          item.batchNo,
          item.manufacturedDate,
          item.expiryDate,
          item.price,
          item.mrp,
          item.discount_type,
          item.discount_value,
          item.discount_amount,
          item.total,
          item.gst
        ]
      );

      await connection.query(
        `UPDATE products 
         SET stock = stock - ? 
         WHERE id = ? AND company_id = ?`,
        [item.quantity, item.product_id, company_id]
      );
    }

    return {
      message: "Invoice created & stock updated ✅",
      invoice_id,
      invoice_number
    };
};

exports.createInvoiceRecord = createInvoiceRecord;
exports.ensureInvoiceCreationSchema = ensureInvoiceCreationSchema;
exports.calculateInvoiceLevelTotals = calculateInvoiceLevelTotals;
exports.normalizeAdvancedItem = normalizeAdvancedItem;

exports.createInvoice = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const invoice = await createInvoiceRecord({
      body: req.body,
      user: req.user,
      connection,
    });
    await connection.commit();
    res.status(201).json(invoice);
  } catch (error) {
    await connection.rollback();
    console.error("❌ CREATE ERROR:", error);
    res.status(error.status || 500).json({
      message: error.status ? error.message : "Server error",
    });
  } finally {
    connection.release();
  }
};

/**
 * ===============================
 * 📄 GET ALL INVOICES
 * ===============================
 */
exports.getInvoices = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT
        i.*,
        LOWER(COALESCE(i.status, 'pending')) AS status,
        CASE
          WHEN LOWER(COALESCE(i.status, '')) = 'paid' THEN i.total_amount
          ELSE COALESCE(payment_totals.paid_amount, 0)
        END AS paid_amount,
        GREATEST(
          i.total_amount -
          CASE
            WHEN LOWER(COALESCE(i.status, '')) = 'paid' THEN i.total_amount
            ELSE COALESCE(payment_totals.paid_amount, 0)
          END,
          0
        ) AS due_amount
       FROM invoices i
       LEFT JOIN (
         SELECT invoice_id, company_id, SUM(amount) AS paid_amount
         FROM payments
         GROUP BY invoice_id, company_id
       ) payment_totals
         ON payment_totals.invoice_id = i.id
        AND payment_totals.company_id = i.company_id
       WHERE i.company_id=?
       ORDER BY i.id DESC`,
      [req.user.company_id]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * ===============================
 * 🔍 GET INVOICE BY ID
 * ===============================
 */
exports.getInvoiceById = async (req, res) => {
  try {
    const { id } = req.params;
    const company_id = req.user.company_id;

    const [invoice] = await db.query(
      `SELECT
        i.*,
        c.phone AS customer_phone,
        c.email AS customer_email,
        c.address AS customer_address,
        LOWER(COALESCE(i.status, 'pending')) AS status,
        CASE
          WHEN LOWER(COALESCE(i.status, '')) = 'paid' THEN i.total_amount
          ELSE COALESCE(payment_totals.paid_amount, 0)
        END AS paid_amount,
        GREATEST(
          i.total_amount -
          CASE
            WHEN LOWER(COALESCE(i.status, '')) = 'paid' THEN i.total_amount
            ELSE COALESCE(payment_totals.paid_amount, 0)
          END,
          0
        ) AS due_amount
       FROM invoices i
       LEFT JOIN customers c
         ON c.name = i.customer_name
        AND c.company_id = i.company_id
       LEFT JOIN (
         SELECT invoice_id, company_id, SUM(amount) AS paid_amount
         FROM payments
         GROUP BY invoice_id, company_id
       ) payment_totals
         ON payment_totals.invoice_id = i.id
        AND payment_totals.company_id = i.company_id
       WHERE i.id=? AND i.company_id=?`,
      [id, company_id]
    );

    if (!invoice.length) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    const [items] = await db.query(
      `SELECT
        ii.*,
        p.hsn AS hsn,
        p.sku AS sku
       FROM invoice_items ii
       LEFT JOIN products p
         ON p.name = ii.item_name
        AND p.company_id = ii.company_id
       WHERE ii.invoice_id=? AND ii.company_id=?
       ORDER BY ii.id ASC`,
      [id, company_id]
    );

    res.json({
      ...invoice[0],
      items
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * ===============================
 * 🗑 DELETE INVOICE (RESTORE STOCK)
 * ===============================
 */
exports.deleteInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const company_id = req.user.company_id;

    const [invoice] = await db.query(
      "SELECT id FROM invoices WHERE id=? AND company_id=?",
      [id, company_id]
    );

    if (!invoice.length) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    const [items] = await db.query(
      "SELECT * FROM invoice_items WHERE invoice_id=? AND company_id=?",
      [id, company_id]
    );

    // 🔁 RESTORE STOCK
    for (let item of items) {
      if (item.product_id) {
        await db.query("UPDATE products SET stock = stock + ? WHERE id=? AND company_id=?", [item.quantity, item.product_id, company_id]);
      } else {
        await db.query("UPDATE products SET stock = stock + ? WHERE name=? AND company_id=?", [item.quantity, item.item_name, company_id]);
      }
    }

    await db.query(
      "DELETE FROM invoices WHERE id=? AND company_id=?",
      [id, company_id]
    );

    res.json({ message: "Invoice deleted & stock restored ✅" });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/**
 * ===============================
 * ✏️ UPDATE INVOICE (BASIC)
 * ===============================
 */
exports.updateInvoice = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await ensureInvoiceMrpColumns();
    await ensureInvoiceDiscountColumns();

    const { id } = req.params;
    const company_id = req.user.company_id;
    const { invoice_date, customer_id, customer_name, items } = req.body;

    if (!invoice_date || !customer_name || !items?.length) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    await ensureInvoiceStatusColumn();
    await connection.beginTransaction();

    const [invoiceRows] = await connection.query(
      "SELECT id, status FROM invoices WHERE id=? AND company_id=?",
      [id, company_id]
    );

    if (!invoiceRows.length) {
      await connection.rollback();
      return res.status(404).json({ message: "Invoice not found" });
    }

    const [oldItems] = await connection.query(
      "SELECT * FROM invoice_items WHERE invoice_id=? AND company_id=?",
      [id, company_id]
    );

    for (const item of oldItems) {
      if (item.product_id) {
        await connection.query("UPDATE products SET stock = stock + ? WHERE id=? AND company_id=?", [Number(item.quantity || 0), item.product_id, company_id]);
      } else {
        await connection.query("UPDATE products SET stock = stock + ? WHERE name=? AND company_id=?", [Number(item.quantity || 0), item.item_name, company_id]);
      }
    }

    let subtotal = 0;
    let discount_amount = 0;
    let tax_amount = 0;
    const processedItems = [];

    for (const item of items) {
      const name = String(item.name || item.item_name || "").trim();
      const qty = Number(item.quantity || 0);
      const price = Number(item.unit_price || item.price || 0);
      const mrp = Number(item.mrp || 0);
      const gst = Number(item.gst_rate || item.gst || 0);

      if (!name || qty <= 0) {
        await connection.rollback();
        return res.status(400).json({ message: "Please enter valid invoice items" });
      }

      const productId = Number(item.product_id || 0);
      const [productRows] = productId > 0
        ? await connection.query("SELECT id, name, stock FROM products WHERE id=? AND company_id=? LIMIT 1 FOR UPDATE", [productId, company_id])
        : await connection.query("SELECT id, name, stock FROM products WHERE name=? AND company_id=? LIMIT 1 FOR UPDATE", [name, company_id]);

      if (!productRows.length) {
        await connection.rollback();
        return res.status(400).json({ message: `Product not found: ${name}` });
      }

      if (Number(productRows[0].stock || 0) < qty) {
        await connection.rollback();
        return res.status(400).json({
          message: `Insufficient stock for ${name}. Available: ${productRows[0].stock}`
        });
      }

      const base = qty * price;
      const discount = calculateItemDiscount(item, base);
      const taxableBase = base - discount.discountAmount;
      const gstAmount = (taxableBase * gst) / 100;
      const total = taxableBase + gstAmount;
      if (!Number.isFinite(gst) || gst < 0 || gst > 100) {
        await connection.rollback();
        return res.status(400).json({ message: "GST rate is invalid" });
      }
      const advanced = normalizeAdvancedItem(item, qty);

      subtotal += base;
      discount_amount += discount.discountAmount;
      tax_amount += gstAmount;

      processedItems.push({
        product_id: productRows[0].id,
        name,
        ...advanced,
        quantity: qty,
        price,
        mrp,
        discount_type: discount.discountType,
        discount_value: discount.discountValue,
        discount_amount: discount.discountAmount,
        gst,
        total
      });
    }

    const invoiceLevel = calculateInvoiceLevelTotals({ subtotal, itemDiscount: discount_amount, tax: tax_amount, body: req.body });
    const total_amount = invoiceLevel.total;
    const [paymentRows] = await connection.query(
      `SELECT COALESCE(SUM(amount), 0) AS paid_amount
       FROM payments
       WHERE invoice_id=? AND company_id=?`,
      [id, company_id]
    );
    const paymentSum = Number(paymentRows[0]?.paid_amount || 0);
    const wasMarkedPaid =
      String(invoiceRows[0]?.status || "").toLowerCase() === "paid";
    const paidAmount = paymentSum > 0 || !wasMarkedPaid ? paymentSum : total_amount;

    if (paidAmount > total_amount) {
      await connection.rollback();
      return res.status(400).json({
        message: "Invoice total cannot be less than amount already received"
      });
    }

    const status =
      paidAmount >= total_amount && total_amount > 0
        ? "paid"
        : paidAmount > 0
        ? "partial"
        : "pending";

    await connection.query(
      `UPDATE invoices
       SET invoice_date=?, customer_id=?, customer_name=?, subtotal=?, discount_amount=?, tax_amount=?, cgst=?, sgst=?, igst=?,
           overall_discount_type=?, overall_discount_value=?, overall_discount_amount=?, additional_discount_type=?, additional_discount_value=?, additional_discount_amount=?, round_off_amount=?, total_amount=?, status=?
       WHERE id=? AND company_id=?`,
      [
        invoice_date,
        customer_id || null,
        customer_name,
        subtotal,
        discount_amount,
        tax_amount,
        tax_amount / 2,
        tax_amount / 2,
        0,
        invoiceLevel.overall.type,
        invoiceLevel.overall.value,
        invoiceLevel.overall.amount,
        invoiceLevel.additional.type,
        invoiceLevel.additional.value,
        invoiceLevel.additional.amount,
        invoiceLevel.roundOff,
        total_amount,
        status,
        id,
        company_id
      ]
    );

    await connection.query(
      "DELETE FROM invoice_items WHERE invoice_id=? AND company_id=?",
      [id, company_id]
    );

    for (const item of processedItems) {
      await connection.query(
        `INSERT INTO invoice_items
        (invoice_id, company_id, product_id, item_name, description, quantity, unit, serial_numbers_json, batch_no, manufactured_date, expiry_date,
         unit_price, mrp, discount_type, discount_value, discount_amount, total_price, gst_rate)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, company_id, item.product_id, item.name, item.description, item.quantity, item.unit,
          item.serials.length ? JSON.stringify(item.serials) : null, item.batchNo, item.manufacturedDate, item.expiryDate,
          item.price, item.mrp, item.discount_type, item.discount_value, item.discount_amount, item.total, item.gst]
      );

      await connection.query(
        "UPDATE products SET stock = stock - ? WHERE id=? AND company_id=?",
        [item.quantity, item.product_id, company_id]
      );
    }

    await connection.commit();
    res.json({ message: "Invoice updated", status });
  } catch (error) {
    await connection.rollback();
    console.error("Update invoice error:", error);
    res.status(error.status || 500).json({
      message: error.status ? error.message : "Server error",
      ...(error.status ? {} : { error: error.message }),
    });
  } finally {
    connection.release();
  }
};

exports.getPartyItemRate = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const customerId = Number(req.query.customer_id);
    const productId = Number(req.query.product_id);
    if (!Number.isSafeInteger(customerId) || customerId <= 0 || !Number.isSafeInteger(productId) || productId <= 0) {
      return res.status(400).json({ message: "Valid customer_id and product_id are required" });
    }
    const [products] = await db.query(
      "SELECT id, sellingPrice FROM products WHERE id=? AND company_id=? AND status='Active' LIMIT 1",
      [productId, companyId]
    );
    if (!products.length) return res.status(404).json({ message: "Product not found" });
    const [history] = await db.query(
      `SELECT ii.unit_price
       FROM invoice_items ii
       INNER JOIN invoices i ON i.id=ii.invoice_id AND i.company_id=ii.company_id
       WHERE ii.company_id=? AND i.customer_id=? AND ii.product_id=?
         AND LOWER(COALESCE(i.status,'pending')) <> 'cancelled'
       ORDER BY i.invoice_date DESC, i.id DESC, ii.id DESC LIMIT 1`,
      [companyId, customerId, productId]
    );
    return res.json({
      rate: Number(history[0]?.unit_price ?? products[0].sellingPrice ?? 0),
      source: history.length ? "customer_history" : "product",
    });
  } catch (error) {
    console.error("Party item rate error:", error);
    return res.status(500).json({ message: "Unable to resolve item rate" });
  }
};

/**
 * ===============================
 * 🔄 UPDATE STATUS
 * ===============================
 */
exports.updateInvoiceStatus = async (req, res) => {
  const { id } = req.params;
  const requestedStatus = String(req.body.status || "").toLowerCase();
  const statusMap = {
    paid: "paid",
    pending: "pending",
    partial: "partial",
    "partial paid": "partial"
  };
  const status = statusMap[requestedStatus];
  const company_id = req.user.company_id;

  if (!status) {
    return res.status(400).json({ message: "Invalid invoice status" });
  }

  await ensureInvoiceStatusColumn();

  const [result] = await db.query(
    "UPDATE invoices SET status=? WHERE id=? AND company_id=?",
    [status, id, company_id]
  );

  if (result.affectedRows === 0) {
    return res.status(404).json({ message: "Invoice not found" });
  }

  res.json({ message: "Status updated" });
};

/**
 * ===============================
 * 📄 GENERATE PDF (BASIC)
 * ===============================
 */
exports.generateInvoicePDF = async (req, res) => {
  res.json({ message: "PDF generation coming soon" });
};
