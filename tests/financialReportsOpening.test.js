const assert = require("node:assert/strict");
const accountingSummary = require("../controllers/accountingSummary");
const db = require("../db/connection");
const originalQuery = db.query;
db.query = async sql => {
  if (sql.includes("FROM iv_operations")) return [[]]; // explicit legacy basis
  throw new Error("Unexpected database call in isolated report fixture");
};

const originalSummary = accountingSummary.getAccountingSummary;
accountingSummary.getAccountingSummary = async () => ({
  cash: 0, receivables: 0, gstInput: 0, vendorCredits: 0,
  payables: 0, customerCredits: 0, gstOutput: 0, salaryPayable: 0,
  sales: 0, purchases: 0, payrollExpense: 0, profit: 0,
  openingBalances: [
    { id: 1, account_code: "1001", account_name: "Bank", account_type: "ASSET", debit: 100, credit: 0 },
    { id: 2, account_code: "2100", account_name: "Accounts Payable", account_type: "LIABILITY", debit: 0, credit: 40 },
    { id: 3, account_code: "SYS-OBE-4", account_name: "Opening Balance Equity", account_type: "EQUITY", debit: 40, credit: 100 },
  ],
});

delete require.cache[require.resolve("../controllers/trialBalanceController")];
delete require.cache[require.resolve("../controllers/balanceSheetController")];
const { getTrialBalance } = require("../controllers/trialBalanceController");
const { getBalanceSheet } = require("../controllers/balanceSheetController");

const capture = () => {
  let result;
  return {
    res: { status(code) { return { json(body) { result = { code, body }; } }; } },
    read: () => result,
  };
};

const run = async () => {
  const trial = capture();
  await getTrialBalance({ user: { company_id: 4 }, query: {} }, trial.res);
  assert.equal(trial.read().code, 200);
  assert.equal(trial.read().body.totals.debit, 140);
  assert.equal(trial.read().body.totals.credit, 140);
  assert.equal(trial.read().body.totals.difference, 0);

  const balance = capture();
  await getBalanceSheet({ user: { company_id: 4 }, query: {} }, balance.res);
  assert.equal(balance.read().code, 200);
  assert.equal(balance.read().body.totals.totalAssets, 100);
  assert.equal(balance.read().body.totals.totalLiabilities, 40);
  assert.equal(balance.read().body.totals.totalEquity, 60);
  assert.equal(balance.read().body.totals.totalLiabilitiesAndEquity, 100);

  console.log("Trial Balance and Balance Sheet opening-event tests passed");
};

run()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => { accountingSummary.getAccountingSummary = originalSummary; db.query = originalQuery; });
