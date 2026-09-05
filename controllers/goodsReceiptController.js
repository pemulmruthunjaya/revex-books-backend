const db = require("../db/connection");
const { requireFinancialYearForDate, rejectClientFinancialYear } = require("../services/financialYearService");

const userId = (req) => req.user.user_id || req.user.id || null;
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });

async function nextNumber(connection, companyId, table, column, prefix) {
  const [rows] = await connection.query(
    `SELECT ${column} number FROM ${table} WHERE company_id=? AND ${column} LIKE ? ORDER BY id DESC LIMIT 100 FOR UPDATE`,
    [companyId, `${prefix}-%`],
  );
  const max = rows.reduce((value, row) => {
    const match = String(row.number || "").match(
      new RegExp(`^${prefix}-(\\d+)$`, "i"),
    );
    return match ? Math.max(value, Number(match[1])) : value;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(6, "0")}`;
}

async function loadPoForReceipt(connection, companyId, poId, lock = false) {
  const [orders] = await connection.query(
    `SELECT po.*,v.name vendor_name FROM purchase_orders po INNER JOIN vendors v ON v.id=po.vendor_id AND v.company_id=po.company_id WHERE po.id=? AND po.company_id=? ${lock ? "FOR UPDATE" : ""}`,
    [poId, companyId],
  );
  if (!orders.length) throw fail("Purchase order not found", 404);
  if (["Cancelled", "Closed"].includes(orders[0].status))
    throw fail("This purchase order cannot receive goods");
  const [items] = await connection.query(
    `SELECT poi.*,p.sku,p.unit product_unit,COALESCE(received.accepted_qty,0) received_qty,(poi.quantity-COALESCE(received.accepted_qty,0)) pending_qty FROM purchase_order_items poi INNER JOIN purchase_orders po ON po.id=poi.purchase_order_id AND po.company_id=? LEFT JOIN products p ON p.id=poi.product_id AND p.company_id=po.company_id LEFT JOIN (SELECT gri.purchase_order_item_id,SUM(gri.accepted_qty) accepted_qty FROM goods_receipt_items gri INNER JOIN goods_receipts gr ON gr.id=gri.goods_receipt_id AND gr.company_id=gri.company_id WHERE gri.company_id=? AND gr.status='Posted' GROUP BY gri.purchase_order_item_id) received ON received.purchase_order_item_id=poi.id WHERE poi.purchase_order_id=? ORDER BY poi.id`,
    [companyId, companyId, poId],
  );
  return { order: orders[0], items };
}

async function refreshPoStatus(connection, companyId, poId) {
  const { items } = await loadPoForReceipt(connection, companyId, poId);
  const received = items.reduce(
    (sum, item) => sum + Number(item.received_qty || 0),
    0,
  );
  const ordered = items.reduce(
    (sum, item) => sum + Number(item.quantity || 0),
    0,
  );
  const status =
    received <= 0
      ? "Sent"
      : received + 0.000001 >= ordered
        ? "Fully Received"
        : "Partially Received";
  await connection.query(
    "UPDATE purchase_orders SET status=? WHERE id=? AND company_id=?",
    [status, poId, companyId],
  );
  return status;
}

async function postReceipt(connection, req, receiptId) {
  const companyId = req.user.company_id;
  const [receipts] = await connection.query(
    "SELECT * FROM goods_receipts WHERE id=? AND company_id=? FOR UPDATE",
    [receiptId, companyId],
  );
  if (!receipts.length) throw fail("GRN not found", 404);
  const receipt = receipts[0];
  if (receipt.stock_posted || receipt.status === "Posted")
    throw fail("GRN stock has already been posted", 409);
  const { items: poItems } = await loadPoForReceipt(
    connection,
    companyId,
    receipt.purchase_order_id,
    true,
  );
  const [items] = await connection.query(
    "SELECT * FROM goods_receipt_items WHERE goods_receipt_id=? AND company_id=?",
    [receiptId, companyId],
  );
  if (!items.length) throw fail("GRN has no received items");
  const quantitiesByProduct = new Map();
  for (const item of items) {
    const poItem = poItems.find(
      (entry) => Number(entry.id) === Number(item.purchase_order_item_id),
    );
    if (!poItem) throw fail("GRN item does not belong to this purchase order");
    if (Number(item.accepted_qty) > Number(poItem.pending_qty) + 0.000001)
      throw fail(
        `Accepted quantity exceeds pending quantity for ${poItem.product_name}`,
      );
    quantitiesByProduct.set(
      Number(item.product_id),
      (quantitiesByProduct.get(Number(item.product_id)) || 0) +
        Number(item.accepted_qty),
    );
  }
  for (const [productId, acceptedQty] of quantitiesByProduct) {
    if (acceptedQty <= 0) continue;
    const [movement] = await connection.query(
      `INSERT INTO inventory_transactions (company_id,branch_id,product_id,transaction_type,reference_type,reference_id,quantity_in,quantity_out,transaction_date,created_by) VALUES (?,?,?,'PURCHASE_RECEIPT','GRN',?,?,0,?,?)`,
      [
        companyId,
        receipt.branch_id,
        productId,
        receiptId,
        acceptedQty,
        receipt.grn_date,
        userId(req),
      ],
    );
    if (!movement.affectedRows)
      throw fail("Unable to record inventory movement");
    const [stock] = await connection.query(
      "UPDATE products SET stock=stock+? WHERE id=? AND company_id=?",
      [acceptedQty, productId, companyId],
    );
    if (!stock.affectedRows)
      throw fail("Product not found while posting stock");
  }
  await connection.query(
    "UPDATE goods_receipts SET status='Posted',stock_posted=1,posted_by=?,posted_at=NOW() WHERE id=? AND company_id=? AND stock_posted=0",
    [userId(req), receiptId, companyId],
  );
  await refreshPoStatus(connection, companyId, receipt.purchase_order_id);
}

exports.nextNumber = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const number = await nextNumber(
      connection,
      req.user.company_id,
      "goods_receipts",
      "grn_number",
      "GRN",
    );
    await connection.rollback();
    res.json({ grn_number: number });
  } finally {
    connection.release();
  }
};
exports.getPurchaseOrderPending = async (req, res) => {
  const connection = await db.getConnection();
  try {
    res.json(
      await loadPoForReceipt(connection, req.user.company_id, req.params.id),
    );
  } catch (error) {
    res.status(error.status || 500).json({
      message: error.status
        ? error.message
        : "Unable to load pending quantities",
    });
  } finally {
    connection.release();
  }
};
exports.list = async (req, res) => {
  const [rows] = await db.query(
    `SELECT gr.*,po.po_number,v.name vendor_name,COALESCE(SUM(gri.accepted_qty),0) accepted_qty FROM goods_receipts gr INNER JOIN purchase_orders po ON po.id=gr.purchase_order_id AND po.company_id=gr.company_id INNER JOIN vendors v ON v.id=gr.vendor_id AND v.company_id=gr.company_id LEFT JOIN goods_receipt_items gri ON gri.goods_receipt_id=gr.id AND gri.company_id=gr.company_id WHERE gr.company_id=? GROUP BY gr.id ORDER BY gr.id DESC`,
    [req.user.company_id],
  );
  res.json(rows);
};
exports.getById = async (req, res) => {
  const [rows] = await db.query(
    `SELECT gr.*,po.po_number,v.name vendor_name,v.address vendor_address FROM goods_receipts gr INNER JOIN purchase_orders po ON po.id=gr.purchase_order_id AND po.company_id=gr.company_id INNER JOIN vendors v ON v.id=gr.vendor_id AND v.company_id=gr.company_id WHERE gr.id=? AND gr.company_id=?`,
    [req.params.id, req.user.company_id],
  );
  if (!rows.length) return res.status(404).json({ message: "GRN not found" });
  const [items] = await db.query(
    `SELECT gri.*,poi.product_name,poi.quantity ordered_qty,p.sku FROM goods_receipt_items gri INNER JOIN purchase_order_items poi ON poi.id=gri.purchase_order_item_id INNER JOIN products p ON p.id=gri.product_id AND p.company_id=gri.company_id WHERE gri.goods_receipt_id=? AND gri.company_id=?`,
    [req.params.id, req.user.company_id],
  );
  const [bills] = await db.query(
    "SELECT id,bill_number,total_amount,status FROM bills WHERE company_id=? AND source_grn_id=?",
    [req.user.company_id, req.params.id],
  );
  res.json({ ...rows[0], items, bills });
};
exports.listBillable = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const vendorId = Number(req.query.vendor_id || 0);
    if (!vendorId)
      return res.status(400).json({ message: "Vendor is required" });
    const branchId = req.user.branch_id || null;
    const params = [companyId, vendorId];
    const branchFilter = branchId ? " AND gr.branch_id=?" : "";
    if (branchId) params.push(branchId);
    const [rows] = await db.query(
      `SELECT gr.id,gr.grn_number,gr.grn_date,gr.vendor_id,gr.purchase_order_id,po.po_number,
        SUM(gri.accepted_qty) accepted_quantity,
        COALESCE(SUM(billed.billed_quantity),0) billed_quantity,
        SUM(gri.accepted_qty)-COALESCE(SUM(billed.billed_quantity),0) remaining_billable_quantity
       FROM goods_receipts gr
       INNER JOIN purchase_orders po ON po.id=gr.purchase_order_id AND po.company_id=gr.company_id
       INNER JOIN goods_receipt_items gri ON gri.goods_receipt_id=gr.id AND gri.company_id=gr.company_id
       LEFT JOIN (
         SELECT bi.source_grn_item_id,SUM(bi.quantity) billed_quantity
         FROM bill_items bi INNER JOIN bills b ON b.id=bi.bill_id
         WHERE b.company_id=? AND b.source_grn_id IS NOT NULL
         GROUP BY bi.source_grn_item_id
       ) billed ON billed.source_grn_item_id=gri.id
       WHERE gr.company_id=? AND gr.vendor_id=? AND gr.status='Posted'${branchFilter}
       GROUP BY gr.id
       HAVING remaining_billable_quantity>0
       ORDER BY gr.grn_date DESC,gr.id DESC`,
      [companyId, ...params],
    );
    res.json(rows);
  } catch (error) {
    console.error("List billable GRNs error", {
      companyId: req.user.company_id,
      code: error.code,
      message: error.message,
    });
    res.status(500).json({ message: "Unable to load billable GRNs" });
  }
};
exports.getBillable = async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const branchId = req.user.branch_id || null;
    const params = [req.params.id, companyId];
    const branchFilter = branchId ? " AND gr.branch_id=?" : "";
    if (branchId) params.push(branchId);
    const [receipts] = await db.query(
      `SELECT gr.id,gr.grn_number,gr.grn_date,gr.vendor_id,gr.purchase_order_id,po.po_number,v.name vendor_name
       FROM goods_receipts gr
       INNER JOIN purchase_orders po ON po.id=gr.purchase_order_id AND po.company_id=gr.company_id
       INNER JOIN vendors v ON v.id=gr.vendor_id AND v.company_id=gr.company_id
       WHERE gr.id=? AND gr.company_id=? AND gr.status='Posted'${branchFilter}`,
      params,
    );
    if (!receipts.length)
      return res.status(404).json({ message: "Posted GRN not found" });
    const [items] = await db.query(
      `SELECT gri.id source_grn_item_id,gri.product_id,poi.product_name,p.sku,
        gri.accepted_qty accepted_quantity,COALESCE(SUM(CASE WHEN b.id IS NOT NULL THEN bi.quantity ELSE 0 END),0) already_billed_quantity,
        gri.accepted_qty-COALESCE(SUM(CASE WHEN b.id IS NOT NULL THEN bi.quantity ELSE 0 END),0) remaining_billable_quantity,
        poi.price,poi.mrp,poi.gst_percent,poi.cgst,poi.sgst
       FROM goods_receipt_items gri
       INNER JOIN purchase_order_items poi ON poi.id=gri.purchase_order_item_id AND poi.company_id=gri.company_id
       INNER JOIN products p ON p.id=gri.product_id AND p.company_id=gri.company_id
       LEFT JOIN bill_items bi ON bi.source_grn_item_id=gri.id
       LEFT JOIN bills b ON b.id=bi.bill_id AND b.company_id=gri.company_id AND b.source_grn_id=gri.goods_receipt_id
       WHERE gri.goods_receipt_id=? AND gri.company_id=?
       GROUP BY gri.id
       HAVING remaining_billable_quantity>0
       ORDER BY gri.id`,
      [req.params.id, companyId],
    );
    res.json({ ...receipts[0], items });
  } catch (error) {
    console.error("Get billable GRN error", {
      companyId: req.user.company_id,
      grnId: req.params.id,
      code: error.code,
      message: error.message,
    });
    res.status(500).json({ message: "Unable to load billable GRN" });
  }
};
exports.create = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const companyId = req.user.company_id,
      {
        purchase_order_id,
        grn_date,
        challan_number,
        challan_date,
        notes,
        status = "Draft",
        items = [],
      } = req.body;
    await connection.beginTransaction();
    const { order, items: poItems } = await loadPoForReceipt(
      connection,
      companyId,
      purchase_order_id,
      true,
    );
    if (!items.length) throw fail("Enter at least one received quantity");
    const grnNumber = String(
      req.body.grn_number ||
        (await nextNumber(
          connection,
          companyId,
          "goods_receipts",
          "grn_number",
          "GRN",
        )),
    ).trim();
    const [result] = await connection.query(
      `INSERT INTO goods_receipts (company_id,branch_id,grn_number,purchase_order_id,vendor_id,grn_date,challan_number,challan_date,status,notes,created_by) VALUES (?,?,?,?,?,?,?,?, 'Draft',?,?)`,
      [
        companyId,
        req.user.branch_id || order.branch_id || null,
        grnNumber,
        purchase_order_id,
        order.vendor_id,
        grn_date,
        challan_number || null,
        challan_date || null,
        notes || null,
        userId(req),
      ],
    );
    for (const input of items) {
      const poItem = poItems.find(
        (entry) => Number(entry.id) === Number(input.purchase_order_item_id),
      );
      if (!poItem) throw fail("Invalid PO item");
      const received = Number(input.received_qty || 0),
        rejected = Number(input.rejected_qty || 0),
        accepted = received - rejected;
      if (received < 0 || rejected < 0 || accepted < 0)
        throw fail(`Invalid quantities for ${poItem.product_name}`);
      if (received > Number(poItem.pending_qty) + 0.000001)
        throw fail(
          `Received quantity exceeds pending quantity for ${poItem.product_name}`,
        );
      if (received === 0) continue;
      await connection.query(
        `INSERT INTO goods_receipt_items (company_id,goods_receipt_id,purchase_order_item_id,product_id,received_qty,rejected_qty,accepted_qty,notes) VALUES (?,?,?,?,?,?,?,?)`,
        [
          companyId,
          result.insertId,
          poItem.id,
          poItem.product_id,
          received,
          rejected,
          accepted,
          input.notes || null,
        ],
      );
    }
    if (status === "Posted")
      await postReceipt(connection, req, result.insertId);
    await connection.commit();
    res.status(201).json({
      message:
        status === "Posted"
          ? "GRN posted and stock increased"
          : "Draft GRN created",
      grn_id: result.insertId,
      grn_number: grnNumber,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Create GRN error", {
      companyId: req.user.company_id,
      code: error.code,
      message: error.message,
    });
    res.status(error.code === "ER_DUP_ENTRY" ? 409 : error.status || 500).json({
      message:
        error.code === "ER_DUP_ENTRY"
          ? "GRN number already exists"
          : error.status
            ? error.message
            : "Unable to create GRN",
    });
  } finally {
    connection.release();
  }
};
exports.post = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    await postReceipt(connection, req, req.params.id);
    await connection.commit();
    res.json({ message: "GRN posted and stock increased" });
  } catch (error) {
    await connection.rollback();
    console.error("Post GRN error", {
      companyId: req.user.company_id,
      grnId: req.params.id,
      code: error.code,
      message: error.message,
    });
    res
      .status(error.status || 500)
      .json({ message: error.status ? error.message : "Unable to post GRN" });
  } finally {
    connection.release();
  }
};
exports.deleteDraft = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      "SELECT status FROM goods_receipts WHERE id=? AND company_id=? FOR UPDATE",
      [req.params.id, req.user.company_id],
    );
    if (!rows.length) throw fail("GRN not found", 404);
    if (rows[0].status !== "Draft")
      throw fail("Only draft GRNs can be deleted", 409);
    await connection.query(
      "DELETE FROM goods_receipt_items WHERE goods_receipt_id=? AND company_id=?",
      [req.params.id, req.user.company_id],
    );
    await connection.query(
      "DELETE FROM goods_receipts WHERE id=? AND company_id=?",
      [req.params.id, req.user.company_id],
    );
    await connection.commit();
    res.json({ message: "Draft GRN deleted" });
  } catch (error) {
    await connection.rollback();
    res
      .status(error.status || 500)
      .json({ message: error.status ? error.message : "Unable to delete GRN" });
  } finally {
    connection.release();
  }
};
exports.createBill = async (req, res) => {
  const connection = await db.getConnection();
  try {
    const companyId = req.user.company_id;
    rejectClientFinancialYear(req.body);
    await connection.beginTransaction();
    const [receipts] = await connection.query(
      "SELECT * FROM goods_receipts WHERE id=? AND company_id=? AND status='Posted' FOR UPDATE",
      [req.params.id, companyId],
    );
    if (!receipts.length) throw fail("Posted GRN not found", 404);
    const grn = receipts[0];
    const [existing] = await connection.query(
      "SELECT id,bill_number FROM bills WHERE company_id=? AND source_grn_id=? LIMIT 1",
      [companyId, grn.id],
    );
    if (existing.length)
      throw fail(
        `Bill ${existing[0].bill_number} already exists for this GRN`,
        409,
      );
    const [items] = await connection.query(
      `SELECT gri.*,poi.product_name,poi.price,poi.mrp,poi.gst_percent,poi.cgst,poi.sgst FROM goods_receipt_items gri INNER JOIN purchase_order_items poi ON poi.id=gri.purchase_order_item_id WHERE gri.goods_receipt_id=? AND gri.company_id=?`,
      [grn.id, companyId],
    );
    const billNumber = String(
      req.body.bill_number ||
        (await nextNumber(
          connection,
          companyId,
          "bills",
          "bill_number",
          "BILL",
        )),
    ).trim();
    const total = items.reduce(
      (sum, item) =>
        sum +
        Number(item.accepted_qty) *
          Number(item.price) *
          (1 + Number(item.gst_percent) / 100),
      0,
    );
    const billDate = req.body.bill_date || new Date().toISOString().slice(0, 10);
    const financialYear = await requireFinancialYearForDate(companyId, billDate, connection);
    const [bill] = await connection.query(
      `INSERT INTO bills (vendor_id,bill_number,bill_date,due_date,total_amount,status,company_id,financial_year_id,source_purchase_order_id,source_grn_id,stock_posted) VALUES (?,?,?,?,?,'Unpaid',?,?,?,?,0)`,
      [
        grn.vendor_id,
        billNumber,
        billDate,
        req.body.due_date || null,
        total,
        companyId,
        financialYear.id,
        grn.purchase_order_id,
        grn.id,
      ],
    );
    for (const item of items) {
      const taxable = Number(item.accepted_qty) * Number(item.price),
        tax = (taxable * Number(item.gst_percent)) / 100;
      await connection.query(
        `INSERT INTO bill_items (bill_id,product_id,product_name,quantity,price,mrp,total,gst_percent,cgst,sgst) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [
          bill.insertId,
          item.product_id,
          item.product_name,
          item.accepted_qty,
          item.price,
          item.mrp,
          taxable + tax,
          item.gst_percent,
          tax / 2,
          tax / 2,
        ],
      );
    }
    await connection.commit();
    res.status(201).json({
      message: "Bill created from GRN without reposting stock",
      bill_id: bill.insertId,
      bill_number: billNumber,
    });
  } catch (error) {
    await connection.rollback();
    console.error("GRN bill error", {
      companyId: req.user.company_id,
      grnId: req.params.id,
      code: error.code,
      message: error.message,
    });
    res.status(error.status || 500).json({
      message: error.status ? error.message : "Unable to create bill from GRN",
    });
  } finally {
    connection.release();
  }
};

exports._private = { loadPoForReceipt, refreshPoStatus, nextNumber };
