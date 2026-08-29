const assert = require("node:assert/strict");
const test = require("node:test");
const {
  loadReceiptEntryDetail,
  normalizeAllocation,
} = require("../controllers/receiptEntryController");

const header = (overrides = {}) => ({
  id: 5,
  receipt_no: "RCPT-2026-000005",
  receipt_date: "2026-08-29 00:00:00",
  receipt_type: "CUSTOMER",
  amount: "75.20",
  payment_mode: "bank",
  reference_number: "UTR-1",
  narration: "Customer receipt",
  customer_id: 7,
  invoice_id: null,
  journal_entry_id: 12,
  received_in_account_name: "Bank",
  received_in_account_code: "0002",
  received_from_account_name: "Accounts Receivable",
  received_from_account_code: "1100",
  customer_name: "Customer",
  invoice_number: null,
  advance_original_amount: null,
  advance_unapplied_amount: null,
  advance_status: null,
  ...overrides,
});

const allocation = (id, invoiceId, number, date, amount) => ({
  payment_id: id,
  invoice_id: invoiceId,
  invoice_number: number,
  invoice_date: date,
  invoice_total: "100.00",
  allocation_amount: amount,
});

const executorFor = (receiptRows, allocationRows = []) => {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return calls.length === 1 ? [receiptRows] : [allocationRows];
    },
  };
};

test("single allocation preserves existing header fields and stable dates", async () => {
  const executor = executorFor([header()], [allocation(9, 20, "INV-20", "2026-08-28", "27.20")]);
  const result = await loadReceiptEntryDetail(5, 4, executor);
  assert.equal(result.receipt_no, "RCPT-2026-000005");
  assert.equal(result.customer_name, "Customer");
  assert.equal(result.received_in_account_name, "Bank");
  assert.equal(result.receipt_date, "2026-08-29");
  assert.equal(result.allocations[0].invoice_date, "2026-08-28");
  assert.equal(result.allocations[0].allocation_amount, 27.2);
});

test("all multi-invoice allocations are returned in query order", async () => {
  const rows = [
    allocation(9, 20, "INV-20", new Date(2026, 7, 28), "25.20"),
    allocation(10, 21, "INV-21", new Date(2026, 7, 29), "50.00"),
  ];
  const result = await loadReceiptEntryDetail(5, 4, executorFor([header()], rows));
  assert.deepEqual(result.allocations.map((row) => row.invoice_number), ["INV-20", "INV-21"]);
  assert.deepEqual(result.allocations.map((row) => row.invoice_date), ["2026-08-28", "2026-08-29"]);
});

test("advance returns empty allocations while preserving real advance fields", async () => {
  const result = await loadReceiptEntryDetail(
    6,
    4,
    executorFor([header({
      id: 6,
      receipt_type: "ADVANCE",
      advance_original_amount: "100.00",
      advance_unapplied_amount: "80.00",
      advance_status: "PARTIALLY_APPLIED",
    })], [])
  );
  assert.deepEqual(result.allocations, []);
  assert.equal(result.advance_unapplied_amount, "80.00");
});

test("wrong-company or nonexistent receipt returns null without allocation lookup", async () => {
  const executor = executorFor([]);
  assert.equal(await loadReceiptEntryDetail(5, 99, executor), null);
  assert.equal(executor.calls.length, 1);
  assert.deepEqual(executor.calls[0].params, [5, 99]);
});

test("receipt and allocation joins remain company scoped", async () => {
  const executor = executorFor([header()], []);
  await loadReceiptEntryDetail(5, 4, executor);
  assert.match(executor.calls[0].sql, /re\.id = \? AND re\.company_id = \?/);
  assert.match(executor.calls[0].sql, /received_in\.company_id = re\.company_id/);
  assert.match(executor.calls[0].sql, /c\.company_id = re\.company_id/);
  assert.match(executor.calls[0].sql, /advance_totals\.company_id = re\.company_id/);
  assert.match(executor.calls[1].sql, /i\.company_id = p\.company_id/);
  assert.match(executor.calls[1].sql, /p\.receipt_entry_id = \?/);
  assert.match(executor.calls[1].sql, /p\.company_id = \?/);
  assert.deepEqual(executor.calls[1].params, [5, 4]);
});

test("allocation normalization uses numeric money and date-only output", () => {
  assert.deepEqual(normalizeAllocation(allocation(1, 2, "INV-2", "2026-08-29T00:00:00.000Z", "12.34")), {
    payment_id: 1,
    invoice_id: 2,
    invoice_number: "INV-2",
    invoice_date: "2026-08-29",
    invoice_total: 100,
    allocation_amount: 12.34,
  });
});
