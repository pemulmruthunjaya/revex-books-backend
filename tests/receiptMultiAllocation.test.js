const assert = require("node:assert/strict");
const test = require("node:test");
const {
  assertIdempotentReceiptEquivalent,
  moneyToMinor,
  normalizeCustomerAllocations,
  paymentStatusFor,
  postReceipt,
} = require("../services/receiptEntryService");

const customerReceipt = (overrides = {}) => ({
  receipt_date: "2026-08-28",
  receipt_type: "CUSTOMER",
  customer_id: 1,
  received_in_account_id: 10,
  amount: "5000.00",
  payment_mode: "cash",
  reference_number: "REF-1",
  narration: "Multi allocation",
  idempotency_key: "multi-receipt-1",
  allocations: [
    { invoice_id: 22, amount: "3000.00" },
    { invoice_id: 11, amount: "2000.00" },
  ],
  ...overrides,
});

const makeConnection = ({ invoices, paidRows = [], failOnPayment = 0 } = {}) => {
  const calls = [];
  let paymentCount = 0;
  const connection = {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("FROM receipt_entries") && sql.includes("idempotency_key")) return [[]];
      if (sql.includes("SELECT a.*") && sql.includes("parent_account_name")) {
        return [[{ id: 10, account_name: "Cash in Hand", account_type: "ASSET", parent_account_name: "", description: "" }]];
      }
      if (sql.includes("FROM customers") && sql.includes("FOR UPDATE")) return [[{ id: 1, name: "Ramki" }]];
      if (sql.includes("FROM invoices") && sql.includes("ORDER BY id") && sql.includes("FOR UPDATE")) return [invoices];
      if (sql.includes("SELECT invoice_id, amount") && sql.includes("FROM payments")) return [paidRows];
      if (sql.includes("FROM accounts") && sql.includes("LOWER(account_name)")) {
        return [[{ id: 30, account_code: "1100", account_name: "Accounts Receivable", account_type: "ASSET" }]];
      }
      if (sql.includes("INSERT INTO receipt_entries")) return [{ insertId: 100 }];
      if (sql.includes("INSERT INTO journal_entries")) return [{ insertId: 200 }];
      if (sql.includes("INSERT INTO payments")) {
        paymentCount += 1;
        if (failOnPayment === paymentCount) throw new Error("forced allocation failure");
        return [{ insertId: 300 + paymentCount }];
      }
      return [{ affectedRows: 1 }];
    },
  };
  return connection;
};

const invoices = [
  { id: 11, invoice_number: "INV-11", total_amount: "2000.00", status: "pending", customer_id: 1, customer_name: "Ramki" },
  { id: 22, invoice_number: "INV-22", total_amount: "4000.00", status: "pending", customer_id: 1, customer_name: "Ramki" },
];

test("money normalization is exact to two decimal minor units", () => {
  assert.equal(moneyToMinor("47.20"), 4720);
  assert.equal(moneyToMinor(0.1), 10);
  assert.throws(() => moneyToMinor("1.001"), /two decimal/);
  assert.equal(paymentStatusFor("47.20", "47.20"), "PAID");
});

test("multi allocations are sorted, exact, positive, and reject duplicates", () => {
  const plan = normalizeCustomerAllocations(customerReceipt());
  assert.deepEqual(plan.allocations.map((row) => row.invoiceId), [11, 22]);
  assert.equal(plan.receiptMinor, 500000);
  assert.equal(plan.isMulti, true);
  assert.throws(() => normalizeCustomerAllocations(customerReceipt({ amount: 4999 })), /must equal/);
  assert.throws(() => normalizeCustomerAllocations(customerReceipt({ allocations: [{ invoice_id: 1, amount: 0 }] })), /greater than zero/);
  assert.throws(() => normalizeCustomerAllocations(customerReceipt({ allocations: [
    { invoice_id: 1, amount: 2500 }, { invoice_id: 1, amount: 2500 },
  ] })), /Duplicate/);
});

test("multi receipt writes one header, one journal, and one payment per invoice", async () => {
  const connection = makeConnection({ invoices });
  const result = await postReceipt(connection, customerReceipt(), { company_id: 4, user_id: 13 });
  assert.equal(result.allocations.length, 2);
  assert.equal(result.payment_id, null);
  assert.equal(result.invoice_status, null);
  assert.equal(connection.calls.filter(({ sql }) => sql.includes("INSERT INTO receipt_entries")).length, 1);
  assert.equal(connection.calls.filter(({ sql }) => sql.includes("INSERT INTO journal_entries")).length, 1);
  assert.equal(connection.calls.filter(({ sql }) => sql.includes("INSERT INTO payments")).length, 2);
  const lock = connection.calls.find(({ sql }) => sql.includes("FROM invoices") && sql.includes("FOR UPDATE"));
  assert.deepEqual(lock.params, [4, 11, 22]);
  const receipt = connection.calls.find(({ sql }) => sql.includes("INSERT INTO receipt_entries"));
  assert.equal(receipt.params[4], null);
  const receiptUpdate = connection.calls.find(({ sql }) => sql.includes("SET journal_entry_id"));
  assert.equal(receiptUpdate.params[1], null);
  assert.deepEqual(result.allocations.map(({ invoice_id, invoice_status }) => [invoice_id, invoice_status]), [
    [11, "PAID"], [22, "PARTIAL"],
  ]);
});

test("allocation validation rejects overpayment, wrong customer, and missing company invoice", async () => {
  await assert.rejects(
    postReceipt(makeConnection({ invoices, paidRows: [{ invoice_id: 11, amount: 100 }] }), customerReceipt(), { company_id: 4, user_id: 13 }),
    /cannot exceed outstanding/
  );
  const wrongCustomer = invoices.map((invoice) => ({ ...invoice, customer_id: 9, customer_name: "Other" }));
  await assert.rejects(
    postReceipt(makeConnection({ invoices: wrongCustomer }), customerReceipt(), { company_id: 4, user_id: 13 }),
    /does not belong/
  );
  await assert.rejects(
    postReceipt(makeConnection({ invoices: [invoices[0]] }), customerReceipt(), { company_id: 4, user_id: 13 }),
    /not found for this company/
  );
});

test("same idempotency key must represent the same header and allocations", async () => {
  const existing = {
    id: 100, receipt_date: "2026-08-28", receipt_type: "CUSTOMER", customer_id: 1,
    received_in_account_id: 10, amount: "5000.00", payment_mode: "cash",
    reference_number: "REF-1", narration: "Multi allocation",
  };
  const executor = { async query() { return [[{ invoice_id: 11, amount: "2000.00" }, { invoice_id: 22, amount: "3000.00" }]]; } };
  await assert.doesNotReject(assertIdempotentReceiptEquivalent(executor, existing, customerReceipt(), 4));
  await assert.rejects(
    assertIdempotentReceiptEquivalent(executor, existing, customerReceipt({ reference_number: "DIFFERENT" }), 4),
    (error) => error.code === "IDEMPOTENCY_KEY_REUSED" && error.status === 409
  );
});

test("forced failure during allocation propagates to the owning transaction", async () => {
  const connection = makeConnection({ invoices, failOnPayment: 2 });
  await assert.rejects(
    postReceipt(connection, customerReceipt(), { company_id: 4, user_id: 13 }),
    /forced allocation failure/
  );
  assert.equal(connection.calls.filter(({ sql }) => sql.includes("INSERT INTO receipt_entries")).length, 1);
  assert.equal(connection.calls.filter(({ sql }) => sql.includes("INSERT INTO journal_entries")).length, 1);
});
