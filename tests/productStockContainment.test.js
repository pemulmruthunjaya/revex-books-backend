const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const db = require("../db/connection");
const {
  assertSafeProductImportRows,
  assertUnchangedProductStock,
  assertZeroInitialStock,
} = require("../services/productStockSafety");
const { importMasterData, rollbackImport } = require("../controllers/backupController");

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test("new product stock accepts omitted/blank/zero and rejects every nonzero or invalid quantity", () => {
  for (const body of [{}, { stock: "", opening_stock: "" }, { stock: 0 }, { opening_stock: "0" }]) {
    assert.doesNotThrow(() => assertZeroInitialStock(body));
  }
  for (const body of [{ stock: 1 }, { stock: -1 }, { opening_stock: 2 }, { stock: "invalid" }]) {
    assert.throws(
      () => assertZeroInitialStock(body),
      (error) => error.code === "PRODUCT_INITIAL_STOCK_WORKFLOW_REQUIRED" && error.status === 409
    );
  }
});

test("product edit permits exact frontend quantity echoes but rejects increases, decreases and resets", () => {
  const persisted = { stock: "12.50", opening_stock: "5.00" };
  assert.doesNotThrow(() => assertUnchangedProductStock({}, persisted));
  assert.doesNotThrow(() => assertUnchangedProductStock({ stock: 12.5, opening_stock: 5 }, persisted));
  for (const body of [
    { stock: 13 }, { stock: 11 }, { stock: 0 }, { opening_stock: 6 }, { opening_stock: 0 },
  ]) {
    assert.throws(
      () => assertUnchangedProductStock(body, persisted),
      (error) => error.code === "PRODUCT_STOCK_DIRECT_UPDATE_RESTRICTED"
    );
  }
});

test("product import accepts blank/zero metadata but rejects meaningful quantity for the full batch", () => {
  assert.doesNotThrow(() => assertSafeProductImportRows([
    { Name: "A" },
    { Name: "B", Stock: "", "Opening Stock": 0 },
  ]));
  for (const row of [
    { Name: "A", Stock: 1 },
    { Name: "A", "Current Stock": -1 },
    { Name: "A", Quantity: 3 },
    { Name: "A", "Opening Qty": 2 },
    { Name: "A", Stock: "bad" },
  ]) {
    assert.throws(
      () => assertSafeProductImportRows([{ Name: "safe" }, row]),
      (error) => error.code === "PRODUCT_IMPORT_STOCK_RESTRICTED"
    );
  }
});

const getProductHandlers = () => {
  delete require.cache[require.resolve("../routes/productRoutes")];
  const router = require("../routes/productRoutes");
  const find = (method) => router.stack.find((layer) => layer.route?.path === "/" && layer.route.methods[method])
    .route.stack.at(-1).handle;
  const update = router.stack.find((layer) => layer.route?.path === "/:id" && layer.route.methods.put)
    .route.stack.at(-1).handle;
  return { create: find("post"), list: find("get"), update };
};

test("unsafe product creation rejects before any product or inventory write", async () => {
  const originalQuery = db.query;
  const calls = [];
  db.query = async (sql) => { calls.push(String(sql)); throw new Error("DB must not be reached"); };
  try {
    const { create } = getProductHandlers();
    const res = response();
    await create({ body: { name: "Unsafe", sellingPrice: 10, stock: 4 }, user: { company_id: 4 } }, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "PRODUCT_INITIAL_STOCK_WORKFLOW_REQUIRED");
    assert.equal(calls.length, 0);
  } finally {
    db.query = originalQuery;
    delete require.cache[require.resolve("../routes/productRoutes")];
  }
});

test("new products with zero or omitted quantity persist zero without fabricating inventory events", async () => {
  const originalQuery = db.query;
  const calls = [];
  db.query = async (sql, params = []) => {
    const text = String(sql);
    calls.push({ text, params });
    if (text.includes("SHOW COLUMNS FROM products")) {
      return [["mrp", "sku", "barcode", "hsn", "category", "batch_no", "manufactured_date", "expiry_date", "unit", "gst", "purchase_price", "opening_stock", "reorder_level", "status"].map((Field) => ({ Field }))];
    }
    if (text.includes("INSERT INTO products")) return [{ insertId: calls.length }];
    throw new Error(`Unexpected SQL: ${text}`);
  };
  try {
    const { create } = getProductHandlers();
    for (const body of [
      { name: "Zero", sellingPrice: 10, stock: 0, opening_stock: 0 },
      { name: "Omitted", sellingPrice: 10 },
    ]) {
      const res = response();
      await create({ body, user: { company_id: 4 } }, res);
      assert.equal(res.statusCode, 201);
    }
    const inserts = calls.filter(({ text }) => text.includes("INSERT INTO products"));
    assert.equal(inserts.length, 2);
    for (const insert of inserts) {
      assert.equal(insert.params[13], 0);
      assert.equal(insert.params[14], 0);
    }
    assert.equal(calls.some(({ text }) => text.includes("inventory_transactions")), false);
  } finally {
    db.query = originalQuery;
    delete require.cache[require.resolve("../routes/productRoutes")];
  }
});

test("product update SQL never assigns stock fields and its comparison is company scoped", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "routes", "productRoutes.js"), "utf8");
  const update = source.slice(source.indexOf("/* ================= UPDATE PRODUCT"), source.indexOf("/* ================= DELETE PRODUCT"));
  assert.match(update, /SELECT id,stock,opening_stock FROM products WHERE id=\? AND company_id=\?/);
  const updateSql = update.match(/`UPDATE products[\s\S]*?`/)[0];
  assert.doesNotMatch(updateSql, /\bstock\s*=/);
  assert.doesNotMatch(updateSql, /\bopening_stock\s*=/);
  assert.match(updateSql, /WHERE id=\? AND company_id=\?/);
  assert.ok(update.indexOf("assertUnchangedProductStock") < update.indexOf("`UPDATE products"));
});

test("safe product edit succeeds while a quantity change leaves every field untouched", async () => {
  const originalQuery = db.query;
  const calls = [];
  db.query = async (sql, params = []) => {
    const text = String(sql);
    calls.push({ text, params });
    if (text.includes("SHOW COLUMNS FROM products")) {
      return [["mrp", "sku", "barcode", "hsn", "category", "batch_no", "manufactured_date", "expiry_date", "unit", "gst", "purchase_price", "opening_stock", "reorder_level", "status"].map((Field) => ({ Field }))];
    }
    if (text.includes("SELECT id,stock,opening_stock")) return [[{ id: 8, stock: "12.50", opening_stock: "5.00" }]];
    if (text.includes("UPDATE products")) return [{ affectedRows: 1 }];
    throw new Error(`Unexpected SQL: ${text}`);
  };
  try {
    const { update } = getProductHandlers();
    const safe = response();
    await update({
      params: { id: "8" },
      body: { name: "Renamed", sellingPrice: 10, stock: 12.5, opening_stock: 5 },
      user: { company_id: 4 },
    }, safe);
    assert.equal(safe.statusCode, 200);
    const writesAfterSafe = calls.filter(({ text }) => text.includes("UPDATE products")).length;
    assert.equal(writesAfterSafe, 1);

    const blocked = response();
    await update({
      params: { id: "8" },
      body: { name: "Must Not Persist", sellingPrice: 99, stock: 0, opening_stock: 5 },
      user: { company_id: 4 },
    }, blocked);
    assert.equal(blocked.statusCode, 409);
    assert.equal(blocked.body.code, "PRODUCT_STOCK_DIRECT_UPDATE_RESTRICTED");
    assert.equal(calls.filter(({ text }) => text.includes("UPDATE products")).length, writesAfterSafe);
    for (const read of calls.filter(({ text }) => text.includes("SELECT id,stock,opening_stock"))) {
      assert.deepEqual(read.params, ["8", 4]);
    }
  } finally {
    db.query = originalQuery;
    delete require.cache[require.resolve("../routes/productRoutes")];
  }
});

test("unsafe product import rejects the complete batch before DB access", async () => {
  const original = db.getConnection;
  let accessed = false;
  db.getConnection = async () => { accessed = true; throw new Error("must not connect"); };
  try {
    const res = response();
    await importMasterData({
      params: { type: "products" },
      body: { rows: [{ Name: "Safe" }, { Name: "Unsafe", Stock: 5 }] },
      user: { company_id: 4 },
    }, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "PRODUCT_IMPORT_STOCK_RESTRICTED");
    assert.equal(accessed, false);
  } finally {
    db.getConnection = original;
  }
});

test("product import mapping cannot reset stock with blank or zero input", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "controllers", "backupController.js"), "utf8");
  const productMapping = source.slice(source.indexOf('if (config.table === "products")'), source.indexOf('} else if (config.table === "accounts")'));
  assert.match(productMapping, /delete mapped\.stock/);
  assert.match(productMapping, /delete mapped\.opening_stock/);
  assert.doesNotMatch(productMapping, /mapped\.stock\s*=/);
  assert.doesNotMatch(productMapping, /mapped\.opening_stock\s*=/);
});

test("FY-4D-1 continues to block product rollback", async () => {
  const original = db.getConnection;
  let began = false;
  const connection = {
    async beginTransaction() { began = true; }, async rollback() {}, release() {},
    async query(sql) {
      const text = String(sql);
      if (text.includes("CREATE TABLE IF NOT EXISTS")) return [{}];
      if (text.includes("FROM data_import_batches")) return [[{ id: 7, company_id: 4, activity_type: "Import", status: "Completed" }]];
      if (text.includes("FROM data_import_changes")) return [[{ table_name: "products", record_id: 9, action: "updated" }]];
      throw new Error(`Unexpected SQL: ${text}`);
    },
  };
  db.getConnection = async () => connection;
  try {
    const res = response();
    await rollbackImport({ params: { id: "7" }, user: { company_id: 4 } }, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "IMPORT_ROLLBACK_FINANCIAL_HISTORY_RESTRICTED");
    assert.equal(began, false);
  } finally {
    db.getConnection = original;
  }
});
