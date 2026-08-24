const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  calculateInvoiceLevelTotals,
  normalizeAdvancedItem,
} = require("../controllers/invoiceController");
const { DEFAULTS, validateCustomization } = require("../services/invoiceSettingsService");

test("sales settings defaults and validation include every Phase 1 preference", () => {
  const settings = validateCustomization({});
  for (const key of ["barcodeScan", "defaultUnit", "partyWiseItemRate", "description", "itemWiseDiscount", "overallBillDiscount", "additionalDiscount", "roundOff", "itemWiseTax", "mrp", "serialImei", "batchNo", "mfgDate", "expDate"]) {
    assert.ok(Object.hasOwn(settings, key), `missing ${key}`);
    assert.ok(Object.hasOwn(DEFAULTS, key), `missing default ${key}`);
  }
  assert.throws(() => validateCustomization({ defaultUnit: "x".repeat(31) }), /Default unit/);
});

test("invoice calculation applies item result, overall, additional, then round off", () => {
  const result = calculateInvoiceLevelTotals({
    subtotal: 1000,
    itemDiscount: 100,
    tax: 162,
    body: {
      overall_discount_type: "percent", overall_discount_value: 10,
      additional_discount_type: "amount", additional_discount_value: 50,
      round_off_amount: -0.8,
    },
  });
  assert.equal(result.overall.amount, 106.2);
  assert.equal(result.additional.amount, 50);
  assert.equal(result.total, 905);
});

test("advanced item validation preserves values and enforces serial/date safety", () => {
  const item = normalizeAdvancedItem({
    description: "snapshot", unit: "PCS", serial_numbers: ["A", "B"],
    batch_no: "LOT-1", manufactured_date: "2026-01-01", expiry_date: "2027-01-01",
  }, 2);
  assert.deepEqual(item.serials, ["A", "B"]);
  assert.equal(item.batchNo, "LOT-1");
  assert.throws(() => normalizeAdvancedItem({ serial_numbers: ["A", "B"] }, 1), /cannot exceed/);
  assert.throws(() => normalizeAdvancedItem({ manufactured_date: "2027-01-01", expiry_date: "2026-01-01" }, 1), /cannot precede/);
});

test("party rate query is company/customer/product scoped and does not use item names", () => {
  const source = fs.readFileSync(path.join(__dirname, "../controllers/invoiceController.js"), "utf8");
  const start = source.indexOf("exports.getPartyItemRate");
  const handler = source.slice(start, start + 2200);
  assert.match(handler, /ii\.company_id=\?/);
  assert.match(handler, /i\.customer_id=\?/);
  assert.match(handler, /ii\.product_id=\?/);
  assert.doesNotMatch(handler, /item_name\s*=/);
});

test("migration is idempotent and intentionally has no product foreign key or backfill", () => {
  const sql = fs.readFileSync(path.join(__dirname, "../db/migrations/2026-08-24-sales-invoice-advanced-fields.sql"), "utf8");
  assert.match(sql, /information_schema\.COLUMNS/);
  assert.match(sql, /idx_invoice_items_company_product \(company_id, product_id\)/);
  assert.match(sql, /uq_invoice_settings_company/);
  assert.doesNotMatch(sql, /FOREIGN KEY\s*\(product_id\)/i);
  assert.doesNotMatch(sql, /UPDATE\s+invoice_items\s+SET\s+product_id/i);
});
