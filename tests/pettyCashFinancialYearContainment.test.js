const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");

const controllerPath = require.resolve("../controllers/pettyCashController");
const dbPath = require.resolve("../db/connection");
const pettyServicePath = require.resolve("../services/pettyCashService");
const fyServicePath = require.resolve("../services/financialYearService");

const loadController = ({
  transaction,
  settings = [{ opening_balance: 0, current_balance: 100 }],
  fyError,
  failOn,
} = {}) => {
  const queries = [];
  let committed = false;
  let rolledBack = false;
  const connection = {
    beginTransaction: async () => queries.push(["BEGIN", []]),
    commit: async () => { committed = true; },
    rollback: async () => { rolledBack = true; },
    release: () => {},
    query: async (sql, params = []) => {
      queries.push([sql, params]);
      if (failOn && sql.includes(failOn)) throw new Error("forced Petty Cash write failure");
      if (sql.includes("FROM petty_cash_transactions t")) return [[transaction]];
      if (sql.includes("SELECT opening_balance FROM petty_cash_settings")) return [settings];
      if (sql.includes("SELECT current_balance FROM petty_cash_settings")) return [[settings[0]]];
      if (sql.startsWith("INSERT INTO petty_cash_transactions")) return [{ insertId: 91 }];
      if (sql.includes("COUNT(*) AS count")) return [[{ count: 0 }]];
      return [{ affectedRows: 1 }];
    },
  };
  const fyCalls = [];
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    const resolved = (() => { try { return Module._resolveFilename(request, parent); } catch { return request; } })();
    if (resolved === dbPath) return { getConnection: async () => connection, query: connection.query };
    if (resolved === pettyServicePath) return {
      ACTIONS: [],
      STATUSES: {
        DRAFT: "DRAFT", SUBMITTED: "SUBMITTED", MANAGER_APPROVED: "MANAGER_APPROVED",
        ACCOUNTS_APPROVED: "ACCOUNTS_APPROVED", POSTED: "POSTED", REJECTED: "REJECTED",
      },
      addWorkflowHistory: async () => queries.push(["HISTORY", []]),
      ensurePettyCashSchema: async () => {},
      getUserPermissions: async () => ({}),
      nextTransactionNumber: async () => "PCE-2026-00001",
    };
    if (resolved === fyServicePath) return {
      rejectClientFinancialYear: (body) => {
        if (Object.prototype.hasOwnProperty.call(body || {}, "financial_year_id")) {
          const error = new Error("financial_year_id is assigned by the server");
          error.code = "CLIENT_FINANCIAL_YEAR_NOT_ALLOWED";
          error.status = 400;
          throw error;
        }
      },
      requireFinancialYearForPosting: async (companyId, date, executor) => {
        queries.push(["FY_SHARED_LOCK", [companyId, date]]);
        fyCalls.push({ companyId, date, executor });
        if (fyError) throw fyError;
        return { id: 14, status: "OPEN" };
      },
    };
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[controllerPath];
  const controller = require(controllerPath);
  Module._load = originalLoad;
  return { controller, connection, queries, fyCalls, state: () => ({ committed, rolledBack }) };
};

const req = (body = {}) => ({
  body,
  params: { id: "7" },
  user: { company_id: 8, user_id: 18, role: "owner" },
  files: [],
});

const response = () => ({
  statusCode: 200,
  payload: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.payload = payload; return this; },
});

const approved = (overrides = {}) => ({
  id: 7,
  company_id: 8,
  transaction_date: "2026-04-01",
  transaction_type: "REPLENISHMENT",
  amount: 25,
  status: "ACCOUNTS_APPROVED",
  created_by: 18,
  attachment_count: 0,
  ...overrides,
});

test("OPEN posting locks the company transaction, resolves FY from persisted date, and changes balance once", async () => {
  const harness = loadController({ transaction: approved() });
  const res = response();
  let nextError;
  await harness.controller.postTransaction(req(), res, (error) => { nextError = error; });
  assert.equal(nextError, undefined);
  assert.equal(harness.state().committed, true);
  assert.deepEqual(harness.fyCalls.map(({ companyId, date, executor }) => ({ companyId, date, sameConnection: executor === harness.connection })), [
    { companyId: 8, date: "2026-04-01", sameConnection: true },
  ]);
  const transactionReads = harness.queries.filter(([sql]) => sql.includes("FROM petty_cash_transactions t"));
  assert.equal(transactionReads.length, 2);
  assert.doesNotMatch(transactionReads[0][0], /FOR UPDATE$/);
  assert.match(transactionReads[1][0], /FOR UPDATE$/);
  const fyIndex = harness.queries.findIndex(([sql]) => sql === "FY_SHARED_LOCK");
  const lockedTransactionIndex = harness.queries.findIndex(([sql]) => /FROM petty_cash_transactions t[\s\S]*FOR UPDATE$/.test(sql));
  const settingsIndex = harness.queries.findIndex(([sql]) => sql.includes("SELECT current_balance FROM petty_cash_settings"));
  assert.ok(fyIndex < lockedTransactionIndex && lockedTransactionIndex < settingsIndex);
  assert.equal(harness.queries.filter(([sql]) => sql.includes("current_balance=current_balance+?")).length, 1);
  assert.equal(harness.queries.filter(([sql]) => sql.includes("status='POSTED'")).length, 1);
});

for (const code of [
  "FINANCIAL_YEAR_DRAFT",
  "FINANCIAL_YEAR_RECONCILIATION_RESTRICTED",
  "FINANCIAL_YEAR_CLOSING_RESTRICTED",
  "FINANCIAL_YEAR_CLOSED",
  "FINANCIAL_YEAR_LOCKED",
  "FINANCIAL_YEAR_NOT_FOUND_FOR_DATE",
  "FINANCIAL_YEAR_AMBIGUOUS",
]) {
  test(`${code} leaves Petty Cash balance and transaction unchanged`, async () => {
    const error = Object.assign(new Error(code), { code, status: 409 });
    const harness = loadController({ transaction: approved(), fyError: error });
    const res = response();
    let nextError;
    await harness.controller.postTransaction(req(), res, (caught) => { nextError = caught; });
    assert.equal(nextError, undefined);
    assert.equal(res.statusCode, 409);
    assert.equal(res.payload.code, code);
    assert.equal(harness.state().rolledBack, true);
    assert.equal(harness.state().committed, false);
    assert.equal(harness.queries.some(([sql]) => sql.includes("current_balance=current_balance+?")), false);
    assert.equal(harness.queries.some(([sql]) => sql.includes("status='POSTED'")), false);
  });
}

test("client FY cannot authorize posting", async () => {
  const harness = loadController({ transaction: approved() });
  const res = response();
  let nextError;
  await harness.controller.postTransaction(req({ financial_year_id: 14 }), res, (error) => { nextError = error; });
  assert.equal(nextError, undefined);
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.code, "CLIENT_FINANCIAL_YEAR_NOT_ALLOWED");
  assert.equal(harness.queries.length, 0);
});

test("initial opening balance is zero-only and existing opening balance is immutable", async () => {
  let harness = loadController({ settings: [] });
  let nextError;
  await harness.controller.updateSettings(req({ opening_balance: 50 }), response(), (error) => { nextError = error; });
  assert.equal(nextError, undefined);
  assert.equal(harness.queries.some(([sql]) => sql.startsWith("INSERT INTO petty_cash_settings")), false);

  harness = loadController({ settings: [{ opening_balance: 75, current_balance: 90 }] });
  nextError = undefined;
  await harness.controller.updateSettings(req({ opening_balance: 0 }), response(), (error) => { nextError = error; });
  assert.equal(nextError, undefined);
  assert.equal(harness.queries.some(([sql]) => sql.startsWith("INSERT INTO petty_cash_settings")), false);

  harness = loadController({ settings: [{ opening_balance: 75, current_balance: 90 }] });
  nextError = undefined;
  await harness.controller.updateSettings(req({ opening_balance: 75, fund_name: "Main" }), response(), (error) => { nextError = error; });
  assert.equal(nextError, undefined);
  assert.equal(harness.state().committed, true);
  const upsert = harness.queries.find(([sql]) => sql.startsWith("INSERT INTO petty_cash_settings"));
  assert.ok(upsert);
  assert.doesNotMatch(upsert[0].split("ON DUPLICATE KEY UPDATE")[1], /opening_balance|current_balance/);
});

test("draft creation remains non-financial and does not invoke the FY posting guard", async () => {
  const harness = loadController();
  let nextError;
  await harness.controller.createTransaction(req({
    transaction_type: "EXPENSE",
    transaction_date: "2026-04-01",
    description: "Stationery",
    amount: 10,
  }), response(), (error) => { nextError = error; });
  assert.equal(nextError, undefined);
  assert.equal(harness.fyCalls.length, 0);
  assert.equal(harness.queries.some(([sql]) => sql.includes("current_balance")), false);
});

test("a failure after balance calculation rolls back the balance and posting state atomically", async () => {
  const harness = loadController({
    transaction: approved(),
    failOn: "status='POSTED'",
  });
  let nextError;
  await harness.controller.postTransaction(req(), response(), (error) => { nextError = error; });
  assert.match(nextError.message, /forced Petty Cash write failure/);
  assert.equal(harness.state().rolledBack, true);
  assert.equal(harness.state().committed, false);
  assert.equal(harness.queries.filter(([sql]) => sql.includes("current_balance=current_balance+?")).length, 1);
  assert.equal(harness.queries.filter(([sql]) => sql.includes("status='POSTED'")).length, 1);
});
