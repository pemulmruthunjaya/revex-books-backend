const assert = require("node:assert/strict");
const test = require("node:test");

const {
  accountingDate,
  createFinancialYear,
  getDefaultFinancialYear,
  getFinancialYear,
  listFinancialYearEvents,
  resolveFinancialYearForDate,
  setDefaultFinancialYear,
} = require("../services/financialYearService");

test("accounting dates preserve explicit local calendar dates", () => {
  assert.equal(accountingDate("2026-04-01", "date"), "2026-04-01");
  assert.equal(accountingDate("2027-03-31", "date"), "2027-03-31");
  assert.throws(() => accountingDate("2026-02-29", "date"), { code: "INVALID_DATE" });
  assert.throws(() => accountingDate("04/01/2026", "date"), { code: "INVALID_DATE" });
});

test("create validates range before opening a transaction and does not mutate input", async () => {
  const input = {
    companyId: 4,
    code: "FY 2026-27",
    startDate: "2027-03-31",
    endDate: "2026-04-01",
    status: "OPEN",
  };
  const snapshot = structuredClone(input);
  let connections = 0;
  await assert.rejects(
    createFinancialYear(input, { getConnection: async () => { connections += 1; } }),
    { code: "INVALID_DATE_RANGE" }
  );
  assert.equal(connections, 0);
  assert.deepEqual(input, snapshot);
});

test("tenant lookup always binds company and financial year", async () => {
  let call;
  const executor = {
    query: async (sql, params) => {
      call = { sql, params };
      return [[{
        id: 8, company_id: 4, code: "FY26", name: null,
        start_date: "2026-04-01", end_date: "2027-03-31", status: "DRAFT",
        is_default: 0, source: "MANUAL", created_by: null,
        created_at: "created", updated_at: "updated",
      }]];
    },
  };
  const result = await getFinancialYear(4, 8, executor);
  assert.match(call.sql, /company_id=\? AND id=\?/);
  assert.deepEqual(call.params, [4, 8]);
  assert.equal(result.company_id, 4);
  assert.equal(result.status, "DRAFT");
});

test("date resolution is company-scoped, inclusive, and returns null when absent", async () => {
  const calls = [];
  const executor = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return calls.length === 1
        ? [[{
          id: 1, company_id: 4, code: "FY26", name: "FY 2026-27",
          start_date: "2026-04-01", end_date: "2027-03-31", status: "OPEN",
          is_default: 1, source: "MANUAL", created_by: 13,
          created_at: "created", updated_at: "updated",
        }]]
        : [[]];
    },
  };
  const first = await resolveFinancialYearForDate(4, "2026-04-01", executor);
  const outside = await resolveFinancialYearForDate(4, "2028-04-01", executor);
  assert.equal(first.status, "OPEN");
  assert.equal(outside, null);
  assert.match(calls[0].sql, /company_id=\? AND \? BETWEEN start_date AND end_date/);
  assert.deepEqual(calls[0].params, [4, "2026-04-01"]);
});

const fyRow = (overrides = {}) => ({
  id: 21,
  company_id: 4,
  code: "FY26",
  name: "FY 2026-27",
  start_date: "2026-04-01",
  end_date: "2027-03-31",
  status: "RECONCILIATION",
  is_default: 1,
  source: "MIGRATION",
  created_by: 13,
  created_at: "created",
  updated_at: "updated",
  ...overrides,
});

test("create is transactional, company-scoped, writes CREATE/default events, and preserves input", async () => {
  const calls = [];
  const connection = {
    beginTransaction: async () => calls.push("BEGIN"),
    commit: async () => calls.push("COMMIT"),
    rollback: async () => calls.push("ROLLBACK"),
    release: () => calls.push("RELEASE"),
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/SELECT id FROM companies/.test(sql)) return [[{ id: 4 }]];
      if (/user_company_memberships/.test(sql)) return [[{ ok: 1 }]];
      if (/SELECT id FROM financial_years\s+WHERE company_id=\? AND \? <=/.test(sql)) return [[]];
      if (/SELECT id FROM financial_years WHERE company_id=\? AND is_default=1/.test(sql)) return [[{ id: 20 }]];
      if (/UPDATE financial_years SET is_default=0/.test(sql)) return [{ affectedRows: 1 }];
      if (/INSERT INTO financial_years/.test(sql)) return [{ insertId: 21, affectedRows: 1 }];
      if (/INSERT INTO financial_year_events/.test(sql)) return [{ insertId: 31, affectedRows: 1 }];
      if (/FROM financial_years WHERE id=\? AND company_id=\?/.test(sql)) return [[fyRow()]];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const executor = { getConnection: async () => connection };
  const input = {
    companyId: 4,
    code: "FY26",
    name: "FY 2026-27",
    startDate: "2026-04-01",
    endDate: "2027-03-31",
    status: "RECONCILIATION",
    isDefault: true,
    source: "MIGRATION",
    actorUserId: 13,
    reason: "Test fixture",
  };
  const snapshot = structuredClone(input);
  const created = await createFinancialYear(input, executor);
  assert.equal(created.id, 21);
  assert.equal(created.is_default, true);
  assert.deepEqual(input, snapshot);
  assert.deepEqual(calls.filter((call) => typeof call === "string"), ["BEGIN", "COMMIT", "RELEASE"]);
  const eventCalls = calls.filter((call) => call.sql?.includes("INSERT INTO financial_year_events"));
  assert.equal(eventCalls.length, 2);
  assert.equal(eventCalls[0].params[2], "CREATE");
  assert.equal(eventCalls[1].params[2], "SET_DEFAULT");
  assert.match(eventCalls[1].params[7], /previous_default_financial_year_id/);
});

test("set default changes only years in the explicit company and records the event", async () => {
  const calls = [];
  const connection = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/SELECT id FROM companies/.test(sql)) return [[{ id: 4 }]];
      if (/user_company_memberships/.test(sql)) return [[{ ok: 1 }]];
      if (/FROM financial_years WHERE id=\? AND company_id=\? LIMIT 1 FOR UPDATE/.test(sql)) return [[fyRow({ is_default: 0 })]];
      if (/SELECT id FROM financial_years WHERE company_id=\? AND is_default=1/.test(sql)) return [[{ id: 20 }]];
      if (/UPDATE financial_years SET is_default=0/.test(sql)) return [{ affectedRows: 1 }];
      if (/UPDATE financial_years SET is_default=1/.test(sql)) return [{ affectedRows: 1 }];
      if (/INSERT INTO financial_year_events/.test(sql)) return [{ insertId: 32 }];
      if (/FROM financial_years WHERE id=\? AND company_id=\?/.test(sql)) return [[fyRow({ is_default: 1 })]];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const updated = await setDefaultFinancialYear(
    { companyId: 4, financialYearId: 21, actorUserId: 13, reason: "Use new FY" },
    { getConnection: async () => connection }
  );
  assert.equal(updated.is_default, true);
  const clear = calls.find((call) => call.sql?.includes("UPDATE financial_years SET is_default=0"));
  const select = calls.find((call) => call.sql?.includes("UPDATE financial_years SET is_default=1"));
  assert.deepEqual(clear.params, [4]);
  assert.deepEqual(select.params, [21, 4]);
  const event = calls.find((call) => call.sql?.includes("INSERT INTO financial_year_events"));
  assert.equal(event.params[2], "SET_DEFAULT");
});

test("default lookup is company scoped", async () => {
  let observed;
  const result = await getDefaultFinancialYear(4, {
    query: async (sql, params) => {
      observed = { sql, params };
      return [[fyRow()]];
    },
  });
  assert.match(observed.sql, /company_id=\? AND is_default=1/);
  assert.deepEqual(observed.params, [4]);
  assert.equal(result.id, 21);
});

test("lifecycle history is scoped by both company and financial year", async () => {
  let observed;
  const events = await listFinancialYearEvents(4, 21, {
    query: async (sql, params) => {
      observed = { sql, params };
      return [[{
        id: 31, company_id: 4, financial_year_id: 21, event_type: "CREATE",
        previous_status: null, new_status: "OPEN", reason: null,
        actor_user_id: 13, metadata: '{"source":"API"}', occurred_at: "event-time",
      }]];
    },
  });
  assert.match(observed.sql, /WHERE e\.company_id=\? AND e\.financial_year_id=\?/);
  assert.deepEqual(observed.params, [4, 21]);
  assert.deepEqual(events[0].metadata, { source: "API" });
});
