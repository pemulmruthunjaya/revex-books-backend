const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const db = require("../db/connection");
const { importTransactions } = require("../controllers/backupController");

const blockedTypes = ["sales_invoices", "purchase_bills", "customer_payments", "vendor_payments"];

const response = () => ({
  statusCode: null,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

test("exactly the four incomplete operational accounting imports fail closed before DB access", async () => {
  const originalGetConnection = db.getConnection;
  let databaseAccessed = false;
  db.getConnection = async () => { databaseAccessed = true; throw new Error("must not access DB"); };
  try {
    for (const type of blockedTypes) {
      const res = response();
      await importTransactions({ params: { type }, body: { rows: [{ financial_year_id: 999 }] }, user: { company_id: 4 } }, res);
      assert.equal(res.statusCode, 409);
      assert.equal(res.body.code, "OPERATIONAL_IMPORT_ACCOUNTING_PATH_REQUIRED");
      assert.match(res.body.message, /temporarily unavailable.*accounting integrity.*controlled transaction workflow/i);
    }
    assert.equal(databaseAccessed, false);
  } finally {
    db.getConnection = originalGetConnection;
  }
});

test("invalid transaction types remain validation errors and unrelated backup/master routes stay mounted", async () => {
  const res = response();
  await importTransactions({ params: { type: "customers" }, body: {}, user: {} }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, "Invalid transaction import type");

  const routes = fs.readFileSync(path.join(__dirname, "..", "routes", "backupRoutes.js"), "utf8");
  assert.match(routes, /router\.post\("\/import\/:type", importMasterData\)/);
  assert.match(routes, /router\.get\("\/export", exportCompanyBackup\)/);
  assert.match(routes, /router\.post\("\/restore\/preview", previewRestoreBackup\)/);
});

test("blocked import gate precedes rows, date fallbacks, connection acquisition, and all transaction writes", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "controllers", "backupController.js"), "utf8");
  const handler = source.slice(source.indexOf("exports.importTransactions"), source.indexOf("exports.getDataHistory"));
  const gate = handler.indexOf("OPERATIONAL_IMPORT_ACCOUNTING_PATH_REQUIRED");
  assert.ok(gate > 0);
  assert.ok(gate < handler.indexOf("const rows"));
  assert.ok(gate < handler.indexOf("db.getConnection"));
  assert.ok(gate < handler.indexOf("importSalesInvoices"));
  assert.deepEqual([...handler.matchAll(/"(sales_invoices|purchase_bills|customer_payments|vendor_payments)"/g)].map((match) => match[1]).slice(0, 4), blockedTypes);
});
