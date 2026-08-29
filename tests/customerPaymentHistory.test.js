const assert = require("node:assert/strict");
const test = require("node:test");
const {
  PAYMENT_HISTORY_SQL,
  getCustomerPaymentHistory,
  normalizePaymentHistoryRow,
} = require("../services/customerFinancialService");

const customer = { id: 7, name: "Same Name" };
const receipt = (overrides = {}) => ({
  receipt_entry_id: 5,
  receipt_number: "RCPT-2026-000005",
  receipt_date: "2026-08-29",
  receipt_type: "CUSTOMER",
  amount: "27.20",
  payment_mode: "bank",
  received_in_account_id: 2,
  received_in_account_name: "Bank",
  received_in_account_code: "0002",
  reference_number: null,
  narration: "Customer receipt",
  allocation_count: 1,
  allocated_amount: "27.20",
  invoice_numbers: "INV-0020",
  unapplied_amount: "0.00",
  ...overrides,
});

const executorFor = (rows, foundCustomer = customer) => {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return calls.length === 1 ? [foundCustomer ? [foundCustomer] : []] : [rows];
    },
  };
};

test("single, partial and fully-settled receipt rows remain authoritative history", async () => {
  const executor = executorFor([
    receipt({ allocated_amount: "10.00", amount: "10.00" }),
    receipt({ receipt_entry_id: 6, amount: "47.20", allocated_amount: "47.20" }),
  ]);
  const result = await getCustomerPaymentHistory(4, 7, {}, executor);
  assert.equal(result.payments.length, 2);
  assert.equal(result.payments[0].allocated_amount, 10);
  assert.equal(result.payments[1].amount, 47.2);
});

test("multi-invoice receipt appears once with unique invoice numbers", () => {
  const result = normalizePaymentHistoryRow(receipt({
    allocation_count: 3,
    allocated_amount: "75.25",
    invoice_numbers: "INV-1||INV-2||INV-1",
  }));
  assert.equal(result.receipt_entry_id, 5);
  assert.equal(result.allocation_count, 3);
  assert.equal(result.allocated_amount, 75.25);
  assert.deepEqual(result.invoice_numbers, ["INV-1", "INV-2"]);
});

test("advance stays separate from allocations and exposes unapplied amount", () => {
  const result = normalizePaymentHistoryRow(receipt({
    receipt_type: "ADVANCE",
    amount: "100.00",
    allocation_count: 2,
    allocated_amount: "20.00",
    invoice_numbers: "INV-1||INV-2",
    unapplied_amount: "80.00",
  }));
  assert.equal(result.allocation_count, 0);
  assert.equal(result.allocated_amount, 0);
  assert.deepEqual(result.invoice_numbers, []);
  assert.equal(result.unapplied_amount, 80);
});

test("empty history is successful and pagination defaults to 10/0", async () => {
  const executor = executorFor([]);
  const result = await getCustomerPaymentHistory(4, 7, {}, executor);
  assert.deepEqual(result.payments, []);
  assert.deepEqual(result.pagination, { limit: 10, offset: 0 });
  assert.deepEqual(executor.calls[1].params, [4, 7, 10, 0]);
});

test("pagination is integer-normalized and capped at 50", async () => {
  const executor = executorFor([]);
  const result = await getCustomerPaymentHistory(4, 7, { limit: "500", offset: "12" }, executor);
  assert.deepEqual(result.pagination, { limit: 50, offset: 12 });
  assert.deepEqual(executor.calls[1].params, [4, 7, 50, 12]);
});

test("missing or wrong-company customer returns null before history query", async () => {
  const executor = executorFor([], null);
  assert.equal(await getCustomerPaymentHistory(4, 7, {}, executor), null);
  assert.equal(executor.calls.length, 1);
  assert.deepEqual(executor.calls[0].params, [7, 4]);
});

test("history SQL enforces authoritative tenant relationships and exclusions", () => {
  assert.match(PAYMENT_HISTORY_SQL, /re\.company_id = \?/);
  assert.match(PAYMENT_HISTORY_SQL, /re\.customer_id = \?/);
  assert.match(PAYMENT_HISTORY_SQL, /p\.receipt_entry_id = re\.id/);
  assert.match(PAYMENT_HISTORY_SQL, /p\.company_id = re\.company_id/);
  assert.match(PAYMENT_HISTORY_SQL, /i\.company_id = p\.company_id/);
  assert.match(PAYMENT_HISTORY_SQL, /received_in\.company_id = re\.company_id/);
  assert.match(PAYMENT_HISTORY_SQL, /advance_totals\.company_id = re\.company_id/);
  assert.match(PAYMENT_HISTORY_SQL, /receipt_type IN \('CUSTOMER', 'ADVANCE'\)/);
  assert.match(PAYMENT_HISTORY_SQL, /GROUP BY/);
  assert.match(PAYMENT_HISTORY_SQL, /ORDER BY re\.receipt_date DESC, re\.id DESC/);
  assert.doesNotMatch(PAYMENT_HISTORY_SQL, /customer_name/i);
  assert.doesNotMatch(PAYMENT_HISTORY_SQL, /payment_status/i);
  assert.doesNotMatch(PAYMENT_HISTORY_SQL, /narration LIKE/i);
});

test("OTHER and unlinked legacy payments cannot enter the grouped history", () => {
  assert.match(PAYMENT_HISTORY_SQL, /receipt_type IN \('CUSTOMER', 'ADVANCE'\)/);
  assert.match(PAYMENT_HISTORY_SQL, /p\.receipt_entry_id = re\.id/);
  assert.doesNotMatch(PAYMENT_HISTORY_SQL, /receipt_type.*OTHER/);
});
