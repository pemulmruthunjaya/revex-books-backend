const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { previewNextInvoiceNumber } = require("../controllers/invoiceController");

const executorFor = ({ prefix = "INV", current = 20, maximum = 19, missing = false } = {}) => ({
  queries: [],
  async query(sql, params) {
    this.queries.push({ sql, params });
    if (/FROM invoice_settings/.test(sql)) return [missing ? [] : [{ prefix, current_number: current }]];
    if (/SELECT MAX/.test(sql)) return [[{ max_number: maximum }]];
    throw new Error(`Unexpected query: ${sql}`);
  },
});

test("preview uses company sequence and does not mutate or reserve it", async () => {
  const executor = executorFor();
  assert.equal(await previewNextInvoiceNumber(4, executor), "INV-0020");
  assert.equal(await previewNextInvoiceNumber(4, executor), "INV-0020");
  assert.ok(executor.queries.every(({ params }) => params[0] === 4));
  assert.ok(executor.queries.every(({ sql }) => /^SELECT/.test(sql.trim())));
  assert.ok(executor.queries.every(({ sql }) => !/FOR UPDATE|INSERT|UPDATE|DELETE/i.test(sql)));
});

test("preview reconciles settings with existing numbers per tenant", async () => {
  const firstCompany = executorFor({ prefix: "SI", current: 7, maximum: 12 });
  const secondCompany = executorFor({ prefix: "BILL", current: 42, maximum: 8 });
  assert.equal(await previewNextInvoiceNumber(4, firstCompany), "SI-0013");
  assert.equal(await previewNextInvoiceNumber(8, secondCompany), "BILL-0042");
  assert.equal(firstCompany.queries[0].params[0], 4);
  assert.equal(secondCompany.queries[0].params[0], 8);
});

test("missing settings follows the existing INV default without creating settings", async () => {
  const executor = executorFor({ missing: true, maximum: 3 });
  assert.equal(await previewNextInvoiceNumber(5, executor), "INV-0004");
  assert.equal(executor.queries.length, 2);
});

test("route is authenticated, ordered before /:id, and handler trusts only req.user company", () => {
  const routes = fs.readFileSync(path.join(__dirname, "../routes/invoiceRoutes.js"), "utf8");
  const controller = fs.readFileSync(path.join(__dirname, "../controllers/invoiceController.js"), "utf8");
  assert.match(routes, /router\.get\("\/next-number", authMiddleware/);
  assert.ok(routes.indexOf('"/next-number"') < routes.indexOf('"/:id"'));
  const start = controller.indexOf("exports.getNextInvoiceNumber");
  const handler = controller.slice(start, start + 700);
  assert.match(handler, /req\.user\.company_id/);
  assert.doesNotMatch(handler, /req\.(body|query)\.company_id/);
});
