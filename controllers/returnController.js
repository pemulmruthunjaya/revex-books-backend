const db = require("../db/connection");

let returnTablesReady = false;

const ensureReturnTables = async () => {
  if (returnTablesReady) {
    return;
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS product_returns (
      id INT AUTO_INCREMENT PRIMARY KEY,
      company_id INT NOT NULL,
      type VARCHAR(20) NOT NULL,
      return_number VARCHAR(50) NOT NULL,
      return_date DATE NOT NULL,
      party_type VARCHAR(20) NOT NULL,
      party_id INT NULL,
      party_name VARCHAR(255) NOT NULL,
      reference_number VARCHAR(100) NULL,
      subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
      tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      notes TEXT NULL,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_product_returns_company_number (company_id, return_number)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS return_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      return_id INT NOT NULL,
      company_id INT NOT NULL,
      product_id INT NOT NULL,
      product_name VARCHAR(255) NOT NULL,
      batch_no VARCHAR(100) NULL,
      quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
      unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
      mrp DECIMAL(12,2) NOT NULL DEFAULT 0,
      gst_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
      total_price DECIMAL(12,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_return_items_return (return_id),
      INDEX idx_return_items_company_product (company_id, product_id)
    )
  `);

  returnTablesReady = true;
};

const toNumber = (value) => {
  const numberValue = Number(value || 0);
  return Number.isNaN(numberValue) ? 0 : numberValue;
};

const normalizeType = (value) => {
  const type = String(value || "").toLowerCase();
  return type === "purchase" ? "purchase" : "sales";
};

const getPrefix = (type) => (type === "purchase" ? "PRET" : "SRET");

const getNextReturnNumber = async (companyId, type) => {
  const prefix = getPrefix(type);
  const [rows] = await db.query(
    `SELECT MAX(CAST(SUBSTRING_INDEX(return_number, '-', -1) AS UNSIGNED)) AS max_number
     FROM product_returns
     WHERE company_id = ? AND type = ? AND return_number LIKE ?`,
    [companyId, type, `${prefix}-%`]
  );

  const nextNumber = Number(rows[0]?.max_number || 0) + 1;
  return `${prefix}-${String(nextNumber).padStart(4, "0")}`;
};

const resolveParty = async ({ companyId, type, partyId, partyName }) => {
  const table = type === "purchase" ? "vendors" : "customers";
  const partyType = type === "purchase" ? "vendor" : "customer";

  if (!partyId) {
    return {
      party_type: partyType,
      party_id: null,
      party_name: String(partyName || "").trim(),
    };
  }

  const [rows] = await db.query(
    `SELECT id, name FROM ${table} WHERE id = ? AND company_id = ? LIMIT 1`,
    [partyId, companyId]
  );

  if (!rows.length) {
    return {
      party_type: partyType,
      party_id: null,
      party_name: String(partyName || "").trim(),
    };
  }

  return {
    party_type: partyType,
    party_id: rows[0].id,
    party_name: rows[0].name,
  };
};

exports.getReturns = async (req, res) => {
  try {
    await ensureReturnTables();

    const companyId = req.user.company_id;
    const type = req.query.type ? normalizeType(req.query.type) : null;
    const params = [companyId];
    let typeFilter = "";

    if (type) {
      typeFilter = " AND r.type = ?";
      params.push(type);
    }

    const [rows] = await db.query(
      `SELECT
         r.*,
         COUNT(ri.id) AS item_count,
         COALESCE(SUM(ri.quantity), 0) AS total_qty
       FROM product_returns r
       LEFT JOIN return_items ri
         ON ri.return_id = r.id
        AND ri.company_id = r.company_id
       WHERE r.company_id = ?
       ${typeFilter}
       GROUP BY r.id
       ORDER BY r.id DESC`,
      params
    );

    res.json(rows);
  } catch (error) {
    console.error("Get returns error:", error);
    res.status(500).json({ message: "Failed to fetch returns" });
  }
};

exports.getReturnById = async (req, res) => {
  try {
    await ensureReturnTables();

    const companyId = req.user.company_id;
    const { id } = req.params;

    const [returns] = await db.query(
      "SELECT * FROM product_returns WHERE id = ? AND company_id = ?",
      [id, companyId]
    );

    if (!returns.length) {
      return res.status(404).json({ message: "Return not found" });
    }

    const [items] = await db.query(
      "SELECT * FROM return_items WHERE return_id = ? AND company_id = ? ORDER BY id",
      [id, companyId]
    );

    res.json({ ...returns[0], items });
  } catch (error) {
    console.error("Get return error:", error);
    res.status(500).json({ message: "Failed to fetch return" });
  }
};

exports.createReturn = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await ensureReturnTables();

    const companyId = req.user.company_id;
    const createdBy = req.user.user_id;
    const type = normalizeType(req.body.type);
    const { return_date, party_id, party_name, reference_number, notes, items } = req.body;

    if (!return_date || !Array.isArray(items) || !items.length) {
      return res.status(400).json({ message: "Return date and items are required" });
    }

    const party = await resolveParty({ companyId, type, partyId: party_id, partyName: party_name });

    if (!party.party_name) {
      return res.status(400).json({
        message: type === "purchase" ? "Vendor is required" : "Customer is required",
      });
    }

    const validItems = items
      .map((item) => ({
        product_id: Number(item.product_id || 0),
        quantity: toNumber(item.quantity || item.qty),
        unit_price: toNumber(item.unit_price || item.price),
        gst_rate: toNumber(item.gst_rate || item.gst),
      }))
      .filter((item) => item.product_id && item.quantity > 0);

    if (!validItems.length) {
      return res.status(400).json({ message: "Please add at least one valid item" });
    }

    await connection.beginTransaction();

    const returnNumber = await getNextReturnNumber(companyId, type);
    let subtotal = 0;
    let taxAmount = 0;
    const processedItems = [];

    for (const item of validItems) {
      const [productRows] = await connection.query(
        "SELECT id, name, stock, mrp, batch_no, sellingPrice, purchase_price FROM products WHERE id = ? AND company_id = ?",
        [item.product_id, companyId]
      );

      if (!productRows.length) {
        await connection.rollback();
        return res.status(400).json({ message: `Product not found: ${item.product_id}` });
      }

      const product = productRows[0];
      const currentStock = toNumber(product.stock);

      if (type === "purchase" && currentStock < item.quantity) {
        await connection.rollback();
        return res.status(400).json({
          message: `Stock is not enough for purchase return: ${product.name}. Available: ${currentStock}`,
        });
      }

      const fallbackPrice = type === "purchase" ? product.purchase_price : product.sellingPrice;
      const unitPrice = item.unit_price || toNumber(fallbackPrice);
      const taxable = item.quantity * unitPrice;
      const gst = (taxable * item.gst_rate) / 100;
      const total = taxable + gst;

      subtotal += taxable;
      taxAmount += gst;

      processedItems.push({
        ...item,
        product_name: product.name,
        batch_no: product.batch_no || null,
        mrp: toNumber(product.mrp),
        unit_price: unitPrice,
        total_price: total,
      });
    }

    const totalAmount = subtotal + taxAmount;

    const [returnResult] = await connection.query(
      `INSERT INTO product_returns
       (company_id, type, return_number, return_date, party_type, party_id, party_name, reference_number, subtotal, tax_amount, total_amount, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        type,
        returnNumber,
        return_date,
        party.party_type,
        party.party_id,
        party.party_name,
        reference_number || null,
        subtotal,
        taxAmount,
        totalAmount,
        notes || null,
        createdBy,
      ]
    );

    const returnId = returnResult.insertId;

    for (const item of processedItems) {
      await connection.query(
        `INSERT INTO return_items
         (return_id, company_id, product_id, product_name, batch_no, quantity, unit_price, mrp, gst_rate, total_price)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          returnId,
          companyId,
          item.product_id,
          item.product_name,
          item.batch_no,
          item.quantity,
          item.unit_price,
          item.mrp,
          item.gst_rate,
          item.total_price,
        ]
      );

      await connection.query(
        `UPDATE products
         SET stock = stock ${type === "sales" ? "+" : "-"} ?
         WHERE id = ? AND company_id = ?`,
        [item.quantity, item.product_id, companyId]
      );
    }

    await connection.commit();

    res.status(201).json({
      message: "Return saved",
      return_id: returnId,
      return_number: returnNumber,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Create return error:", error);
    res.status(500).json({ message: "Failed to save return", error: error.message });
  } finally {
    connection.release();
  }
};

exports.deleteReturn = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await ensureReturnTables();

    const companyId = req.user.company_id;
    const { id } = req.params;

    await connection.beginTransaction();

    const [returns] = await connection.query(
      "SELECT * FROM product_returns WHERE id = ? AND company_id = ?",
      [id, companyId]
    );

    if (!returns.length) {
      await connection.rollback();
      return res.status(404).json({ message: "Return not found" });
    }

    const returnRow = returns[0];
    const [items] = await connection.query(
      "SELECT * FROM return_items WHERE return_id = ? AND company_id = ?",
      [id, companyId]
    );

    for (const item of items) {
      if (returnRow.type === "sales") {
        const [productRows] = await connection.query(
          "SELECT stock FROM products WHERE id = ? AND company_id = ?",
          [item.product_id, companyId]
        );
        const currentStock = toNumber(productRows[0]?.stock);

        if (currentStock < toNumber(item.quantity)) {
          await connection.rollback();
          return res.status(400).json({
            message: `Cannot delete. Product stock is lower than sales return quantity for ${item.product_name}`,
          });
        }
      }

      await connection.query(
        `UPDATE products
         SET stock = stock ${returnRow.type === "sales" ? "-" : "+"} ?
         WHERE id = ? AND company_id = ?`,
        [item.quantity, item.product_id, companyId]
      );
    }

    await connection.query("DELETE FROM return_items WHERE return_id = ? AND company_id = ?", [id, companyId]);
    await connection.query("DELETE FROM product_returns WHERE id = ? AND company_id = ?", [id, companyId]);

    await connection.commit();
    res.json({ message: "Return deleted and stock reversed" });
  } catch (error) {
    await connection.rollback();
    console.error("Delete return error:", error);
    res.status(500).json({ message: "Failed to delete return" });
  } finally {
    connection.release();
  }
};

// Product Returns currently carry valued/GST semantics and move stock, but they
// do not link to source documents or reverse accounting and settlement. Keep
// historical reads available while preventing new or destructive pseudo-
// financial activity until the complete controlled workflow exists.
exports.createReturn = async (_req, res) =>
  res.status(409).json({
    code: "RETURN_ACCOUNTING_WORKFLOW_REQUIRED",
    message:
      "Sales and Purchase Returns are temporarily unavailable until the controlled return-accounting workflow is available",
  });

exports.deleteReturn = async (_req, res) =>
  res.status(409).json({
    code: "RETURN_HISTORICAL_MUTATION_RESTRICTED",
    message:
      "Existing Returns cannot be deleted because their stock and financial history must remain intact",
  });
