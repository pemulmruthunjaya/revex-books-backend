const db = require("../db/connection");
const {
  rejectClientFinancialYear,
  requireFinancialYearForDate,
  requireFinancialYearForMutation,
  requireFinancialYearForPosting,
} = require("../services/financialYearService");

let deliveryChallanTablesReady = false;

const ensureDeliveryChallanTables = async () => {
  if (deliveryChallanTablesReady) {
    return;
  }

  const [productColumns] = await db.query("SHOW COLUMNS FROM products");
  const existingProductColumns = new Set(productColumns.map((column) => column.Field));
  const requiredProductColumns = [
    { name: "unit", definition: "VARCHAR(30) NOT NULL DEFAULT 'PCS'" },
    { name: "batch_no", definition: "VARCHAR(100) NULL" },
    { name: "status", definition: "VARCHAR(20) NOT NULL DEFAULT 'Active'" },
  ];

  for (const column of requiredProductColumns) {
    if (!existingProductColumns.has(column.name)) {
      await db.query(
        `ALTER TABLE products ADD COLUMN \`${column.name}\` ${column.definition}`
      );
    }
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS delivery_challans (
      id INT AUTO_INCREMENT PRIMARY KEY,
      company_id INT NOT NULL,
      type VARCHAR(10) NOT NULL,
      challan_number VARCHAR(50) NOT NULL,
      challan_date DATE NOT NULL,
      party_type VARCHAR(20) NOT NULL,
      party_id INT NULL,
      party_name VARCHAR(255) NOT NULL,
      address TEXT NULL,
      transport VARCHAR(255) NULL,
      vehicle_number VARCHAR(100) NULL,
      notes TEXT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'Created',
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_delivery_challan_company_number (company_id, challan_number)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS delivery_challan_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      challan_id INT NOT NULL,
      company_id INT NOT NULL,
      product_id INT NOT NULL,
      product_name VARCHAR(255) NOT NULL,
      batch_no VARCHAR(100) NULL,
      quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
      unit VARCHAR(30) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_delivery_challan_items_challan (challan_id),
      INDEX idx_delivery_challan_items_company_product (company_id, product_id)
    )
  `);

  deliveryChallanTablesReady = true;
};

const toNumber = (value) => {
  const numberValue = Number(value || 0);
  return Number.isNaN(numberValue) ? 0 : numberValue;
};

const normalizeType = (value) => {
  const type = String(value || "").toLowerCase();
  return type === "in" ? "in" : "out";
};

const getPrefix = (type) => (type === "in" ? "DCIN" : "DCOUT");

const getNextChallanNumber = async (companyId, type) => {
  const prefix = getPrefix(type);
  const [rows] = await db.query(
    `SELECT MAX(CAST(SUBSTRING_INDEX(challan_number, '-', -1) AS UNSIGNED)) AS max_number
     FROM delivery_challans
     WHERE company_id = ? AND type = ? AND challan_number LIKE ?`,
    [companyId, type, `${prefix}-%`]
  );

  const nextNumber = Number(rows[0]?.max_number || 0) + 1;
  return `${prefix}-${String(nextNumber).padStart(4, "0")}`;
};

const resolveParty = async ({ companyId, type, partyId, partyName }) => {
  const partyType = type === "in" ? "vendor" : "customer";

  if (!partyId) {
    return {
      party_type: partyType,
      party_id: null,
      party_name: String(partyName || "").trim(),
      address: "",
    };
  }

  const table = type === "in" ? "vendors" : "customers";
  const [rows] = await db.query(
    `SELECT id, name, address FROM ${table} WHERE id = ? AND company_id = ? LIMIT 1`,
    [partyId, companyId]
  );

  if (!rows.length) {
    return {
      party_type: partyType,
      party_id: null,
      party_name: String(partyName || "").trim(),
      address: "",
    };
  }

  return {
    party_type: partyType,
    party_id: rows[0].id,
    party_name: rows[0].name,
    address: rows[0].address || "",
  };
};

exports.getChallans = async (req, res) => {
  try {
    await ensureDeliveryChallanTables();

    const companyId = req.user.company_id;
    const type = req.query.type ? normalizeType(req.query.type) : null;
    const params = [companyId];
    let typeFilter = "";

    if (type) {
      typeFilter = " AND dc.type = ?";
      params.push(type);
    }

    const [rows] = await db.query(
      `SELECT
         dc.*,
         COUNT(dci.id) AS item_count,
         COALESCE(SUM(dci.quantity), 0) AS total_qty
       FROM delivery_challans dc
       LEFT JOIN delivery_challan_items dci
         ON dci.challan_id = dc.id
        AND dci.company_id = dc.company_id
       WHERE dc.company_id = ?
       ${typeFilter}
       GROUP BY dc.id
       ORDER BY dc.id DESC`,
      params
    );

    res.json(rows);
  } catch (error) {
    console.error("Get delivery challans error:", error);
    res.status(500).json({ message: "Failed to fetch delivery challans" });
  }
};

exports.getChallanById = async (req, res) => {
  try {
    await ensureDeliveryChallanTables();

    const companyId = req.user.company_id;
    const { id } = req.params;

    const [challans] = await db.query(
      "SELECT * FROM delivery_challans WHERE id = ? AND company_id = ?",
      [id, companyId]
    );

    if (!challans.length) {
      return res.status(404).json({ message: "Delivery challan not found" });
    }

    const [items] = await db.query(
      "SELECT * FROM delivery_challan_items WHERE challan_id = ? AND company_id = ?",
      [id, companyId]
    );

    res.json({ ...challans[0], items });
  } catch (error) {
    console.error("Get delivery challan error:", error);
    res.status(500).json({ message: "Failed to fetch delivery challan" });
  }
};

exports.createChallan = async (req, res) => {
  const connection = await db.getConnection();

  try {
    rejectClientFinancialYear(req.body);
    await ensureDeliveryChallanTables();

    const companyId = req.user.company_id;
    const createdBy = req.user.user_id;
    const type = normalizeType(req.body.type);
    const {
      challan_date,
      party_id,
      party_name,
      address,
      transport,
      vehicle_number,
      notes,
      items,
    } = req.body;

    if (!challan_date || !Array.isArray(items) || !items.length) {
      return res.status(400).json({ message: "Challan date and items are required" });
    }

    const party = await resolveParty({
      companyId,
      type,
      partyId: party_id,
      partyName: party_name,
    });

    if (!party.party_name) {
      return res.status(400).json({
        message: type === "in" ? "Vendor is required" : "Customer is required",
      });
    }

    const validItems = items
      .map((item) => ({
        product_id: Number(item.product_id || 0),
        quantity: toNumber(item.quantity || item.qty),
      }))
      .filter((item) => item.product_id && item.quantity > 0);

    if (!validItems.length) {
      return res.status(400).json({ message: "Please add at least one valid item" });
    }

    await connection.beginTransaction();
    await requireFinancialYearForPosting(companyId, challan_date, connection);

    const challanNumber = await getNextChallanNumber(companyId, type);

    const [challanResult] = await connection.query(
      `INSERT INTO delivery_challans
       (company_id, type, challan_number, challan_date, party_type, party_id, party_name, address, transport, vehicle_number, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        type,
        challanNumber,
        challan_date,
        party.party_type,
        party.party_id,
        party.party_name,
        address || party.address || null,
        transport || null,
        vehicle_number || null,
        notes || null,
        createdBy,
      ]
    );

    const challanId = challanResult.insertId;

    for (const item of validItems) {
      const [productRows] = await connection.query(
        "SELECT id, name, stock, unit, batch_no FROM products WHERE id = ? AND company_id = ?",
        [item.product_id, companyId]
      );

      if (!productRows.length) {
        await connection.rollback();
        return res.status(400).json({ message: `Product not found: ${item.product_id}` });
      }

      const product = productRows[0];
      const currentStock = toNumber(product.stock);

      if (type === "out" && currentStock < item.quantity) {
        await connection.rollback();
        return res.status(400).json({
          message: `Insufficient stock for ${product.name}. Available: ${currentStock}`,
        });
      }

      await connection.query(
        `INSERT INTO delivery_challan_items
         (challan_id, company_id, product_id, product_name, batch_no, quantity, unit)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          challanId,
          companyId,
          product.id,
          product.name,
          product.batch_no || null,
          item.quantity,
          product.unit || "PCS",
        ]
      );

      await connection.query(
        `UPDATE products
         SET stock = stock ${type === "in" ? "+" : "-"} ?
         WHERE id = ? AND company_id = ?`,
        [item.quantity, product.id, companyId]
      );
    }

    await connection.commit();

    res.status(201).json({
      message: "Delivery challan created",
      challan_id: challanId,
      challan_number: challanNumber,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Create delivery challan error:", error);
    res.status(error.status || 500).json({
      ...(error.code ? { code: error.code } : {}),
      message: error.status ? error.message : "Failed to create delivery challan",
      ...(error.status ? {} : { error: error.message }),
    });
  } finally {
    connection.release();
  }
};

exports.deleteChallan = async (req, res) => {
  const connection = await db.getConnection();

  try {
    rejectClientFinancialYear(req.body);
    await ensureDeliveryChallanTables();

    const companyId = req.user.company_id;
    const { id } = req.params;

    await connection.beginTransaction();

    const [challans] = await connection.query(
      "SELECT * FROM delivery_challans WHERE id = ? AND company_id = ? FOR UPDATE",
      [id, companyId]
    );

    if (!challans.length) {
      await connection.rollback();
      return res.status(404).json({ message: "Delivery challan not found" });
    }

    const challan = challans[0];
    const sourceFinancialYear = await requireFinancialYearForDate(
      companyId,
      challan.challan_date,
      connection
    );
    await requireFinancialYearForMutation(
      companyId,
      sourceFinancialYear.id,
      connection
    );
    const [items] = await connection.query(
      "SELECT * FROM delivery_challan_items WHERE challan_id = ? AND company_id = ?",
      [id, companyId]
    );

    for (const item of items) {
      if (challan.type === "in") {
        const [productRows] = await connection.query(
          "SELECT stock FROM products WHERE id = ? AND company_id = ?",
          [item.product_id, companyId]
        );
        const currentStock = toNumber(productRows[0]?.stock);

        if (currentStock < toNumber(item.quantity)) {
          await connection.rollback();
          return res.status(400).json({
            message: `Cannot delete. Product stock is lower than received challan quantity for ${item.product_name}`,
          });
        }
      }

      await connection.query(
        `UPDATE products
         SET stock = stock ${challan.type === "in" ? "-" : "+"} ?
         WHERE id = ? AND company_id = ?`,
        [item.quantity, item.product_id, companyId]
      );
    }

    await connection.query(
      "DELETE FROM delivery_challan_items WHERE challan_id = ? AND company_id = ?",
      [id, companyId]
    );
    await connection.query(
      "DELETE FROM delivery_challans WHERE id = ? AND company_id = ?",
      [id, companyId]
    );

    await connection.commit();
    res.json({ message: "Delivery challan deleted and stock reversed" });
  } catch (error) {
    await connection.rollback();
    console.error("Delete delivery challan error:", error);
    res.status(error.status || 500).json({
      ...(error.code ? { code: error.code } : {}),
      message: error.status ? error.message : "Failed to delete delivery challan",
    });
  } finally {
    connection.release();
  }
};
