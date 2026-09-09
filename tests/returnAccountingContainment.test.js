const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");

const controllerPath = require.resolve("../controllers/returnController");
const dbPath = require.resolve("../db/connection");

const loadController = () => {
  const queries = [];
  let connections = 0;
  const db = {
    getConnection: async () => {
      connections += 1;
      throw new Error("containment must reject before requesting a connection");
    },
    query: async (sql, params = []) => {
      queries.push([sql, params]);
      if (sql.includes("FROM product_returns r")) {
        return [[{
          id: 41,
          company_id: 8,
          type: "sales",
          return_number: "SRET-0041",
          return_date: "2026-08-12",
          total_amount: 118,
          item_count: 1,
          total_qty: 1,
        }]];
      }
      if (sql.includes("SELECT * FROM product_returns")) {
        return [[{ id: 41, company_id: 8, type: "sales", return_number: "SRET-0041" }]];
      }
      if (sql.includes("SELECT * FROM return_items")) {
        return [[{ id: 51, return_id: 41, company_id: 8, product_id: 9, quantity: 1 }]];
      }
      return [[]];
    },
  };
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    let resolved;
    try { resolved = Module._resolveFilename(request, parent); } catch { resolved = request; }
    if (resolved === dbPath) return db;
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[controllerPath];
  const controller = require(controllerPath);
  Module._load = originalLoad;
  return { controller, queries, connections: () => connections };
};

const request = (overrides = {}) => ({
  body: {},
  params: { id: "41" },
  query: {},
  user: { company_id: 8, user_id: 18 },
  ...overrides,
});

const response = () => ({
  statusCode: 200,
  payload: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.payload = payload; return this; },
});

for (const type of ["sales", "purchase"]) {
  test(`new ${type} Return is rejected before header, item, stock, inventory, or accounting writes`, async () => {
    const harness = loadController();
    const res = response();
    await harness.controller.createReturn(request({
      body: {
        type,
        return_date: "2026-08-12",
        financial_year_id: 14,
        items: [{ product_id: 9, quantity: 1, unit_price: 100, gst_rate: 18 }],
      },
    }), res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.payload.code, "RETURN_ACCOUNTING_WORKFLOW_REQUIRED");
    assert.equal(harness.connections(), 0);
    assert.deepEqual(harness.queries, []);
  });
}

test("historical Return deletion is rejected before lookup, stock reversal, or deletion", async () => {
  const harness = loadController();
  const res = response();
  await harness.controller.deleteReturn(request(), res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.payload.code, "RETURN_HISTORICAL_MUTATION_RESTRICTED");
  assert.equal(harness.connections(), 0);
  assert.deepEqual(harness.queries, []);
});

test("historical Return list and detail reads remain company scoped", async () => {
  const harness = loadController();
  let res = response();
  await harness.controller.getReturns(request(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload[0].id, 41);
  let query = harness.queries.find(([sql]) => sql.includes("FROM product_returns r"));
  assert.match(query[0], /WHERE r\.company_id = \?/);
  assert.equal(query[1][0], 8);

  res = response();
  await harness.controller.getReturnById(request(), res);
  assert.equal(res.payload.id, 41);
  query = harness.queries.find(([sql]) => sql.includes("SELECT * FROM product_returns"));
  assert.match(query[0], /id = \? AND company_id = \?/);
  assert.deepEqual(query[1], ["41", 8]);
});

test("source proves incomplete financial classification and preserves reporting reads", () => {
  const controller = fs.readFileSync(controllerPath, "utf8");
  const accounting = fs.readFileSync(require.resolve("../controllers/accountingSummary"), "utf8");
  const reports = fs.readFileSync(require.resolve("../controllers/reportController"), "utf8");
  assert.match(controller, /subtotal DECIMAL/);
  assert.match(controller, /tax_amount DECIMAL/);
  assert.match(controller, /total_amount DECIMAL/);
  assert.match(controller, /SET stock = stock \$\{type === "sales" \? "\+" : "-"\}/);
  assert.doesNotMatch(controller, /invoice_id|invoice_item_id|bill_id|bill_item_id/);
  assert.doesNotMatch(controller, /journal_entries|ledger_entries|receipt_entries|vendor_payments/);
  assert.match(accounting, /sales_return_total/);
  assert.match(reports, /Credit Notes \/ Sales Returns/);
});
