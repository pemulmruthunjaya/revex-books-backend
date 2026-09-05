const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  requireFinancialYearForDate,
  rejectClientFinancialYear,
} = require("../services/financialYearService");

const root = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("transaction resolver is company scoped, inclusive, connection owned and status agnostic", async () => {
  const calls = [];
  const executor = {
    async query(sql, params) {
      calls.push({ sql, params });
      return [[{
        id: 41, company_id: 4, code: "FY26-27", name: "FY 2026-27",
        start_date: "2026-04-01", end_date: "2027-03-31", status: "LOCKED",
        is_default: 0, source: "MANUAL", created_by: 13,
      }]];
    },
  };
  for (const date of ["2026-04-01", "2027-03-31"]) {
    const year = await requireFinancialYearForDate(4, date, executor);
    assert.equal(year.id, 41);
    assert.equal(year.status, "LOCKED");
  }
  assert.deepEqual(calls.map(({ params }) => params), [[4, "2026-04-01"], [4, "2027-03-31"]]);
  assert.ok(calls.every(({ sql }) => /company_id=\? AND \? BETWEEN start_date AND end_date/.test(sql)));
});

test("missing, invalid and cross-company dates fail without accepting a client FY", async () => {
  await assert.rejects(
    requireFinancialYearForDate(4, "2028-04-01", { query: async () => [[]] }),
    (error) => error.code === "FINANCIAL_YEAR_NOT_FOUND_FOR_DATE" && error.status === 409
  );
  await assert.rejects(requireFinancialYearForDate(4, "2026-02-30", { query: async () => [[]] }), /valid calendar date/);
  assert.throws(
    () => rejectClientFinancialYear({ financial_year_id: 999 }),
    (error) => error.code === "CLIENT_FINANCIAL_YEAR_NOT_ALLOWED" && error.status === 400
  );
  assert.doesNotThrow(() => rejectClientFinancialYear({ invoice_date: "2026-04-01" }));
});

test("approved write paths store only server-resolved financial years", () => {
  const expectations = {
    "controllers/invoiceController.js": ["financial_year_id", "requireFinancialYearForDate", "rejectClientFinancialYear", "{ financialYear }"],
    "services/salesInvoiceAccountingService.js": ["financial_year_id", "invoice.financial_year_id"],
    "services/receiptEntryService.js": ["financial_year_id", "requireFinancialYearForDate", "rejectClientFinancialYear"],
    "controllers/billController.js": ["financial_year_id", "requireFinancialYearForDate", "rejectClientFinancialYear"],
    "controllers/purchaseOrderController.js": ["financial_year_id", "requireFinancialYearForDate", "rejectClientFinancialYear"],
    "controllers/goodsReceiptController.js": ["financial_year_id", "requireFinancialYearForDate", "rejectClientFinancialYear"],
    "controllers/quotationController.js": ["financial_year_id", "requireFinancialYearForDate", "rejectClientFinancialYear", "postSalesInvoiceJournal"],
    "services/vendorPaymentService.js": ["financial_year_id", "requireFinancialYearForDate", "rejectClientFinancialYear"],
    "controllers/expenseController.js": ["financial_year_id", "requireFinancialYearForDate", "rejectClientFinancialYear"],
    "controllers/journalEntryController.js": ["financial_year_id", "requireFinancialYearForDate", "rejectClientFinancialYear"],
    "services/recurringInvoiceService.js": ["createInvoiceRecord"],
  };
  for (const [file, needles] of Object.entries(expectations)) {
    const text = source(file);
    for (const needle of needles) assert.ok(text.includes(needle), `${file} must contain ${needle}`);
  }
});

test("quotation conversion posts its shared sales journal before marking the quotation converted", () => {
  const text = source("controllers/quotationController.js");
  const conversion = text.slice(text.indexOf("exports.convertQuotationToInvoice"), text.indexOf("exports.deleteQuotation"));
  assert.ok(conversion.indexOf("INSERT INTO invoices") < conversion.indexOf("postSalesInvoiceJournal"));
  assert.ok(conversion.indexOf("postSalesInvoiceJournal") < conversion.indexOf("UPDATE quotations SET status = 'Converted'"));
  assert.ok(conversion.indexOf("UPDATE quotations SET status = 'Converted'") < conversion.indexOf("connection.commit()"));
  assert.match(conversion, /financial_year_id:\s*financialYear\.id/);
});

test("migration is nullable, additive, seven-table-only and intentionally excludes receipt headers", () => {
  const migration = source("db/migrations/2026-09-05-core-accounting-financial-year-links.sql");
  const calls = [...migration.matchAll(/CALL add_core_transaction_fy_link\('([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(calls, ["invoices", "payments", "bills", "vendor_payments", "ledger_entries", "expenses", "journal_entries"]);
  assert.match(migration, /BIGINT UNSIGNED NULL/);
  assert.match(migration, /FOREIGN KEY \(`financial_year_id`,`company_id`\)/);
  assert.doesNotMatch(migration, /UPDATE\s+(invoices|payments|bills|vendor_payments|ledger_entries|expenses|journal_entries)/i);
  for (const excluded of ["receipt_entries", "petty_cash_transactions", "payroll_entries", "opening_balance_events", "inventory_transactions"]) {
    assert.equal(calls.includes(excluded), false);
  }
});
