"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { accountConstraintError } = require("../services/accountConstraintError");
const opening = require("../services/openingBalanceService"), db = require("../db/connection");
const duplicate = key => Object.assign(new Error(`Duplicate entry 'PRIVATE' for key 'accounts.${key}'`), { code: "ER_DUP_ENTRY" });
test("duplicate constraints report distinct sanitized contracts, never driver values", () => {
  for (const [key, code, status] of [["uq_accounts_company_code", "ACCOUNT_CODE_ALREADY_EXISTS", 409], ["account_code", "ACCOUNT_CODE_SCHEMA_NOT_READY", 503], ["uq_opening_event_sequence", "OPENING_EVENT_CONFLICT", 409], ["uq_opening_event_journal", "OPENING_EVENT_CONFLICT", 409], ...["unexpected", "__proto__", "constructor", "toString"].map(k => [k, "ACCOUNT_UNIQUE_CONSTRAINT_FAILED", 500])]) {
    const error = accountConstraintError(duplicate(key));
    assert.equal(error.code, code); assert.equal(error.status, status); assert.doesNotMatch(error.message + error.stack, /PRIVATE|Duplicate entry/);
  }
});
test("zero opening performs no opening-event SQL", async () => {
  assert.deepEqual(await opening.recordOpeningBalanceEvent({ connection: { query() { assert.fail("unexpected SQL"); } }, companyId: 9, newSignedAmount: 0 }), { posted: false, delta: 0 });
});
test("controller keeps tenant duplicate/retry rejection and atomic rollback without partial events", async () => {
  const original = db.getConnection, record = opening.recordOpeningBalanceEvent;
  let state = { accounts: [], events: [] }, failEvent = false, transaction;
  const cx = {
    async beginTransaction() { transaction = structuredClone(state); },
    async query(sql, args) {
      assert.match(sql, /INSERT INTO accounts/);
      const [code, name, type, , amount, , , company] = args;
      if (transaction.accounts.some(a => a.code === code && a.company === company)) throw duplicate("uq_accounts_company_code");
      const id = transaction.accounts.length + 1; transaction.accounts.push({ id, code, name, type, amount, company }); return [{ insertId: id }];
    },
    async commit() { state = transaction; }, async rollback() { transaction = null; }, release() {},
  };
  db.getConnection = async () => cx;
  opening.recordOpeningBalanceEvent = async args => {
    if (!args.newSignedAmount) return { posted: false };
    transaction.events.push({ company: args.companyId, entity: args.entityId });
    if (failEvent) throw duplicate("uq_opening_event_sequence");
  };
  const modulePath = require.resolve("../controllers/accountController"); delete require.cache[modulePath];
  const { createAccount } = require(modulePath);
  async function create(company, code, amount = 0) {
    let response; const res = { status(status) { return { json(body) { response = { status, body }; } }; } };
    await createAccount({ user: { company_id: company }, body: { account_code: code, account_name: "Payable", account_type: "LIABILITY", opening_balance: amount } }, res);
    return response;
  }
  try {
    assert.equal((await create(1, "2000")).status, 201);
    assert.equal((await create(9, "2000")).status, 201);
    const before = structuredClone(state);
    for (let i = 0; i < 2; i++) assert.equal((await create(9, "2000")).body.code, "ACCOUNT_CODE_ALREADY_EXISTS");
    assert.deepEqual(state, before); assert.equal(state.events.length, 0);
    failEvent = true;
    assert.equal((await create(9, "2001", 5)).body.code, "OPENING_EVENT_CONFLICT");
    assert.deepEqual(state, before, "account plus partially inserted event must rollback together");
    failEvent = false; assert.equal((await create(9, "2001", 5)).status, 201);
    assert.equal(state.events.length, 1);
    assert.equal((await create(9, "2001", 5)).status, 409); assert.equal(state.events.length, 1);
  } finally { db.getConnection = original; opening.recordOpeningBalanceEvent = record; delete require.cache[modulePath]; }
});
