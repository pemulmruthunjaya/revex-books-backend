const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ADVANCE_BALANCE_SQL,
  ELIGIBLE_INVOICES_SQL,
  buildFinancialSummary,
  getCustomerFinancialSummary,
  normalizeDateOnly,
} = require("../services/customerFinancialService");

const customer = { id: 7, name: "Same Name", credit_period_days: 30, credit_limit: "1000.00" };
const invoice = (overrides = {}) => ({
  invoice_id: 1,
  invoice_number: "INV-1",
  invoice_type: "CREDIT",
  invoice_date: "2026-08-01",
  due_date: "2026-08-31",
  total_amount: "47.20",
  paid_amount: "0.00",
  overdue_days: 0,
  ...overrides,
});

test("date-only normalization preserves mysql2 local calendar dates", () => {
  const result = buildFinancialSummary(customer, [invoice({
    invoice_date: new Date(2026, 7, 29),
    due_date: new Date(2026, 8, 5),
  })], 0);
  assert.equal(result.outstanding_invoices[0].invoice_date, "2026-08-29");
  assert.equal(result.outstanding_invoices[0].due_date, "2026-09-05");
  assert.doesNotMatch(result.outstanding_invoices[0].invoice_date, /T/);
  assert.doesNotMatch(result.outstanding_invoices[0].due_date, /T/);
});

test("date-only normalization preserves strings, datetime calendar portions, padding, and null", () => {
  assert.equal(normalizeDateOnly("2026-08-29"), "2026-08-29");
  assert.equal(normalizeDateOnly("2026-08-29 13:45:00"), "2026-08-29");
  assert.equal(normalizeDateOnly("2026-08-29T13:45:00.000Z"), "2026-08-29");
  assert.equal(normalizeDateOnly(new Date(2026, 0, 5)), "2026-01-05");
  assert.equal(normalizeDateOnly(null), null);
  assert.equal(normalizeDateOnly(undefined), null);
  const result = buildFinancialSummary(customer, [invoice({ due_date: null })], 0);
  assert.equal(result.outstanding_invoices[0].due_date, null);
});

test("no invoices returns exact zero summary and keeps advance separate", () => {
  const result = buildFinancialSummary(customer, [], "25.50");
  assert.deepEqual(result.summary, {
    total_invoiced: 0,
    total_received: 0,
    total_outstanding: 0,
    outstanding_invoice_count: 0,
    overdue_amount: 0,
    overdue_invoice_count: 0,
    unapplied_advance_balance: 25.5,
  });
  assert.deepEqual(result.outstanding_invoices, []);
});

test("unpaid, partial, paid, decimal and overpayment calculations use actual payments", () => {
  const result = buildFinancialSummary(customer, [
    invoice(),
    invoice({ invoice_id: 2, invoice_number: "INV-2", total_amount: "47.20", paid_amount: "20.00" }),
    invoice({ invoice_id: 3, invoice_number: "INV-3", total_amount: "10.00", paid_amount: "10.00" }),
    invoice({ invoice_id: 4, invoice_number: "INV-4", total_amount: "5.00", paid_amount: "7.00" }),
  ], 0);
  assert.deepEqual(result.summary, {
    total_invoiced: 109.4,
    total_received: 37,
    total_outstanding: 74.4,
    outstanding_invoice_count: 2,
    overdue_amount: 0,
    overdue_invoice_count: 0,
    unapplied_advance_balance: 0,
  });
  assert.deepEqual(result.outstanding_invoices.map((row) => [row.invoice_id, row.payment_status, row.outstanding_amount]), [
    [1, "UNPAID", 47.2],
    [2, "PARTIAL", 27.2],
  ]);
});

test("overdue, due today, future, and missing due dates are represented consistently", () => {
  const rows = [
    invoice({ invoice_id: 1, overdue_days: 4 }),
    invoice({ invoice_id: 2, overdue_days: 0 }),
    invoice({ invoice_id: 3, due_date: "2026-09-01", overdue_days: 0 }),
    invoice({ invoice_id: 4, due_date: null, overdue_days: null }),
  ];
  const result = buildFinancialSummary(customer, rows, 0);
  assert.equal(result.summary.overdue_invoice_count, 1);
  assert.equal(result.summary.overdue_amount, 47.2);
  assert.deepEqual(result.outstanding_invoices.map(({ is_overdue, overdue_days }) => [is_overdue, overdue_days]), [
    [true, 4], [false, 0], [false, 0], [false, null],
  ]);
});

test("service returns null for absent or cross-company customer without querying finance rows", async () => {
  const calls = [];
  const executor = { async query(sql, params) { calls.push({ sql, params }); return [[]]; } };
  assert.equal(await getCustomerFinancialSummary(4, 99, executor), null);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, [99, 4]);
});

test("service uses exactly three bounded company/customer queries", async () => {
  const calls = [];
  const executor = { async query(sql, params) {
    calls.push({ sql, params });
    if (calls.length === 1) return [[customer]];
    if (calls.length === 2) return [[invoice({ invoice_type: null })]];
    return [[{ unapplied_advance_balance: "12.34" }]];
  } };
  const result = await getCustomerFinancialSummary(4, 7, executor);
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1].params, [4, 4, 7]);
  assert.deepEqual(calls[2].params, [4, 7]);
  assert.equal(result.outstanding_invoices[0].invoice_type, null);
  assert.equal(result.summary.unapplied_advance_balance, 12.34);
});

test("SQL establishes ownership only by company/customer IDs and never receipt headers", () => {
  assert.match(ELIGIBLE_INVOICES_SQL, /i\.company_id = \?/);
  assert.match(ELIGIBLE_INVOICES_SQL, /i\.customer_id = \?/);
  assert.match(ELIGIBLE_INVOICES_SQL, /payments/);
  assert.match(ELIGIBLE_INVOICES_SQL, /payment_totals\.company_id = i\.company_id/);
  assert.match(ELIGIBLE_INVOICES_SQL, /payment_totals\.invoice_id = i\.id/);
  assert.match(ELIGIBLE_INVOICES_SQL, /invoice_type = 'CREDIT' OR i\.invoice_type IS NULL/);
  assert.match(ELIGIBLE_INVOICES_SQL, /<> 'cancelled'/);
  assert.doesNotMatch(ELIGIBLE_INVOICES_SQL, /customer_name/i);
  assert.doesNotMatch(ELIGIBLE_INVOICES_SQL, /receipt_entries/i);
  assert.doesNotMatch(ELIGIBLE_INVOICES_SQL, /payment_status/i);
  assert.match(ADVANCE_BALANCE_SQL, /status IN \('UNAPPLIED', 'PARTIALLY_APPLIED'\)/);
});

test("SQL ordering is deterministic and known due dates precede missing dates", () => {
  assert.match(ELIGIBLE_INVOICES_SQL, /CASE WHEN i\.due_date IS NULL THEN 1 ELSE 0 END/);
  assert.match(ELIGIBLE_INVOICES_SQL, /i\.due_date ASC/);
  assert.match(ELIGIBLE_INVOICES_SQL, /i\.invoice_date ASC/);
  assert.match(ELIGIBLE_INVOICES_SQL, /i\.id ASC/);
});
