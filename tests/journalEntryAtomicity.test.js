const assert = require("node:assert/strict");
const test = require("node:test");

const db = require("../db/connection");
const originalGetConnection = db.getConnection;

const response = () => {
  const state = {};
  return {
    state,
    status(code) {
      state.code = code;
      return { json(body) { state.body = body; } };
    },
  };
};

test.after(() => { db.getConnection = originalGetConnection; });

test("manual journal commits header and all details in one transaction", async () => {
  const calls = [];
  const connection = {
    beginTransaction: async () => calls.push("BEGIN"),
    commit: async () => calls.push("COMMIT"),
    rollback: async () => calls.push("ROLLBACK"),
    release: () => calls.push("RELEASE"),
    query: async (sql) => {
      calls.push(String(sql));
      if (String(sql).includes("FROM financial_years")) return [[{
        id: 27, company_id: 4, code: "FY2026-27", name: "FY 2026-27",
        start_date: "2026-04-01", end_date: "2027-03-31", status: "OPEN",
        is_default: 1, source: "TEST", created_by: null,
      }]];
      throw new Error(`Unexpected query: ${sql}`);
    },
    execute: async (sql) => {
      calls.push(String(sql));
      if (String(sql).includes("SELECT id") && String(sql).includes("journal_entries")) return [[]];
      if (String(sql).includes("INSERT INTO journal_entries")) return [{ insertId: 91 }];
      if (String(sql).includes("INSERT INTO journal_entry_details")) return [{ insertId: 101 }];
      throw new Error(`Unexpected execute: ${sql}`);
    },
  };
  db.getConnection = async () => connection;
  delete require.cache[require.resolve("../controllers/journalEntryController")];
  const { createJournalEntry } = require("../controllers/journalEntryController");
  const res = response();
  await createJournalEntry({
    user: { company_id: 4 },
    body: { journal_date: "2026-08-12", narration: "Test", entries: [
      { account_id: 1, debit: 100, credit: 0 },
      { account_id: 2, debit: 0, credit: 100 },
    ] },
  }, res);

  assert.equal(res.state.code, 201);
  assert.equal(calls.filter((value) => String(value).includes("INSERT INTO journal_entry_details")).length, 2);
  assert.deepEqual(calls.filter((value) => ["BEGIN", "COMMIT", "ROLLBACK", "RELEASE"].includes(value)), ["BEGIN", "COMMIT", "RELEASE"]);
});

test("manual journal rolls back header and partial details when a detail write fails", async () => {
  const calls = [];
  let detailWrites = 0;
  const connection = {
    beginTransaction: async () => calls.push("BEGIN"),
    commit: async () => calls.push("COMMIT"),
    rollback: async () => calls.push("ROLLBACK"),
    release: () => calls.push("RELEASE"),
    query: async () => [[{
      id: 27, company_id: 4, code: "FY2026-27", name: "FY 2026-27",
      start_date: "2026-04-01", end_date: "2027-03-31", status: "OPEN",
      is_default: 1, source: "TEST", created_by: null,
    }]],
    execute: async (sql) => {
      calls.push(String(sql));
      if (String(sql).includes("SELECT id") && String(sql).includes("journal_entries")) return [[]];
      if (String(sql).includes("INSERT INTO journal_entries")) return [{ insertId: 92 }];
      if (String(sql).includes("INSERT INTO journal_entry_details")) {
        detailWrites += 1;
        if (detailWrites === 2) throw new Error("forced detail failure");
        return [{ insertId: 102 }];
      }
      throw new Error(`Unexpected execute: ${sql}`);
    },
  };
  db.getConnection = async () => connection;
  delete require.cache[require.resolve("../controllers/journalEntryController")];
  const { createJournalEntry } = require("../controllers/journalEntryController");
  const res = response();
  await createJournalEntry({
    user: { company_id: 4 },
    body: { journal_date: "2026-08-12", narration: "Test", entries: [
      { account_id: 1, debit: 100, credit: 0 },
      { account_id: 2, debit: 0, credit: 100 },
    ] },
  }, res);

  assert.equal(res.state.code, 500);
  assert.deepEqual(calls.filter((value) => ["BEGIN", "COMMIT", "ROLLBACK", "RELEASE"].includes(value)), ["BEGIN", "ROLLBACK", "RELEASE"]);
});
