const db = require("../db/connection");
const { assertReportSchemaReady } = require("../services/reportSchemaService");

const RETURN_SCHEMA = Object.freeze([
  { table: "product_returns", columns: ["id", "company_id", "type", "return_date", "subtotal", "tax_amount", "total_amount"] },
  { table: "return_items", columns: ["return_id", "company_id", "product_id", "quantity", "unit_price", "gst_rate", "total_price"] },
]);
const DELIVERY_SCHEMA = Object.freeze([
  { table: "delivery_challans", columns: ["id", "company_id", "type", "challan_date", "status"] },
  { table: "delivery_challan_items", columns: ["challan_id", "company_id", "product_id", "quantity"] },
]);
const PRODUCT_REPORT_SCHEMA = Object.freeze([
  { table: "products", columns: ["id", "company_id", "mrp", "sku", "hsn", "category", "batch_no", "manufactured_date", "expiry_date", "unit", "gst", "purchase_price", "opening_stock", "reorder_level", "status"] },
]);
const PAYROLL_REPORT_SCHEMA = Object.freeze([
  { table: "payroll_entries", columns: ["id", "company_id", "payroll_date", "net_amount", "status", "payment_date"] },
]);

const toNumber = (value) => Number(value || 0);
const money = (value) => Math.round(toNumber(value) * 100) / 100;

const addDateFilter = (column, query, params) => {
  const clauses = [];

  if (query.from_date) {
    clauses.push(`${column} >= ?`);
    params.push(query.from_date);
  }

  if (query.to_date) {
    clauses.push(`${column} <= ?`);
    params.push(query.to_date);
  }

  return clauses.length ? ` AND ${clauses.join(" AND ")}` : "";
};

const buildTaxSummary = (rows, extra = {}) => {
  const totals = rows.reduce(
    (acc, row) => {
      acc.taxable_value += toNumber(row.taxable_value);
      acc.cgst += toNumber(row.cgst);
      acc.sgst += toNumber(row.sgst);
      acc.igst += toNumber(row.igst);
      acc.total_gst += toNumber(row.total_gst);
      acc.total_amount += toNumber(row.total_amount);
      return acc;
    },
    {
      taxable_value: 0,
      cgst: 0,
      sgst: 0,
      igst: 0,
      total_gst: 0,
      total_amount: 0
    }
  );

  return {
    total_records: rows.length,
    taxable_value: money(totals.taxable_value),
    cgst: money(totals.cgst),
    sgst: money(totals.sgst),
    igst: money(totals.igst),
    total_gst: money(totals.total_gst),
    total_amount: money(totals.total_amount),
    ...extra
  };
};

const normalizeTaxRows = (rows) =>
  rows.map((row) => ({
    ...row,
    taxable_value: money(row.taxable_value),
    cgst: money(row.cgst),
    sgst: money(row.sgst),
    igst: money(row.igst),
    total_gst: money(row.total_gst),
    total_amount: money(row.total_amount)
  }));

const getTableColumns = async (tableName) => {
  const [columns] = await db.query(`SHOW COLUMNS FROM \`${tableName}\``);
  return new Set(columns.map((column) => column.Field));
};

const gstinPattern = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const getInvoiceTaxRows = async (company_id, query) => {
  const params = [company_id];
  const dateFilter = addDateFilter("i.invoice_date", query, params);

  const [rows] = await db.query(
    `
    SELECT
      i.id,
      i.invoice_number,
      i.invoice_date,
      i.customer_name,
      i.subtotal AS taxable_value,
      i.cgst,
      i.sgst,
      i.igst,
      i.tax_amount AS total_gst,
      i.total_amount,
      LOWER(COALESCE(i.status, 'pending')) AS status
    FROM invoices i
    WHERE i.company_id = ?
    ${dateFilter}
    ORDER BY i.invoice_date DESC, i.id DESC
    `,
    params
  );

  return rows;
};

const getBillTaxRows = async (company_id, query) => {
  const params = [company_id];
  const dateFilter = addDateFilter("b.bill_date", query, params);

  const [rows] = await db.query(
    `
    SELECT
      b.id,
      b.bill_number,
      b.bill_date,
      COALESCE(v.name, '-') AS vendor_name,
      COALESCE(item_totals.taxable_value, b.total_amount) AS taxable_value,
      COALESCE(item_totals.cgst, 0) AS cgst,
      COALESCE(item_totals.sgst, 0) AS sgst,
      0 AS igst,
      COALESCE(item_totals.total_gst, 0) AS total_gst,
      b.total_amount,
      LOWER(COALESCE(b.status, 'unpaid')) AS status
    FROM bills b
    LEFT JOIN vendors v
      ON v.id = b.vendor_id
     AND v.company_id = b.company_id
    LEFT JOIN (
      SELECT
        bill_id,
        SUM(quantity * price) AS taxable_value,
        SUM(COALESCE(cgst, 0)) AS cgst,
        SUM(COALESCE(sgst, 0)) AS sgst,
        SUM(GREATEST(COALESCE(total, 0) - (quantity * price), 0)) AS total_gst
      FROM bill_items
      GROUP BY bill_id
    ) item_totals
      ON item_totals.bill_id = b.id
    WHERE b.company_id = ?
      AND b.total_amount > 0
    ${dateFilter}
    ORDER BY b.bill_date DESC, b.id DESC
    `,
    params
  );

  return rows;
};

const getReturnTaxSummary = async (company_id, type, query) => {
  const params = [company_id, type];
  const dateFilter = addDateFilter("return_date", query, params);

  const [[summary]] = await db.query(
    `
    SELECT
      COALESCE(SUM(subtotal), 0) AS taxable_value,
      COALESCE(SUM(tax_amount / 2), 0) AS cgst,
      COALESCE(SUM(tax_amount / 2), 0) AS sgst,
      0 AS igst,
      COALESCE(SUM(tax_amount), 0) AS total_gst,
      COALESCE(SUM(total_amount), 0) AS total_amount
    FROM product_returns
    WHERE company_id = ?
      AND type = ?
    ${dateFilter}
    `,
    params
  );

  return {
    taxable_value: toNumber(summary.taxable_value),
    cgst: toNumber(summary.cgst),
    sgst: toNumber(summary.sgst),
    igst: toNumber(summary.igst),
    total_gst: toNumber(summary.total_gst),
    total_amount: toNumber(summary.total_amount)
  };
};

/**
 * PROFIT REPORT
 */
exports.getProfit = async (req, res) => {
  try {
    const company_id = req.user.company_id;

    const [[sales]] = await db.query(
      `
      SELECT SUM(subtotal) as total_sales FROM invoices
      WHERE company_id = ?
      `,
      [company_id]
    );

    const [[purchase]] = await db.query(
      `
      SELECT COALESCE(SUM(item_totals.taxable), 0) as total_purchase
      FROM bills b
      LEFT JOIN (
        SELECT bill_id, SUM(quantity * price) AS taxable
        FROM bill_items
        GROUP BY bill_id
      ) item_totals ON item_totals.bill_id = b.id
      WHERE b.company_id = ?
      `,
      [company_id]
    );

    const total_sales = money(sales.total_sales);
    const total_purchase = money(purchase.total_purchase);

    res.json({
      total_sales,
      total_purchase,
      profit: money(total_sales - total_purchase)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error fetching profit" });
  }
};

/**
 * SALES REPORT
 */
exports.getSales = async (req, res) => {
  try {
    await assertReportSchemaReady(db, RETURN_SCHEMA);
    const company_id = req.user.company_id;
    const params = [company_id];
    const dateFilter = addDateFilter("i.invoice_date", req.query, params);

    const [rows] = await db.query(
      `
      SELECT
        i.id,
        i.invoice_number,
        i.invoice_date,
        i.customer_name,
        LOWER(COALESCE(i.status, 'pending')) AS status,
        i.subtotal,
        i.tax_amount,
        i.total_amount,
        CASE
          WHEN LOWER(COALESCE(i.status, '')) = 'paid' THEN i.total_amount
          ELSE LEAST(COALESCE(payment_totals.paid_amount, 0), i.total_amount)
        END AS paid_amount,
        GREATEST(
          i.total_amount -
          CASE
            WHEN LOWER(COALESCE(i.status, '')) = 'paid' THEN i.total_amount
            ELSE LEAST(COALESCE(payment_totals.paid_amount, 0), i.total_amount)
          END,
          0
        ) AS due_amount,
        COALESCE(item_totals.item_count, 0) AS item_count
      FROM invoices i
      LEFT JOIN (
        SELECT invoice_id, company_id, SUM(amount) AS paid_amount
        FROM payments
        GROUP BY invoice_id, company_id
      ) payment_totals
        ON payment_totals.invoice_id = i.id
       AND payment_totals.company_id = i.company_id
      LEFT JOIN (
        SELECT invoice_id, company_id, COUNT(*) AS item_count
        FROM invoice_items
        GROUP BY invoice_id, company_id
      ) item_totals
        ON item_totals.invoice_id = i.id
       AND item_totals.company_id = i.company_id
      WHERE i.company_id = ?
      ${dateFilter}
      ORDER BY i.invoice_date DESC, i.id DESC
      `,
      params
    );

    const summary = rows.reduce(
      (acc, row) => {
        acc.total_invoices += 1;
        acc.subtotal += toNumber(row.subtotal);
        acc.gst += toNumber(row.tax_amount);
        acc.total_sales += toNumber(row.total_amount);
        acc.paid += toNumber(row.paid_amount);
        acc.pending += toNumber(row.due_amount);
        return acc;
      },
      {
        total_invoices: 0,
        subtotal: 0,
        gst: 0,
        total_sales: 0,
        paid: 0,
        pending: 0
      }
    );

    const returnParams = [company_id, "sales"];
    const returnDateFilter = addDateFilter("return_date", req.query, returnParams);
    const [[returnSummary]] = await db.query(
      `SELECT
         COALESCE(SUM(subtotal), 0) AS subtotal,
         COALESCE(SUM(tax_amount), 0) AS gst,
         COALESCE(SUM(total_amount), 0) AS total
       FROM product_returns
       WHERE company_id = ? AND type = ?
       ${returnDateFilter}`,
      returnParams
    );

    res.json({
      filters: {
        from_date: req.query.from_date || null,
        to_date: req.query.to_date || null
      },
      summary: {
        total_invoices: summary.total_invoices,
        subtotal: money(summary.subtotal),
        gst: money(summary.gst - toNumber(returnSummary.gst)),
        total_sales: money(summary.total_sales),
        returns: money(returnSummary.total),
        net_sales: money(summary.total_sales - toNumber(returnSummary.total)),
        paid: money(summary.paid),
        pending: money(Math.max(summary.pending - toNumber(returnSummary.total), 0))
      },
      data: rows.map((row) => ({
        ...row,
        subtotal: money(row.subtotal),
        tax_amount: money(row.tax_amount),
        total_amount: money(row.total_amount),
        paid_amount: money(row.paid_amount),
        due_amount: money(row.due_amount)
      }))
    });
  } catch (err) {
    console.error("Sales report error:", err);
    res.status(500).json({ error: "Error fetching sales report" });
  }
};

/**
 * PURCHASE REPORT
 */
exports.getPurchase = async (req, res) => {
  try {
    await assertReportSchemaReady(db, RETURN_SCHEMA);
    const company_id = req.user.company_id;
    const params = [company_id];
    const dateFilter = addDateFilter("b.bill_date", req.query, params);

    const [rows] = await db.query(
      `
      SELECT
        b.id,
        b.bill_number,
        b.bill_date,
        b.due_date,
        b.status,
        b.total_amount,
        v.name AS vendor_name,
        COALESCE(item_totals.item_count, 0) AS item_count,
        COALESCE(item_totals.taxable, b.total_amount) AS subtotal,
        COALESCE(item_totals.gst_amount, 0) AS tax_amount,
        CASE
          WHEN LOWER(COALESCE(b.status, '')) = 'paid' THEN b.total_amount
          ELSE LEAST(COALESCE(payment_totals.paid_amount, 0), b.total_amount)
        END AS paid_amount,
        GREATEST(
          b.total_amount -
          CASE
            WHEN LOWER(COALESCE(b.status, '')) = 'paid' THEN b.total_amount
            ELSE LEAST(COALESCE(payment_totals.paid_amount, 0), b.total_amount)
          END,
          0
        ) AS due_amount
      FROM bills b
      INNER JOIN vendors v
        ON v.id = b.vendor_id
       AND v.company_id = b.company_id
       AND (v.status IS NULL OR v.status <> 'Inactive')
      LEFT JOIN (
        SELECT
          bill_id,
          COUNT(*) AS item_count,
          SUM(quantity * price) AS taxable,
          SUM(total - (quantity * price)) AS gst_amount
        FROM bill_items
        GROUP BY bill_id
      ) item_totals ON item_totals.bill_id = b.id
      LEFT JOIN (
        SELECT bill_id, company_id, SUM(amount) AS paid_amount
        FROM vendor_payments
        GROUP BY bill_id, company_id
      ) payment_totals
        ON payment_totals.bill_id = b.id
       AND payment_totals.company_id = b.company_id
      WHERE b.company_id = ?
        AND b.total_amount > 0
      ${dateFilter}
      ORDER BY b.bill_date DESC, b.id DESC
      `,
      params
    );

    const summary = rows.reduce(
      (acc, row) => {
        acc.total_bills += 1;
        acc.subtotal += toNumber(row.subtotal);
        acc.gst += toNumber(row.tax_amount);
        acc.total_purchase += toNumber(row.total_amount);
        acc.paid += toNumber(row.paid_amount);
        acc.payable += toNumber(row.due_amount);
        return acc;
      },
      {
        total_bills: 0,
        subtotal: 0,
        gst: 0,
        total_purchase: 0,
        paid: 0,
        payable: 0
      }
    );

    const returnParams = [company_id, "purchase"];
    const returnDateFilter = addDateFilter("return_date", req.query, returnParams);
    const [[returnSummary]] = await db.query(
      `SELECT
         COALESCE(SUM(subtotal), 0) AS subtotal,
         COALESCE(SUM(tax_amount), 0) AS gst,
         COALESCE(SUM(total_amount), 0) AS total
       FROM product_returns
       WHERE company_id = ? AND type = ?
       ${returnDateFilter}`,
      returnParams
    );

    res.json({
      filters: {
        from_date: req.query.from_date || null,
        to_date: req.query.to_date || null
      },
      summary: {
        total_bills: summary.total_bills,
        subtotal: money(summary.subtotal),
        gst: money(summary.gst - toNumber(returnSummary.gst)),
        total_purchase: money(summary.total_purchase),
        returns: money(returnSummary.total),
        net_purchase: money(summary.total_purchase - toNumber(returnSummary.total)),
        paid: money(summary.paid),
        payable: money(Math.max(summary.payable - toNumber(returnSummary.total), 0))
      },
      data: rows.map((row) => ({
        ...row,
        subtotal: money(row.subtotal),
        tax_amount: money(row.tax_amount),
        total_amount: money(row.total_amount),
        paid_amount: money(row.paid_amount),
        due_amount: money(row.due_amount)
      }))
    });
  } catch (err) {
    console.error("Purchase report error:", err);
    res.status(500).json({ error: "Error fetching purchase report" });
  }
};

/**
 * PAYROLL REPORT
 */
exports.getPayrollReport = async (req, res) => {
  try {
    await assertReportSchemaReady(db, PAYROLL_REPORT_SCHEMA);
    const company_id = req.user.company_id;
    const params = [company_id];
    const dateFilter = addDateFilter("pe.payroll_date", req.query, params);

    const monthFilter = req.query.month ? " AND pe.payroll_month = ?" : "";
    if (req.query.month) {
      params.push(req.query.month);
    }

    const [rows] = await db.query(
      `
      SELECT
        pe.id,
        pe.employee_id,
        pe.employee_name,
        e.employee_code,
        e.designation,
        pe.payroll_month,
        pe.payroll_date,
        pe.salary_mode,
        pe.working_days,
        pe.present_days,
        pe.absent_days,
        pe.total_hours,
        pe.overtime_hours,
        pe.standard_hours,
        pe.basic_salary,
        pe.allowances,
        pe.deductions,
        pe.net_amount,
        pe.status,
        pe.payment_date,
        pe.notes
      FROM payroll_entries pe
      LEFT JOIN payroll_employees e
        ON e.id = pe.employee_id
       AND e.company_id = pe.company_id
      WHERE pe.company_id = ?
      ${dateFilter}
      ${monthFilter}
      ORDER BY pe.payroll_date DESC, pe.id DESC
      `,
      params
    );

    const employees = new Set();
    const summary = rows.reduce(
      (acc, row) => {
        employees.add(row.employee_id || row.employee_name);
        acc.working_days += toNumber(row.working_days);
        acc.present_days += toNumber(row.present_days);
        acc.absent_days += toNumber(row.absent_days);
        acc.total_hours += toNumber(row.total_hours);
        acc.overtime_hours += toNumber(row.overtime_hours);
        acc.basic_salary += toNumber(row.basic_salary);
        acc.allowances += toNumber(row.allowances);
        acc.deductions += toNumber(row.deductions);
        acc.net_amount += toNumber(row.net_amount);

        if (String(row.status || "").toLowerCase() === "paid") {
          acc.paid_payroll += toNumber(row.net_amount);
        } else {
          acc.salary_payable += toNumber(row.net_amount);
        }

        return acc;
      },
      {
        working_days: 0,
        present_days: 0,
        absent_days: 0,
        total_hours: 0,
        overtime_hours: 0,
        basic_salary: 0,
        allowances: 0,
        deductions: 0,
        net_amount: 0,
        paid_payroll: 0,
        salary_payable: 0
      }
    );

    res.json({
      filters: {
        from_date: req.query.from_date || null,
        to_date: req.query.to_date || null,
        month: req.query.month || null
      },
      summary: {
        total_entries: rows.length,
        employees: employees.size,
        working_days: money(summary.working_days),
        present_days: money(summary.present_days),
        absent_days: money(summary.absent_days),
        total_hours: money(summary.total_hours),
        overtime_hours: money(summary.overtime_hours),
        basic_salary: money(summary.basic_salary),
        allowances: money(summary.allowances),
        deductions: money(summary.deductions),
        net_amount: money(summary.net_amount),
        paid_payroll: money(summary.paid_payroll),
        salary_payable: money(summary.salary_payable)
      },
      data: rows.map((row) => ({
        ...row,
        working_days: money(row.working_days),
        present_days: money(row.present_days),
        absent_days: money(row.absent_days),
        total_hours: money(row.total_hours),
        overtime_hours: money(row.overtime_hours),
        standard_hours: money(row.standard_hours),
        basic_salary: money(row.basic_salary),
        allowances: money(row.allowances),
        deductions: money(row.deductions),
        net_amount: money(row.net_amount)
      }))
    });
  } catch (err) {
    console.error("Payroll report error:", err);
    res.status(500).json({ error: "Error fetching payroll report" });
  }
};

/**
 * INVENTORY REPORT
 */
exports.getStock = async (req, res) => {
  try {
    await assertReportSchemaReady(db, PRODUCT_REPORT_SCHEMA);
    const company_id = req.user.company_id;
    const [rows] = await db.query(
      `
      SELECT
        id,
        name,
        sku,
        hsn,
        category,
        batch_no,
        manufactured_date,
        expiry_date,
        unit,
        gst,
        purchase_price,
        sellingPrice,
        mrp,
        stock,
        reorder_level,
        status,
        stock * purchase_price AS purchase_value,
        stock * sellingPrice AS selling_value,
        stock * mrp AS mrp_value
      FROM products
      WHERE company_id = ?
      ORDER BY name ASC
      `,
      [company_id]
    );

    const summary = rows.reduce(
      (acc, row) => {
        acc.total_products += 1;
        acc.total_stock += toNumber(row.stock);
        acc.purchase_value += toNumber(row.purchase_value);
        acc.selling_value += toNumber(row.selling_value);
        acc.mrp_value += toNumber(row.mrp_value);

        if (
          toNumber(row.reorder_level) > 0 &&
          toNumber(row.stock) <= toNumber(row.reorder_level)
        ) {
          acc.low_stock += 1;
        }

        return acc;
      },
      {
        total_products: 0,
        total_stock: 0,
        low_stock: 0,
        purchase_value: 0,
        selling_value: 0,
        mrp_value: 0
      }
    );

    res.json({
      summary: {
        total_products: summary.total_products,
        total_stock: summary.total_stock,
        low_stock: summary.low_stock,
        purchase_value: money(summary.purchase_value),
        selling_value: money(summary.selling_value),
        mrp_value: money(summary.mrp_value)
      },
      data: rows.map((row) => ({
        ...row,
        sellingPrice: money(row.sellingPrice),
        purchase_price: money(row.purchase_price),
        mrp: money(row.mrp),
        purchase_value: money(row.purchase_value),
        selling_value: money(row.selling_value),
        mrp_value: money(row.mrp_value)
      }))
    });
  } catch (err) {
    console.error("Inventory report error:", err);
    res.status(500).json({ error: "Error fetching inventory report" });
  }
};

/**
 * STOCK MOVEMENT REPORT
 */
exports.getStockMovementReport = async (req, res) => {
  try {
    await assertReportSchemaReady(db, [...PRODUCT_REPORT_SCHEMA, ...DELIVERY_SCHEMA, ...RETURN_SCHEMA]);
    const company_id = req.user.company_id;
    const productId = req.query.product_id ? Number(req.query.product_id) : null;

    const addProductFilter = (alias, params) => {
      if (!productId) {
        return "";
      }

      params.push(productId);
      return ` AND ${alias}.product_id = ?`;
    };

    const purchaseParams = [company_id];
    const purchaseDateFilter = addDateFilter("b.bill_date", req.query, purchaseParams);
    const purchaseProductFilter = addProductFilter("bi", purchaseParams);

    const salesParams = [company_id];
    const salesDateFilter = addDateFilter("i.invoice_date", req.query, salesParams);
    const salesProductFilter = productId ? " AND p.id = ?" : "";
    if (productId) salesParams.push(productId);

    const challanParams = [company_id];
    const challanDateFilter = addDateFilter("dc.challan_date", req.query, challanParams);
    const challanProductFilter = addProductFilter("dci", challanParams);

    const returnParams = [company_id];
    const returnDateFilter = addDateFilter("pr.return_date", req.query, returnParams);
    const returnProductFilter = addProductFilter("ri", returnParams);

    const [purchaseRows] = await db.query(
      `
      SELECT
        CONCAT('bill-', b.id, '-', bi.id) AS id,
        b.bill_date AS movement_date,
        'Purchase Bill' AS movement_type,
        b.bill_number AS reference_number,
        COALESCE(v.name, '-') AS party_name,
        bi.product_id,
        bi.product_name,
        COALESCE(p.sku, '') AS sku,
        COALESCE(p.hsn, '') AS hsn,
        COALESCE(p.batch_no, '') AS batch_no,
        COALESCE(p.unit, 'PCS') AS unit,
        bi.quantity AS in_qty,
        0 AS out_qty,
        bi.price AS rate,
        COALESCE(bi.total, bi.quantity * bi.price) AS amount
      FROM bills b
      INNER JOIN bill_items bi
        ON bi.bill_id = b.id
      LEFT JOIN vendors v
        ON v.id = b.vendor_id
       AND v.company_id = b.company_id
      LEFT JOIN products p
        ON p.id = bi.product_id
       AND p.company_id = b.company_id
      WHERE b.company_id = ?
        AND b.total_amount > 0
      ${purchaseDateFilter}
      ${purchaseProductFilter}
      `,
      purchaseParams
    );

    const [salesRows] = await db.query(
      `
      SELECT
        CONCAT('invoice-', i.id, '-', ii.id) AS id,
        i.invoice_date AS movement_date,
        'Sales Invoice' AS movement_type,
        i.invoice_number AS reference_number,
        i.customer_name AS party_name,
        p.id AS product_id,
        ii.item_name AS product_name,
        COALESCE(p.sku, '') AS sku,
        COALESCE(p.hsn, '') AS hsn,
        COALESCE(p.batch_no, '') AS batch_no,
        COALESCE(p.unit, 'PCS') AS unit,
        0 AS in_qty,
        ii.quantity AS out_qty,
        ii.unit_price AS rate,
        COALESCE(ii.total_price, ii.quantity * ii.unit_price) AS amount
      FROM invoices i
      INNER JOIN invoice_items ii
        ON ii.invoice_id = i.id
       AND ii.company_id = i.company_id
      LEFT JOIN products p
        ON p.company_id = ii.company_id
       AND p.name = ii.item_name
      WHERE i.company_id = ?
      ${salesDateFilter}
      ${salesProductFilter}
      `,
      salesParams
    );

    const [challanRows] = await db.query(
      `
      SELECT
        CONCAT('dc-', dc.id, '-', dci.id) AS id,
        dc.challan_date AS movement_date,
        CASE WHEN dc.type = 'in' THEN 'DC In' ELSE 'DC Out' END AS movement_type,
        dc.challan_number AS reference_number,
        dc.party_name,
        dci.product_id,
        dci.product_name,
        COALESCE(p.sku, '') AS sku,
        COALESCE(p.hsn, '') AS hsn,
        COALESCE(p.batch_no, dci.batch_no, '') AS batch_no,
        COALESCE(dci.unit, p.unit, 'PCS') AS unit,
        CASE WHEN dc.type = 'in' THEN dci.quantity ELSE 0 END AS in_qty,
        CASE WHEN dc.type = 'out' THEN dci.quantity ELSE 0 END AS out_qty,
        0 AS rate,
        0 AS amount
      FROM delivery_challans dc
      INNER JOIN delivery_challan_items dci
        ON dci.challan_id = dc.id
       AND dci.company_id = dc.company_id
      LEFT JOIN products p
        ON p.id = dci.product_id
       AND p.company_id = dc.company_id
      WHERE dc.company_id = ?
      ${challanDateFilter}
      ${challanProductFilter}
      `,
      challanParams
    );

    const [returnRows] = await db.query(
      `
      SELECT
        CONCAT('return-', pr.id, '-', ri.id) AS id,
        pr.return_date AS movement_date,
        CASE WHEN pr.type = 'sales' THEN 'Sales Return' ELSE 'Purchase Return' END AS movement_type,
        pr.return_number AS reference_number,
        pr.party_name,
        ri.product_id,
        ri.product_name,
        COALESCE(p.sku, '') AS sku,
        COALESCE(p.hsn, '') AS hsn,
        COALESCE(p.batch_no, ri.batch_no, '') AS batch_no,
        COALESCE(p.unit, 'PCS') AS unit,
        CASE WHEN pr.type = 'sales' THEN ri.quantity ELSE 0 END AS in_qty,
        CASE WHEN pr.type = 'purchase' THEN ri.quantity ELSE 0 END AS out_qty,
        ri.unit_price AS rate,
        ri.total_price AS amount
      FROM product_returns pr
      INNER JOIN return_items ri
        ON ri.return_id = pr.id
       AND ri.company_id = pr.company_id
      LEFT JOIN products p
        ON p.id = ri.product_id
       AND p.company_id = pr.company_id
      WHERE pr.company_id = ?
      ${returnDateFilter}
      ${returnProductFilter}
      `,
      returnParams
    );

    const movementRows = [
      ...purchaseRows,
      ...salesRows,
      ...challanRows,
      ...returnRows,
    ].sort((a, b) => {
      const dateCompare = new Date(b.movement_date || 0) - new Date(a.movement_date || 0);
      if (dateCompare) return dateCompare;
      return String(b.reference_number || "").localeCompare(String(a.reference_number || ""));
    });

    const productParams = [company_id];
    const productFilter = productId ? " AND id = ?" : "";
    if (productId) productParams.push(productId);

    const [products] = await db.query(
      `
      SELECT id, name, sku, hsn, batch_no, unit, opening_stock, stock
      FROM products
      WHERE company_id = ?
      ${productFilter}
      ORDER BY name ASC
      `,
      productParams
    );

    const openingStock = products.reduce((sum, row) => sum + toNumber(row.opening_stock), 0);
    const currentStock = products.reduce((sum, row) => sum + toNumber(row.stock), 0);
    const totalIn = movementRows.reduce((sum, row) => sum + toNumber(row.in_qty), 0);
    const totalOut = movementRows.reduce((sum, row) => sum + toNumber(row.out_qty), 0);

    res.json({
      filters: {
        from_date: req.query.from_date || null,
        to_date: req.query.to_date || null,
        product_id: productId || null,
      },
      summary: {
        products: products.length,
        opening_stock: money(openingStock),
        stock_in: money(totalIn),
        stock_out: money(totalOut),
        net_movement: money(totalIn - totalOut),
        current_stock: money(currentStock),
      },
      data: movementRows.map((row) => ({
        ...row,
        in_qty: money(row.in_qty),
        out_qty: money(row.out_qty),
        rate: money(row.rate),
        amount: money(row.amount),
      })),
    });
  } catch (err) {
    console.error("Stock movement report error:", err);
    res.status(500).json({ error: "Error fetching stock movement report" });
  }
};

/**
 * LOW STOCK
 */
exports.getLowStock = async (req, res) => {
  try {
    await assertReportSchemaReady(db, PRODUCT_REPORT_SCHEMA);
    const company_id = req.user.company_id;

    const [rows] = await db.query(
      `
      SELECT id, name, sku, hsn, category, batch_no, manufactured_date, expiry_date, unit, gst, purchase_price, sellingPrice, mrp, stock, reorder_level FROM products
      WHERE company_id = ?
        AND reorder_level > 0
        AND stock <= reorder_level
      ORDER BY stock ASC, name ASC
      `,
      [company_id]
    );

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Error fetching low stock" });
  }
};

/**
 * DELIVERY CHALLAN REPORT
 */
exports.getDeliveryChallanReport = async (req, res) => {
  try {
    await assertReportSchemaReady(db, [...DELIVERY_SCHEMA, ...PRODUCT_REPORT_SCHEMA]);
    const company_id = req.user.company_id;
    const type = String(req.query.type || "out").toLowerCase() === "in" ? "in" : "out";
    const params = [company_id, type];
    const dateFilter = addDateFilter("dc.challan_date", req.query, params);

    const [rows] = await db.query(
      `
      SELECT
        dc.id,
        dc.type,
        dc.challan_number,
        dc.challan_date,
        dc.party_name,
        dc.transport,
        dc.vehicle_number,
        dc.status,
        COALESCE(item_totals.item_count, 0) AS item_count,
        COALESCE(item_totals.total_qty, 0) AS total_qty
      FROM delivery_challans dc
      LEFT JOIN (
        SELECT challan_id, company_id, COUNT(*) AS item_count, SUM(quantity) AS total_qty
        FROM delivery_challan_items
        GROUP BY challan_id, company_id
      ) item_totals
        ON item_totals.challan_id = dc.id
       AND item_totals.company_id = dc.company_id
      WHERE dc.company_id = ?
        AND dc.type = ?
      ${dateFilter}
      ORDER BY dc.challan_date DESC, dc.id DESC
      `,
      params
    );

    const summary = rows.reduce(
      (acc, row) => {
        acc.total_challans += 1;
        acc.total_items += toNumber(row.item_count);
        acc.total_qty += toNumber(row.total_qty);
        return acc;
      },
      { total_challans: 0, total_items: 0, total_qty: 0 }
    );

    res.json({
      filters: {
        from_date: req.query.from_date || null,
        to_date: req.query.to_date || null,
        type,
      },
      summary,
      data: rows,
    });
  } catch (err) {
    console.error("Delivery challan report error:", err);
    res.status(500).json({ error: "Error fetching delivery challan report" });
  }
};

/**
 * RETURN REPORT
 */
exports.getReturnReport = async (req, res) => {
  try {
    await assertReportSchemaReady(db, [...RETURN_SCHEMA, ...PRODUCT_REPORT_SCHEMA]);
    const company_id = req.user.company_id;
    const type = String(req.query.type || "sales").toLowerCase() === "purchase" ? "purchase" : "sales";
    const params = [company_id, type];
    const dateFilter = addDateFilter("pr.return_date", req.query, params);

    const [rows] = await db.query(
      `
      SELECT
        pr.id,
        pr.type,
        pr.return_number,
        pr.return_date,
        pr.party_name,
        pr.reference_number,
        pr.subtotal,
        pr.tax_amount,
        pr.total_amount,
        COALESCE(item_totals.item_count, 0) AS item_count,
        COALESCE(item_totals.total_qty, 0) AS total_qty
      FROM product_returns pr
      LEFT JOIN (
        SELECT return_id, company_id, COUNT(*) AS item_count, SUM(quantity) AS total_qty
        FROM return_items
        GROUP BY return_id, company_id
      ) item_totals
        ON item_totals.return_id = pr.id
       AND item_totals.company_id = pr.company_id
      WHERE pr.company_id = ?
        AND pr.type = ?
      ${dateFilter}
      ORDER BY pr.return_date DESC, pr.id DESC
      `,
      params
    );

    const summary = rows.reduce(
      (acc, row) => {
        acc.total_returns += 1;
        acc.total_items += toNumber(row.item_count);
        acc.total_qty += toNumber(row.total_qty);
        acc.subtotal += toNumber(row.subtotal);
        acc.gst += toNumber(row.tax_amount);
        acc.total += toNumber(row.total_amount);
        return acc;
      },
      { total_returns: 0, total_items: 0, total_qty: 0, subtotal: 0, gst: 0, total: 0 }
    );

    res.json({
      filters: {
        from_date: req.query.from_date || null,
        to_date: req.query.to_date || null,
        type,
      },
      summary: {
        total_returns: summary.total_returns,
        total_items: summary.total_items,
        total_qty: summary.total_qty,
        subtotal: money(summary.subtotal),
        gst: money(summary.gst),
        total: money(summary.total),
      },
      data: rows.map((row) => ({
        ...row,
        subtotal: money(row.subtotal),
        tax_amount: money(row.tax_amount),
        total_amount: money(row.total_amount),
      })),
    });
  } catch (err) {
    console.error("Return report error:", err);
    res.status(500).json({ error: "Error fetching return report" });
  }
};

/**
 * GST SALES REGISTER
 */
exports.getGstSalesRegister = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const rows = await getInvoiceTaxRows(company_id, req.query);

    res.json({
      filters: {
        from_date: req.query.from_date || null,
        to_date: req.query.to_date || null
      },
      summary: buildTaxSummary(rows),
      data: normalizeTaxRows(rows)
    });
  } catch (err) {
    console.error("GST sales register error:", err);
    res.status(500).json({ error: "Error fetching GST sales register" });
  }
};

/**
 * GST PURCHASE REGISTER
 */
exports.getGstPurchaseRegister = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const rows = await getBillTaxRows(company_id, req.query);

    res.json({
      filters: {
        from_date: req.query.from_date || null,
        to_date: req.query.to_date || null
      },
      summary: buildTaxSummary(rows),
      data: normalizeTaxRows(rows)
    });
  } catch (err) {
    console.error("GST purchase register error:", err);
    res.status(500).json({ error: "Error fetching GST purchase register" });
  }
};

/**
 * GSTR-1 SUMMARY
 */
exports.getGstr1Summary = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const salesRows = await getInvoiceTaxRows(company_id, req.query);
    const salesSummary = buildTaxSummary(salesRows);
    const salesReturns = await getReturnTaxSummary(company_id, "sales", req.query);

    const net = {
      taxable_value: toNumber(salesSummary.taxable_value) - salesReturns.taxable_value,
      cgst: toNumber(salesSummary.cgst) - salesReturns.cgst,
      sgst: toNumber(salesSummary.sgst) - salesReturns.sgst,
      igst: toNumber(salesSummary.igst) - salesReturns.igst,
      total_gst: toNumber(salesSummary.total_gst) - salesReturns.total_gst,
      total_amount: toNumber(salesSummary.total_amount) - salesReturns.total_amount
    };

    const rows = [
      {
        id: "outward",
        section: "Outward Taxable Supplies",
        description: "Sales invoices",
        taxable_value: salesSummary.taxable_value,
        cgst: salesSummary.cgst,
        sgst: salesSummary.sgst,
        igst: salesSummary.igst,
        total_gst: salesSummary.total_gst,
        total_amount: salesSummary.total_amount
      },
      {
        id: "returns",
        section: "Credit Notes / Sales Returns",
        description: "Returns reduced from outward supplies",
        taxable_value: money(salesReturns.taxable_value),
        cgst: money(salesReturns.cgst),
        sgst: money(salesReturns.sgst),
        igst: money(salesReturns.igst),
        total_gst: money(salesReturns.total_gst),
        total_amount: money(salesReturns.total_amount)
      },
      {
        id: "net",
        section: "Net Outward Supplies",
        description: "Final GSTR-1 value",
        taxable_value: money(net.taxable_value),
        cgst: money(net.cgst),
        sgst: money(net.sgst),
        igst: money(net.igst),
        total_gst: money(net.total_gst),
        total_amount: money(net.total_amount)
      }
    ];

    res.json({
      filters: {
        from_date: req.query.from_date || null,
        to_date: req.query.to_date || null
      },
      summary: {
        invoices: salesSummary.total_records,
        returns: money(salesReturns.total_amount),
        net_taxable: money(net.taxable_value),
        cgst: money(net.cgst),
        sgst: money(net.sgst),
        igst: money(net.igst),
        total_gst: money(net.total_gst),
        net_value: money(net.total_amount)
      },
      data: rows
    });
  } catch (err) {
    console.error("GSTR-1 summary error:", err);
    res.status(500).json({ error: "Error fetching GSTR-1 summary" });
  }
};

/**
 * GSTR-3B SUMMARY
 */
exports.getGstr3bSummary = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const salesRows = await getInvoiceTaxRows(company_id, req.query);
    const purchaseRows = await getBillTaxRows(company_id, req.query);
    const salesSummary = buildTaxSummary(salesRows);
    const purchaseSummary = buildTaxSummary(purchaseRows);
    const salesReturns = await getReturnTaxSummary(company_id, "sales", req.query);
    const purchaseReturns = await getReturnTaxSummary(company_id, "purchase", req.query);

    const outwardTaxable = toNumber(salesSummary.taxable_value) - salesReturns.taxable_value;
    const outwardGst = toNumber(salesSummary.total_gst) - salesReturns.total_gst;
    const itcTaxable = toNumber(purchaseSummary.taxable_value) - purchaseReturns.taxable_value;
    const itcGst = toNumber(purchaseSummary.total_gst) - purchaseReturns.total_gst;
    const netPayable = Math.max(outwardGst - itcGst, 0);
    const excessItc = Math.max(itcGst - outwardGst, 0);

    const rows = [
      {
        id: "outward",
        section: "3.1 Outward Taxable Supplies",
        taxable_value: money(outwardTaxable),
        total_gst: money(outwardGst),
        remarks: "Sales less sales returns"
      },
      {
        id: "itc",
        section: "4 Eligible ITC",
        taxable_value: money(itcTaxable),
        total_gst: money(itcGst),
        remarks: "Purchases less purchase returns"
      },
      {
        id: "payable",
        section: "Net GST Payable",
        taxable_value: 0,
        total_gst: money(netPayable),
        remarks: excessItc > 0 ? "ITC carry-forward available" : "Payable after ITC"
      }
    ];

    res.json({
      filters: {
        from_date: req.query.from_date || null,
        to_date: req.query.to_date || null
      },
      summary: {
        outward_taxable: money(outwardTaxable),
        output_gst: money(outwardGst),
        itc_taxable: money(itcTaxable),
        input_gst: money(itcGst),
        net_payable: money(netPayable),
        excess_itc: money(excessItc)
      },
      data: rows
    });
  } catch (err) {
    console.error("GSTR-3B summary error:", err);
    res.status(500).json({ error: "Error fetching GSTR-3B summary" });
  }
};

/**
 * INPUT TAX CREDIT REPORT
 */
exports.getItcReport = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const rows = await getBillTaxRows(company_id, req.query);
    const purchaseReturns = await getReturnTaxSummary(company_id, "purchase", req.query);

    res.json({
      filters: {
        from_date: req.query.from_date || null,
        to_date: req.query.to_date || null
      },
      summary: buildTaxSummary(rows, {
        purchase_returns: money(purchaseReturns.total_amount),
        net_itc: money(
          rows.reduce((sum, row) => sum + toNumber(row.total_gst), 0) -
            purchaseReturns.total_gst
        )
      }),
      data: normalizeTaxRows(rows)
    });
  } catch (err) {
    console.error("ITC report error:", err);
    res.status(500).json({ error: "Error fetching ITC report" });
  }
};

/**
 * OUTPUT GST REPORT
 */
exports.getOutputGstReport = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const rows = await getInvoiceTaxRows(company_id, req.query);
    const salesReturns = await getReturnTaxSummary(company_id, "sales", req.query);

    res.json({
      filters: {
        from_date: req.query.from_date || null,
        to_date: req.query.to_date || null
      },
      summary: buildTaxSummary(rows, {
        sales_returns: money(salesReturns.total_amount),
        net_output_gst: money(
          rows.reduce((sum, row) => sum + toNumber(row.total_gst), 0) -
            salesReturns.total_gst
        )
      }),
      data: normalizeTaxRows(rows)
    });
  } catch (err) {
    console.error("Output GST report error:", err);
    res.status(500).json({ error: "Error fetching output GST report" });
  }
};

/**
 * HSN REPORT
 */
exports.getHsnReport = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const salesParams = [company_id];
    const salesDateFilter = addDateFilter("i.invoice_date", req.query, salesParams);
    const purchaseParams = [company_id];
    const purchaseDateFilter = addDateFilter("b.bill_date", req.query, purchaseParams);

    const [salesRows] = await db.query(
      `
      SELECT
        CONCAT('sales-', COALESCE(NULLIF(p.hsn, ''), 'Not Set'), '-', ii.item_name) AS id,
        'Sales' AS report_type,
        COALESCE(NULLIF(p.hsn, ''), 'Not Set') AS hsn,
        ii.item_name AS product_name,
        SUM(ii.quantity) AS quantity,
        SUM(ii.quantity * ii.unit_price) AS taxable_value,
        SUM(COALESCE(ii.total_price, 0) - (ii.quantity * ii.unit_price)) AS total_gst,
        SUM(COALESCE(ii.total_price, 0)) AS total_amount
      FROM invoice_items ii
      INNER JOIN invoices i
        ON i.id = ii.invoice_id
       AND i.company_id = ii.company_id
      LEFT JOIN products p
        ON p.company_id = ii.company_id
       AND p.name = ii.item_name
      WHERE ii.company_id = ?
      ${salesDateFilter}
      GROUP BY
        CONCAT('sales-', COALESCE(NULLIF(p.hsn, ''), 'Not Set'), '-', ii.item_name),
        COALESCE(NULLIF(p.hsn, ''), 'Not Set'),
        ii.item_name
      `,
      salesParams
    );

    const [purchaseRows] = await db.query(
      `
      SELECT
        CONCAT('purchase-', COALESCE(NULLIF(p.hsn, ''), 'Not Set'), '-', bi.product_name) AS id,
        'Purchase' AS report_type,
        COALESCE(NULLIF(p.hsn, ''), 'Not Set') AS hsn,
        bi.product_name,
        SUM(bi.quantity) AS quantity,
        SUM(bi.quantity * bi.price) AS taxable_value,
        SUM(GREATEST(COALESCE(bi.total, 0) - (bi.quantity * bi.price), 0)) AS total_gst,
        SUM(COALESCE(bi.total, 0)) AS total_amount
      FROM bill_items bi
      INNER JOIN bills b
        ON b.id = bi.bill_id
      LEFT JOIN products p
        ON p.company_id = b.company_id
       AND p.id = bi.product_id
      WHERE b.company_id = ?
        AND b.total_amount > 0
      ${purchaseDateFilter}
      GROUP BY
        CONCAT('purchase-', COALESCE(NULLIF(p.hsn, ''), 'Not Set'), '-', bi.product_name),
        COALESCE(NULLIF(p.hsn, ''), 'Not Set'),
        bi.product_name
      `,
      purchaseParams
    );

    const rows = [...salesRows, ...purchaseRows].sort((a, b) =>
      String(a.hsn).localeCompare(String(b.hsn)) ||
      String(a.product_name).localeCompare(String(b.product_name))
    );
    const uniqueHsnCodes = new Set(
      rows
        .map((row) => row.hsn)
        .filter((hsn) => hsn && hsn !== "Not Set")
    );

    const summary = rows.reduce(
      (acc, row) => {
        acc.total_qty += toNumber(row.quantity);
        acc.taxable_value += toNumber(row.taxable_value);
        acc.total_gst += toNumber(row.total_gst);
        acc.total_amount += toNumber(row.total_amount);
        return acc;
      },
      {
        total_qty: 0,
        taxable_value: 0,
        total_gst: 0,
        total_amount: 0
      }
    );

    res.json({
      filters: {
        from_date: req.query.from_date || null,
        to_date: req.query.to_date || null
      },
      summary: {
        total_rows: rows.length,
        total_hsn: uniqueHsnCodes.size,
        total_qty: money(summary.total_qty),
        taxable_value: money(summary.taxable_value),
        total_gst: money(summary.total_gst),
        total_amount: money(summary.total_amount)
      },
      data: rows.map((row) => ({
        ...row,
        quantity: money(row.quantity),
        taxable_value: money(row.taxable_value),
        total_gst: money(row.total_gst),
        total_amount: money(row.total_amount)
      }))
    });
  } catch (err) {
    console.error("HSN report error:", err);
    res.status(500).json({ error: "Error fetching HSN report" });
  }
};

/**
 * GST FILING READINESS CHECK
 */
exports.getGstFilingReadiness = async (req, res) => {
  try {
    const company_id = req.user.company_id;
    const issues = [];
    const addIssue = ({ severity, area, title, message, count = 0, action, samples = [] }) => {
      issues.push({
        id: `${area}-${title}-${issues.length + 1}`,
        severity,
        area,
        title,
        message,
        count,
        action,
        samples: samples.slice(0, 5).join(", ")
      });
    };

    const businessColumns = await getTableColumns("business_profiles");
    const businessSelect = [
      "name",
      businessColumns.has("gstin") ? "gstin" : "NULL AS gstin",
      businessColumns.has("address") ? "address" : "NULL AS address"
    ].join(", ");

    const [[business]] = await db.query(
      `SELECT ${businessSelect} FROM business_profiles WHERE company_id = ? LIMIT 1`,
      [company_id]
    );

    const businessGstin = String(business?.gstin || "").trim().toUpperCase();
    if (!business) {
      addIssue({
        severity: "Critical",
        area: "Business Profile",
        title: "Business profile is missing",
        message: "GST reports need your company name and GSTIN before filing.",
        action: "Open Business Profile and save company details."
      });
    } else if (!businessGstin) {
      addIssue({
        severity: "Critical",
        area: "Business Profile",
        title: "Company GSTIN is missing",
        message: "GSTR reports should carry your registered GSTIN.",
        action: "Open Business Profile and enter GSTIN."
      });
    } else if (!gstinPattern.test(businessGstin)) {
      addIssue({
        severity: "Critical",
        area: "Business Profile",
        title: "Company GSTIN format needs review",
        message: "GSTIN should be 15 characters in the standard GST format.",
        action: "Correct the GSTIN in Business Profile.",
        samples: [businessGstin]
      });
    }

    const salesCountParams = [company_id];
    const salesCountDateFilter = addDateFilter("i.invoice_date", req.query, salesCountParams);
    const [salesRows] = await db.query(
      `
      SELECT COUNT(*) AS total_records
      FROM invoices i
      WHERE i.company_id = ?
      ${salesCountDateFilter}
      `,
      salesCountParams
    );

    const purchaseCountParams = [company_id];
    const purchaseCountDateFilter = addDateFilter("b.bill_date", req.query, purchaseCountParams);
    const [purchaseRows] = await db.query(
      `
      SELECT COUNT(*) AS total_records
      FROM bills b
      WHERE b.company_id = ?
        AND b.total_amount > 0
      ${purchaseCountDateFilter}
      `,
      purchaseCountParams
    );

    const [missingProductHsn] = await db.query(
      `
      SELECT name
      FROM products
      WHERE company_id = ?
        AND (status IS NULL OR status <> 'Inactive')
        AND (hsn IS NULL OR TRIM(hsn) = '' OR hsn = '-')
      ORDER BY name
      LIMIT 20
      `,
      [company_id]
    );

    if (missingProductHsn.length) {
      addIssue({
        severity: "Warning",
        area: "Products",
        title: "Products missing HSN",
        message: "HSN report and GST filing summaries need product HSN codes.",
        count: missingProductHsn.length,
        action: "Update HSN in Products for these items.",
        samples: missingProductHsn.map((row) => row.name)
      });
    }

    const [invalidGstProducts] = await db.query(
      `
      SELECT name, gst
      FROM products
      WHERE company_id = ?
        AND (status IS NULL OR status <> 'Inactive')
        AND (gst IS NULL OR gst < 0 OR gst > 28)
      ORDER BY name
      LIMIT 20
      `,
      [company_id]
    );

    if (invalidGstProducts.length) {
      addIssue({
        severity: "Critical",
        area: "Products",
        title: "Invalid GST rate on products",
        message: "GST rate should be between 0% and 28%.",
        count: invalidGstProducts.length,
        action: "Correct GST rate in Products.",
        samples: invalidGstProducts.map((row) => `${row.name} (${row.gst}%)`)
      });
    }

    const salesParams = [company_id];
    const salesDateFilter = addDateFilter("i.invoice_date", req.query, salesParams);
    const [salesTaxMismatches] = await db.query(
      `
      SELECT
        i.invoice_number,
        i.tax_amount,
        COALESCE(SUM(ii.total_price - (ii.quantity * ii.unit_price)), 0) AS item_gst
      FROM invoices i
      LEFT JOIN invoice_items ii
        ON ii.invoice_id = i.id
       AND ii.company_id = i.company_id
      WHERE i.company_id = ?
      ${salesDateFilter}
      GROUP BY i.id, i.invoice_number, i.tax_amount
      HAVING ABS(COALESCE(i.tax_amount, 0) - item_gst) > 0.99
      ORDER BY i.invoice_date DESC, i.id DESC
      LIMIT 20
      `,
      salesParams
    );

    if (salesTaxMismatches.length) {
      addIssue({
        severity: "Critical",
        area: "Sales",
        title: "Sales GST total mismatch",
        message: "Some invoice GST totals do not match their line-item GST totals.",
        count: salesTaxMismatches.length,
        action: "Open and correct these sales invoices.",
        samples: salesTaxMismatches.map((row) => row.invoice_number)
      });
    }

    const [salesMissingDetails] = await db.query(
      `
      SELECT invoice_number
      FROM invoices i
      WHERE i.company_id = ?
        AND (
          invoice_number IS NULL OR TRIM(invoice_number) = '' OR
          invoice_date IS NULL OR
          customer_name IS NULL OR TRIM(customer_name) = ''
        )
      ${salesDateFilter}
      ORDER BY i.id DESC
      LIMIT 20
      `,
      salesParams
    );

    if (salesMissingDetails.length) {
      addIssue({
        severity: "Critical",
        area: "Sales",
        title: "Sales invoices missing required details",
        message: "Invoice number, date, and customer name are required before filing.",
        count: salesMissingDetails.length,
        action: "Open these invoices and complete the missing details.",
        samples: salesMissingDetails.map((row) => row.invoice_number || "Invoice without number")
      });
    }

    const purchaseParams = [company_id];
    const purchaseDateFilter = addDateFilter("b.bill_date", req.query, purchaseParams);
    const [purchaseTaxMismatches] = await db.query(
      `
      SELECT
        b.bill_number,
        b.total_amount,
        COALESCE(SUM(bi.total), 0) AS item_total
      FROM bills b
      LEFT JOIN bill_items bi
        ON bi.bill_id = b.id
      WHERE b.company_id = ?
        AND b.total_amount > 0
      ${purchaseDateFilter}
      GROUP BY b.id, b.bill_number, b.total_amount
      HAVING ABS(COALESCE(b.total_amount, 0) - item_total) > 0.99
      ORDER BY b.bill_date DESC, b.id DESC
      LIMIT 20
      `,
      purchaseParams
    );

    if (purchaseTaxMismatches.length) {
      addIssue({
        severity: "Critical",
        area: "Purchases",
        title: "Purchase bill total mismatch",
        message: "Some bill totals do not match their line-item totals.",
        count: purchaseTaxMismatches.length,
        action: "Open and correct these purchase bills.",
        samples: purchaseTaxMismatches.map((row) => row.bill_number)
      });
    }

    const [purchaseMissingDetails] = await db.query(
      `
      SELECT b.bill_number
      FROM bills b
      LEFT JOIN vendors v
        ON v.id = b.vendor_id
       AND v.company_id = b.company_id
      WHERE b.company_id = ?
        AND b.total_amount > 0
        AND (
          b.bill_number IS NULL OR TRIM(b.bill_number) = '' OR
          b.bill_date IS NULL OR
          b.vendor_id IS NULL OR
          v.id IS NULL
        )
      ${purchaseDateFilter}
      ORDER BY b.id DESC
      LIMIT 20
      `,
      purchaseParams
    );

    if (purchaseMissingDetails.length) {
      addIssue({
        severity: "Critical",
        area: "Purchases",
        title: "Purchase bills missing required details",
        message: "Bill number, date, and vendor are required before filing.",
        count: purchaseMissingDetails.length,
        action: "Open these bills and complete the missing details.",
        samples: purchaseMissingDetails.map((row) => row.bill_number || "Bill without number")
      });
    }

    const [vendorsMissingGstin] = await db.query(
      `
      SELECT DISTINCT v.name
      FROM bills b
      INNER JOIN vendors v
        ON v.id = b.vendor_id
       AND v.company_id = b.company_id
      WHERE b.company_id = ?
        AND b.total_amount > 0
        AND (v.gst_number IS NULL OR TRIM(v.gst_number) = '')
      ${purchaseDateFilter}
      ORDER BY v.name
      LIMIT 20
      `,
      purchaseParams
    );

    if (vendorsMissingGstin.length) {
      addIssue({
        severity: "Warning",
        area: "ITC",
        title: "Vendor GSTIN missing on purchase bills",
        message: "ITC claims normally need supplier GSTIN details.",
        count: vendorsMissingGstin.length,
        action: "Update GSTIN in Vendor master where ITC is applicable.",
        samples: vendorsMissingGstin.map((row) => row.name)
      });
    }

    const customerColumns = await getTableColumns("customers");
    const customerGstColumn =
      ["gst_number", "gstin", "gst"].find((column) => customerColumns.has(column)) || null;

    if (!customerGstColumn) {
      addIssue({
        severity: "Info",
        area: "Customers",
        title: "Customer GSTIN field not available",
        message: "B2B and B2C GST classification will need manual review because customers do not store GSTIN yet.",
        action: "Add customer GSTIN later if B2B sales are needed."
      });
    } else {
      const [customersMissingGstin] = await db.query(
        `
        SELECT DISTINCT i.customer_name
        FROM invoices i
        LEFT JOIN customers c
          ON c.company_id = i.company_id
         AND c.name = i.customer_name
        WHERE i.company_id = ?
          AND (c.${customerGstColumn} IS NULL OR TRIM(c.${customerGstColumn}) = '')
        ${salesDateFilter}
        ORDER BY i.customer_name
        LIMIT 20
        `,
        salesParams
      );

      if (customersMissingGstin.length) {
        addIssue({
          severity: "Info",
          area: "Customers",
          title: "Some invoice customers have no GSTIN",
          message: "This is fine for B2C sales, but B2B invoices should have customer GSTIN.",
          count: customersMissingGstin.length,
          action: "Review whether these are B2C or update customer GSTIN.",
          samples: customersMissingGstin.map((row) => row.customer_name)
        });
      }
    }

    const returnParams = [company_id];
    const returnDateFilter = addDateFilter("return_date", req.query, returnParams);
    const [returnMissingReference] = await db.query(
      `
      SELECT return_number
      FROM product_returns
      WHERE company_id = ?
        AND (reference_number IS NULL OR TRIM(reference_number) = '')
      ${returnDateFilter}
      ORDER BY return_date DESC, id DESC
      LIMIT 20
      `,
      returnParams
    );

    if (returnMissingReference.length) {
      addIssue({
        severity: "Warning",
        area: "Returns",
        title: "Returns missing invoice or bill reference",
        message: "Credit/debit note reporting is cleaner when every return links to the original invoice or bill.",
        count: returnMissingReference.length,
        action: "Open returns and add the reference number.",
        samples: returnMissingReference.map((row) => row.return_number)
      });
    }

    if (!issues.some((issue) => issue.severity === "Critical" || issue.severity === "Warning")) {
      addIssue({
        severity: "OK",
        area: "GST Filing",
        title: "Ready for accountant review",
        message: "No blocking GST data issues were found for this period.",
        action: "Download GST reports and share with your accountant."
      });
    }

    const critical = issues.filter((issue) => issue.severity === "Critical").length;
    const warning = issues.filter((issue) => issue.severity === "Warning").length;
    const info = issues.filter((issue) => issue.severity === "Info").length;
    const ready = critical === 0;

    res.json({
      filters: {
        from_date: req.query.from_date || null,
        to_date: req.query.to_date || null
      },
      summary: {
        ready,
        status: ready ? "Ready for review" : "Needs fixes",
        critical,
        warning,
        info,
        checks: issues.length,
        sales_invoices: Number(salesRows[0]?.total_records || 0),
        purchase_bills: Number(purchaseRows[0]?.total_records || 0)
      },
      data: issues
    });
  } catch (err) {
    console.error("GST readiness report error:", err);
    res.status(500).json({ error: "Error fetching GST readiness report" });
  }
};
