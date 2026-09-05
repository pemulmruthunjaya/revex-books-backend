const assert = require("assert");
const db = require("../db/connection");

const run = async () => {
  const originalQuery = db.query;
  const originalGetConnection = db.getConnection;
  const calls = [];

  db.query = async (sql) => {
    if (sql.includes("information_schema.COLUMNS")) return [[{ present: 1 }]];
    if (sql.includes("information_schema.STATISTICS")) return [[{ present: 1 }]];
    if (sql.includes("UPDATE bills b")) return [{ affectedRows: 0 }];
    throw new Error(`Unexpected pool query: ${sql}`);
  };

  const connection = {
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql.includes("FROM financial_years")) return [[{ id: 2026, company_id: 2, code: "FY26", name: "FY 2026", start_date: "2026-04-01", end_date: "2027-03-31", status: "OPEN", is_default: 1, source: "MANUAL", created_by: 3 }]];
      if (sql.includes("SELECT id,journal_entry_id FROM vendor_payments")) return [[]];
      if (sql.includes("FROM bills b INNER JOIN vendors")) {
        return [[{ id: 13, vendor_id: 7, bill_number: "BILL-0013", total_amount: 784, vendor_name: "PKD Traders" }]];
      }
      if (sql.includes("COALESCE(SUM(amount),0) paid")) return [[{ paid: 0 }]];
      if (sql.includes("FROM accounts a LEFT JOIN accounts p")) {
        return [[{ id: 4, account_name: "Bank", account_type: "ASSET", parent_account_name: "Bank Accounts" }]];
      }
      if (sql.includes("REGEXP 'accounts payable")) {
        return [[{ id: 9, account_name: "Accounts Payable", account_type: "LIABILITY" }]];
      }
      if (sql.includes("INSERT INTO vendor_payments")) return [{ insertId: 21 }];
      if (sql.includes("INSERT INTO journal_entries")) return [{ insertId: 34 }];
      return [{ affectedRows: 1 }];
    },
  };
  db.getConnection = async () => connection;

  delete require.cache[require.resolve("../services/vendorPaymentService")];
  const { calculatePaymentState, recordVendorPayment } = require("../services/vendorPaymentService");

  assert.deepStrictEqual(calculatePaymentState(1000, 0, 0), {
    paidAmount: 0,
    dueAmount: 1000,
    status: "Unpaid",
  });
  assert.deepStrictEqual(calculatePaymentState(1000, 0, 250), {
    paidAmount: 250,
    dueAmount: 750,
    status: "Partial Paid",
  });
  assert.deepStrictEqual(calculatePaymentState(1000, 250, 750), {
    paidAmount: 1000,
    dueAmount: 0,
    status: "Paid",
  });

  const result = await recordVendorPayment({
    vendor_id: 7,
    bill_id: 13,
    amount: 784,
    payment_date: "2026-08-01",
    payment_method: "Bank Transfer",
    paid_from_account_id: 4,
    reference_number: "552655525",
    idempotency_key: "vendor-payment-test-1",
  }, { company_id: 2, user_id: 3 });

  assert.strictEqual(result.status, "Paid");
  const journalCall = calls.find(({ sql }) => sql.includes("INSERT INTO journal_entries"));
  assert(journalCall, "journal entry should be inserted");
  assert(!journalCall.sql.includes("created_by"), "journal insert must match the existing schema");
  assert(!journalCall.sql.includes("status"), "journal insert must not require a status column");
  assert.strictEqual(journalCall.params.length, 9);
  assert.strictEqual(journalCall.params[6], 2026);
  const paymentCall = calls.find(({ sql }) => sql.includes("INSERT INTO vendor_payments"));
  const ledgerCall = calls.find(({ sql }) => sql.includes("INSERT INTO ledger_entries"));
  assert.strictEqual(paymentCall.params[9], 2026);
  assert.strictEqual(ledgerCall.params[1], 2026);

  db.query = originalQuery;
  db.getConnection = originalGetConnection;
  console.log("Vendor payment service: state and transaction SQL checks passed");
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
