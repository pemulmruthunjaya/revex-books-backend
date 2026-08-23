const assert = require("node:assert/strict");
const test = require("node:test");
const { createPlatformPortalController, parsePage } = require("../controllers/platformPortalController");

const response = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const executor = (results) => ({ query: async (sql, params = []) => { const next = results.shift(); if (!next) throw new Error(`Unexpected query: ${sql}`); next.sql = sql; next.params = params; return [next.rows]; } });

test("pagination parser constrains invalid and oversized input", () => {
  assert.equal(parsePage("2"), 2);
  assert.equal(parsePage("invalid"), 1);
  assert.equal(parsePage("999"), 100);
});

test("dashboard returns real aggregation sections", async () => {
  const results = [
    { rows: [{ total_companies: 8, total_tenant_users: 9 }] },
    { rows: [{ active_subscriptions: 7, trialing: 1, expired: 0, suspended: 0, renewals_due_soon: 1 }] },
    { rows: [{ id: 8, name: "Recent" }] }, { rows: [] }, { rows: [] },
  ];
  const controller = createPlatformPortalController({ executor: executor(results), logger: { error() {} } });
  const res = response();
  await controller.dashboard({ query: {} }, res);
  assert.equal(res.body.kpis.total_companies, 8);
  assert.deepEqual(res.body.recent_subscription_activity, []);
});

test("companies list applies parameterized search and pagination", async () => {
  const results = [{ rows: [{ total: 1 }] }, { rows: [{ id: 4, name: "RevEx Development" }] }, { rows: [] }];
  const controller = createPlatformPortalController({ executor: executor(results), logger: { error() {} } });
  const res = response();
  await controller.companies({ query: { search: "RevEx", status: "active", page: "1" } }, res);
  assert.equal(res.body.data[0].id, 4);
  assert.equal(res.body.pagination.total, 1);
});

test("company detail rejects invalid IDs and reports missing company", async () => {
  const controller = createPlatformPortalController({ executor: executor([]), logger: { error() {} } });
  const invalid = response();
  await controller.companyDetail({ params: { companyId: "x" } }, invalid);
  assert.equal(invalid.statusCode, 400);

  const missingResults = [{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }];
  const missingController = createPlatformPortalController({ executor: executor(missingResults), logger: { error() {} } });
  const missing = response();
  await missingController.companyDetail({ params: { companyId: "999" } }, missing);
  assert.equal(missing.statusCode, 404);
});

test("subscriptions list returns plans and page metadata", async () => {
  const results = [{ rows: [{ total: 2 }] }, { rows: [{ id: 1 }, { id: 2 }] }, { rows: [{ id: 2, name: "Pro" }] }];
  const controller = createPlatformPortalController({ executor: executor(results), logger: { error() {} } });
  const res = response();
  await controller.subscriptions({ query: { status: "active", plan_id: "2" } }, res);
  assert.equal(res.body.data.length, 2);
  assert.equal(res.body.plans[0].name, "Pro");
});
