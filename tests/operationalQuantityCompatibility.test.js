"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), vm = require("node:vm"), fs = require("node:fs");
const math = require("../services/inventoryValuationMath");
function controller() {
  const exports = {};
  const mocks = {
    "../db/connection": {}, "../utils/errorResponse": {}, "../services/receiptEntryService": {}, "../services/salesInvoiceAccountingService": {},
    "../services/financialYearService": { rejectClientFinancialYear() {}, requireFinancialYearForPosting: async () => ({ id: 1 }) },
    "../services/inventoryGlService": { transaction: async () => {}, preflightSale: async () => true },
    "../services/reportSchemaService": { assertReportSchemaReady: async () => {} }, "../services/inventoryValuationMath": math,
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("../controllers/invoiceController"), "utf8"), { exports, require: name => {
    if (name === "node:crypto") return require(name);
    assert.ok(Object.hasOwn(mocks, name), `Unexpected dependency ${name}`); return mocks[name];
  } });
  return exports;
}
test("DECIMAL text stock is compared numerically in the actual invoice create path", async () => {
  for (const [stock, quantity, accepted] of [["10.00", "2.00", true], ["2.00", "10.00", false], ["1.20", "1.2", true], ["0.09", "0.10", false], ["0.30", "0.20", true], [10, 2, true]]) {
    const writes = [];
    const connection = { async query(sql) {
      if (sql.includes("FROM invoice_settings")) return [[{ prefix: "INV", current_number: 1 }]];
      if (sql.includes("SELECT MAX")) return [[{ max_number: 0 }]];
      if (sql.startsWith("UPDATE invoice_settings")) return [{ affectedRows: 1 }];
      if (sql.includes("FROM products")) return [[{ id: 1, name: "Synthetic", stock }]];
      if (sql.includes("INSERT INTO invoices")) { writes.push(sql); throw Error("STOCK_CHECK_PASSED"); }
      throw Error("Unexpected mock query");
    } };
    await assert.rejects(controller().createInvoiceRecord({ body: { invoice_type: "Cash", invoice_date: "2026-10-12", items: [{ product_id: 1, name: "Synthetic", quantity, unit_price: "1", gst_rate: "0" }] }, user: { company_id: 1, user_id: 1 }, connection }), accepted ? /STOCK_CHECK_PASSED/ : /Insufficient stock/);
    assert.equal(writes.length, accepted ? 1 : 0);
  }
});
test("bill/GRN quantities retain Q2/Q6 exactness with mysql2 DECIMAL strings", () => {
  const received = math.operationalQuantity("10.25"), billed = math.operationalQuantity("2.10"), remainder = math.operationalQuantity("8.15");
  assert.equal(received.q2 - billed.q2, remainder.q2);
  assert.equal(received.q6 - billed.q6, remainder.q6);
  assert.equal(received.q2 * 10000n, received.q6);
  assert.equal(math.billAmounts("1.25", "100", "0").quantity, "1.25");
});
