const db = require("../db/connection");

let purchaseOrderTablesReady = false;

const ensurePurchaseOrderTables = async () => {
  if (purchaseOrderTablesReady) {
    return;
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      company_id INT NOT NULL,
      vendor_id INT NOT NULL,
      po_number VARCHAR(100) NOT NULL,
      po_date DATE NOT NULL,
      expected_date DATE NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'Draft',
      notes TEXT NULL,
      subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
      gst_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_po_company_number (company_id, po_number),
      INDEX idx_po_company_vendor (company_id, vendor_id),
      INDEX idx_po_company_status (company_id, status)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS purchase_order_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      purchase_order_id INT NOT NULL,
      product_id INT NOT NULL,
      product_name VARCHAR(255) NOT NULL,
      mrp DECIMAL(10,2) NOT NULL DEFAULT 0,
      quantity DECIMAL(12,2) NOT NULL DEFAULT 0,
      price DECIMAL(12,2) NOT NULL DEFAULT 0,
      gst_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
      cgst DECIMAL(12,2) NOT NULL DEFAULT 0,
      sgst DECIMAL(12,2) NOT NULL DEFAULT 0,
      total DECIMAL(12,2) NOT NULL DEFAULT 0,
      INDEX idx_po_items_order (purchase_order_id),
      INDEX idx_po_items_product (product_id)
    )
  `);

  purchaseOrderTablesReady = true;
};

const allowedStatuses = ["Draft", "Sent", "Approved", "Cancelled", "Closed", "Converted"];

const generatePurchaseOrderNumber = async (connection, companyId) => {
  const [rows] = await connection.query(
    "SELECT po_number FROM purchase_orders WHERE company_id=? AND po_number LIKE 'PO-%' ORDER BY id DESC LIMIT 100 FOR UPDATE",
    [companyId]
  );
  const max = rows.reduce((value, row) => {
    const match = String(row.po_number || "").match(/^PO-(\d+)$/i);
    return match ? Math.max(value, Number(match[1])) : value;
  }, 0);
  return `PO-${String(max + 1).padStart(6, "0")}`;
};

exports.getNextPurchaseOrderNumber = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await ensurePurchaseOrderTables();
    await connection.beginTransaction();
    const po_number = await generatePurchaseOrderNumber(connection, req.user.company_id);
    await connection.rollback();
    res.json({ po_number });
  } finally {
    connection.release();
  }
};

const ensureBillConversionColumns = async (connection) => {
  const [billColumns] = await connection.query("SHOW COLUMNS FROM bills");
  const billColumnNames = new Set(billColumns.map((column) => column.Field));

  if (!billColumnNames.has("source_purchase_order_id")) {
    await connection.query(
      "ALTER TABLE bills ADD COLUMN source_purchase_order_id INT NULL"
    );
  }

  const [billItemColumns] = await connection.query("SHOW COLUMNS FROM bill_items");
  const billItemColumnNames = new Set(billItemColumns.map((column) => column.Field));

  if (!billItemColumnNames.has("mrp")) {
    await connection.query(
      "ALTER TABLE bill_items ADD COLUMN mrp DECIMAL(10,2) NOT NULL DEFAULT 0"
    );
  }
};

const generateBillNumber = async (connection, companyId) => {
  const [rows] = await connection.query(
    "SELECT bill_number FROM bills WHERE company_id = ? AND bill_number LIKE 'BILL-%'",
    [companyId]
  );

  const maxNumber = rows.reduce((max, row) => {
    const match = String(row.bill_number || "").match(/^BILL-?(\d+)$/i);
    return match ? Math.max(max, Number(match[1] || 0)) : max;
  }, 0);

  return `BILL-${String(maxNumber + 1).padStart(4, "0")}`;
};

const processItems = async (connection, companyId, items = []) => {
  if (!items.length) {
    throw new Error("Please add at least one item");
  }

  let subtotal = 0;
  let gstAmount = 0;

  const processedItems = [];

  for (const item of items) {
    const productId = Number(item.product_id || 0);
    const qty = Number(item.quantity || item.qty || 0);
    const price = Number(item.price || 0);
    const mrp = Number(item.mrp || 0);
    const gst = Number(item.gst_percent || item.gst || 0);

    if (!productId || qty <= 0) {
      throw new Error("Please select valid items and quantity");
    }

    const [products] = await connection.query(
      "SELECT id, name FROM products WHERE id = ? AND company_id = ? LIMIT 1",
      [productId, companyId]
    );

    if (!products.length) {
      throw new Error("Selected product was not found");
    }

    const base = qty * price;
    const gstValue = (base * gst) / 100;
    const total = base + gstValue;

    subtotal += base;
    gstAmount += gstValue;

    processedItems.push({
      product_id: products[0].id,
      product_name: products[0].name,
      mrp,
      quantity: qty,
      price,
      gst_percent: gst,
      cgst: gstValue / 2,
      sgst: gstValue / 2,
      total,
    });
  }

  return {
    items: processedItems,
    subtotal,
    gstAmount,
    totalAmount: subtotal + gstAmount,
  };
};

exports.createPurchaseOrder = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await ensurePurchaseOrderTables();

    const companyId = req.user.company_id;
    const {
      vendor_id,
      po_number,
      po_date,
      expected_date,
      notes,
      items,
    } = req.body;

    if (!vendor_id || !po_date) {
      return res.status(400).json({ message: "Vendor and PO date are required" });
    }

    await connection.beginTransaction();

    const [vendors] = await connection.query(
      "SELECT id FROM vendors WHERE id = ? AND company_id = ? LIMIT 1",
      [vendor_id, companyId]
    );

    if (!vendors.length) {
      await connection.rollback();
      return res.status(400).json({ message: "Vendor not found" });
    }

    const processed = await processItems(connection, companyId, items);

    const purchaseOrderNumber = String(
      po_number || (await generatePurchaseOrderNumber(connection, companyId))
    ).trim();
    const [result] = await connection.query(
      `INSERT INTO purchase_orders
        (company_id, vendor_id, po_number, po_date, expected_date, status, notes,
         subtotal, gst_amount, total_amount, created_by)
       VALUES (?, ?, ?, ?, ?, 'Draft', ?, ?, ?, ?, ?)`,
      [
        companyId,
        vendor_id,
        purchaseOrderNumber,
        po_date,
        expected_date || null,
        notes || null,
        processed.subtotal,
        processed.gstAmount,
        processed.totalAmount,
        req.user.user_id || null,
      ]
    );

    for (const item of processed.items) {
      await connection.query(
        `INSERT INTO purchase_order_items
          (company_id, purchase_order_id, product_id, product_name, mrp, quantity, price,
           gst_percent, cgst, sgst, total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          companyId,
          result.insertId,
          item.product_id,
          item.product_name,
          item.mrp,
          item.quantity,
          item.price,
          item.gst_percent,
          item.cgst,
          item.sgst,
          item.total,
        ]
      );
    }

    await connection.commit();
    res.status(201).json({
      message: "Purchase order created",
      purchase_order_id: result.insertId,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Create purchase order error:", error);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Purchase order number already exists" });
    }

    res.status(500).json({ message: error.message || "Server error" });
  } finally {
    connection.release();
  }
};

exports.getPurchaseOrders = async (req, res) => {
  try {
    await ensurePurchaseOrderTables();

    const companyId = req.user.company_id;
    const [rows] = await db.query(
      `SELECT po.*, v.name AS vendor_name,
              COALESCE(progress.ordered_qty,0) ordered_qty,
              COALESCE(progress.received_qty,0) received_qty
       FROM purchase_orders po
       LEFT JOIN vendors v ON v.id = po.vendor_id AND v.company_id = po.company_id
       LEFT JOIN (
         SELECT poi.purchase_order_id,SUM(poi.quantity) ordered_qty,
                SUM(COALESCE(received.accepted_qty,0)) received_qty
         FROM purchase_order_items poi
         LEFT JOIN (
           SELECT gri.purchase_order_item_id,SUM(gri.accepted_qty) accepted_qty
           FROM goods_receipt_items gri
           INNER JOIN goods_receipts gr ON gr.id=gri.goods_receipt_id AND gr.company_id=gri.company_id
           WHERE gr.status='Posted' GROUP BY gri.purchase_order_item_id
         ) received ON received.purchase_order_item_id=poi.id
         GROUP BY poi.purchase_order_id
       ) progress ON progress.purchase_order_id=po.id
       WHERE po.company_id = ?
       ORDER BY po.id DESC`,
      [companyId]
    );

    res.json(rows);
  } catch (error) {
    console.error("Get purchase orders error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getPurchaseOrderById = async (req, res) => {
  try {
    await ensurePurchaseOrderTables();

    const companyId = req.user.company_id;
    const { id } = req.params;

    const [orders] = await db.query(
      `SELECT po.*, v.name AS vendor_name, v.phone AS vendor_phone,
              v.email AS vendor_email, v.gst_number AS vendor_gst_number,
              v.address AS vendor_address
       FROM purchase_orders po
       LEFT JOIN vendors v ON v.id = po.vendor_id AND v.company_id = po.company_id
       WHERE po.id = ? AND po.company_id = ?
       LIMIT 1`,
      [id, companyId]
    );

    if (!orders.length) {
      return res.status(404).json({ message: "Purchase order not found" });
    }

    const [items] = await db.query(
      `SELECT poi.*,COALESCE(received.accepted_qty,0) received_qty,
              poi.quantity-COALESCE(received.accepted_qty,0) pending_qty
       FROM purchase_order_items poi
       LEFT JOIN (
         SELECT gri.purchase_order_item_id,SUM(gri.accepted_qty) accepted_qty
         FROM goods_receipt_items gri
         INNER JOIN goods_receipts gr ON gr.id=gri.goods_receipt_id AND gr.company_id=gri.company_id
         WHERE gr.company_id=? AND gr.status='Posted' GROUP BY gri.purchase_order_item_id
       ) received ON received.purchase_order_item_id=poi.id
       WHERE poi.purchase_order_id=? ORDER BY poi.id ASC`,
      [companyId, id]
    );
    const [grns] = await db.query(
      "SELECT id,grn_number,grn_date,status FROM goods_receipts WHERE purchase_order_id=? AND company_id=? ORDER BY id",
      [id, companyId]
    );

    res.json({ ...orders[0], items, grns });
  } catch (error) {
    console.error("Get purchase order error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.updatePurchaseOrder = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await ensurePurchaseOrderTables();

    const companyId = req.user.company_id;
    const { id } = req.params;
    const {
      vendor_id,
      po_number,
      po_date,
      expected_date,
      notes,
      items,
    } = req.body;

    if (!vendor_id || !po_number || !po_date) {
      return res.status(400).json({ message: "Vendor, PO number, and PO date are required" });
    }

    await connection.beginTransaction();

    const [existing] = await connection.query(
      "SELECT id,status FROM purchase_orders WHERE id = ? AND company_id = ? LIMIT 1",
      [id, companyId]
    );

    if (!existing.length) {
      await connection.rollback();
      return res.status(404).json({ message: "Purchase order not found" });
    }
    if (!["Draft", "Sent", "Approved"].includes(existing[0].status)) {
      await connection.rollback();
      return res.status(409).json({ message: "Received, cancelled, closed, or converted purchase orders cannot be edited" });
    }
    const [receiptRows] = await connection.query(
      "SELECT id FROM goods_receipts WHERE company_id=? AND purchase_order_id=? LIMIT 1",
      [companyId, id]
    );
    if (receiptRows.length) {
      await connection.rollback();
      return res.status(409).json({ message: "Purchase order cannot be edited after a GRN has been created" });
    }

    const processed = await processItems(connection, companyId, items);

    await connection.query(
      `UPDATE purchase_orders
       SET vendor_id = ?, po_number = ?, po_date = ?, expected_date = ?,
           notes = ?, subtotal = ?, gst_amount = ?, total_amount = ?
       WHERE id = ? AND company_id = ?`,
      [
        vendor_id,
        String(po_number).trim(),
        po_date,
        expected_date || null,
        notes || null,
        processed.subtotal,
        processed.gstAmount,
        processed.totalAmount,
        id,
        companyId,
      ]
    );

    await connection.query("DELETE FROM purchase_order_items WHERE purchase_order_id = ?", [id]);

    for (const item of processed.items) {
      await connection.query(
        `INSERT INTO purchase_order_items
          (company_id, purchase_order_id, product_id, product_name, mrp, quantity, price,
           gst_percent, cgst, sgst, total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          companyId,
          id,
          item.product_id,
          item.product_name,
          item.mrp,
          item.quantity,
          item.price,
          item.gst_percent,
          item.cgst,
          item.sgst,
          item.total,
        ]
      );
    }

    await connection.commit();
    res.json({ message: "Purchase order updated" });
  } catch (error) {
    await connection.rollback();
    console.error("Update purchase order error:", error);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Purchase order number already exists" });
    }

    res.status(500).json({ message: error.message || "Server error" });
  } finally {
    connection.release();
  }
};

exports.updatePurchaseOrderStatus = async (req, res) => {
  try {
    await ensurePurchaseOrderTables();

    const companyId = req.user.company_id;
    const { id } = req.params;
    const status = String(req.body.status || "").trim();

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid purchase order status" });
    }

    const [orders] = await db.query(
      "SELECT status FROM purchase_orders WHERE id=? AND company_id=?",
      [id, companyId]
    );
    if (!orders.length) return res.status(404).json({ message: "Purchase order not found" });
    if (["Partially Received", "Fully Received"].includes(orders[0].status) && status !== "Closed") {
      return res.status(409).json({ message: "Receipt-controlled purchase order status cannot be changed manually" });
    }
    const [result] = await db.query(
      "UPDATE purchase_orders SET status = ? WHERE id = ? AND company_id = ?",
      [status, id, companyId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Purchase order not found" });
    }

    res.json({ message: "Purchase order status updated" });
  } catch (error) {
    console.error("Update purchase order status error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.convertPurchaseOrderToBill = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await ensurePurchaseOrderTables();

    const companyId = req.user.company_id;
    const { id } = req.params;
    const billDate = req.body.bill_date || new Date().toISOString().slice(0, 10);
    const dueDate = req.body.due_date || null;

    await ensureBillConversionColumns(connection);
    await connection.beginTransaction();

    const [orders] = await connection.query(
      `SELECT po.*, v.id AS valid_vendor_id
       FROM purchase_orders po
       INNER JOIN vendors v
         ON v.id = po.vendor_id
        AND v.company_id = po.company_id
       WHERE po.id = ? AND po.company_id = ?
       LIMIT 1
       FOR UPDATE`,
      [id, companyId]
    );

    if (!orders.length) {
      await connection.rollback();
      return res.status(404).json({ message: "Purchase order not found" });
    }

    const order = orders[0];

    const [postedReceipts] = await connection.query(
      "SELECT id, grn_number FROM goods_receipts WHERE company_id = ? AND purchase_order_id = ? AND status = 'Posted' LIMIT 1",
      [companyId, id]
    );
    if (postedReceipts.length) {
      await connection.rollback();
      return res.status(409).json({
        message: "This PO has posted receipts. Create bills from its GRNs to avoid posting stock twice.",
      });
    }

    if (order.status === "Cancelled") {
      await connection.rollback();
      return res.status(400).json({ message: "Cancelled PO cannot be converted" });
    }

    if (order.status === "Converted") {
      await connection.rollback();
      return res.status(400).json({ message: "This PO is already converted" });
    }

    const [existingBills] = await connection.query(
      `SELECT id, bill_number
       FROM bills
       WHERE company_id = ? AND source_purchase_order_id = ?
       LIMIT 1`,
      [companyId, id]
    );

    if (existingBills.length) {
      await connection.rollback();
      return res.status(409).json({
        message: `This PO is already converted to bill ${existingBills[0].bill_number}`,
        bill_id: existingBills[0].id,
      });
    }

    const [items] = await connection.query(
      "SELECT * FROM purchase_order_items WHERE purchase_order_id = ? ORDER BY id ASC",
      [id]
    );

    if (!items.length) {
      await connection.rollback();
      return res.status(400).json({ message: "PO has no items to convert" });
    }

    const billNumber = String(
      req.body.bill_number || (await generateBillNumber(connection, companyId))
    ).trim();

    const [billResult] = await connection.query(
      `INSERT INTO bills
        (vendor_id, bill_number, bill_date, due_date, total_amount, status, company_id, source_purchase_order_id)
       VALUES (?, ?, ?, ?, ?, 'Unpaid', ?, ?)`,
      [
        order.vendor_id,
        billNumber,
        billDate,
        dueDate,
        order.total_amount,
        companyId,
        id,
      ]
    );

    const billId = billResult.insertId;

    for (const item of items) {
      const quantity = Number(item.quantity || 0);
      const price = Number(item.price || 0);
      const mrp = Number(item.mrp || 0);
      const gst = Number(item.gst_percent || 0);

      await connection.query(
        `INSERT INTO bill_items
          (bill_id, product_id, product_name, quantity, price, mrp, total, gst_percent, cgst, sgst)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          billId,
          item.product_id,
          item.product_name,
          quantity,
          price,
          mrp,
          item.total,
          gst,
          item.cgst,
          item.sgst,
        ]
      );

      await connection.query(
        `UPDATE products
         SET stock = stock + ?,
             mrp = ?,
             purchase_price = ?,
             gst = ?
         WHERE id = ? AND company_id = ?`,
        [quantity, mrp, price, gst, item.product_id, companyId]
      );
    }

    await connection.query(
      "UPDATE purchase_orders SET status = 'Converted' WHERE id = ? AND company_id = ?",
      [id, companyId]
    );

    await connection.commit();
    res.status(201).json({
      message: "Purchase order converted to bill",
      bill_id: billId,
      bill_number: billNumber,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Convert purchase order error:", error);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Bill number already exists" });
    }

    res.status(500).json({ message: error.message || "Server error" });
  } finally {
    connection.release();
  }
};

exports.deletePurchaseOrder = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await ensurePurchaseOrderTables();

    const companyId = req.user.company_id;
    const { id } = req.params;

    await connection.beginTransaction();

    const [existing] = await connection.query(
      "SELECT id,status FROM purchase_orders WHERE id = ? AND company_id = ? LIMIT 1",
      [id, companyId]
    );

    if (!existing.length) {
      await connection.rollback();
      return res.status(404).json({ message: "Purchase order not found" });
    }
    if (existing[0].status !== "Draft") {
      await connection.rollback();
      return res.status(409).json({ message: "Only draft purchase orders can be deleted" });
    }
    const [receiptRows] = await connection.query(
      "SELECT id FROM goods_receipts WHERE company_id=? AND purchase_order_id=? LIMIT 1",
      [companyId, id]
    );
    if (receiptRows.length) {
      await connection.rollback();
      return res.status(409).json({ message: "Purchase order with GRN history cannot be deleted" });
    }

    await connection.query("DELETE FROM purchase_order_items WHERE purchase_order_id = ?", [id]);
    await connection.query("DELETE FROM purchase_orders WHERE id = ? AND company_id = ?", [
      id,
      companyId,
    ]);

    await connection.commit();
    res.json({ message: "Purchase order deleted" });
  } catch (error) {
    await connection.rollback();
    console.error("Delete purchase order error:", error);
    res.status(500).json({ message: "Server error" });
  } finally {
    connection.release();
  }
};
