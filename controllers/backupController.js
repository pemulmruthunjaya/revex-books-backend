const db = require("../db/connection");
const { ensureAuditLogTable } = require("../services/auditLogService");
const { ensurePayrollTables } = require("../services/payrollService");
const { ensureUserAccessColumns } = require("../services/userAccessService");

const productInventoryColumns = [
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

const exportSpecs = [
  { key: "company", table: "companies", direct: true, whereColumn: "id" },
  { key: "users", table: "users", direct: true, excludeColumns: ["password"] },
  { key: "business_profiles", table: "business_profiles", direct: true },
  { key: "invoice_settings", table: "invoice_settings", direct: true },
  { key: "customers", table: "customers", direct: true },
  { key: "vendors", table: "vendors", direct: true },
  { key: "products", table: "products", direct: true },
  { key: "invoices", table: "invoices", direct: true },
  { key: "invoice_items", table: "invoice_items", direct: true },
  { key: "payments", table: "payments", direct: true },
  { key: "bills", table: "bills", direct: true },
  {
    key: "bill_items",
    table: "bill_items",
    sql:
      "SELECT bi.* FROM bill_items bi INNER JOIN bills b ON b.id = bi.bill_id WHERE b.company_id = ? ORDER BY bi.id",
  },
  { key: "vendor_payments", table: "vendor_payments", direct: true },
  { key: "delivery_challans", table: "delivery_challans", direct: true },
  { key: "delivery_challan_items", table: "delivery_challan_items", direct: true },
  { key: "product_returns", table: "product_returns", direct: true },
  { key: "return_items", table: "return_items", direct: true },
  { key: "quotations", table: "quotations", direct: true },
  {
    key: "quotation_items",
    table: "quotation_items",
    sql:
      "SELECT qi.* FROM quotation_items qi INNER JOIN quotations q ON q.id = qi.quotation_id WHERE q.company_id = ? ORDER BY qi.id",
  },
  { key: "purchase_orders", table: "purchase_orders", direct: true },
  {
    key: "purchase_order_items",
    table: "purchase_order_items",
    sql:
      "SELECT poi.* FROM purchase_order_items poi INNER JOIN purchase_orders po ON po.id = poi.purchase_order_id WHERE po.company_id = ? ORDER BY poi.id",
  },
  { key: "accounts", table: "accounts", direct: true },
  { key: "journal_entries", table: "journal_entries", direct: true },
  { key: "receipt_entries", table: "receipt_entries", direct: true },
  { key: "payment_entries", table: "payment_entries", direct: true },
  { key: "expenses", table: "expenses", direct: true },
  { key: "payroll_employees", table: "payroll_employees", direct: true },
  { key: "payroll_entries", table: "payroll_entries", direct: true },
  { key: "payroll_attendance_imports", table: "payroll_attendance_imports", direct: true },
  { key: "payroll_attendance_lines", table: "payroll_attendance_lines", direct: true },
  { key: "audit_logs", table: "audit_logs", direct: true },
  { key: "data_import_batches", table: "data_import_batches", direct: true },
  { key: "data_import_changes", table: "data_import_changes", direct: true },
];

const optionalBackupTables = new Set(["receipt_entries", "payment_entries"]);

const backupSectionLabels = {
  company: "Company",
  users: "Staff Users",
  business_profiles: "Business Profile",
  invoice_settings: "Invoice Settings",
  customers: "Customers",
  vendors: "Vendors",
  products: "Products",
  invoices: "Sales Invoices",
  invoice_items: "Sales Invoice Items",
  payments: "Customer Payments",
  bills: "Purchase Bills",
  bill_items: "Purchase Bill Items",
  vendor_payments: "Vendor Payments",
  delivery_challans: "Delivery Challans",
  delivery_challan_items: "Delivery Challan Items",
  product_returns: "Returns",
  return_items: "Return Items",
  quotations: "Quotations",
  quotation_items: "Quotation Items",
  purchase_orders: "Purchase Orders",
  purchase_order_items: "Purchase Order Items",
  accounts: "Chart of Accounts",
  journal_entries: "Journal Entries",
  receipt_entries: "Receipt Entries",
  payment_entries: "Payment Entries",
  expenses: "Expenses",
  payroll_employees: "Payroll Employees",
  payroll_entries: "Payroll Entries",
  payroll_attendance_imports: "Attendance Imports",
  payroll_attendance_lines: "Attendance Lines",
  audit_logs: "Audit Logs",
  data_import_batches: "Import/Export History",
  data_import_changes: "Import Change Details",
};

const importConfigs = {
  products: {
    table: "products",
    label: "products",
    requiredField: "name",
    findBy: ["sku", "barcode", "name"],
    aliases: {
      name: ["name", "product", "product name", "item", "item name"],
      sku: ["sku", "sku code", "product code", "item code"],
      barcode: ["barcode", "bar code"],
      hsn: ["hsn", "hsn code", "hsn/sac"],
      category: ["category", "group"],
      batch_no: ["batch", "batch no", "batch number"],
      manufactured_date: ["manufactured date", "mfg date", "mfd", "manufacture date"],
      expiry_date: ["expiry date", "exp date", "expiry", "best before"],
      unit: ["unit", "uom"],
      gst: ["gst", "gst%", "tax", "tax %"],
      purchase_price: ["purchase price", "purchase rate", "buying price", "cost"],
      sellingPrice: ["selling price", "sales price", "sellingprice", "price", "rate"],
      mrp: ["mrp"],
      opening_stock: ["opening stock", "opening qty"],
      stock: ["stock", "current stock", "qty", "quantity"],
      reorder_level: ["reorder level", "minimum stock", "min stock"],
      status: ["status"],
    },
    numeric: [
      "gst",
      "purchase_price",
      "sellingPrice",
      "mrp",
      "opening_stock",
      "stock",
      "reorder_level",
    ],
    dates: ["manufactured_date", "expiry_date"],
  },
  customers: {
    table: "customers",
    label: "customers",
    requiredField: "name",
    findBy: ["phone", "email", "name"],
    aliases: {
      name: ["name", "customer", "customer name"],
      phone: ["phone", "mobile", "contact", "contact number"],
      email: ["email", "email id"],
      address: ["address", "billing address", "shipping address"],
    },
  },
  vendors: {
    table: "vendors",
    label: "vendors",
    requiredField: "name",
    findBy: ["phone", "email", "name"],
    aliases: {
      name: ["name", "vendor", "vendor name", "supplier", "supplier name"],
      phone: ["phone", "mobile", "contact", "contact number"],
      email: ["email", "email id"],
      gst_number: ["gst", "gstin", "gst number", "gst no"],
      address: ["address"],
      status: ["status"],
    },
  },
  accounts: {
    table: "accounts",
    label: "chart of accounts",
    requiredField: "account_name",
    findBy: ["account_code", "account_name"],
    aliases: {
      account_code: ["account code", "code"],
      account_name: ["account name", "name", "ledger name"],
      account_type: ["account type", "type"],
      opening_balance: ["opening balance", "opening"],
      balance_type: ["balance type", "dr/cr", "debit credit"],
      description: ["description", "notes", "remarks"],
      status: ["status"],
    },
    numeric: ["opening_balance"],
  },
};

const moduleExportConfigs = {
  products: {
    label: "inventory",
    sql: `
      SELECT
        name AS 'Product Name',
        sku AS 'SKU',
        barcode AS 'Barcode',
        hsn AS 'HSN',
        category AS 'Category',
        batch_no AS 'Batch No',
        DATE_FORMAT(manufactured_date, '%Y-%m-%d') AS 'Manufactured Date',
        DATE_FORMAT(expiry_date, '%Y-%m-%d') AS 'Expiry Date',
        unit AS 'Unit',
        gst AS 'GST',
        purchase_price AS 'Purchase Price',
        sellingPrice AS 'Selling Price',
        mrp AS 'MRP',
        opening_stock AS 'Opening Stock',
        stock AS 'Current Stock',
        reorder_level AS 'Reorder Level',
        status AS 'Status'
      FROM products
      WHERE company_id = ?
      ORDER BY id DESC
    `,
  },
  sales_invoices: {
    label: "sales",
    sql: `
      SELECT
        i.invoice_number AS 'Invoice Number',
        DATE_FORMAT(i.invoice_date, '%Y-%m-%d') AS 'Invoice Date',
        i.customer_name AS 'Customer Name',
        ii.item_name AS 'Product Name',
        p.sku AS 'SKU',
        ii.quantity AS 'Quantity',
        ii.unit_price AS 'Rate',
        ii.mrp AS 'MRP',
        0 AS 'Discount',
        ii.gst_rate AS 'GST',
        COALESCE(payment_totals.paid_amount, 0) AS 'Paid Amount',
        DATE_FORMAT(payment_dates.payment_date, '%Y-%m-%d') AS 'Payment Date',
        payment_dates.payment_method AS 'Payment Method',
        payment_dates.reference_number AS 'Reference Number',
        i.status AS 'Status'
      FROM invoices i
      INNER JOIN invoice_items ii
        ON ii.invoice_id = i.id
       AND ii.company_id = i.company_id
      LEFT JOIN products p
        ON p.company_id = i.company_id
       AND p.name = ii.item_name
      LEFT JOIN (
        SELECT invoice_id, company_id, SUM(amount) AS paid_amount
        FROM payments
        GROUP BY invoice_id, company_id
      ) payment_totals
        ON payment_totals.invoice_id = i.id
       AND payment_totals.company_id = i.company_id
      LEFT JOIN (
        SELECT p1.invoice_id, p1.company_id, p1.payment_date, p1.payment_method, p1.reference_number
        FROM payments p1
        INNER JOIN (
          SELECT invoice_id, company_id, MIN(id) AS id
          FROM payments
          GROUP BY invoice_id, company_id
        ) first_payment
          ON first_payment.id = p1.id
      ) payment_dates
        ON payment_dates.invoice_id = i.id
       AND payment_dates.company_id = i.company_id
      WHERE i.company_id = ?
      ORDER BY i.id DESC, ii.id ASC
    `,
  },
  purchase_bills: {
    label: "purchases",
    sql: `
      SELECT
        b.bill_number AS 'Bill Number',
        DATE_FORMAT(b.bill_date, '%Y-%m-%d') AS 'Bill Date',
        DATE_FORMAT(b.due_date, '%Y-%m-%d') AS 'Due Date',
        v.name AS 'Vendor Name',
        bi.product_name AS 'Product Name',
        p.sku AS 'SKU',
        bi.quantity AS 'Quantity',
        bi.price AS 'Rate',
        bi.mrp AS 'MRP',
        bi.gst_percent AS 'GST',
        COALESCE(payment_totals.paid_amount, 0) AS 'Paid Amount',
        DATE_FORMAT(payment_dates.payment_date, '%Y-%m-%d') AS 'Payment Date',
        payment_dates.payment_method AS 'Payment Method',
        payment_dates.notes AS 'Notes',
        b.status AS 'Status'
      FROM bills b
      INNER JOIN bill_items bi
        ON bi.bill_id = b.id
      LEFT JOIN vendors v
        ON v.id = b.vendor_id
       AND v.company_id = b.company_id
      LEFT JOIN products p
        ON p.id = bi.product_id
       AND p.company_id = b.company_id
      LEFT JOIN (
        SELECT bill_id, company_id, SUM(amount) AS paid_amount
        FROM vendor_payments
        GROUP BY bill_id, company_id
      ) payment_totals
        ON payment_totals.bill_id = b.id
       AND payment_totals.company_id = b.company_id
      LEFT JOIN (
        SELECT vp1.bill_id, vp1.company_id, vp1.payment_date, vp1.payment_method, vp1.notes
        FROM vendor_payments vp1
        INNER JOIN (
          SELECT bill_id, company_id, MIN(id) AS id
          FROM vendor_payments
          GROUP BY bill_id, company_id
        ) first_payment
          ON first_payment.id = vp1.id
      ) payment_dates
        ON payment_dates.bill_id = b.id
       AND payment_dates.company_id = b.company_id
      WHERE b.company_id = ?
      ORDER BY b.id DESC, bi.id ASC
    `,
  },
  accounts: {
    label: "chart-of-accounts",
    sql: `
      SELECT
        account_code AS 'Account Code',
        account_name AS 'Account Name',
        account_type AS 'Account Type',
        opening_balance AS 'Opening Balance',
        balance_type AS 'Balance Type',
        description AS 'Description',
        CASE WHEN status = 1 THEN 'Active' ELSE 'Inactive' END AS 'Status'
      FROM accounts
      WHERE company_id = ?
      ORDER BY account_type ASC, account_name ASC
    `,
  },
};

const transactionConfigs = {
  sales_invoices: {
    label: "sales invoices",
    kind: "invoice",
    groupBy: "invoice_number",
    aliases: {
      invoice_number: ["invoice number", "invoice no", "invoice", "bill no", "voucher no"],
      invoice_date: ["invoice date", "date", "voucher date"],
      customer_name: ["customer", "customer name", "party", "party name"],
      item_name: ["product", "product name", "item", "item name"],
      sku: ["sku", "product code", "item code"],
      barcode: ["barcode"],
      quantity: ["qty", "quantity"],
      rate: ["rate", "price", "selling price", "unit price"],
      mrp: ["mrp"],
      discount: ["discount", "disc"],
      gst: ["gst", "gst%", "tax", "tax %"],
      paid_amount: ["paid amount", "paid", "received", "receipt amount"],
      payment_date: ["payment date", "receipt date", "paid date"],
      payment_method: ["payment method", "mode", "payment mode"],
      reference_number: ["reference", "reference number", "ref no"],
      status: ["status"],
    },
  },
  purchase_bills: {
    label: "purchase bills",
    kind: "bill",
    groupBy: "bill_number",
    aliases: {
      bill_number: ["bill number", "bill no", "purchase bill", "invoice number", "invoice no", "voucher no"],
      bill_date: ["bill date", "purchase date", "date", "voucher date"],
      due_date: ["due date"],
      vendor_name: ["vendor", "vendor name", "supplier", "supplier name", "party", "party name"],
      item_name: ["product", "product name", "item", "item name"],
      sku: ["sku", "product code", "item code"],
      barcode: ["barcode"],
      quantity: ["qty", "quantity"],
      rate: ["rate", "price", "purchase price", "purchase rate", "unit price"],
      mrp: ["mrp"],
      gst: ["gst", "gst%", "tax", "tax %"],
      paid_amount: ["paid amount", "paid", "payment amount"],
      payment_date: ["payment date", "paid date"],
      payment_method: ["payment method", "mode", "payment mode"],
      notes: ["notes", "remarks"],
      status: ["status"],
    },
  },
  customer_payments: {
    label: "customer payments",
    kind: "customer_payment",
    aliases: {
      invoice_number: ["invoice number", "invoice no", "invoice", "voucher no"],
      amount: ["amount", "paid amount", "received", "receipt amount"],
      payment_date: ["payment date", "receipt date", "date"],
      payment_method: ["payment method", "mode", "payment mode"],
      reference_number: ["reference", "reference number", "ref no"],
    },
  },
  vendor_payments: {
    label: "vendor payments",
    kind: "vendor_payment",
    aliases: {
      bill_number: ["bill number", "bill no", "purchase bill", "invoice number", "invoice no", "voucher no"],
      amount: ["amount", "paid amount", "payment amount"],
      payment_date: ["payment date", "paid date", "date"],
      payment_method: ["payment method", "mode", "payment mode"],
      notes: ["notes", "remarks"],
    },
  },
};

const quoteId = (identifier) => `\`${identifier.replace(/`/g, "``")}\``;

const normalizeKey = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_./-]+/g, " ")
    .replace(/\s+/g, " ");

const normalizeRow = (row) => {
  const normalized = {};
  Object.entries(row || {}).forEach(([key, value]) => {
    normalized[normalizeKey(key)] = value;
  });
  return normalized;
};

const toNumber = (value, fallback = 0) => {
  if (value === "" || value === null || value === undefined) {
    return fallback;
  }

  const cleaned = String(value).replace(/[₹,]/g, "").trim();
  const numberValue = Number(cleaned);
  return Number.isNaN(numberValue) ? fallback : numberValue;
};

const toDate = (value) => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const text = String(value).trim();
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const indianMatch = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (indianMatch) {
    const [, day, month, year] = indianMatch;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  return null;
};

const tableExists = async (connection, table) => {
  const [rows] = await connection.query("SHOW TABLES LIKE ?", [table]);
  return rows.length > 0;
};

const getColumnSet = async (connection, table) => {
  const [columns] = await connection.query(`SHOW COLUMNS FROM ${quoteId(table)}`);
  return new Set(columns.map((column) => column.Field));
};

const rollbackTables = new Set([
  "accounts",
  "bill_items",
  "bills",
  "customers",
  "invoice_items",
  "invoices",
  "ledger_entries",
  "payments",
  "products",
  "vendor_payments",
  "vendors",
]);

const ensureDataHistoryTables = async (connection) => {
  await connection.query(
    `CREATE TABLE IF NOT EXISTS data_import_batches (
      id INT AUTO_INCREMENT PRIMARY KEY,
      company_id INT NOT NULL,
      activity_type VARCHAR(20) NOT NULL,
      data_type VARCHAR(80) NOT NULL,
      file_name VARCHAR(255) NULL,
      row_count INT NOT NULL DEFAULT 0,
      created_count INT NOT NULL DEFAULT 0,
      updated_count INT NOT NULL DEFAULT 0,
      skipped_count INT NOT NULL DEFAULT 0,
      affect_stock TINYINT(1) NOT NULL DEFAULT 0,
      status VARCHAR(30) NOT NULL DEFAULT 'Completed',
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      rolled_back_at TIMESTAMP NULL,
      INDEX idx_data_import_batches_company (company_id, created_at)
    )`
  );

  await connection.query(
    `CREATE TABLE IF NOT EXISTS data_import_changes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      batch_id INT NOT NULL,
      company_id INT NOT NULL,
      table_name VARCHAR(80) NOT NULL,
      record_id INT NOT NULL,
      action VARCHAR(20) NOT NULL,
      before_data LONGTEXT NULL,
      after_data LONGTEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_data_import_changes_batch (batch_id),
      INDEX idx_data_import_changes_company (company_id)
    )`
  );
};

const getRecordById = async (connection, table, id, companyId) => {
  if (!rollbackTables.has(table)) return null;
  const columns = await getColumnSet(connection, table);
  const hasCompany = columns.has("company_id");
  const [rows] = await connection.query(
    `SELECT * FROM ${quoteId(table)}
     WHERE id = ?${hasCompany ? " AND company_id = ?" : ""}
     LIMIT 1`,
    hasCompany ? [id, companyId] : [id]
  );
  return rows[0] || null;
};

const addCreatedChange = async (connection, changes, table, id, companyId) => {
  const afterData = await getRecordById(connection, table, id, companyId);
  changes.push({ action: "created", table, id, afterData });
};

const addUpdatedChange = async (connection, changes, table, id, companyId, beforeData) => {
  const afterData = await getRecordById(connection, table, id, companyId);
  changes.push({ action: "updated", table, id, beforeData, afterData });
};

const createDataActivity = async (connection, companyId, userId, details) => {
  const [result] = await connection.query(
    `INSERT INTO data_import_batches
     (company_id, activity_type, data_type, file_name, row_count, created_count,
      updated_count, skipped_count, affect_stock, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      companyId,
      details.activityType,
      details.dataType,
      details.fileName || null,
      details.rowCount || 0,
      details.createdCount || 0,
      details.updatedCount || 0,
      details.skippedCount || 0,
      details.affectStock ? 1 : 0,
      details.status || "Completed",
      userId || null,
    ]
  );
  return result.insertId;
};

const recordDataChanges = async (connection, batchId, companyId, changes) => {
  if (!changes.length) return;

  await connection.query(
    `INSERT INTO data_import_changes
     (batch_id, company_id, table_name, record_id, action, before_data, after_data)
     VALUES ?`,
    [
      changes.map((change) => [
        batchId,
        companyId,
        change.table,
        change.id,
        change.action,
        change.beforeData ? JSON.stringify(change.beforeData) : null,
        change.afterData ? JSON.stringify(change.afterData) : null,
      ]),
    ]
  );
};

const ensureProductColumns = async (connection) => {
  const columns = await getColumnSet(connection, "products");
  for (const column of productInventoryColumns) {
    if (!columns.has(column.name)) {
      await connection.query(
        `ALTER TABLE products ADD COLUMN ${quoteId(column.name)} ${column.definition}`
      );
    }
  }
};

const getAliasedValue = (normalizedRow, aliases) => {
  for (const alias of aliases) {
    const normalizedAlias = normalizeKey(alias);
    if (
      Object.prototype.hasOwnProperty.call(normalizedRow, normalizedAlias) &&
      normalizedRow[normalizedAlias] !== ""
    ) {
      return normalizedRow[normalizedAlias];
    }
  }

  return undefined;
};

const mapImportRow = (row, config) => {
  const normalizedRow = normalizeRow(row);
  const mapped = {};

  Object.entries(config.aliases).forEach(([field, aliases]) => {
    const value = getAliasedValue(normalizedRow, aliases);
    if (value !== undefined) {
      mapped[field] = value;
    }
  });

  (config.numeric || []).forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(mapped, field)) {
      mapped[field] = toNumber(mapped[field], 0);
    }
  });

  (config.dates || []).forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(mapped, field)) {
      mapped[field] = toDate(mapped[field]);
    }
  });

  if (config.table === "products") {
    mapped.name = String(mapped.name || "").trim();
    mapped.unit = String(mapped.unit || "PCS").trim() || "PCS";
    mapped.status = mapped.status === "Inactive" ? "Inactive" : "Active";
    mapped.gst = toNumber(mapped.gst, 18);
    mapped.purchase_price = toNumber(mapped.purchase_price, 0);
    mapped.sellingPrice = toNumber(mapped.sellingPrice, 0);
    mapped.mrp = toNumber(mapped.mrp, 0);
    mapped.reorder_level = toNumber(mapped.reorder_level, 0);

    const stock = Object.prototype.hasOwnProperty.call(mapped, "stock")
      ? mapped.stock
      : mapped.opening_stock;
    const openingStock = Object.prototype.hasOwnProperty.call(mapped, "opening_stock")
      ? mapped.opening_stock
      : stock;

    mapped.stock = toNumber(stock, 0);
    mapped.opening_stock = toNumber(openingStock, mapped.stock);
  } else if (config.table === "accounts") {
    mapped.account_code = String(mapped.account_code || "").trim();
    mapped.account_name = String(mapped.account_name || "").trim();
    mapped.account_type = String(mapped.account_type || "").trim().toUpperCase();
    mapped.balance_type = String(mapped.balance_type || "DEBIT").trim().toUpperCase();
    mapped.opening_balance = toNumber(mapped.opening_balance, 0);
    mapped.status = String(mapped.status || "Active").trim().toLowerCase() === "inactive" ? 0 : 1;
  } else {
    mapped.name = String(mapped.name || "").trim();
    if (mapped.status) {
      mapped.status = mapped.status === "Inactive" ? "Inactive" : "Active";
    }
  }

  return mapped;
};

const cleanDbValue = (value) => {
  if (value === "" || value === undefined) return null;
  return value;
};

const findExistingId = async (connection, config, columns, companyId, mapped) => {
  if (!columns.has("company_id")) return null;

  for (const field of config.findBy) {
    if (!columns.has(field) || !mapped[field]) continue;

    const [rows] = await connection.query(
      `SELECT id FROM ${quoteId(config.table)}
       WHERE company_id = ? AND ${quoteId(field)} = ?
       LIMIT 1`,
      [companyId, mapped[field]]
    );

    if (rows.length) {
      return rows[0].id;
    }
  }

  return null;
};

const saveImportRow = async (connection, config, columns, companyId, mapped) => {
  const allowedFields = Object.keys(mapped).filter((field) => columns.has(field));
  if (!allowedFields.length) return { action: "skipped" };

  const existingId = await findExistingId(connection, config, columns, companyId, mapped);

  if (existingId) {
    const updateFields = allowedFields.filter(
      (field) => !["id", "company_id", "created_at", "updated_at"].includes(field)
    );
    if (!updateFields.length) return { action: "skipped" };

    const beforeData = await getRecordById(connection, config.table, existingId, companyId);

    await connection.query(
      `UPDATE ${quoteId(config.table)}
       SET ${updateFields.map((field) => `${quoteId(field)} = ?`).join(", ")}
       WHERE id = ? AND company_id = ?`,
      [
        ...updateFields.map((field) => cleanDbValue(mapped[field])),
        existingId,
        companyId,
      ]
    );

    const afterData = await getRecordById(connection, config.table, existingId, companyId);
    return {
      action: "updated",
      table: config.table,
      id: existingId,
      beforeData,
      afterData,
    };
  }

  const insertFields = columns.has("company_id")
    ? ["company_id", ...allowedFields]
    : allowedFields;
  const values = columns.has("company_id")
    ? [companyId, ...allowedFields.map((field) => cleanDbValue(mapped[field]))]
    : allowedFields.map((field) => cleanDbValue(mapped[field]));

  const [result] = await connection.query(
    `INSERT INTO ${quoteId(config.table)}
     (${insertFields.map(quoteId).join(", ")})
     VALUES (${insertFields.map(() => "?").join(", ")})`,
    values
  );

  const afterData = await getRecordById(connection, config.table, result.insertId, companyId);
  return {
    action: "created",
    table: config.table,
    id: result.insertId,
    afterData,
  };
};

const getMappedTransactionValue = (row, aliases) => {
  const normalizedRow = normalizeRow(row);
  const mapped = {};

  Object.entries(aliases).forEach(([field, fieldAliases]) => {
    const value = getAliasedValue(normalizedRow, fieldAliases);
    if (value !== undefined) {
      mapped[field] = value;
    }
  });

  return mapped;
};

const mapTransactionRow = (row, config) => {
  const mapped = getMappedTransactionValue(row, config.aliases);
  const dateFields = ["invoice_date", "bill_date", "due_date", "payment_date"];
  const numberFields = ["quantity", "rate", "mrp", "discount", "gst", "paid_amount", "amount"];

  dateFields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(mapped, field)) {
      mapped[field] = toDate(mapped[field]);
    }
  });

  numberFields.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(mapped, field)) {
      mapped[field] = toNumber(mapped[field], 0);
    }
  });

  ["invoice_number", "bill_number", "customer_name", "vendor_name", "item_name", "sku", "barcode"].forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(mapped, field)) {
      mapped[field] = String(mapped[field] || "").trim();
    }
  });

  mapped.quantity = toNumber(mapped.quantity, 0);
  mapped.rate = toNumber(mapped.rate, 0);
  mapped.mrp = toNumber(mapped.mrp, 0);
  mapped.discount = toNumber(mapped.discount, 0);
  mapped.gst = toNumber(mapped.gst, 0);

  return mapped;
};

const groupRows = (rows, config) => {
  const groups = new Map();
  const mappedRows = rows.map((row) => mapTransactionRow(row, config));

  for (const row of mappedRows) {
    const key = row[config.groupBy];
    if (!key) continue;

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(row);
  }

  return groups;
};

const normalizeInvoiceStatus = (status) => {
  const value = String(status || "").trim().toLowerCase();
  if (["paid", "complete", "completed"].includes(value)) return "paid";
  if (["partial", "partial paid", "partially paid"].includes(value)) return "partial";
  if (["cancelled", "canceled"].includes(value)) return "cancelled";
  return "pending";
};

const normalizeBillStatus = (status) => {
  const value = String(status || "").trim().toLowerCase();
  if (["paid", "complete", "completed"].includes(value)) return "Paid";
  if (["partial", "partial paid", "partially paid"].includes(value)) return "Partial Paid";
  if (["cancelled", "canceled"].includes(value)) return "Cancelled";
  return "Unpaid";
};

const findProduct = async (connection, companyId, row) => {
  await ensureProductColumns(connection);

  const clauses = [];
  const params = [companyId];

  if (row.sku) {
    clauses.push("sku = ?");
    params.push(row.sku);
  }
  if (row.barcode) {
    clauses.push("barcode = ?");
    params.push(row.barcode);
  }
  if (row.item_name) {
    clauses.push("name = ?");
    params.push(row.item_name);
  }

  if (!clauses.length) return null;

  const [products] = await connection.query(
    `SELECT id, name FROM products
     WHERE company_id = ?
       AND (${clauses.join(" OR ")})
       AND (status IS NULL OR status <> 'Inactive')
     ORDER BY id DESC
     LIMIT 1`,
    params
  );

  return products[0] || null;
};

const findOrCreateProduct = async (connection, companyId, row, changes = []) => {
  const existing = await findProduct(connection, companyId, row);
  if (existing) return existing;

  if (!row.item_name) return null;

  const [result] = await connection.query(
    `INSERT INTO products
     (name, sku, barcode, unit, gst, purchase_price, sellingPrice, mrp, opening_stock, stock, reorder_level, status, company_id)
     VALUES (?, ?, ?, 'PCS', ?, ?, 0, ?, 0, 0, 0, 'Active', ?)`,
    [
      row.item_name,
      row.sku || null,
      row.barcode || null,
      row.gst || 0,
      row.rate || 0,
      row.mrp || 0,
      companyId,
    ]
  );

  await addCreatedChange(connection, changes, "products", result.insertId, companyId);
  return { id: result.insertId, name: row.item_name };
};

const ensureCustomerExists = async (connection, companyId, customerName, changes = []) => {
  if (!customerName || !(await tableExists(connection, "customers"))) return;

  const [existing] = await connection.query(
    "SELECT id FROM customers WHERE company_id = ? AND name = ? LIMIT 1",
    [companyId, customerName]
  );

  if (!existing.length) {
    const [result] = await connection.query(
      "INSERT INTO customers (name, company_id) VALUES (?, ?)",
      [customerName, companyId]
    );
    await addCreatedChange(connection, changes, "customers", result.insertId, companyId);
  }
};

const findOrCreateVendor = async (connection, companyId, vendorName, changes = []) => {
  if (!vendorName) return null;

  const [existing] = await connection.query(
    `SELECT id FROM vendors
     WHERE company_id = ? AND name = ? AND (status IS NULL OR status <> 'Inactive')
     LIMIT 1`,
    [companyId, vendorName]
  );

  if (existing.length) return existing[0];

  const [result] = await connection.query(
    "INSERT INTO vendors (name, company_id) VALUES (?, ?)",
    [vendorName, companyId]
  );

  await addCreatedChange(connection, changes, "vendors", result.insertId, companyId);
  return { id: result.insertId, name: vendorName };
};

const getLineAmounts = (row) => {
  const taxable = Math.max((row.quantity || 0) * (row.rate || 0) - (row.discount || 0), 0);
  const gstAmount = (taxable * (row.gst || 0)) / 100;
  return {
    taxable,
    gstAmount,
    total: taxable + gstAmount,
    cgst: gstAmount / 2,
    sgst: gstAmount / 2,
  };
};

const insertCustomerPayment = async (
  connection,
  companyId,
  invoiceId,
  amount,
  paymentDate,
  paymentMethod,
  referenceNumber,
  changes = []
) => {
  if (!(await tableExists(connection, "payments"))) return;
  const paymentAmount = toNumber(amount, 0);
  if (paymentAmount <= 0) return;

  const [paymentResult] = await connection.query(
    `INSERT INTO payments
     (invoice_id, company_id, amount, payment_date, payment_method, reference_number)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      invoiceId,
      companyId,
      paymentAmount,
      paymentDate || new Date(),
      paymentMethod || "Imported",
      referenceNumber || null,
    ]
  );
  await addCreatedChange(connection, changes, "payments", paymentResult.insertId, companyId);

  const [[totals]] = await connection.query(
    `SELECT i.total_amount, COALESCE(SUM(p.amount), 0) AS paid_amount
     FROM invoices i
     LEFT JOIN payments p ON p.invoice_id = i.id AND p.company_id = i.company_id
     WHERE i.id = ? AND i.company_id = ?
     GROUP BY i.id, i.total_amount`,
    [invoiceId, companyId]
  );

  const status =
    Number(totals?.paid_amount || 0) >= Number(totals?.total_amount || 0)
      ? "paid"
      : "partial";

  const beforeInvoice = await getRecordById(connection, "invoices", invoiceId, companyId);
  await connection.query(
    "UPDATE invoices SET status = ? WHERE id = ? AND company_id = ?",
    [status, invoiceId, companyId]
  );
  await addUpdatedChange(connection, changes, "invoices", invoiceId, companyId, beforeInvoice);
};

const insertVendorPayment = async (
  connection,
  companyId,
  vendorId,
  billId,
  amount,
  paymentDate,
  paymentMethod,
  notes,
  changes = []
) => {
  if (!(await tableExists(connection, "vendor_payments"))) return;
  const paymentAmount = toNumber(amount, 0);
  if (paymentAmount <= 0) return;

  const [result] = await connection.query(
    `INSERT INTO vendor_payments
     (vendor_id, bill_id, amount, payment_date, payment_method, notes, company_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      vendorId,
      billId || null,
      paymentAmount,
      paymentDate || new Date(),
      paymentMethod || "Imported",
      notes || null,
      companyId,
    ]
  );
  await addCreatedChange(connection, changes, "vendor_payments", result.insertId, companyId);

  if (await tableExists(connection, "ledger_entries")) {
    const [ledgerResult] = await connection.query(
      `INSERT INTO ledger_entries
       (company_id, entity_type, entity_id, reference_type, reference_id, debit, credit, transaction_date)
       VALUES (?, 'vendor', ?, 'payment', ?, 0, ?, ?)`,
      [
        companyId,
        vendorId,
        result.insertId,
        paymentAmount,
        paymentDate || new Date(),
      ]
    );
    await addCreatedChange(connection, changes, "ledger_entries", ledgerResult.insertId, companyId);
  }

  if (billId) {
    const [[totals]] = await connection.query(
      `SELECT b.total_amount, COALESCE(SUM(vp.amount), 0) AS paid_amount
       FROM bills b
       LEFT JOIN vendor_payments vp ON vp.bill_id = b.id AND vp.company_id = b.company_id
       WHERE b.id = ? AND b.company_id = ?
       GROUP BY b.id, b.total_amount`,
      [billId, companyId]
    );

    const status =
      Number(totals?.paid_amount || 0) >= Number(totals?.total_amount || 0)
        ? "Paid"
        : "Partial Paid";

    const beforeBill = await getRecordById(connection, "bills", billId, companyId);
    await connection.query(
      "UPDATE bills SET status = ? WHERE id = ? AND company_id = ?",
      [status, billId, companyId]
    );
    await addUpdatedChange(connection, changes, "bills", billId, companyId, beforeBill);
  }
};

const ensureSalesTransactionColumns = async (connection) => {
  await connection.query(
    "ALTER TABLE invoices MODIFY status VARCHAR(30) NOT NULL DEFAULT 'pending'"
  );

  const itemColumns = await getColumnSet(connection, "invoice_items");
  if (!itemColumns.has("mrp")) {
    await connection.query(
      "ALTER TABLE invoice_items ADD COLUMN mrp DECIMAL(10,2) NOT NULL DEFAULT 0"
    );
  }
};

const ensurePurchaseTransactionColumns = async (connection) => {
  await connection.query(
    "ALTER TABLE bills MODIFY status VARCHAR(30) NOT NULL DEFAULT 'Unpaid'"
  );

  const itemColumns = await getColumnSet(connection, "bill_items");
  if (!itemColumns.has("mrp")) {
    await connection.query(
      "ALTER TABLE bill_items ADD COLUMN mrp DECIMAL(10,2) NOT NULL DEFAULT 0"
    );
  }
};

const importSalesInvoices = async (connection, companyId, userId, rows, affectStock, changes = []) => {
  const config = transactionConfigs.sales_invoices;
  const groups = groupRows(rows, config);
  const summary = { total: groups.size, created: 0, updated: 0, skipped: 0 };
  const errors = [];

  await ensureSalesTransactionColumns(connection);

  for (const [invoiceNumber, group] of groups.entries()) {
    const first = group[0];
    try {
      if (!first.invoice_date || !first.customer_name) {
        throw new Error("Invoice date and customer name are required");
      }

      const [existing] = await connection.query(
        "SELECT id FROM invoices WHERE company_id = ? AND invoice_number = ? LIMIT 1",
        [companyId, invoiceNumber]
      );

      if (existing.length) {
        throw new Error("Invoice number already exists");
      }

      const items = [];
      for (const row of group) {
        if (!row.item_name || row.quantity <= 0) {
          throw new Error("Each invoice row needs product name and quantity");
        }

        const product = await findProduct(connection, companyId, row);
        if (affectStock && !product) {
          throw new Error(`Product not found for stock update: ${row.item_name}`);
        }

        const amounts = getLineAmounts(row);
        items.push({ ...row, product, amounts });
      }

      await ensureCustomerExists(connection, companyId, first.customer_name, changes);

      const subtotal = items.reduce((sum, item) => sum + item.amounts.taxable, 0);
      const taxAmount = items.reduce((sum, item) => sum + item.amounts.gstAmount, 0);
      const totalAmount = subtotal + taxAmount;
      const paidAmount = Math.min(toNumber(first.paid_amount, 0), totalAmount);

      const status = paidAmount > 0
        ? (paidAmount >= totalAmount ? "paid" : "partial")
        : normalizeInvoiceStatus(first.status);

      const [invoiceResult] = await connection.query(
        `INSERT INTO invoices
         (company_id, created_by, invoice_number, invoice_date, customer_name,
          subtotal, tax_amount, cgst, sgst, igst, total_amount, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        [
          companyId,
          userId || null,
          invoiceNumber,
          first.invoice_date,
          first.customer_name,
          subtotal,
          taxAmount,
          taxAmount / 2,
          taxAmount / 2,
          totalAmount,
          status,
        ]
      );
      await addCreatedChange(connection, changes, "invoices", invoiceResult.insertId, companyId);

      for (const item of items) {
        const [itemResult] = await connection.query(
          `INSERT INTO invoice_items
           (invoice_id, company_id, item_name, quantity, unit_price, mrp, total_price, gst_rate)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            invoiceResult.insertId,
            companyId,
            item.item_name,
            item.quantity,
            item.rate,
            item.mrp,
            item.amounts.total,
            item.gst,
          ]
        );
        await addCreatedChange(connection, changes, "invoice_items", itemResult.insertId, companyId);

        if (affectStock && item.product) {
          const beforeProduct = await getRecordById(connection, "products", item.product.id, companyId);
          await connection.query(
            "UPDATE products SET stock = stock - ? WHERE id = ? AND company_id = ?",
            [item.quantity, item.product.id, companyId]
          );
          await addUpdatedChange(
            connection,
            changes,
            "products",
            item.product.id,
            companyId,
            beforeProduct
          );
        }
      }

      if (paidAmount > 0) {
        await insertCustomerPayment(
          connection,
          companyId,
          invoiceResult.insertId,
          paidAmount,
          first.payment_date || first.invoice_date,
          first.payment_method,
          first.reference_number,
          changes
        );
      }

      summary.created += 1;
    } catch (error) {
      summary.skipped += 1;
      errors.push({ row: invoiceNumber, message: error.message });
    }
  }

  return { summary, errors };
};

const importPurchaseBills = async (connection, companyId, rows, affectStock, changes = []) => {
  const config = transactionConfigs.purchase_bills;
  const groups = groupRows(rows, config);
  const summary = { total: groups.size, created: 0, updated: 0, skipped: 0 };
  const errors = [];

  await ensurePurchaseTransactionColumns(connection);

  for (const [billNumber, group] of groups.entries()) {
    const first = group[0];
    try {
      if (!first.bill_date || !first.vendor_name) {
        throw new Error("Bill date and vendor name are required");
      }

      const [existing] = await connection.query(
        "SELECT id FROM bills WHERE company_id = ? AND bill_number = ? LIMIT 1",
        [companyId, billNumber]
      );

      if (existing.length) {
        throw new Error("Bill number already exists");
      }

      for (const row of group) {
        if (!row.item_name || row.quantity <= 0) {
          throw new Error("Each bill row needs product name and quantity");
        }
      }

      const vendor = await findOrCreateVendor(connection, companyId, first.vendor_name, changes);
      if (!vendor) {
        throw new Error("Vendor is required");
      }

      const items = [];
      for (const row of group) {
        const product = await findOrCreateProduct(connection, companyId, row, changes);
        if (!product) {
          throw new Error(`Product not found: ${row.item_name}`);
        }

        const amounts = getLineAmounts(row);
        items.push({ ...row, product, amounts });
      }

      const totalAmount = items.reduce((sum, item) => sum + item.amounts.total, 0);
      const paidAmount = Math.min(toNumber(first.paid_amount, 0), totalAmount);
      const status = paidAmount > 0
        ? (paidAmount >= totalAmount ? "Paid" : "Partial Paid")
        : normalizeBillStatus(first.status);

      const [billResult] = await connection.query(
        `INSERT INTO bills
         (vendor_id, bill_number, bill_date, due_date, total_amount, status, company_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          vendor.id,
          billNumber,
          first.bill_date,
          first.due_date || null,
          totalAmount,
          status,
          companyId,
        ]
      );
      await addCreatedChange(connection, changes, "bills", billResult.insertId, companyId);

      for (const item of items) {
        const [itemResult] = await connection.query(
          `INSERT INTO bill_items
           (bill_id, product_id, product_name, quantity, price, mrp, total, gst_percent, cgst, sgst)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            billResult.insertId,
            item.product.id,
            item.item_name,
            item.quantity,
            item.rate,
            item.mrp,
            item.amounts.total,
            item.gst,
            item.amounts.cgst,
            item.amounts.sgst,
          ]
        );
        await addCreatedChange(connection, changes, "bill_items", itemResult.insertId, companyId);

        if (affectStock) {
          const beforeProduct = await getRecordById(connection, "products", item.product.id, companyId);
          await connection.query(
            `UPDATE products
             SET stock = stock + ?, purchase_price = ?, mrp = ?, gst = ?
             WHERE id = ? AND company_id = ?`,
            [
              item.quantity,
              item.rate,
              item.mrp,
              item.gst,
              item.product.id,
              companyId,
            ]
          );
          await addUpdatedChange(
            connection,
            changes,
            "products",
            item.product.id,
            companyId,
            beforeProduct
          );
        }
      }

      if (paidAmount > 0) {
        await insertVendorPayment(
          connection,
          companyId,
          vendor.id,
          billResult.insertId,
          paidAmount,
          first.payment_date || first.bill_date,
          first.payment_method,
          first.notes,
          changes
        );
      }

      summary.created += 1;
    } catch (error) {
      summary.skipped += 1;
      errors.push({ row: billNumber, message: error.message });
    }
  }

  return { summary, errors };
};

const importCustomerPayments = async (connection, companyId, rows, changes = []) => {
  const config = transactionConfigs.customer_payments;
  const summary = { total: rows.length, created: 0, updated: 0, skipped: 0 };
  const errors = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = mapTransactionRow(rows[index], config);
    try {
      if (!row.invoice_number || row.amount <= 0) {
        throw new Error("Invoice number and amount are required");
      }

      const [invoices] = await connection.query(
        "SELECT id FROM invoices WHERE company_id = ? AND invoice_number = ? LIMIT 1",
        [companyId, row.invoice_number]
      );

      if (!invoices.length) {
        throw new Error("Invoice not found");
      }

      await insertCustomerPayment(
        connection,
        companyId,
        invoices[0].id,
        row.amount,
        row.payment_date,
        row.payment_method,
        row.reference_number,
        changes
      );

      summary.created += 1;
    } catch (error) {
      summary.skipped += 1;
      errors.push({ row: index + 2, message: error.message });
    }
  }

  return { summary, errors };
};

const importVendorPayments = async (connection, companyId, rows, changes = []) => {
  const config = transactionConfigs.vendor_payments;
  const summary = { total: rows.length, created: 0, updated: 0, skipped: 0 };
  const errors = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = mapTransactionRow(rows[index], config);
    try {
      if (!row.bill_number || row.amount <= 0) {
        throw new Error("Bill number and amount are required");
      }

      const [bills] = await connection.query(
        "SELECT id, vendor_id FROM bills WHERE company_id = ? AND bill_number = ? LIMIT 1",
        [companyId, row.bill_number]
      );

      if (!bills.length) {
        throw new Error("Bill not found");
      }

      await insertVendorPayment(
        connection,
        companyId,
        bills[0].vendor_id,
        bills[0].id,
        row.amount,
        row.payment_date,
        row.payment_method,
        row.notes,
        changes
      );

      summary.created += 1;
    } catch (error) {
      summary.skipped += 1;
      errors.push({ row: index + 2, message: error.message });
    }
  }

  return { summary, errors };
};

const getBackupSectionRows = (backup, key) => {
  const rows = backup?.data?.[key];
  return Array.isArray(rows) ? rows : [];
};

const backupHasSensitiveUserData = (backup) =>
  getBackupSectionRows(backup, "users").some((user) =>
    Object.prototype.hasOwnProperty.call(user || {}, "password")
  );

exports.previewRestoreBackup = async (req, res) => {
  try {
    const backup = req.body?.backup;
    const warnings = [];

    if (!backup || typeof backup !== "object" || Array.isArray(backup)) {
      return res.status(400).json({ message: "Please upload a valid backup JSON file." });
    }

    if (!backup.metadata || backup.metadata.backup_type !== "company_full_backup") {
      return res.status(400).json({
        message: "This file does not look like a full company backup.",
      });
    }

    if (!backup.data || typeof backup.data !== "object" || Array.isArray(backup.data)) {
      return res.status(400).json({ message: "Backup data section is missing." });
    }

    const currentCompanyId = req.user.company_id;
    const backupCompanyId = Number(backup.metadata.company_id || 0);
    if (backupCompanyId && backupCompanyId !== Number(currentCompanyId)) {
      warnings.push(
        `This backup belongs to company ${backupCompanyId}, but you are logged into company ${currentCompanyId}.`
      );
    }

    const sections = exportSpecs.map((spec) => {
      const rows = getBackupSectionRows(backup, spec.key);
      const tableCount = Number(backup.table_counts?.[spec.key]);
      return {
        key: spec.key,
        table: spec.table,
        label: backupSectionLabels[spec.key] || spec.key,
        rows: rows.length,
        backupCount: Number.isFinite(tableCount) ? tableCount : rows.length,
        present: Object.prototype.hasOwnProperty.call(backup.data, spec.key),
        optional: optionalBackupTables.has(spec.table),
      };
    });

    const missingRequiredSections = sections
      .filter((section) => !section.present && !section.optional)
      .map((section) => section.label);

    const optionalMissingSections = sections
      .filter((section) => !section.present && section.optional)
      .map((section) => section.label);

    if (missingRequiredSections.length) {
      warnings.push(
        `This backup is missing: ${missingRequiredSections.join(", ")}. It may be from an older version.`
      );
    }

    if (optionalMissingSections.length) {
      warnings.push(
        `Optional old sections not found: ${optionalMissingSections.join(", ")}.`
      );
    }

    const hasPassword = backupHasSensitiveUserData(backup);
    if (hasPassword) {
      warnings.push(
        "This backup contains user password data. Do not restore or share it until reviewed."
      );
    }

    const unknownSections = Object.keys(backup.data).filter(
      (key) => !exportSpecs.some((spec) => spec.key === key)
    );

    const totalRows = sections.reduce((sum, section) => sum + section.rows, 0);

    res.json({
      message: "Restore preview completed",
      readyForRestorePlanning: !hasPassword && missingRequiredSections.length === 0,
      metadata: {
        app: backup.metadata.app || "-",
        backupType: backup.metadata.backup_type,
        backupCompanyId: backupCompanyId || null,
        currentCompanyId,
        exportedAt: backup.metadata.exported_at || null,
        formatVersion: backup.metadata.format_version || null,
      },
      summary: {
        sections: sections.length,
        totalRows,
        requiredMissing: missingRequiredSections.length,
        optionalMissing: optionalMissingSections.length,
        unknownSections: unknownSections.length,
        passwordsIncluded: hasPassword,
      },
      sections,
      missingRequiredSections,
      optionalMissingSections,
      unknownSections,
      warnings,
    });
  } catch (error) {
    console.error("Restore preview error:", error);
    res.status(500).json({ message: "Failed to preview backup restore" });
  }
};

exports.exportCompanyBackup = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const companyId = req.user.company_id;
    await ensureDataHistoryTables(connection);
    await ensureUserAccessColumns();
    await ensureAuditLogTable();
    await ensurePayrollTables();

    const backup = {
      metadata: {
        app: "RevEx Books",
        backup_type: "company_full_backup",
        company_id: companyId,
        exported_at: new Date().toISOString(),
        format_version: 1,
      },
      data: {},
      table_counts: {},
      skipped_tables: [],
    };

    for (const spec of exportSpecs) {
      const exists = await tableExists(connection, spec.table);
      if (!exists) {
        backup.skipped_tables.push(spec.table);
        backup.data[spec.key] = [];
        backup.table_counts[spec.key] = 0;
        continue;
      }

      if (spec.direct) {
        const columns = await getColumnSet(connection, spec.table);
        const whereColumn = spec.whereColumn || "company_id";
        if (!columns.has(whereColumn)) {
          backup.skipped_tables.push(spec.table);
          backup.data[spec.key] = [];
          backup.table_counts[spec.key] = 0;
          continue;
        }

        const excluded = new Set(spec.excludeColumns || []);
        const selectColumns = Array.from(columns)
          .filter((column) => !excluded.has(column))
          .map(quoteId)
          .join(", ");

        if (!selectColumns) {
          backup.skipped_tables.push(spec.table);
          backup.data[spec.key] = [];
          backup.table_counts[spec.key] = 0;
          continue;
        }

        const [rows] = await connection.query(
          `SELECT ${selectColumns} FROM ${quoteId(spec.table)}
           WHERE ${quoteId(whereColumn)} = ?
           ORDER BY ${columns.has("id") ? "id" : quoteId(whereColumn)}`,
          [companyId]
        );
        backup.data[spec.key] = rows;
        backup.table_counts[spec.key] = rows.length;
        continue;
      }

      const [rows] = await connection.query(spec.sql, [companyId]);
      backup.data[spec.key] = rows;
      backup.table_counts[spec.key] = rows.length;
    }

    const rowCount = Object.values(backup.data).reduce(
      (sum, value) => sum + (Array.isArray(value) ? value.length : 0),
      0
    );
    await createDataActivity(connection, companyId, req.user.user_id || req.user.id, {
      activityType: "Export",
      dataType: "full_backup",
      rowCount,
    });

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="billing-backup-company-${companyId}-${stamp}.json"`
    );
    res.json(backup);
  } catch (error) {
    console.error("Export backup error:", error);
    res.status(500).json({ message: "Failed to download backup" });
  } finally {
    connection.release();
  }
};

exports.exportModuleData = async (req, res) => {
  const { type } = req.params;
  const config = moduleExportConfigs[type];

  if (!config) {
    return res.status(400).json({ message: "Invalid export type" });
  }

  const connection = await db.getConnection();

  try {
    const companyId = req.user.company_id;
    await ensureDataHistoryTables(connection);

    if (type === "products") {
      await ensureProductColumns(connection);
    }

    if (type === "sales_invoices") {
      await ensureSalesTransactionColumns(connection);
    }

    if (type === "purchase_bills") {
      await ensurePurchaseTransactionColumns(connection);
    }

    const [rows] = await connection.query(config.sql, [companyId]);

    await createDataActivity(connection, companyId, req.user.user_id || req.user.id, {
      activityType: "Export",
      dataType: type,
      rowCount: rows.length,
    });

    res.json({
      type,
      label: config.label,
      exported_at: new Date().toISOString(),
      count: rows.length,
      rows,
    });
  } catch (error) {
    console.error("Export module data error:", error);
    res.status(500).json({ message: "Failed to export data" });
  } finally {
    connection.release();
  }
};

exports.importMasterData = async (req, res) => {
  const { type } = req.params;
  const config = importConfigs[type];

  if (!config) {
    return res.status(400).json({ message: "Invalid import type" });
  }

  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  const fileName = String(req.body.fileName || "").slice(0, 255);
  if (!rows.length) {
    return res.status(400).json({ message: "No rows found to import" });
  }

  if (rows.length > 5000) {
    return res.status(400).json({
      message: "Please import 5000 rows or less at a time",
    });
  }

  const connection = await db.getConnection();

  try {
    const companyId = req.user.company_id;
    await ensureDataHistoryTables(connection);

    if (!(await tableExists(connection, config.table))) {
      return res.status(400).json({
        message: `${config.label} table is not ready yet`,
      });
    }

    if (type === "products") {
      await ensureProductColumns(connection);
    }

    const columns = await getColumnSet(connection, config.table);
    const summary = { total: rows.length, created: 0, updated: 0, skipped: 0 };
    const errors = [];
    const changes = [];

    await connection.beginTransaction();

    for (let index = 0; index < rows.length; index += 1) {
      const mapped = mapImportRow(rows[index], config);

      if (!mapped[config.requiredField]) {
        summary.skipped += 1;
        errors.push({
          row: index + 2,
          message: `${config.requiredField} is required`,
        });
        continue;
      }

      try {
        const result = await saveImportRow(
          connection,
          config,
          columns,
          companyId,
          mapped
        );
        summary[result.action] += 1;
        if (result.action === "created" || result.action === "updated") {
          changes.push(result);
        }
      } catch (error) {
        summary.skipped += 1;
        errors.push({
          row: index + 2,
          message: error.message,
        });
      }
    }

    const batchId = await createDataActivity(connection, companyId, req.user.user_id || req.user.id, {
      activityType: "Import",
      dataType: type,
      fileName,
      rowCount: rows.length,
      createdCount: summary.created,
      updatedCount: summary.updated,
      skippedCount: summary.skipped,
    });
    await recordDataChanges(connection, batchId, companyId, changes);

    await connection.commit();

    res.json({
      message: "Import completed",
      batchId,
      summary,
      errors: errors.slice(0, 25),
    });
  } catch (error) {
    await connection.rollback();
    console.error("Import master data error:", error);
    res.status(500).json({ message: "Failed to import data" });
  } finally {
    connection.release();
  }
};

exports.importTransactions = async (req, res) => {
  const { type } = req.params;
  const config = transactionConfigs[type];

  if (!config) {
    return res.status(400).json({ message: "Invalid transaction import type" });
  }

  if (["sales_invoices", "purchase_bills", "customer_payments", "vendor_payments"].includes(type)) {
    return res.status(409).json({
      code: "OPERATIONAL_IMPORT_ACCOUNTING_PATH_REQUIRED",
      message:
        "This transaction import type is temporarily unavailable because financial and accounting integrity requires the controlled transaction workflow.",
    });
  }

  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  const affectStock = Boolean(req.body.affectStock);
  const fileName = String(req.body.fileName || "").slice(0, 255);

  if (!rows.length) {
    return res.status(400).json({ message: "No rows found to import" });
  }

  if (rows.length > 5000) {
    return res.status(400).json({
      message: "Please import 5000 rows or less at a time",
    });
  }

  const connection = await db.getConnection();

  try {
    const companyId = req.user.company_id;
    const userId = req.user.user_id || req.user.id || null;
    await ensureDataHistoryTables(connection);

    await connection.beginTransaction();

    let result;
    const changes = [];

    if (type === "sales_invoices") {
      result = await importSalesInvoices(connection, companyId, userId, rows, affectStock, changes);
    } else if (type === "purchase_bills") {
      result = await importPurchaseBills(connection, companyId, rows, affectStock, changes);
    } else if (type === "customer_payments") {
      result = await importCustomerPayments(connection, companyId, rows, changes);
    } else if (type === "vendor_payments") {
      result = await importVendorPayments(connection, companyId, rows, changes);
    }

    const batchId = await createDataActivity(connection, companyId, userId, {
      activityType: "Import",
      dataType: type,
      fileName,
      rowCount: rows.length,
      createdCount: result.summary.created,
      updatedCount: result.summary.updated,
      skippedCount: result.summary.skipped,
      affectStock,
    });
    await recordDataChanges(connection, batchId, companyId, changes);

    await connection.commit();

    res.json({
      message: "Transaction import completed",
      batchId,
      summary: result.summary,
      errors: result.errors.slice(0, 50),
      affectStock,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Import transactions error:", error);
    res.status(500).json({ message: "Failed to import transactions" });
  } finally {
    connection.release();
  }
};

exports.getDataHistory = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const companyId = req.user.company_id;
    await ensureDataHistoryTables(connection);

    const [rows] = await connection.query(
      `SELECT id, activity_type, data_type, file_name, row_count, created_count,
              updated_count, skipped_count, affect_stock, status, created_at, rolled_back_at
       FROM data_import_batches
       WHERE company_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 50`,
      [companyId]
    );

    res.json({ history: rows });
  } catch (error) {
    console.error("Data history error:", error);
    res.status(500).json({ message: "Failed to load import history" });
  } finally {
    connection.release();
  }
};

exports.rollbackImport = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const companyId = req.user.company_id;
    const batchId = Number(req.params.id);
    if (!batchId) {
      return res.status(400).json({ message: "Invalid import history record" });
    }

    await ensureDataHistoryTables(connection);

    const [[batch]] = await connection.query(
      `SELECT * FROM data_import_batches
       WHERE id = ? AND company_id = ?
       LIMIT 1`,
      [batchId, companyId]
    );

    if (!batch) {
      return res.status(404).json({ message: "Import history record not found" });
    }

    if (batch.activity_type !== "Import") {
      return res.status(400).json({ message: "Only imports can be rolled back" });
    }

    if (batch.status !== "Completed") {
      return res.status(400).json({ message: "This import is already rolled back or not active" });
    }

    const [changes] = await connection.query(
      `SELECT * FROM data_import_changes
       WHERE batch_id = ? AND company_id = ?
       ORDER BY id DESC`,
      [batchId, companyId]
    );

    if (!changes.length) {
      return res.status(400).json({ message: "No rollback details found for this import" });
    }

    await connection.beginTransaction();

    for (const change of changes) {
      if (!rollbackTables.has(change.table_name)) continue;
      const columns = await getColumnSet(connection, change.table_name);
      const hasCompany = columns.has("company_id");

      if (change.action === "created") {
        await connection.query(
          `DELETE FROM ${quoteId(change.table_name)}
           WHERE id = ?${hasCompany ? " AND company_id = ?" : ""}`,
          hasCompany ? [change.record_id, companyId] : [change.record_id]
        );
        continue;
      }

      if (change.action === "updated") {
        const beforeData = change.before_data ? JSON.parse(change.before_data) : null;
        if (!beforeData) continue;

        const fields = Object.keys(beforeData).filter(
          (field) =>
            columns.has(field) &&
            !["id", "created_at", "updated_at"].includes(field)
        );

        if (!fields.length) continue;

        await connection.query(
          `UPDATE ${quoteId(change.table_name)}
           SET ${fields.map((field) => `${quoteId(field)} = ?`).join(", ")}
           WHERE id = ?${hasCompany ? " AND company_id = ?" : ""}`,
          [
            ...fields.map((field) => beforeData[field]),
            change.record_id,
            ...(hasCompany ? [companyId] : []),
          ]
        );
      }
    }

    await connection.query(
      "UPDATE data_import_batches SET status = 'Rolled Back', rolled_back_at = NOW() WHERE id = ? AND company_id = ?",
      [batchId, companyId]
    );

    await connection.commit();

    res.json({
      message: "Import rolled back",
      rolledBackChanges: changes.length,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Rollback import error:", error);
    res.status(500).json({ message: "Failed to roll back import" });
  } finally {
    connection.release();
  }
};
