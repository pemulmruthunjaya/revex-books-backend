const assert = require("node:assert/strict");
const db = require("../db/connection");
const {
  recordOpeningBalanceEvent,
  signedAccountOpening,
} = require("../services/openingBalanceService");

const workflowConnection = ({ sequence = 0, eventError = null } = {}) => {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (text.includes("DATE_FORMAT(CURRENT_DATE")) return [[{ opening_date: "2026-08-12" }]];
      if (text.includes("FROM financial_years")) return [[{ id: 2026, company_id: 4, status: "OPEN" }]];
      if (text.includes("FROM opening_balance_events obe")) return [[{ financial_year_id: 2026 }]];
      if (text.includes("FROM accounts")) {
        return [[{ id: 99, account_code: "SYS-OBE-4", account_name: "Opening Balance Equity", account_type: "EQUITY" }]];
      }
      if (text.includes("MAX(sequence_no)")) return [[{ sequence_no: sequence }]];
      if (text.includes("INSERT INTO opening_balance_events")) {
        if (eventError) throw eventError;
        return [{ insertId: 501 }];
      }
      if (text.includes("INSERT INTO journal_entries")) return [{ insertId: 701 }];
      if (text.includes("INSERT INTO journal_entry_details")) return [{ affectedRows: 2 }];
      if (text.includes("UPDATE opening_balance_events")) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${text}`);
    },
  };
};

const post = (connection, overrides = {}) => recordOpeningBalanceEvent({
  connection,
  companyId: 4,
  entityType: "account",
  entityId: 20,
  targetAccount: { id: 20, account_name: "Cash", account_type: "ASSET" },
  previousSignedAmount: 0,
  newSignedAmount: 100,
  createdBy: 7,
  ...overrides,
});

const run = async () => {
  assert.equal(signedAccountOpening(100, "ASSET"), 100);
  assert.equal(signedAccountOpening(100, "LIABILITY"), -100);
  assert.equal(signedAccountOpening(100, "EQUITY"), -100);
  assert.throws(() => signedAccountOpening(100, "EXPENSE"), /only for Asset, Liability, and Equity/);

  const asset = workflowConnection();
  await post(asset);
  const assetLines = asset.calls.find(({ sql }) => sql.includes("INSERT INTO journal_entry_details"));
  assert.deepEqual(assetLines.params, [701, 20, 100, assetLines.params[3], 701, 99, 100, assetLines.params[7]]);

  const liability = workflowConnection();
  await post(liability, {
    targetAccount: { id: 22, account_name: "Creditors", account_type: "LIABILITY" },
    newSignedAmount: -100,
  });
  const liabilityLines = liability.calls.find(({ sql }) => sql.includes("INSERT INTO journal_entry_details"));
  assert.equal(liabilityLines.params[1], 99, "equity must be debited for a liability opening");
  assert.equal(liabilityLines.params[5], 22, "the liability must be credited");

  const zero = workflowConnection();
  const zeroResult = await post(zero, { newSignedAmount: 0 });
  assert.equal(zeroResult.posted, false);
  assert.equal(zero.calls.length, 0, "zero openings must not query or post");

  const adjustment = workflowConnection({ sequence: 1 });
  const adjustmentResult = await post(adjustment, { previousSignedAmount: 100, newSignedAmount: 140 });
  assert.equal(adjustmentResult.delta, 40, "edits must post only the difference");
  const adjustmentEvent = adjustment.calls.find(({ sql }) => sql.includes("INSERT INTO opening_balance_events"));
  assert.equal(adjustmentEvent.params[3], 2);
  assert.equal(adjustmentEvent.params[4], "adjustment");

  const duplicate = workflowConnection({ eventError: Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" }) });
  await assert.rejects(() => post(duplicate), /duplicate/);
  assert.equal(duplicate.calls.some(({ sql }) => sql.includes("INSERT INTO journal_entries")), false);

  for (const { sql, params } of asset.calls.filter(({ sql }) => /SELECT|UPDATE/.test(sql) && !sql.includes("CURRENT_DATE"))) {
    assert.match(sql, /company_id\s*=\s*\?/i, "opening workflow reads and updates must be company scoped");
    assert.ok(params.includes(4));
  }

  const originalGetConnection = db.getConnection;
  let rolledBack = false;
  let released = false;
  const failingConnection = {
    beginTransaction: async () => {},
    commit: async () => { throw new Error("commit must not occur"); },
    rollback: async () => { rolledBack = true; },
    release: () => { released = true; },
    async query(sql) {
      if (String(sql).includes("INSERT INTO accounts")) return [{ insertId: 44 }];
      if (String(sql).includes("FROM accounts")) throw new Error("opening event failed");
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  db.getConnection = async () => failingConnection;
  delete require.cache[require.resolve("../controllers/accountController")];
  const { createAccount } = require("../controllers/accountController");
  let response;
  await createAccount(
    { user: { company_id: 4, user_id: 7 }, body: { account_name: "Test Cash", account_type: "ASSET", opening_balance: 100 } },
    { status(code) { return { json(body) { response = { code, body }; } }; } }
  );
  db.getConnection = originalGetConnection;
  assert.equal(response.code, 500);
  assert.equal(rolledBack, true, "account and opening journal must roll back together");
  assert.equal(released, true);

  console.log("opening balance workflow regression tests passed");
};

run().catch((error) => { console.error(error); process.exitCode = 1; });
