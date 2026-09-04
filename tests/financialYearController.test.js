const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createFinancialYearController,
} = require("../controllers/financialYearController");
const { FinancialYearServiceError } = require("../services/financialYearService");

const year = (overrides = {}) => ({
  id: 21,
  company_id: 4,
  code: "FY26",
  name: "FY 2026-27",
  start_date: "2026-04-01",
  end_date: "2027-03-31",
  status: "OPEN",
  is_default: true,
  ...overrides,
});

const response = () => {
  const calls = { status: [], body: [] };
  return {
    calls,
    status(code) { calls.status.push(code); return this; },
    json(body) { calls.body.push(body); return this; },
  };
};

const request = (overrides = {}) => ({
  user: { user_id: 13, company_id: 4, role: "owner", access_role: "owner" },
  params: {}, query: {}, body: {}, ...overrides,
});

const invoke = async (handler, req) => {
  const res = response();
  await handler(req, res);
  return res.calls;
};

test("authenticated list, get, and default use only authenticated company", async () => {
  const calls = [];
  const service = {
    listFinancialYears: async (companyId) => { calls.push(["list", companyId]); return [year()]; },
    getFinancialYear: async (companyId, id) => { calls.push(["get", companyId, id]); return year(); },
    getDefaultFinancialYear: async (companyId) => { calls.push(["default", companyId]); return year(); },
  };
  const controller = createFinancialYearController({ service, logger: { error() {} } });
  assert.equal((await invoke(controller.list, request({ query: { company_id: 999 } }))).body[0].data.length, 1);
  assert.equal((await invoke(controller.getOne, request({ params: { id: "21", company_id: 999 } }))).body[0].data.id, 21);
  assert.equal((await invoke(controller.getDefault, request())).body[0].data.is_default, true);
  assert.deepEqual(calls, [["list", 4], ["get", 4, "21"], ["default", 4]]);
});

test("resolve preserves exact first/last dates and returns controlled no-match", async () => {
  const dates = [];
  const service = {
    resolveFinancialYearForDate: async (companyId, date) => {
      dates.push([companyId, date]);
      return date === "2028-04-01" ? null : year();
    },
  };
  const controller = createFinancialYearController({ service, logger: { error() {} } });
  for (const date of ["2026-04-01", "2027-03-31"]) {
    const result = await invoke(controller.resolve, request({ query: { date } }));
    assert.equal(result.body[0].data.id, 21);
  }
  const missing = await invoke(controller.resolve, request({ query: { date: "2028-04-01" } }));
  assert.equal(missing.status[0], 404);
  assert.equal(missing.body[0].code, "FINANCIAL_YEAR_NOT_FOUND_FOR_DATE");
  assert.deepEqual(dates, [[4, "2026-04-01"], [4, "2027-03-31"], [4, "2028-04-01"]]);
});

test("invalid resolve date is mapped without SQL detail", async () => {
  const service = {
    resolveFinancialYearForDate: async () => {
      throw new FinancialYearServiceError("INVALID_DATE", "internal date parser detail", 400);
    },
  };
  const result = await invoke(
    createFinancialYearController({ service, logger: { error() {} } }).resolve,
    request({ query: { date: "04/01/2026" } })
  );
  assert.equal(result.status[0], 400);
  assert.deepEqual(result.body[0], { success: false, code: "INVALID_DATE", message: "Invalid accounting date" });
});

test("authorized create passes only approved fields and server identity", async () => {
  let input;
  const service = { createFinancialYear: async (value) => { input = value; return year(); } };
  const controller = createFinancialYearController({ service, logger: { error() {} } });
  const result = await invoke(controller.create, request({ body: {
    code: "FY26", name: "FY 2026-27", start_date: "2026-04-01",
    end_date: "2027-03-31", status: "OPEN", is_default: true,
  } }));
  assert.equal(result.status[0], 201);
  assert.deepEqual(input, {
    companyId: 4, code: "FY26", name: "FY 2026-27", startDate: "2026-04-01",
    endDate: "2027-03-31", status: "OPEN", isDefault: true, source: "API",
    actorUserId: 13, reason: "Financial year created",
  });
});

test("client-controlled company, actor, timestamp, and internal fields are rejected", async () => {
  let serviceCalls = 0;
  const controller = createFinancialYearController({
    service: { createFinancialYear: async () => { serviceCalls += 1; } },
    logger: { error() {} },
  });
  for (const field of ["company_id", "created_by", "actor_user_id", "created_at", "source", "default_company_id"]) {
    const result = await invoke(controller.create, request({ body: { code: "FY26", [field]: 999 } }));
    assert.equal(result.status[0], 400);
    assert.equal(result.body[0].code, "UNSUPPORTED_FIELD");
  }
  assert.equal(serviceCalls, 0);
});

test("known create errors have stable safe responses", async () => {
  for (const [code, status] of [
    ["FINANCIAL_YEAR_OVERLAP", 409],
    ["DUPLICATE_FINANCIAL_YEAR_CODE", 409],
    ["INVALID_DATE_RANGE", 400],
  ]) {
    const service = { createFinancialYear: async () => { throw new FinancialYearServiceError(code, "raw SQL trigger detail"); } };
    const result = await invoke(createFinancialYearController({ service, logger: { error() {} } }).create, request({ body: {
      code: "FY26", start_date: "2026-04-01", end_date: "2027-03-31",
    } }));
    assert.equal(result.status[0], status);
    assert.equal(result.body[0].code, code);
    assert.doesNotMatch(JSON.stringify(result.body[0]), /SQL|trigger/i);
  }
});

test("set default is company scoped and server controlled", async () => {
  let input;
  const service = { setDefaultFinancialYear: async (value) => { input = value; return year(); } };
  const controller = createFinancialYearController({ service, logger: { error() {} } });
  const result = await invoke(controller.setDefault, request({ params: { id: "21" } }));
  assert.equal(result.body[0].data.is_default, true);
  assert.deepEqual(input, {
    companyId: 4, financialYearId: "21", actorUserId: 13,
    reason: "Default financial year changed",
  });
  const rejected = await invoke(controller.setDefault, request({ params: { id: "21" }, body: { company_id: 9 } }));
  assert.equal(rejected.status[0], 400);
});

test("events require an FY in the authenticated company before reading history", async () => {
  const calls = [];
  const service = {
    getFinancialYear: async (companyId, id) => { calls.push(["year", companyId, id]); return id === "99" ? null : year(); },
    listFinancialYearEvents: async (companyId, id) => { calls.push(["events", companyId, id]); return [{ id: 1, event_type: "CREATE" }]; },
  };
  const controller = createFinancialYearController({ service, logger: { error() {} } });
  const found = await invoke(controller.events, request({ params: { id: "21" } }));
  assert.equal(found.body[0].data[0].event_type, "CREATE");
  const hidden = await invoke(controller.events, request({ params: { id: "99" } }));
  assert.equal(hidden.status[0], 404);
  assert.deepEqual(calls, [["year", 4, "21"], ["events", 4, "21"], ["year", 4, "99"]]);
});

test("cross-company FY reads and defaults surface as not found without changing tenant context", async () => {
  const calls = [];
  const service = {
    getFinancialYear: async (companyId, id) => { calls.push(["get", companyId, id]); return null; },
    setDefaultFinancialYear: async (input) => {
      calls.push(["set", input.companyId, input.financialYearId]);
      throw new FinancialYearServiceError("FINANCIAL_YEAR_NOT_FOUND", "hidden", 404);
    },
  };
  const controller = createFinancialYearController({ service, logger: { error() {} } });
  const read = await invoke(controller.getOne, request({ params: { id: "88" }, query: { company_id: 9 } }));
  const events = await invoke(controller.events, request({ params: { id: "88" } }));
  const changed = await invoke(controller.setDefault, request({ params: { id: "88" } }));
  assert.equal(read.status[0], 404);
  assert.equal(events.status[0], 404);
  assert.equal(changed.status[0], 404);
  assert.deepEqual(calls, [["get", 4, "88"], ["get", 4, "88"], ["set", 4, "88"]]);
});

test("missing authenticated company context is rejected before service access", async () => {
  let called = false;
  const controller = createFinancialYearController({
    service: { listFinancialYears: async () => { called = true; } },
    logger: { error() {} },
  });
  const result = await invoke(controller.list, request({ user: {} }));
  assert.equal(result.status[0], 401);
  assert.equal(result.body[0].code, "COMPANY_CONTEXT_REQUIRED");
  assert.equal(called, false);
});

test("unexpected service failures never expose database internals", async () => {
  const logs = [];
  const controller = createFinancialYearController({
    service: { listFinancialYears: async () => { throw new Error("SELECT password FROM secret_table"); } },
    logger: { error: (...args) => logs.push(args) },
  });
  const result = await invoke(controller.list, request());
  assert.equal(result.status[0], 500);
  assert.equal(result.body[0].code, "FINANCIAL_YEAR_OPERATION_FAILED");
  assert.doesNotMatch(JSON.stringify(result.body[0]), /SELECT|password|secret_table/i);
  assert.equal(logs.length, 1);
});
