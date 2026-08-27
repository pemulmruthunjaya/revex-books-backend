const assert = require("node:assert/strict");
const db = require("../db/connection");

const originalQuery = db.query;
const calls = [];
const results = [
  [[{
    sales: "1000", purchases: "400", expenses: "100", receipts: "650",
    customer_payments: "600", vendor_payments: "250", receivables: "300", payables: "150",
    invoice_count: 3, bill_count: 2, customer_count: 8, vendor_count: 5,
  }]],
  [[{ period: "2026-08", sales: "1000", purchases: "400" }]],
  [[{ name: "Rent", value: "100" }]],
  [[{ balance_type: "cash", balance: "220" }, { balance_type: "bank", balance: "780" }]],
  [[{ id: 1, number: "INV-1", due_amount: "300", overdue_days: 4 }]],
  [[{ id: 2, number: null, party: null, due_amount: "150", overdue_days: 2 }]],
  [[{ activity_type: "Receipt", reference: "RCPT-1", amount: "650" }]],
];

db.query = async (sql, params) => {
  calls.push({ sql: String(sql), params });
  return results[calls.length - 1];
};

const { getDashboardData } = require("../controllers/dashboardController");

const responseFor = () => {
  let response;
  return {
    res: {
      status(code) {
        return { json(body) { response = { code, body }; } };
      },
    },
    read: () => response,
  };
};

const run = async () => {
  const success = responseFor();
  await getDashboardData(
    { user: { company_id: 42 }, query: { from_date: "2026-08-01", to_date: "2026-08-31" } },
    success.res
  );

  const response = success.read();
  assert.equal(response.code, 200);
  assert.equal(calls.length, 7);
  calls.forEach(({ sql, params }) => {
    assert.match(sql, /company_id\s*=\s*\?/i, "every dashboard query must be company scoped");
    assert.ok(params.includes(42), "every query must receive the authenticated company id");
  });
  assert.equal(response.body.data.kpis.net_operating, 500);
  assert.deepEqual(response.body.data.balances, { cash: 220, bank: 780 });
  assert.equal(response.body.data.sales_purchases[0].sales, 1000);
  assert.equal(response.body.data.overdue.invoice_basis_days, 30);
  assert.equal(response.body.data.overdue.bills[0].number, "Legacy Bill");
  assert.equal(response.body.data.overdue.bills[0].party, "Vendor unavailable");
  assert.deepEqual(response.body.data.range, { from_date: "2026-08-01", to_date: "2026-08-31" });

  const overdueBillQuery = calls[5].sql;
  assert.match(overdueBillQuery, /TRIM\(b\.bill_number\).*'Legacy Bill'/s, "bill number must use a clear legacy fallback");
  assert.match(overdueBillQuery, /TRIM\(v\.name\).*'Vendor unavailable'/s, "missing vendors need a clear label");

  const activityQuery = calls[6].sql;
  assert.match(activityQuery, /p\.receipt_entry_id IS NULL/, "linked receipt payments must be suppressed");
  assert.match(activityQuery, /NOT EXISTS[\s\S]*receipt_entries linked_receipt/, "linked receipt journals must be suppressed");
  assert.doesNotMatch(activityQuery, /je\.source_type\s*=\s*'manual'/, "standalone manual journals must remain visible");
  assert.match(
    activityQuery,
    /CONVERT\(re\.receipt_number USING utf8mb4\) COLLATE utf8mb4_0900_ai_ci/,
    "mixed-collation receipt references must be normalized in UNION output"
  );
  assert.match(
    activityQuery,
    /WHERE re\.company_id=\? AND re\.receipt_date BETWEEN \? AND \?/,
    "receipt filters must remain directly indexable"
  );

  const beforeInvalid = calls.length;
  const invalid = responseFor();
  await getDashboardData(
    { user: { company_id: 42 }, query: { from_date: "2026-09-01", to_date: "2026-08-01" } },
    invalid.res
  );
  assert.equal(invalid.read().code, 400);
  assert.equal(calls.length, beforeInvalid, "invalid ranges must not execute database queries");

  console.log("dashboard controller tests passed");
};

run()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { db.query = originalQuery; });
