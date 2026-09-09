"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("all Bill creation paths require centralized posting permission before financial writes", () => {
  const bill = source("controllers/billController.js");
  const po = source("controllers/purchaseOrderController.js");
  const grn = source("controllers/goodsReceiptController.js");
  assert.equal((bill.match(/requireFinancialYearForPosting/g) || []).length, 4);
  assert.match(po.slice(po.indexOf("exports.convertPurchaseOrderToBill")), /requireFinancialYearForPosting[\s\S]*INSERT INTO bills/);
  const grnBill = grn.slice(grn.indexOf("exports.createBill ="));
  assert.ok(grnBill.indexOf("requireFinancialYearForPosting") < grnBill.indexOf("FROM goods_receipts"));
  assert.ok(grnBill.indexOf("requireFinancialYearForPosting") < grnBill.indexOf("INSERT INTO bills"));
});

test("Bill edit validates persisted source before destination and delete is atomic", () => {
  const text = source("controllers/billController.js");
  const edit = text.slice(text.indexOf("exports.updateBill ="), text.indexOf("exports.updateBillStatus"));
  assert.ok(edit.indexOf("financial_year_id") < edit.indexOf("requireFinancialYearForMutation"));
  assert.ok(edit.indexOf("requireFinancialYearForMutation") < edit.indexOf("requireFinancialYearForPosting"));
  assert.match(edit, /SET vendor_id[\s\S]*financial_year_id = \?/);
  const remove = text.slice(text.indexOf("exports.deleteBill ="), text.indexOf("exports.getLastPurchasePrices"));
  assert.match(remove, /beginTransaction[\s\S]*FOR UPDATE[\s\S]*requireFinancialYearForMutation[\s\S]*DELETE FROM bills[\s\S]*commit/);
});

test("Bill items have no independent mutation route and remain contained by Bill transactions", () => {
  const routes = source("routes/billRoutes.js");
  assert.doesNotMatch(routes, /bill-items|items\/:/);
  const bill = source("controllers/billController.js");
  assert.match(bill, /connection\.query\("DELETE FROM bill_items/);
  assert.match(bill, /INSERT INTO bill_items/);
});

test("vendor payment checks posting FY and persisted Bill FY before any payment insert", () => {
  const payment = source("services/vendorPaymentService.js");
  const body = payment.slice(payment.indexOf("const recordVendorPayment"));
  assert.ok(body.indexOf("requireFinancialYearForPosting") < body.indexOf("FROM bills"));
  assert.match(body, /b\.financial_year_id[\s\S]*LIMIT 1 FOR UPDATE/);
  assert.ok(body.indexOf("requireFinancialYearForMutation") < body.indexOf("INSERT INTO vendor_payments"));
  assert.ok(body.indexOf("INSERT INTO vendor_payments") < body.indexOf("INSERT INTO journal_entries"));
  assert.ok(body.indexOf("INSERT INTO journal_entries") < body.indexOf("INSERT INTO ledger_entries"));
  assert.ok(body.indexOf("INSERT INTO ledger_entries") < body.indexOf("UPDATE bills SET paid_amount"));
});

test("purchase enforcement retains server-authoritative FY and company scoping", () => {
  for (const file of ["controllers/billController.js", "controllers/purchaseOrderController.js", "controllers/goodsReceiptController.js", "services/vendorPaymentService.js"]) {
    const text = source(file);
    assert.match(text, /rejectClientFinancialYear/);
    assert.match(text, /company_id/);
    assert.match(text, /financial_year_id/);
  }
});
