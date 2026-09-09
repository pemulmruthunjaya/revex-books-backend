const express = require("express");
const router = express.Router();
const db = require("../db/connection");
const authMiddleware = require("../middleware/authMiddleware");
const {
  assertUnchangedProductStock,
  assertZeroInitialStock,
} = require("../services/productStockSafety");

let productColumnsReady = false;

const inventoryColumns = [
  { name: "mrp", definition: "DECIMAL(10,2) NOT NULL DEFAULT 0" },
  { name: "sku", definition: "VARCHAR(100) NULL" },
  { name: "barcode", definition: "VARCHAR(100) NULL" },
  { name: "hsn", definition: "VARCHAR(30) NULL" },
  { name: "category", definition: "VARCHAR(100) NULL" },
  { name: "batch_no", definition: "VARCHAR(100) NULL" },
  { name: "manufactured_date", definition: "DATE NULL" },
  { name: "expiry_date", definition: "DATE NULL" },
  { name: "unit", definition: "VARCHAR(30) NOT NULL DEFAULT 'PCS'" },
  { name: "gst", definition: "DECIMAL(5,2) NOT NULL DEFAULT 18" },
  { name: "purchase_price", definition: "DECIMAL(10,2) NOT NULL DEFAULT 0" },
  { name: "opening_stock", definition: "DECIMAL(10,2) NOT NULL DEFAULT 0" },
  { name: "reorder_level", definition: "DECIMAL(10,2) NOT NULL DEFAULT 0" },
  { name: "status", definition: "VARCHAR(20) NOT NULL DEFAULT 'Active'" },
];

const ensureProductColumns = async () => {
  if (productColumnsReady) {
    return;
  }

  const [columns] = await db.query("SHOW COLUMNS FROM products");
  const existingColumns = new Set(columns.map((column) => column.Field));

  for (const column of inventoryColumns) {
    if (!existingColumns.has(column.name)) {
      await db.query(
        `ALTER TABLE products ADD COLUMN \`${column.name}\` ${column.definition}`
      );
    }
  }

  productColumnsReady = true;
};

const toNumber = (value, fallback = 0) => {
  if (value === "" || value === null || value === undefined) {
    return fallback;
  }

  const numericValue = Number(value);
  return Number.isNaN(numericValue) ? fallback : numericValue;
};

const normalizeProductPayload = (body) => {
  const stock = toNumber(body.stock, toNumber(body.opening_stock, 0));
  const openingStock = toNumber(body.opening_stock, stock);
  const dateOrNull = (value) => value || null;

  return {
    name: String(body.name || "").trim(),
    sku: String(body.sku || "").trim(),
    barcode: String(body.barcode || "").trim(),
    hsn: String(body.hsn || "").trim(),
    category: String(body.category || "").trim(),
    batch_no: String(body.batch_no || "").trim(),
    manufactured_date: dateOrNull(body.manufactured_date),
    expiry_date: dateOrNull(body.expiry_date),
    unit: String(body.unit || "PCS").trim() || "PCS",
    gst: toNumber(body.gst, 18),
    purchase_price: toNumber(body.purchase_price, 0),
    sellingPrice: toNumber(body.sellingPrice, 0),
    mrp: toNumber(body.mrp, 0),
    opening_stock: openingStock,
    stock,
    reorder_level: toNumber(body.reorder_level, 0),
    status: body.status === "Inactive" ? "Inactive" : "Active",
  };
};

/* ================= GET ALL PRODUCTS ================= */
router.get("/", authMiddleware, async (req, res) => {
  try {
    await ensureProductColumns();

    const [rows] = await db.query(
      "SELECT * FROM products WHERE company_id = ? ORDER BY id DESC",
      [req.user.company_id]
    );

    res.status(200).json(rows);
  } catch (err) {
    console.error("❌ ERROR FETCHING PRODUCTS:", err);

    res.status(500).json({
      error: "Failed to fetch products",
      details: err.message,
    });
  }
});

/* ================= ADD PRODUCT ================= */
router.post("/", authMiddleware, async (req, res) => {
  try {
    assertZeroInitialStock(req.body);
    await ensureProductColumns();

    const product = normalizeProductPayload(req.body);

    if (!product.name || product.sellingPrice < 0 || product.stock < 0) {
      return res.status(400).json({
        error: "Product name, selling price, and stock are required",
      });
    }

    const [result] = await db.query(
      `INSERT INTO products
       (name, sku, barcode, hsn, category, batch_no, manufactured_date, expiry_date, unit, gst, purchase_price, sellingPrice, mrp, opening_stock, stock, reorder_level, status, company_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        product.name,
        product.sku,
        product.barcode,
        product.hsn,
        product.category,
        product.batch_no,
        product.manufactured_date,
        product.expiry_date,
        product.unit,
        product.gst,
        product.purchase_price,
        product.sellingPrice,
        product.mrp,
        product.opening_stock,
        product.stock,
        product.reorder_level,
        product.status,
        req.user.company_id,
      ]
    );

    res.status(201).json({
      message: "Product created successfully",
      productId: result.insertId,
    });
  } catch (err) {
    console.error("❌ ADD PRODUCT ERROR:", err);

    res.status(err.status || 500).json({
      error: err.status ? err.message : "Failed to create product",
      ...(err.code ? { code: err.code } : {}),
    });
  }
});

/* ================= UPDATE PRODUCT ================= */
router.put("/:id", authMiddleware, async (req, res) => {
  try {
    await ensureProductColumns();

    const product = normalizeProductPayload(req.body);
    const { id } = req.params;

    console.log("✏️ Updating product ID:", id);

    if (!product.name || product.sellingPrice < 0 || product.stock < 0) {
      return res.status(400).json({
        error: "Product name, selling price, and stock are required",
      });
    }

    const [existingRows] = await db.query(
      "SELECT id,stock,opening_stock FROM products WHERE id=? AND company_id=? LIMIT 1",
      [id, req.user.company_id]
    );
    if (!existingRows.length) {
      return res.status(404).json({ error: "Product not found" });
    }
    assertUnchangedProductStock(req.body, existingRows[0]);

    const [result] = await db.query(
      `UPDATE products
       SET name=?,
           sku=?,
           barcode=?,
           hsn=?,
           category=?,
           batch_no=?,
           manufactured_date=?,
           expiry_date=?,
           unit=?,
           gst=?,
           purchase_price=?,
           sellingPrice=?,
           mrp=?,
           reorder_level=?,
           status=?
       WHERE id=? AND company_id=?`,
      [
        product.name,
        product.sku,
        product.barcode,
        product.hsn,
        product.category,
        product.batch_no,
        product.manufactured_date,
        product.expiry_date,
        product.unit,
        product.gst,
        product.purchase_price,
        product.sellingPrice,
        product.mrp,
        product.reorder_level,
        product.status,
        id,
        req.user.company_id,
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Product not found" });
    }

    res.json({ message: "Product updated successfully" });
  } catch (err) {
    console.error("❌ UPDATE ERROR:", err);

    res.status(err.status || 500).json({
      error: err.status ? err.message : "Failed to update product",
      ...(err.code ? { code: err.code } : {}),
    });
  }
});

/* ================= DELETE PRODUCT ================= */
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    await ensureProductColumns();

    const { id } = req.params;

    console.log("🗑️ Deleting product ID:", id);

    const [products] = await db.query(
      "SELECT id, name FROM products WHERE id=? AND company_id=?",
      [id, req.user.company_id]
    );

    if (!products.length) {
      return res.status(404).json({ error: "Product not found" });
    }

    const product = products[0];
    const [[usage]] = await db.query(
      `SELECT
         (SELECT COUNT(*)
          FROM bill_items bi
          INNER JOIN bills b ON b.id = bi.bill_id
          WHERE bi.product_id = ? AND b.company_id = ?) AS bill_count,
         (SELECT COUNT(*)
          FROM invoice_items ii
          WHERE ii.company_id = ? AND ii.item_name = ?) AS invoice_count`,
      [id, req.user.company_id, req.user.company_id, product.name]
    );

    if (Number(usage.bill_count || 0) + Number(usage.invoice_count || 0) > 0) {
      await db.query(
        "UPDATE products SET status='Inactive' WHERE id=? AND company_id=?",
        [id, req.user.company_id]
      );

      return res.json({
        message: "Product is used in bills or invoices, so it was marked inactive",
      });
    }

    const [result] = await db.query(
      "DELETE FROM products WHERE id=? AND company_id=?",
      [id, req.user.company_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Product not found" });
    }

    res.json({ message: "Product deleted successfully" });
  } catch (err) {
    console.error("❌ DELETE ERROR:", err);

    res.status(500).json({
      error: "Failed to delete product",
      details: err.message,
    });
  }
});

module.exports = router;
