const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  requireFinancialYearForPosting,
} = require("../services/financialYearService");
const { recordOpeningBalanceEvent } = require("../services/openingBalanceService");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

const fyRow = (status = "OPEN") => ({
  id: 41,
  company_id: 4,
  code: "FY26-27",
  name: "FY 2026-27",
  start_date: "2026-04-01",
  end_date: "2027-03-31",
  status,
  is_default: 1,
  source: "manual",
  created_by: null,
  created_at: null,
  updated_at: null,
});

test("expense and manual journal writes use centralized posting and persisted-FY mutation guards", () => {
  const expense = read("controllers/expenseController.js");
  const journal = read("controllers/journalEntryController.js");
  const expenseRoutes = read("routes/expenseRoutes.js");
  const journalRoutes = read("routes/journalEntryRoutes.js");

  assert.match(expense, /requireFinancialYearForPosting\(company_id, expense_date, connection\)/);
  assert.match(expense, /SELECT id,financial_year_id[\s\S]*company_id=\?[\s\S]*FOR UPDATE/);
  assert.match(expense, /requireFinancialYearForMutation\(company_id, rows\[0\]\.financial_year_id, connection\)/);
  assert.match(expense, /financial_year_id\)[\s\S]*financialYear\.id/);
  assert.doesNotMatch(expenseRoutes, /router\.(?:put|patch)\(/);

  assert.match(journal, /requireFinancialYearForPosting\(company_id, journal_date, connection\)/);
  assert.match(journal, /SELECT id,financial_year_id[\s\S]*company_id=\?[\s\S]*FOR UPDATE/);
  assert.match(journal, /requireFinancialYearForMutation\(company_id, journalRows\[0\]\.financial_year_id, connection\)/);
  assert.match(journal, /financial_year_id[\s\S]*financialYear\.id/);
  assert.doesNotMatch(journalRoutes, /router\.(?:put|patch)\(/);
});

test("all restricted FY states reject opening-balance posting before accounting writes", async () => {
  const expected = {
    DRAFT: "FINANCIAL_YEAR_DRAFT",
    RECONCILIATION: "FINANCIAL_YEAR_RECONCILIATION_RESTRICTED",
    CLOSING: "FINANCIAL_YEAR_CLOSING_RESTRICTED",
    CLOSED: "FINANCIAL_YEAR_CLOSED",
    LOCKED: "FINANCIAL_YEAR_LOCKED",
  };

  for (const [status, code] of Object.entries(expected)) {
    const calls = [];
    const connection = {
      async query(sql) {
        calls.push(String(sql));
        if (String(sql).includes("CURRENT_DATE")) return [[{ opening_date: "2026-08-12" }]];
        if (String(sql).includes("FROM financial_years")) return [[fyRow(status)]];
        throw new Error(`write reached in ${status}`);
      },
    };
    await assert.rejects(
      () => recordOpeningBalanceEvent({
        connection,
        companyId: 4,
        entityType: "customer",
        entityId: 10,
        targetAccount: { id: 20, account_name: "Receivables", account_type: "ASSET" },
        newSignedAmount: 100,
      }),
      (error) => error.code === code && error.status === 409
    );
    assert.equal(calls.some((sql) => /^\s*(?:INSERT|UPDATE|DELETE)\b/.test(sql)), false);
  }
});

test("opening-balance adjustment checks persisted source FY and fails closed when history is absent", async () => {
  const calls = [];
  const connection = {
    async query(sql) {
      const text = String(sql);
      calls.push(text);
      if (text.includes("CURRENT_DATE")) return [[{ opening_date: "2026-08-12" }]];
      if (text.includes("FROM opening_balance_events obe")) return [[]];
      throw new Error(`unexpected accounting write: ${text}`);
    },
  };
  await assert.rejects(
    () => recordOpeningBalanceEvent({
      connection,
      companyId: 4,
      entityType: "vendor",
      entityId: 12,
      targetAccount: { id: 21, account_name: "Payables", account_type: "LIABILITY" },
      previousSignedAmount: -100,
      newSignedAmount: -125,
    }),
    (error) => error.code === "OPENING_BALANCE_HISTORY_NOT_FOUND" && error.status === 409
  );
  assert.equal(calls.some((sql) => /^\s*(?:INSERT|UPDATE|DELETE)\b/.test(sql)), false);
});

test("opening-balance adjustment rejects each restricted persisted source FY before destination or writes", async () => {
  const expected = {
    DRAFT: "FINANCIAL_YEAR_DRAFT",
    RECONCILIATION: "FINANCIAL_YEAR_RECONCILIATION_RESTRICTED",
    CLOSING: "FINANCIAL_YEAR_CLOSING_RESTRICTED",
    CLOSED: "FINANCIAL_YEAR_CLOSED",
    LOCKED: "FINANCIAL_YEAR_LOCKED",
  };
  for (const [status, code] of Object.entries(expected)) {
    const calls = [];
    const connection = {
      async query(sql) {
        const text = String(sql);
        calls.push(text);
        if (text.includes("CURRENT_DATE")) return [[{ opening_date: "2026-08-12" }]];
        if (text.includes("FROM opening_balance_events obe")) return [[{ financial_year_id: 40 }]];
        if (text.includes("FROM financial_years") && text.includes("id=?")) return [[{ ...fyRow(status), id: 40 }]];
        throw new Error(`destination/write reached in ${status}: ${text}`);
      },
    };
    await assert.rejects(
      () => recordOpeningBalanceEvent({
        connection,
        companyId: 4,
        entityType: "customer",
        entityId: 10,
        targetAccount: { id: 20, account_name: "Receivables", account_type: "ASSET" },
        previousSignedAmount: 100,
        newSignedAmount: 125,
      }),
      (error) => error.code === code
    );
    assert.equal(calls.filter((sql) => sql.includes("FROM financial_years")).length, 1);
    assert.equal(calls.some((sql) => /^\s*(?:INSERT|UPDATE|DELETE)\b/.test(sql)), false);
  }
});

test("FY date resolution is inclusive, company scoped, and never substitutes the default FY", async () => {
  for (const date of ["2026-04-01", "2027-03-31"]) {
    let params;
    const executor = {
      async query(sql, values) {
        assert.match(String(sql), /company_id=\?/);
        assert.match(String(sql), /BETWEEN start_date AND end_date/);
        assert.match(String(sql), /FOR SHARE/);
        params = values;
        return [[fyRow("OPEN")]];
      },
    };
    const result = await requireFinancialYearForPosting(4, date, executor);
    assert.equal(result.id, 41);
    assert.deepEqual(params, [4, date]);
  }

  const missing = { query: async () => [[]] };
  await assert.rejects(
    () => requireFinancialYearForPosting(4, "2028-04-01", missing),
    (error) => error.code === "FINANCIAL_YEAR_NOT_FOUND_FOR_DATE"
  );
  const ambiguous = { query: async () => [[fyRow("OPEN"), { ...fyRow("OPEN"), id: 42 }]] };
  await assert.rejects(
    () => requireFinancialYearForPosting(4, "2026-08-12", ambiguous),
    (error) => error.code === "FINANCIAL_YEAR_AMBIGUOUS"
  );
});

test("customer, vendor, and account opening APIs reject client-controlled FY values", () => {
  for (const file of [
    "controllers/customerController.js",
    "controllers/vendorController.js",
    "controllers/accountController.js",
  ]) {
    const source = read(file);
    assert.ok((source.match(/rejectClientFinancialYear\(req\.body\)/g) || []).length >= 2, file);
    assert.match(source, /recordOpeningBalanceEvent\(/, file);
  }
});

test("opening journals persist resolved FY and remain balanced without mutating source objects", async () => {
  const calls = [];
  const targetAccount = { id: 20, account_name: "Receivables", account_type: "ASSET" };
  const original = { ...targetAccount };
  const connection = {
    async query(sql, params = []) {
      const text = String(sql);
      calls.push({ text, params });
      if (text.includes("CURRENT_DATE")) return [[{ opening_date: "2026-04-01" }]];
      if (text.includes("FROM financial_years")) return [[fyRow("OPEN")]];
      if (text.includes("FROM accounts")) return [[{ id: 99, account_name: "Opening Balance Equity", account_type: "EQUITY" }]];
      if (text.includes("MAX(sequence_no)")) return [[{ sequence_no: 0 }]];
      if (text.includes("INSERT INTO opening_balance_events")) return [{ insertId: 51 }];
      if (text.includes("INSERT INTO journal_entries")) return [{ insertId: 71 }];
      if (text.includes("INSERT INTO journal_entry_details")) return [{ affectedRows: 2 }];
      if (text.includes("UPDATE opening_balance_events")) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${text}`);
    },
  };
  await recordOpeningBalanceEvent({
    connection,
    companyId: 4,
    entityType: "customer",
    entityId: 10,
    targetAccount,
    newSignedAmount: 125,
  });
  const journal = calls.find(({ text }) => text.includes("INSERT INTO journal_entries"));
  assert.equal(journal.params[1], "2026-04-01");
  assert.equal(journal.params[6], 4);
  assert.equal(journal.params[7], 41);
  assert.equal(journal.params[3], journal.params[4]);
  const details = calls.find(({ text }) => text.includes("INSERT INTO journal_entry_details"));
  assert.equal(details.params[2], details.params[6]);
  assert.deepEqual(targetAccount, original);
});
