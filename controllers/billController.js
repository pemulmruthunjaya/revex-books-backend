const db = require("../db/connection");
const {
  ensureVendorPaymentSchema,
} = require("../services/vendorPaymentService");
const { requireFinancialYearForDate, rejectClientFinancialYear } = require("../services/financialYearService");

let billStatusColumnReady = false;
let billMrpColumnsReady = false;

const ensureBillStatusColumn = async () => {
  if (billStatusColumnReady) {
    return;
  }

  await db.query(
    "ALTER TABLE bills MODIFY status VARCHAR(30) NOT NULL DEFAULT 'Unpaid'",
  );

  billStatusColumnReady = true;
};

const ensureBillMrpColumns = async () => {
  if (billMrpColumnsReady) {
    return;
  }

  const [productColumns] = await db.query("SHOW COLUMNS FROM products");
  const productColumnNames = new Set(
    productColumns.map((column) => column.Field),
  );

  if (!productColumnNames.has("mrp")) {
    await db.query(
      "ALTER TABLE products ADD COLUMN mrp DECIMAL(10,2) NOT NULL DEFAULT 0",
    );
  }

  if (!productColumnNames.has("purchase_price")) {
    await db.query(
      "ALTER TABLE products ADD COLUMN purchase_price DECIMAL(10,2) NOT NULL DEFAULT 0",
    );
  }

  if (!productColumnNames.has("gst")) {
    await db.query(
      "ALTER TABLE products ADD COLUMN gst DECIMAL(5,2) NOT NULL DEFAULT 18",
    );
  }

  const [billItemColumns] = await db.query(
    "SHOW COLUMNS FROM bill_items LIKE 'mrp'",
  );
  if (!billItemColumns.length) {
    await db.query(
      "ALTER TABLE bill_items ADD COLUMN mrp DECIMAL(10,2) NOT NULL DEFAULT 0",
    );
  }

  billMrpColumnsReady = true;
};

/**
 * ===============================
 * CREATE BILL + STOCK INCREASE
 * ===============================
 */
exports.createBill = async (req, res) => {
  const connection = await db.getConnection();
  let transactionStarted = false;
  try {
    await ensureBillMrpColumns();
    rejectClientFinancialYear(req.body);

    const { vendor_id, bill_number, bill_date, due_date, items } = req.body;
    const company_id = req.user.company_id;

    if (!vendor_id || !bill_number || !bill_date || !items?.length) {
      return res.status(400).json({
        message: "Missing required fields",
      });
    }
    let total_amount = 0;

    const processedItems = [];

    /* ================= PROCESS ITEMS ================= */
    for (let item of items) {
      const qty = Number(item.qty || 0);
      const price = Number(item.price || 0);
      const mrp = Number(item.mrp || 0);
      const gst = Number(item.gst || 0);

      const base = qty * price;
      const gstAmount = (base * gst) / 100;
      const total = base + gstAmount;

      total_amount += total;

      processedItems.push({
        product_id: item.product_id,
        name: item.name,
        quantity: qty,
        price,
        mrp,
        gst,
        total,
        cgst: gstAmount / 2,
        sgst: gstAmount / 2,
      });
    }

    await connection.beginTransaction();
    transactionStarted = true;
    const financialYear = await requireFinancialYearForDate(company_id, bill_date, connection);

    /* ================= INSERT BILL ================= */
    const [billResult] = await connection.query(
      `INSERT INTO bills 
      (vendor_id, bill_number, bill_date, due_date, total_amount, status, company_id, financial_year_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        vendor_id,
        bill_number,
        bill_date,
        due_date || null,
        total_amount,
        "Unpaid",
        company_id,
        financialYear.id,
      ],
    );

    const bill_id = billResult.insertId;

    /* ================= INSERT ITEMS + UPDATE STOCK ================= */
    for (let item of processedItems) {
      const productId = Number(item.product_id);
      const qty = Number(item.quantity);

      if (!productId || !qty) {
        continue;
      }

      // ✅ Insert bill item
      await connection.query(
        `INSERT INTO bill_items 
        (bill_id, product_id, product_name, quantity, price, mrp, total, gst_percent, cgst, sgst)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          bill_id,
          productId,
          item.name,
          qty,
          item.price,
          item.mrp,
          item.total,
          item.gst,
          item.cgst,
          item.sgst,
        ],
      );

      // 🔥 STOCK INCREASE (THIS WAS MISSING)
      await connection.query(
        `UPDATE products 
         SET stock = stock + ?,
             mrp = ?,
             purchase_price = ?,
             gst = ?
         WHERE id = ? AND company_id = ?`,
        [qty, item.mrp, item.price, item.gst, productId, company_id],
      );
    }

    await connection.commit();
    transactionStarted = false;

    res.status(201).json({
      message: "Bill created & stock increased ✅",
      bill_id,
    });
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    console.error("BILL CREATE ERROR:", error);
    res.status(error.status || 500).json({
      message: error.status ? error.message : "Server error",
      ...(error.code ? { code: error.code } : {}),
      ...(error.status ? {} : { error: error.message }),
    });
  } finally {
    connection.release();
  }
};

/**
 * ================= GET ALL BILLS =================
 */
exports.getBills = async (req, res) => {
  try {
    await ensureVendorPaymentSchema();
    const company_id = req.user.company_id;
    const { vendor_id } = req.query;

    const params = [company_id];
    let vendorFilter = "";

    if (vendor_id) {
      vendorFilter = " AND b.vendor_id = ?";
      params.push(vendor_id);
    }

    const [rows] = await db.query(
      `
      SELECT
        b.*,
        v.name AS vendor_name,
        GREATEST(COALESCE(payment_totals.paid_amount,0),COALESCE(b.paid_amount,0)) AS paid_amount,
        GREATEST(b.total_amount-GREATEST(COALESCE(payment_totals.paid_amount,0),COALESCE(b.paid_amount,0)),0) AS due_amount,
        CASE
          WHEN GREATEST(b.total_amount-GREATEST(COALESCE(payment_totals.paid_amount,0),COALESCE(b.paid_amount,0)),0)<=0 THEN 'Paid'
          WHEN GREATEST(COALESCE(payment_totals.paid_amount,0),COALESCE(b.paid_amount,0))>0 THEN 'Partial Paid'
          ELSE 'Unpaid' END AS status
      FROM bills b
      LEFT JOIN vendors v
        ON b.vendor_id = v.id
       AND v.company_id = b.company_id
       AND (v.status IS NULL OR v.status <> 'Inactive')
      LEFT JOIN (
        SELECT bill_id, company_id, SUM(amount) AS paid_amount
        FROM vendor_payments WHERE status='SUCCESS'
        GROUP BY bill_id, company_id
      ) payment_totals
        ON payment_totals.bill_id = b.id
       AND payment_totals.company_id = b.company_id
      WHERE b.company_id = ?
      ${vendorFilter}
      ORDER BY b.id DESC
    `,
      params,
    );

    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * ================= GET BILL BY ID =================
 */
exports.getBillById = async (req, res) => {
  try {
    await ensureBillMrpColumns();
    await ensureVendorPaymentSchema();

    const { id } = req.params;
    const company_id = req.user.company_id;

    const [bill] = await db.query(
      `
      SELECT
        b.*,
        v.name AS vendor_name,
        v.phone AS vendor_phone,
        v.email AS vendor_email,
        v.gst_number AS vendor_gst_number,
        v.address AS vendor_address,
        gr.grn_number AS source_grn_number,
        po.po_number AS source_po_number,
        GREATEST(COALESCE(payment_totals.paid_amount,0),COALESCE(b.paid_amount,0)) AS paid_amount,
        GREATEST(b.total_amount-GREATEST(COALESCE(payment_totals.paid_amount,0),COALESCE(b.paid_amount,0)),0) AS due_amount,
        CASE
          WHEN GREATEST(b.total_amount-GREATEST(COALESCE(payment_totals.paid_amount,0),COALESCE(b.paid_amount,0)),0)<=0 THEN 'Paid'
          WHEN GREATEST(COALESCE(payment_totals.paid_amount,0),COALESCE(b.paid_amount,0))>0 THEN 'Partial Paid'
          ELSE 'Unpaid' END AS status
      FROM bills b
      LEFT JOIN vendors v
        ON b.vendor_id = v.id
       AND v.company_id = b.company_id
      LEFT JOIN goods_receipts gr
        ON gr.id = b.source_grn_id AND gr.company_id = b.company_id
      LEFT JOIN purchase_orders po
        ON po.id = b.source_purchase_order_id AND po.company_id = b.company_id
      LEFT JOIN (
        SELECT bill_id, company_id, SUM(amount) AS paid_amount
        FROM vendor_payments WHERE status='SUCCESS'
        GROUP BY bill_id, company_id
      ) payment_totals
        ON payment_totals.bill_id = b.id
       AND payment_totals.company_id = b.company_id
      WHERE b.id = ? AND b.company_id = ?
      LIMIT 1
    `,
      [id, company_id],
    );

    if (!bill.length) {
      return res.status(404).json({ message: "Bill not found" });
    }

    const [items] = await db.query(
      `SELECT
        bi.*,
        p.hsn AS hsn,
        p.sku AS sku
       FROM bill_items bi
       LEFT JOIN products p
         ON p.id = bi.product_id
        AND p.company_id = ?
       WHERE bi.bill_id = ?
       ORDER BY bi.id ASC`,
      [company_id, id],
    );

    res.json({
      ...bill[0],
      items,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.createBillFromGrn = async (req, res) => {
  const connection = await db.getConnection();
  try {
    await ensureBillMrpColumns();
    rejectClientFinancialYear(req.body);
    const companyId = req.user.company_id;
    const branchId = req.user.branch_id || null;
    const {
      source_grn_id,
      vendor_id,
      bill_number,
      bill_date,
      due_date,
      items = [],
    } = req.body;
    if (
      !source_grn_id ||
      !vendor_id ||
      !bill_number ||
      !bill_date ||
      !items.length
    ) {
      return res
        .status(400)
        .json({
          message: "GRN, vendor, bill number, bill date and items are required",
        });
    }
    await connection.beginTransaction();
    const financialYear = await requireFinancialYearForDate(companyId, bill_date, connection);
    const branchFilter = branchId ? " AND gr.branch_id=?" : "";
    const grnParams = [source_grn_id, companyId];
    if (branchId) grnParams.push(branchId);
    const [grns] = await connection.query(
      `SELECT gr.*,po.po_number FROM goods_receipts gr
       INNER JOIN purchase_orders po ON po.id=gr.purchase_order_id AND po.company_id=gr.company_id
       WHERE gr.id=? AND gr.company_id=? AND gr.status='Posted'${branchFilter} FOR UPDATE`,
      grnParams,
    );
    if (!grns.length)
      throw Object.assign(new Error("Posted GRN not found"), { status: 404 });
    const grn = grns[0];
    if (Number(grn.vendor_id) !== Number(vendor_id))
      throw Object.assign(new Error("Selected vendor does not match the GRN"), {
        status: 400,
      });
    const [sourceItems] = await connection.query(
      `SELECT gri.id,gri.product_id,gri.accepted_qty,poi.product_name
       FROM goods_receipt_items gri
       INNER JOIN purchase_order_items poi ON poi.id=gri.purchase_order_item_id AND poi.company_id=gri.company_id
       WHERE gri.goods_receipt_id=? AND gri.company_id=? FOR UPDATE`,
      [source_grn_id, companyId],
    );
    const [billedRows] = await connection.query(
      `SELECT bi.source_grn_item_id,COALESCE(SUM(bi.quantity),0) billed_quantity
       FROM bill_items bi INNER JOIN bills b ON b.id=bi.bill_id
       WHERE b.company_id=? AND b.source_grn_id=? AND bi.source_grn_item_id IS NOT NULL
       GROUP BY bi.source_grn_item_id`,
      [companyId, source_grn_id],
    );
    const billed = new Map(
      billedRows.map((row) => [
        Number(row.source_grn_item_id),
        Number(row.billed_quantity),
      ]),
    );
    let totalAmount = 0;
    const processed = [];
    for (const input of items) {
      const source = sourceItems.find(
        (row) => Number(row.id) === Number(input.source_grn_item_id),
      );
      if (!source || Number(source.product_id) !== Number(input.product_id))
        throw Object.assign(
          new Error("A bill item does not belong to the selected GRN"),
          { status: 400 },
        );
      const quantity = Number(input.qty ?? input.quantity ?? 0);
      const remaining =
        Number(source.accepted_qty) - (billed.get(Number(source.id)) || 0);
      if (quantity <= 0)
        throw Object.assign(
          new Error(
            `Bill quantity must be greater than zero for ${source.product_name}`,
          ),
          { status: 400 },
        );
      if (quantity > remaining + 0.000001)
        throw Object.assign(
          new Error(
            `Bill quantity exceeds remaining billable quantity (${remaining}) for ${source.product_name}`,
          ),
          { status: 400 },
        );
      const price = Number(input.price || 0),
        mrp = Number(input.mrp || 0),
        gst = Number(input.gst ?? input.gst_percent ?? 0);
      if (price < 0 || mrp < 0 || gst < 0)
        throw Object.assign(
          new Error(`Invalid rate or tax for ${source.product_name}`),
          { status: 400 },
        );
      const taxable = quantity * price,
        gstAmount = (taxable * gst) / 100,
        total = taxable + gstAmount;
      totalAmount += total;
      processed.push({
        source_grn_item_id: source.id,
        product_id: source.product_id,
        name: source.product_name,
        quantity,
        price,
        mrp,
        gst,
        total,
        cgst: gstAmount / 2,
        sgst: gstAmount / 2,
      });
    }
    const [billResult] = await connection.query(
      `INSERT INTO bills (vendor_id,bill_number,bill_date,due_date,total_amount,status,company_id,financial_year_id,source_purchase_order_id,source_grn_id,stock_posted)
       VALUES (?,?,?,?,?,'Unpaid',?,?,?,?,0)`,
      [
        vendor_id,
        bill_number,
        bill_date,
        due_date || null,
        totalAmount,
        companyId,
        financialYear.id,
        grn.purchase_order_id,
        grn.id,
      ],
    );
    for (const item of processed) {
      await connection.query(
        `INSERT INTO bill_items (bill_id,source_grn_item_id,product_id,product_name,quantity,price,mrp,total,gst_percent,cgst,sgst)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          billResult.insertId,
          item.source_grn_item_id,
          item.product_id,
          item.name,
          item.quantity,
          item.price,
          item.mrp,
          item.total,
          item.gst,
          item.cgst,
          item.sgst,
        ],
      );
    }
    await connection.commit();
    res
      .status(201)
      .json({
        message: `Bill created from ${grn.grn_number} without changing stock`,
        bill_id: billResult.insertId,
      });
  } catch (error) {
    await connection.rollback();
    console.error("GRN BILL CREATE ERROR", {
      companyId: req.user.company_id,
      grnId: req.body.source_grn_id,
      code: error.code,
      message: error.message,
    });
    res
      .status(error.code === "ER_DUP_ENTRY" ? 409 : error.status || 500)
      .json({
        message:
          error.code === "ER_DUP_ENTRY"
            ? "Bill number already exists"
            : error.status
              ? error.message
              : "Unable to create bill from GRN",
      });
  } finally {
    connection.release();
  }
};

/**
 * ================= UPDATE BILL =================
 */
exports.updateBill = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await ensureBillMrpColumns();
    rejectClientFinancialYear(req.body);

    const { id } = req.params;
    const company_id = req.user.company_id;
    const { vendor_id, bill_number, bill_date, due_date, items } = req.body;

    if (!vendor_id || !bill_number || !bill_date || !items?.length) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    await ensureBillStatusColumn();
    await connection.beginTransaction();
    const financialYear = await requireFinancialYearForDate(company_id, bill_date, connection);

    const [billRows] = await connection.query(
      "SELECT id, status, stock_posted, source_grn_id FROM bills WHERE id = ? AND company_id = ?",
      [id, company_id],
    );

    if (!billRows.length) {
      await connection.rollback();
      return res.status(404).json({ message: "Bill not found" });
    }

    const [oldItems] = await connection.query(
      `SELECT bi.product_id, bi.product_name, bi.quantity, bi.source_grn_item_id
       FROM bill_items bi
       INNER JOIN bills b ON b.id = bi.bill_id
       WHERE bi.bill_id = ? AND b.company_id = ?`,
      [id, company_id],
    );

    let grnItemLimits = null;
    if (billRows[0].source_grn_id) {
      const [grnRows] = await connection.query(
        "SELECT vendor_id FROM goods_receipts WHERE id=? AND company_id=? AND status='Posted' FOR UPDATE",
        [billRows[0].source_grn_id, company_id],
      );
      if (
        !grnRows.length ||
        Number(grnRows[0].vendor_id) !== Number(vendor_id)
      ) {
        await connection.rollback();
        return res
          .status(400)
          .json({ message: "GRN-linked Bill vendor cannot be changed" });
      }
      const [limits] = await connection.query(
        `SELECT gri.id,gri.product_id,gri.accepted_qty,
          COALESCE(SUM(CASE WHEN bi.bill_id<>? THEN bi.quantity ELSE 0 END),0) other_billed_quantity
         FROM goods_receipt_items gri
         LEFT JOIN bill_items bi ON bi.source_grn_item_id=gri.id
         WHERE gri.goods_receipt_id=? AND gri.company_id=?
         GROUP BY gri.id`,
        [id, billRows[0].source_grn_id, company_id],
      );
      grnItemLimits = new Map(limits.map((row) => [Number(row.id), row]));
    }

    for (const item of Number(billRows[0].stock_posted) === 1 ? oldItems : []) {
      const quantity = Number(item.quantity || 0);

      if (item.product_id && quantity > 0) {
        await connection.query(
          `UPDATE products
           SET stock = GREATEST(stock - ?, 0)
           WHERE id = ? AND company_id = ?`,
          [quantity, item.product_id, company_id],
        );
      }
    }

    let total_amount = 0;
    const processedItems = [];

    for (const item of items) {
      const productName = String(item.product_name || item.name || "").trim();
      const productId = Number(item.product_id || 0);
      const qty = Number(item.quantity || item.qty || 0);
      const price = Number(item.price || 0);
      const mrp = Number(item.mrp || 0);
      const gst = Number(item.gst_percent || item.gst || 0);
      const sourceGrnItemId = Number(item.source_grn_item_id || 0);

      if ((!productId && !productName) || qty <= 0) {
        await connection.rollback();
        return res
          .status(400)
          .json({ message: "Please enter valid bill items" });
      }
      if (grnItemLimits) {
        const limit = grnItemLimits.get(sourceGrnItemId);
        const allowed =
          Number(limit?.accepted_qty || 0) -
          Number(limit?.other_billed_quantity || 0);
        if (
          !limit ||
          Number(limit.product_id) !== productId ||
          qty > allowed + 0.000001
        ) {
          await connection.rollback();
          return res
            .status(400)
            .json({
              message: `Bill quantity exceeds remaining GRN quantity for ${productName || productId}`,
            });
        }
      }

      const productParams = productId
        ? [productId, company_id]
        : [productName, company_id];
      const productWhere = productId ? "id = ?" : "name = ?";
      const [productRows] = await connection.query(
        `SELECT id, name FROM products WHERE ${productWhere} AND company_id = ? LIMIT 1`,
        productParams,
      );

      if (!productRows.length) {
        await connection.rollback();
        return res.status(400).json({
          message: `Product not found: ${productName || productId}`,
        });
      }

      const base = qty * price;
      const gstAmount = (base * gst) / 100;
      const total = base + gstAmount;

      total_amount += total;
      processedItems.push({
        product_id: productRows[0].id,
        name: productRows[0].name,
        quantity: qty,
        price,
        mrp,
        gst,
        total,
        cgst: gstAmount / 2,
        sgst: gstAmount / 2,
        source_grn_item_id: sourceGrnItemId || null,
      });
    }

    const [paymentRows] = await connection.query(
      `SELECT COALESCE(SUM(amount), 0) AS paid_amount
       FROM vendor_payments
       WHERE bill_id = ? AND company_id = ?`,
      [id, company_id],
    );
    const paymentSum = Number(paymentRows[0]?.paid_amount || 0);
    const wasMarkedPaid = String(billRows[0]?.status || "") === "Paid";
    const paidAmount =
      paymentSum > 0 || !wasMarkedPaid ? paymentSum : total_amount;

    if (paidAmount > total_amount) {
      await connection.rollback();
      return res.status(400).json({
        message: "Bill total cannot be less than amount already paid",
      });
    }

    const status =
      paidAmount >= total_amount && total_amount > 0
        ? "Paid"
        : paidAmount > 0
          ? "Partial Paid"
          : "Unpaid";

    await connection.query(
      `UPDATE bills
       SET vendor_id = ?, bill_number = ?, bill_date = ?, due_date = ?, total_amount = ?, status = ?, financial_year_id = ?
       WHERE id = ? AND company_id = ?`,
      [
        vendor_id,
        bill_number,
        bill_date,
        due_date || null,
        total_amount,
        status,
        financialYear.id,
        id,
        company_id,
      ],
    );

    await connection.query("DELETE FROM bill_items WHERE bill_id = ?", [id]);

    for (const item of processedItems) {
      await connection.query(
        `INSERT INTO bill_items
        (bill_id, source_grn_item_id, product_id, product_name, quantity, price, mrp, total, gst_percent, cgst, sgst)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          item.source_grn_item_id,
          item.product_id,
          item.name,
          item.quantity,
          item.price,
          item.mrp,
          item.total,
          item.gst,
          item.cgst,
          item.sgst,
        ],
      );

      if (Number(billRows[0].stock_posted) === 1) {
        await connection.query(
          "UPDATE products SET stock = stock + ?, mrp = ?, purchase_price = ?, gst = ? WHERE id = ? AND company_id = ?",
          [
            item.quantity,
            item.mrp,
            item.price,
            item.gst,
            item.product_id,
            company_id,
          ],
        );
      }
    }

    await connection.commit();
    res.json({ message: "Bill updated", status });
  } catch (error) {
    await connection.rollback();
    console.error("Update bill error:", error);
    res.status(error.status || 500).json({
      message: error.status ? error.message : "Server error",
      ...(error.code ? { code: error.code } : {}),
      ...(error.status ? {} : { error: error.message }),
    });
  } finally {
    connection.release();
  }
};

/**
 * ================= UPDATE BILL STATUS =================
 */
exports.updateBillStatus = async (req, res) => {
  return res.status(409).json({
    message:
      "Bill status is calculated from vendor payments and cannot be changed manually",
  });
};

/**
 * ================= DELETE BILL =================
 */
exports.deleteBill = async (req, res) => {
  try {
    const { id } = req.params;
    const company_id = req.user.company_id;

    const [bill] = await db.query(
      "SELECT id, stock_posted FROM bills WHERE id = ? AND company_id = ?",
      [id, company_id],
    );

    if (!bill.length) {
      return res.status(404).json({ message: "Bill not found" });
    }

    const [items] = await db.query(
      "SELECT product_id, quantity FROM bill_items WHERE bill_id = ?",
      [id],
    );

    for (const item of Number(bill[0].stock_posted) === 1 ? items : []) {
      const quantity = Number(item.quantity || 0);

      if (item.product_id && quantity > 0) {
        await db.query(
          `UPDATE products
           SET stock = GREATEST(stock - ?, 0)
           WHERE id = ? AND company_id = ?`,
          [quantity, item.product_id, company_id],
        );
      }
    }

    await db.query("DELETE FROM bill_items WHERE bill_id = ?", [id]);
    await db.query("DELETE FROM bills WHERE id = ? AND company_id = ?", [
      id,
      company_id,
    ]);

    res.json({ message: "Bill deleted" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
};

/**
 * ================= GET LAST PURCHASE PRICE BY PRODUCT =================
 */
exports.getLastPurchasePrices = async (req, res) => {
  try {
    const company_id = req.user.company_id;

    const [rows] = await db.query(
      `
      SELECT
        latest.product_id,
        latest.price,
        latest.bill_date,
        latest.bill_number
      FROM (
        SELECT
          bi.product_id,
          bi.price,
          b.bill_date,
          b.bill_number,
          ROW_NUMBER() OVER (
            PARTITION BY bi.product_id
            ORDER BY b.bill_date DESC, b.id DESC
          ) AS row_num
        FROM bill_items bi
        INNER JOIN bills b ON b.id = bi.bill_id
        WHERE b.company_id = ?
      ) latest
      WHERE latest.row_num = 1
      `,
      [company_id],
    );

    res.json(rows);
  } catch (error) {
    console.error("Last purchase price error:", error);
    res.status(500).json({ message: "Server error" });
  }
};
