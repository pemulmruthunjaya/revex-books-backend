"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const m = require("../services/inventoryValuationMath");
const v = require("../services/inventoryValuationService");

test("operational quantities preserve original decimal and exact Q2/Q6 equality", () => {
  for (const [input, sql] of [["1", "1.00"], ["1.2", "1.20"], ["1.20", "1.20"], ["1.23", "1.23"], ["0", "0.00"], ["99999999.99", "99999999.99"], ["1.230000", "1.23"]]) {
    const result = m.operationalQuantity(input);
    assert.equal(result.original, input);
    assert.equal(result.sql, sql);
    assert.equal(result.q2 * 10000n, result.q6);
    assert.equal(m.quantity(result.sql), m.quantity(input));
  }
  assert.equal(m.quantity("0.000001"), 1n, "pure valuation arithmetic remains Q6");
});
test("precision, notation, malformed quantities and overflow fail without rounding", () => {
  for (const input of ["1.000001", "1.234", "1e2", "1E-2", "+1", "-1", "-0", "01", " 1", "1.", ".1", "", null, undefined, NaN, Infinity, 1.23, -0, "100000000", "99999999.990001", "1.2300000"]) {
    assert.throws(() => m.operationalQuantity(input), { code: "INVENTORY_QUANTITY_PRECISION_UNSUPPORTED" });
  }
});
test("unsupported precision is rejected before even querying the executor", async () => {
  let calls = 0;
  const cx = { query() { calls++; throw new Error("must not query"); } };
  await assert.rejects(v.recordCost(cx, { evidence: { currency: "INR", state: "FINAL", reference: "test", reason: "test", quantity: "1.000001" } }), { code: "INVENTORY_QUANTITY_PRECISION_UNSUPPORTED" });
  await assert.rejects(v.postMovement(cx, { quantity: "1.234" }), { code: "INVENTORY_QUANTITY_PRECISION_UNSUPPORTED" });
  assert.equal(calls, 0);
});

test("bill arithmetic uses fixed-point rounding and rejects header overflow rather than relying on MySQL coercion", () => {
  assert.deepEqual(m.billAmounts("1.23", "10.00", "18"), { quantity: "1.23", price: "10.00", gst: "18.00", total: "14.51", cgst: "1.11", sgst: "1.10" });
  assert.throws(() => m.moneyDecimal(1000000000000n), /IV_DOCUMENT_AMOUNT_OVERFLOW/);
  assert.throws(() => m.billAmounts("99999999.99", "9999999999.99", "18"), /IV_DOCUMENT_AMOUNT_OVERFLOW/);
  assert.throws(() => m.replay([{ id: "a", kind: "RECEIPT", date: "2026-04-01", sequence: "1", source_line: "a", quantity: "1", total_minor: "999999999999999999999999999999" }, { id: "b", kind: "RECEIPT", date: "2026-04-01", sequence: "2", source_line: "b", quantity: "1", total_minor: "1" }]), /IV_VALUATION_OVERFLOW/);
});
