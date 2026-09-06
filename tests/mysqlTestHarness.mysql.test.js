const assert = require("node:assert/strict");
const test = require("node:test");
const db = require("../db/connection");
const { createHarness, routeSharedDbToPool } = require("./helpers/mysqlTestHarness");
const { applyRuntimeFixture } = require("./helpers/runtimeFixture");

test("actual Expense controller routes through disposable local MySQL", { skip: process.env.REVEX_FY_HARNESS_INTEGRATION !== "1", timeout: 60000 }, async (t) => {
  const harness = await createHarness();
  t.after(async () => harness.close());
  await applyRuntimeFixture(harness);
  const restore = routeSharedDbToPool(db, harness.pool);
  t.after(restore);
  delete require.cache[require.resolve("../controllers/expenseController")];
  const { createExpense } = require("../controllers/expenseController");
  let response;
  await createExpense({ user: { company_id: 301 }, body: { title: "Synthetic Expense", category: "Test", amount: 25, expense_date: "2026-08-12", notes: "Synthetic only" } }, {
    status(code) { return { json(body) { response = { code, body }; } }; },
  });
  assert.equal(response.code, 201);
  const [rows] = await harness.pool.query("SELECT id,company_id,financial_year_id,title FROM expenses");
  const [fy] = await harness.pool.query("SELECT id FROM financial_years WHERE company_id=301 AND code='FY2026-27'");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].company_id, 301);
  assert.equal(Number(rows[0].financial_year_id), Number(fy[0].id));

  const [columns] = await harness.pool.query("SELECT COUNT(*) count FROM information_schema.columns WHERE table_schema=? AND column_name='financial_year_id' AND column_type='bigint unsigned' AND is_nullable='YES'", [harness.database]);
  const [tables] = await harness.pool.query("SELECT table_name AS name FROM information_schema.tables WHERE table_schema=? ORDER BY table_name", [harness.database]);
  const [indexes] = await harness.pool.query("SELECT COUNT(DISTINCT table_name,index_name) count FROM information_schema.statistics WHERE table_schema=? AND index_name LIKE 'idx\\_%\\_company\\_fy'", [harness.database]);
  const [fks] = await harness.pool.query("SELECT COUNT(*) count FROM information_schema.referential_constraints WHERE constraint_schema=? AND constraint_name LIKE 'fk\\_%\\_company\\_fy'", [harness.database]);
  assert.equal(columns[0].count, 7);
  assert.deepEqual(tables.map(({ name }) => name), [
    "accounts", "bill_items", "bills", "companies", "customers", "expenses",
    "financial_year_events", "financial_years", "invoice_items", "invoice_settings",
    "invoices", "journal_entries", "journal_entry_details", "ledger_entries",
    "payments", "products", "receipt_entries", "user_company_memberships", "users",
    "vendor_payments", "vendors",
  ]);
  assert.equal(indexes[0].count, 7);
  assert.equal(fks[0].count, 7);

  const [otherFy] = await harness.pool.query("SELECT id FROM financial_years WHERE company_id=302 LIMIT 1");
  await assert.rejects(harness.pool.query("UPDATE expenses SET financial_year_id=? WHERE id=? AND company_id=301", [otherFy[0].id, rows[0].id]), /foreign key constraint fails/i);
});
