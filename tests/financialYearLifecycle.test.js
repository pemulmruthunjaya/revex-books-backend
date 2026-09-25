"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  TRANSITION_MATRIX,
  createFinancialYear,
  requireFinancialYearForMutation,
  requireFinancialYearForPosting,
  requireOpenStatus,
  transitionFinancialYear,
} = require("../services/financialYearService");

const row = (status, overrides = {}) => ({
  id: 21, company_id: 4, code: "FY26", name: "FY 2026-27",
  start_date: "2026-04-01", end_date: "2027-03-31", status,
  is_default: 1, source: "API", created_by: 13,
  created_at: "created", updated_at: "updated", ...overrides,
});

const executorFor = (from, to, options = {}) => {
  const calls = [];
  const connection = {
    beginTransaction: async () => calls.push("BEGIN"),
    commit: async () => calls.push("COMMIT"),
    rollback: async () => calls.push("ROLLBACK"),
    release: () => calls.push("RELEASE"),
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/SELECT id FROM companies/.test(sql)) return [[{ id: 4 }]];
      if (/LIMIT 1 FOR UPDATE/.test(sql) && /FROM financial_years/.test(sql)) return options.missing ? [[]] : [[row(from)]];
      if (/user_company_memberships/.test(sql)) return options.unauthorized ? [[]] : [[{ ok: 1 }]];
      if (/UPDATE financial_years SET status/.test(sql)) return [{ affectedRows: options.conflict ? 0 : 1 }];
      if (/INSERT INTO financial_year_events/.test(sql)) {
        if (options.eventFailure) throw new Error("EVENT_INSERT_FAILED");
        return [{ insertId: 99, affectedRows: 1 }];
      }
      if (/FROM financial_years WHERE id=\? AND company_id=\?/.test(sql)) return [[row(to)]];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  return { executor: { getConnection: async () => connection }, calls };
};

const allowed = [
  ["DRAFT", "OPEN", null, null, "OPEN"],
  ["OPEN", "RECONCILIATION", null, null, "BEGIN_RECONCILIATION"],
  ["RECONCILIATION", "OPEN", "correction", null, "REOPEN"],
  ["CLOSING", "RECONCILIATION", "more work", null, "REOPEN"],
];

for (const [from, to, reason, confirmation, event] of allowed) {
  test(`${from} -> ${to} is atomic and records ${event}`, async () => {
    const fixture = executorFor(from, to);
    const result = await transitionFinancialYear({ companyId: 4, financialYearId: 21, targetStatus: to, actorUserId: 13, reason, confirmation }, fixture.executor);
    assert.equal(result.changed, true);
    assert.equal(result.event, event);
    assert.deepEqual(fixture.calls.filter((x) => typeof x === "string"), ["BEGIN", "COMMIT", "RELEASE"]);
    const locked = fixture.calls.find((x) => x.sql?.includes("FROM financial_years") && x.sql.includes("LIMIT 1 FOR UPDATE"));
    assert.deepEqual(locked.params, [21, 4]);
    const eventCall = fixture.calls.find((x) => x.sql?.includes("INSERT INTO financial_year_events"));
    assert.deepEqual(eventCall.params.slice(0, 7), [4, 21, event, from, to, reason, 13]);
  });
}

test("all unspecified transitions are denied", async () => {
  for (const from of TRANSITION_MATRIX ? ["DRAFT","OPEN","RECONCILIATION","CLOSING","CLOSED","LOCKED"] : []) {
    for (const to of ["DRAFT","OPEN","RECONCILIATION","CLOSING","CLOSED","LOCKED"]) {
      if (from === to || TRANSITION_MATRIX[from].has(to) || ["CLOSING", "CLOSED", "LOCKED"].includes(to)) continue;
      const fixture = executorFor(from, to);
      await assert.rejects(transitionFinancialYear({ companyId: 4, financialYearId: 21, targetStatus: to, actorUserId: 13 }, fixture.executor), { code: "FINANCIAL_YEAR_TRANSITION_NOT_ALLOWED", status: 409 });
      assert.ok(fixture.calls.includes("ROLLBACK"));
    }
  }
});

test("controlled trial blocks every transition into CLOSING, CLOSED, or LOCKED before database work", async () => {
  for (const [from, to] of [["RECONCILIATION", "CLOSING"], ["CLOSING", "CLOSED"], ["CLOSED", "LOCKED"], ["LOCKED", "LOCKED"]]) {
    const fixture = executorFor(from, to);
    await assert.rejects(
      transitionFinancialYear({ companyId: 4, financialYearId: 21, targetStatus: to, actorUserId: 13, reason: "attempt", confirmation: "LOCK" }, fixture.executor),
      { code: "FINANCIAL_YEAR_CLOSE_NOT_AVAILABLE", status: 409 }
    );
    assert.deepEqual(fixture.calls, []);
  }
});

test("no-op commits without update or event", async () => {
  const fixture = executorFor("OPEN", "OPEN");
  const result = await transitionFinancialYear({ companyId: 4, financialYearId: 21, targetStatus: "OPEN", actorUserId: 13 }, fixture.executor);
  assert.equal(result.changed, false);
  assert.equal(fixture.calls.some((x) => x.sql?.startsWith("UPDATE financial_years")), false);
  assert.equal(fixture.calls.some((x) => x.sql?.includes("INSERT INTO financial_year_events")), false);
});

test("posting and mutation policy permits only OPEN", () => {
  assert.equal(requireOpenStatus(row("OPEN")).status, "OPEN");
  const codes = { DRAFT:"FINANCIAL_YEAR_DRAFT", RECONCILIATION:"FINANCIAL_YEAR_RECONCILIATION_RESTRICTED", CLOSING:"FINANCIAL_YEAR_CLOSING_RESTRICTED", CLOSED:"FINANCIAL_YEAR_CLOSED", LOCKED:"FINANCIAL_YEAR_LOCKED" };
  for (const [status, code] of Object.entries(codes)) assert.throws(() => requireOpenStatus(row(status)), { code, status: 409 });
});

test("posting and mutation guards use shared locks and remain tenant/date scoped", async () => {
  const calls = [];
  const executor = { query: async (sql, params) => {
    calls.push({ sql, params });
    return [[row("OPEN")]];
  } };
  await requireFinancialYearForPosting(4, "2026-08-12", executor);
  await requireFinancialYearForMutation(4, 21, executor);
  assert.match(calls[0].sql, /company_id=\? AND \? BETWEEN start_date AND end_date.*LIMIT 2 FOR SHARE/);
  assert.deepEqual(calls[0].params, [4, "2026-08-12"]);
  assert.match(calls[1].sql, /company_id=\? AND id=\? LIMIT 1 FOR SHARE/);
  assert.deepEqual(calls[1].params, [4, 21]);
});

test("transition requires an explicit target status", async () => {
  await assert.rejects(transitionFinancialYear({ companyId: 4, financialYearId: 21, actorUserId: 13 }, {}), {
    code: "INVALID_STATUS",
    status: 400,
  });
});

test("supported reversals require a reason", async () => {
  for (const [from, to] of [["RECONCILIATION","OPEN"],["CLOSING","RECONCILIATION"]]) {
    await assert.rejects(transitionFinancialYear({ companyId:4,financialYearId:21,targetStatus:to,actorUserId:13,confirmation:"LOCK" }, executorFor(from,to).executor), { code:"FINANCIAL_YEAR_TRANSITION_REASON_REQUIRED" });
  }
});

test("event failure and transition conflict roll back", async () => {
  for (const [options, expected] of [[{eventFailure:true},/EVENT_INSERT_FAILED/],[{conflict:true},{code:"FINANCIAL_YEAR_TRANSITION_CONFLICT"}]]) {
    const fixture=executorFor("DRAFT","OPEN",options);
    await assert.rejects(transitionFinancialYear({companyId:4,financialYearId:21,targetStatus:"OPEN",actorUserId:13},fixture.executor),expected);
    assert.ok(fixture.calls.includes("ROLLBACK"));
    assert.equal(fixture.calls.includes("COMMIT"),false);
  }
});

test("cross-company/missing and unauthorized actor fail safely", async () => {
  await assert.rejects(transitionFinancialYear({companyId:4,financialYearId:99,targetStatus:"OPEN",actorUserId:13},executorFor("DRAFT","OPEN",{missing:true}).executor),{code:"FINANCIAL_YEAR_NOT_FOUND",status:404});
  await assert.rejects(transitionFinancialYear({companyId:4,financialYearId:21,targetStatus:"OPEN",actorUserId:13},executorFor("DRAFT","OPEN",{unauthorized:true}).executor),{code:"ACTOR_COMPANY_MISMATCH",status:403});
});

test("normal creation rejects every non-DRAFT initial status", async () => {
  for (const status of ["OPEN","RECONCILIATION","CLOSING","CLOSED","LOCKED"]) {
    await assert.rejects(createFinancialYear({companyId:4,code:"X",startDate:"2030-04-01",endDate:"2031-03-31",status},{}),{code:"FINANCIAL_YEAR_INITIAL_STATUS_INVALID",status:400});
  }
});
