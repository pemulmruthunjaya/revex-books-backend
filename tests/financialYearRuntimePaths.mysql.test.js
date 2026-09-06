const assert = require("node:assert/strict");
const test = require("node:test");
const db = require("../db/connection");
const { createHarness, routeSharedDbToPool } = require("./helpers/mysqlTestHarness");
const { applyRuntimeFixture } = require("./helpers/runtimeFixture");

const enabled = process.env.REVEX_FY_HARNESS_INTEGRATION === "1";
const user = { company_id: 301, user_id: 401 };

const response = () => {
  const state = {};
  return {
    state,
    api: {
      status(code) { state.status = code; return this; },
      json(body) { state.body = body; if (!state.status) state.status = 200; return this; },
    },
  };
};

const counts = async (pool) => {
  const names = ["invoices", "invoice_items", "payments", "receipt_entries", "bills", "bill_items", "vendor_payments", "expenses", "journal_entries", "journal_entry_details", "ledger_entries"];
  const result = {};
  for (const name of names) {
    const [[row]] = await pool.query(`SELECT COUNT(*) count FROM \`${name}\``);
    result[name] = Number(row.count);
  }
  const [[stock]] = await pool.query("SELECT stock FROM products WHERE id=701 AND company_id=301");
  result.stock = Number(stock.stock);
  return result;
};

test("complete FY-2B runtime matrix uses real disposable MySQL", { skip: !enabled, timeout: 120000 }, async (t) => {
  const harness = await createHarness();
  t.after(async () => harness.close());
  await applyRuntimeFixture(harness);
  const restore = routeSharedDbToPool(db, harness.pool);
  t.after(restore);

  for (const modulePath of ["../controllers/invoiceController", "../controllers/billController", "../controllers/expenseController", "../controllers/journalEntryController", "../services/receiptEntryService", "../services/vendorPaymentService"]) {
    delete require.cache[require.resolve(modulePath)];
  }
  const invoiceController = require("../controllers/invoiceController");
  const billController = require("../controllers/billController");
  const expenseController = require("../controllers/expenseController");
  const journalController = require("../controllers/journalEntryController");
  const { createReceipt } = require("../services/receiptEntryService");
  const { recordVendorPayment } = require("../services/vendorPaymentService");

  const [[currentFy]] = await harness.pool.query("SELECT id FROM financial_years WHERE company_id=301 AND code='FY2026-27'");
  const [[historicalFy]] = await harness.pool.query("SELECT id FROM financial_years WHERE company_id=301 AND code='FY2024-25'");
  const invoiceBody = (date, requestId) => ({
    request_id: requestId, invoice_date: date, invoice_type: "CREDIT", customer_id: 501,
    items: [{ product_id: 701, name: "Synthetic Product", quantity: 2, unit_price: 100, mrp: 150, gst_rate: 18 }],
  });
  const createInvoice = async (date, id) => {
    const out = response();
    await invoiceController.createInvoice({ user, body: invoiceBody(date, id) }, out.api);
    return out.state;
  };

  const current = await createInvoice("2026-08-12", "matrix-current");
  assert.equal(current.status, 201);
  const [[currentInvoice]] = await harness.pool.query("SELECT * FROM invoices WHERE id=?", [current.body.invoice_id]);
  assert.equal(Number(currentInvoice.financial_year_id), Number(currentFy.id));
  assert.equal(Number(currentInvoice.company_id), 301);
  const [[currentItems]] = await harness.pool.query("SELECT COUNT(*) count FROM invoice_items WHERE invoice_id=?", [currentInvoice.id]);
  assert.equal(Number(currentItems.count), 1);
  const [[salesJournal]] = await harness.pool.query("SELECT * FROM journal_entries WHERE source_type='sales_invoice' AND source_id=?", [currentInvoice.id]);
  assert.equal(Number(salesJournal.financial_year_id), Number(currentFy.id));
  const [[salesDetails]] = await harness.pool.query("SELECT COUNT(*) count FROM journal_entry_details WHERE journal_entry_id=?", [salesJournal.id]);
  assert.equal(Number(salesDetails.count), 3);

  const historical = await createInvoice("2024-08-12", "matrix-historical");
  assert.equal(historical.status, 201);
  const [[historicalInvoice]] = await harness.pool.query("SELECT * FROM invoices WHERE id=?", [historical.body.invoice_id]);
  assert.equal(Number(historicalInvoice.financial_year_id), Number(historicalFy.id));
  const [[historicalJournal]] = await harness.pool.query("SELECT financial_year_id FROM journal_entries WHERE source_type='sales_invoice' AND source_id=?", [historicalInvoice.id]);
  assert.equal(Number(historicalJournal.financial_year_id), Number(historicalFy.id));

  const beforeInvoiceGap = await counts(harness.pool);
  const gap = await createInvoice("2025-08-12", "matrix-gap");
  assert.equal(gap.status, 409);
  assert.equal(gap.body.code, "FINANCIAL_YEAR_NOT_FOUND_FOR_DATE");
  assert.deepEqual(await counts(harness.pool), beforeInvoiceGap);

  const receipt = await createReceipt({ receipt_date: "2026-08-13", receipt_type: "CUSTOMER", customer_id: 501, received_in_account_id: 801, amount: "50.00", payment_method: "cash", idempotency_key: "matrix-receipt", allocations: [{ invoice_id: currentInvoice.id, amount: "50.00" }] }, user);
  const [[payment]] = await harness.pool.query("SELECT * FROM payments WHERE id=?", [receipt.payment_id]);
  const [[receiptJournal]] = await harness.pool.query("SELECT * FROM journal_entries WHERE id=?", [receipt.journal_entry_id]);
  assert.equal(Number(payment.financial_year_id), Number(currentFy.id));
  assert.equal(Number(receiptJournal.financial_year_id), Number(currentFy.id));
  assert.equal(Number(payment.amount), 50);

  const beforeReceiptGap = await counts(harness.pool);
  await assert.rejects(createReceipt({ receipt_date: "2025-08-13", receipt_type: "CUSTOMER", customer_id: 501, received_in_account_id: 801, amount: "10.00", payment_method: "cash", idempotency_key: "matrix-receipt-gap", allocations: [{ invoice_id: currentInvoice.id, amount: "10.00" }] }, user), { status: 409, code: "FINANCIAL_YEAR_NOT_FOUND_FOR_DATE" });
  assert.deepEqual(await counts(harness.pool), beforeReceiptGap);

  const createBill = async (date, number) => {
    const out = response();
    await billController.createBill({ user, body: { vendor_id: 601, bill_number: number, bill_date: date, items: [{ product_id: 701, name: "Synthetic Product", qty: 3, price: 80, mrp: 150, gst: 18 }] } }, out.api);
    return out.state;
  };
  const beforeBill = await counts(harness.pool);
  const bill = await createBill("2026-08-14", "SYN-BILL-1");
  assert.equal(bill.status, 201);
  const [[billRow]] = await harness.pool.query("SELECT * FROM bills WHERE id=?", [bill.body.bill_id]);
  assert.equal(Number(billRow.financial_year_id), Number(currentFy.id));
  assert.equal((await counts(harness.pool)).stock, beforeBill.stock + 3);
  const beforeBillGap = await counts(harness.pool);
  const billGap = await createBill("2025-08-14", "SYN-BILL-GAP");
  assert.equal(billGap.status, 409);
  assert.deepEqual(await counts(harness.pool), beforeBillGap);

  const vendorPayment = await recordVendorPayment({ vendor_id: 601, bill_id: billRow.id, amount: 25, payment_date: "2026-08-15", payment_method: "Cash", paid_from_account_id: 801, idempotency_key: "matrix-vpay" }, user);
  const [[vp]] = await harness.pool.query("SELECT * FROM vendor_payments WHERE id=?", [vendorPayment.payment_id]);
  const [[vpJournal]] = await harness.pool.query("SELECT * FROM journal_entries WHERE id=?", [vendorPayment.journal_entry_id]);
  const [[vpLedger]] = await harness.pool.query("SELECT * FROM ledger_entries WHERE reference_type='vendor_payment' AND reference_id=?", [vp.id]);
  assert.equal(Number(vp.financial_year_id), Number(currentFy.id));
  assert.equal(Number(vpJournal.financial_year_id), Number(currentFy.id));
  assert.equal(Number(vpLedger.financial_year_id), Number(currentFy.id));
  const beforeVpGap = await counts(harness.pool);
  await assert.rejects(recordVendorPayment({ vendor_id: 601, bill_id: billRow.id, amount: 5, payment_date: "2025-08-15", payment_method: "Cash", paid_from_account_id: 801, idempotency_key: "matrix-vpay-gap" }, user), { status: 409, code: "FINANCIAL_YEAR_NOT_FOUND_FOR_DATE" });
  assert.deepEqual(await counts(harness.pool), beforeVpGap);

  const expense = response();
  await expenseController.createExpense({ user, body: { title: "Current expense", amount: 12, expense_date: "2026-08-16" } }, expense.api);
  assert.equal(expense.state.status, 201);
  const [[expenseRow]] = await harness.pool.query("SELECT financial_year_id FROM expenses WHERE id=?", [expense.state.body.expense_id]);
  assert.equal(Number(expenseRow.financial_year_id), Number(currentFy.id));
  const beforeExpenseGap = await counts(harness.pool);
  const expenseGap = response();
  await expenseController.createExpense({ user, body: { title: "Gap expense", amount: 12, expense_date: "2025-08-16" } }, expenseGap.api);
  assert.equal(expenseGap.state.status, 409);
  assert.deepEqual(await counts(harness.pool), beforeExpenseGap);

  const manual = response();
  await journalController.createJournalEntry({ user, body: { journal_date: "2026-08-17", narration: "Synthetic journal", entries: [{ account_id: 801, debit: 10, credit: 0 }, { account_id: 802, debit: 0, credit: 10 }] } }, manual.api);
  assert.equal(manual.state.status, 201);
  const [[manualRow]] = await harness.pool.query("SELECT financial_year_id FROM journal_entries WHERE id=?", [manual.state.body.journal_id]);
  assert.equal(Number(manualRow.financial_year_id), Number(currentFy.id));
  const [[manualDetails]] = await harness.pool.query("SELECT COUNT(*) count FROM journal_entry_details WHERE journal_entry_id=?", [manual.state.body.journal_id]);
  assert.equal(Number(manualDetails.count), 2);
  const beforeJournalFailure = await counts(harness.pool);
  const invalidJournal = response();
  await journalController.createJournalEntry({ user, body: { journal_date: "2026-08-18", narration: "Rollback journal", entries: [{ account_id: 801, debit: 10, credit: 0 }, { account_id: 999999, debit: 0, credit: 10 }] } }, invalidJournal.api);
  assert.equal(invalidJournal.state.status, 500);
  assert.deepEqual(await counts(harness.pool), beforeJournalFailure);

  await harness.pool.query("INSERT INTO expenses(title,amount,expense_date,company_id,financial_year_id) VALUES ('Legacy NULL',1,'2025-08-19',301,NULL)");
  const legacy = response();
  await expenseController.getExpenses({ user }, legacy.api);
  assert.ok(legacy.state.body.some((row) => row.title === "Legacy NULL" && row.financial_year_id === null));
  const [[legacyStored]] = await harness.pool.query("SELECT financial_year_id FROM expenses WHERE title='Legacy NULL'");
  assert.equal(legacyStored.financial_year_id, null);

  await assert.rejects(harness.pool.query("INSERT INTO financial_years(company_id,code,name,start_date,end_date,status,is_default) VALUES (301,'OVERLAP','Overlap','2026-06-01','2027-05-31','OPEN',0)"), /overlap/i);
  const [[otherFy]] = await harness.pool.query("SELECT id FROM financial_years WHERE company_id=302");
  await assert.rejects(harness.pool.query("UPDATE expenses SET financial_year_id=? WHERE id=? AND company_id=301", [otherFy.id, expense.state.body.expense_id]), /foreign key constraint fails/i);

  const orphanQueries = [
    "SELECT COUNT(*) count FROM invoice_items x LEFT JOIN invoices p ON p.id=x.invoice_id WHERE p.id IS NULL",
    "SELECT COUNT(*) count FROM bill_items x LEFT JOIN bills p ON p.id=x.bill_id WHERE p.id IS NULL",
    "SELECT COUNT(*) count FROM journal_entry_details x LEFT JOIN journal_entries p ON p.id=x.journal_entry_id WHERE p.id IS NULL",
    "SELECT COUNT(*) count FROM ledger_entries x LEFT JOIN vendor_payments p ON x.reference_type='vendor_payment' AND p.id=x.reference_id WHERE x.reference_type='vendor_payment' AND p.id IS NULL",
    "SELECT COUNT(*) count FROM receipt_entries r LEFT JOIN journal_entries j ON j.id=r.journal_entry_id LEFT JOIN payments p ON p.receipt_entry_id=r.id WHERE r.receipt_type='CUSTOMER' AND (j.id IS NULL OR p.id IS NULL)",
  ];
  for (const sql of orphanQueries) { const [[row]] = await harness.pool.query(sql); assert.equal(Number(row.count), 0); }
  const [[crossCompany]] = await harness.pool.query(`SELECT SUM(count) count FROM (
    SELECT COUNT(*) count FROM invoices x JOIN financial_years fy ON fy.id=x.financial_year_id WHERE x.company_id<>fy.company_id
    UNION ALL SELECT COUNT(*) FROM payments x JOIN financial_years fy ON fy.id=x.financial_year_id WHERE x.company_id<>fy.company_id
    UNION ALL SELECT COUNT(*) FROM bills x JOIN financial_years fy ON fy.id=x.financial_year_id WHERE x.company_id<>fy.company_id
    UNION ALL SELECT COUNT(*) FROM vendor_payments x JOIN financial_years fy ON fy.id=x.financial_year_id WHERE x.company_id<>fy.company_id
    UNION ALL SELECT COUNT(*) FROM ledger_entries x JOIN financial_years fy ON fy.id=x.financial_year_id WHERE x.company_id<>fy.company_id
    UNION ALL SELECT COUNT(*) FROM expenses x JOIN financial_years fy ON fy.id=x.financial_year_id WHERE x.company_id<>fy.company_id
    UNION ALL SELECT COUNT(*) FROM journal_entries x JOIN financial_years fy ON fy.id=x.financial_year_id WHERE x.company_id<>fy.company_id
  ) checks`);
  assert.equal(Number(crossCompany.count), 0);
  assert.equal((await counts(harness.pool)).stock, 99);
});
