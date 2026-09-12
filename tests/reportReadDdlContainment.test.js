const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

const SCHEMA_DDL =
  /\b(?:CREATE|ALTER|DROP|RENAME|TRUNCATE)\s+(?:TABLE|INDEX|DATABASE|SCHEMA|VIEW|PROCEDURE|FUNCTION|TRIGGER|EVENT)\b/i;

const calls = [];
let allowSchemaDdl = false;

const zeroReturnTax = {
  taxable_value: 0,
  cgst: 0,
  sgst: 0,
  igst: 0,
  total_gst: 0,
  total_amount: 0,
};

const mockDb = {
  async query(sql, params = []) {
    const text = String(sql);
    calls.push({ sql: text, params });
    if (!allowSchemaDdl) {
      assert.doesNotMatch(text, SCHEMA_DDL, `read path executed schema DDL: ${text}`);
    }

    if (text.includes("FROM petty_cash_user_permissions")) {
      return [[{
        can_create: 1,
        can_edit_own: 1,
        can_submit: 1,
        can_approve: 1,
        can_reject: 1,
        can_post: 1,
        can_view_all: 1,
      }]];
    }
    if (text.includes("FROM customers")) {
      return [[{ id: 9, name: "Test Customer" }]];
    }
    if (text.includes("AS taxable_value") && text.includes("FROM product_returns")) {
      return [[zeroReturnTax]];
    }
    return [[]];
  },
};

const dbPath = require.resolve("../db/connection");
const originalLoad = Module._load;
Module._load = function loadWithReadCapture(request, parent, isMain) {
  let resolved = request;
  try {
    resolved = Module._resolveFilename(request, parent);
  } catch {}
  if (resolved === dbPath) return mockDb;
  return originalLoad.call(this, request, parent, isMain);
};

const reportController = require("../controllers/reportController");
const pettyCashController = require("../controllers/pettyCashController");
const pettyCashService = require("../services/pettyCashService");
const customerStatementController = require("../controllers/customerStatementController");
const trialBalanceController = require("../controllers/trialBalanceController");
const profitLossController = require("../controllers/profitLossController");
const balanceSheetController = require("../controllers/balanceSheetController");
Module._load = originalLoad;

const request = (overrides = {}) => ({
  method: "GET",
  query: {},
  params: {},
  user: {
    company_id: 4,
    user_id: 12,
    role: "staff",
    access_role: "accountant",
    permissions: { accounting: { view: true, create: true, edit: true } },
  },
  ...overrides,
});

const response = () => ({
  statusCode: 200,
  payload: undefined,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.payload = payload;
    return this;
  },
});

const invoke = async (handler, req = request()) => {
  const res = response();
  let nextError;
  await handler(req, res, (error) => {
    nextError = error;
  });
  assert.equal(nextError, undefined);
  assert.notEqual(res.statusCode, 500);
  assert.notEqual(res.payload, undefined, "read handler must still return a response");
  return res;
};

const sqlSince = (start) => calls.slice(start).map(({ sql }) => sql);

test("authorized report and GET paths execute business SELECTs without schema DDL", async () => {
  let start = calls.length;
  await invoke(reportController.getStock);
  assert.ok(sqlSince(start).some((sql) => /\bSELECT\b[\s\S]*\bFROM products\b/i.test(sql)));

  start = calls.length;
  await invoke(reportController.getStockMovementReport);
  const movementSql = sqlSince(start);
  assert.ok(movementSql.some((sql) => /\bFROM bills b\b/i.test(sql)));
  assert.ok(movementSql.some((sql) => /\bFROM delivery_challans dc\b/i.test(sql)));
  assert.ok(movementSql.some((sql) => /\bFROM product_returns pr\b/i.test(sql)));

  start = calls.length;
  await invoke(reportController.getPayrollReport);
  assert.ok(sqlSince(start).some((sql) => /\bFROM payroll_entries pe\b/i.test(sql)));

  start = calls.length;
  await invoke(reportController.getGstr1Summary);
  const taxSql = sqlSince(start);
  assert.ok(taxSql.some((sql) => /\bFROM invoices i\b/i.test(sql)));
  assert.ok(taxSql.some((sql) => /\bFROM product_returns\b/i.test(sql)));

  for (const handler of [
    trialBalanceController.getTrialBalance,
    profitLossController.getProfitLoss,
    balanceSheetController.getBalanceSheet,
  ]) {
    start = calls.length;
    await invoke(handler);
    const accountingSql = sqlSince(start);
    assert.ok(accountingSql.some((sql) => /\bFROM invoices i\b/i.test(sql)));
    assert.ok(accountingSql.some((sql) => /\bFROM product_returns\b/i.test(sql)));
    assert.ok(accountingSql.some((sql) => /\bFROM payroll_entries\b/i.test(sql)));
  }

  start = calls.length;
  await invoke(customerStatementController.getCustomerStatement, request({
    query: { customer_id: "9" },
  }));
  const statementSql = sqlSince(start);
  assert.ok(statementSql.some((sql) => /\bFROM customers\b/i.test(sql)));
  assert.ok(statementSql.some((sql) => /\breceipt_entries re\b/i.test(sql)));

  start = calls.length;
  await invoke(pettyCashController.getReports);
  const pettyReportSql = sqlSince(start);
  assert.ok(pettyReportSql.some((sql) => /\bFROM petty_cash_user_permissions\b/i.test(sql)));
  assert.ok(pettyReportSql.some((sql) => /\bFROM petty_cash_transactions\b/i.test(sql)));

  start = calls.length;
  let permissionNext = false;
  await pettyCashService.requirePermission("view_all")(
    request(),
    response(),
    (error) => {
      assert.equal(error, undefined);
      permissionNext = true;
    }
  );
  assert.equal(permissionNext, true);
  assert.ok(sqlSince(start).some((sql) => /\bFROM petty_cash_user_permissions\b/i.test(sql)));

  for (const { sql } of calls) assert.doesNotMatch(sql, SCHEMA_DDL);
});

test("Petty Cash write middleware retains schema-readiness fallback", async () => {
  const start = calls.length;
  allowSchemaDdl = true;
  let permissionNext = false;
  try {
    await pettyCashService.requirePermission("create")(
      request({ method: "POST" }),
      response(),
      (error) => {
        assert.equal(error, undefined);
        permissionNext = true;
      }
    );
  } finally {
    allowSchemaDdl = false;
  }
  assert.equal(permissionNext, true);
  assert.ok(sqlSince(start).some((sql) => /\bCREATE\s+TABLE\b/i.test(sql)));
});

test("authorized read call sites contain no readiness-helper invocation", () => {
  const root = path.join(__dirname, "..");
  const reportSource = fs.readFileSync(path.join(root, "controllers/reportController.js"), "utf8");
  const accountingSource = fs.readFileSync(path.join(root, "controllers/accountingSummary.js"), "utf8");
  const pettySource = fs.readFileSync(path.join(root, "controllers/pettyCashController.js"), "utf8");
  const pettyServiceSource = fs.readFileSync(path.join(root, "services/pettyCashService.js"), "utf8");
  const statementSource = fs.readFileSync(path.join(root, "controllers/customerStatementController.js"), "utf8");

  assert.equal((reportSource.match(/await ensure(?:ProductInventoryColumns|ReturnTables|DeliveryChallanTables|PayrollTables)\(/g) || []).length, 0);
  assert.equal((accountingSource.match(/await ensure(?:ReturnTables|PayrollTables)\(/g) || []).length, 0);
  assert.doesNotMatch(statementSource, /ensureReceiptEntrySchema/);

  const readHandlers = [
    "getPermissions",
    "getDashboard",
    "listTransactions",
    "getTransaction",
    "getAttachment",
    "getSettings",
    "listUserPermissions",
    "getReports",
  ];
  for (const name of readHandlers) {
    const start = pettySource.indexOf(`exports.${name} =`);
    const nextExport = pettySource.indexOf("\nexports.", start + 1);
    const next = nextExport >= 0 ? nextExport : pettySource.length;
    assert.ok(start >= 0, `missing Petty Cash read handler ${name}`);
    assert.doesNotMatch(pettySource.slice(start, next), /ensurePettyCashSchema/);
  }

  const permissionRead = pettyServiceSource.slice(
    pettyServiceSource.indexOf("const getUserPermissions ="),
    pettyServiceSource.indexOf("const requirePermission =")
  );
  assert.doesNotMatch(permissionRead, /ensurePettyCashSchema/);
});
