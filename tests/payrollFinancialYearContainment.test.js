const assert = require("node:assert/strict");
const test = require("node:test");

const db = require("../db/connection");
const payrollService = require("../services/payrollService");

const originalEnsurePayrollTables = payrollService.ensurePayrollTables;
payrollService.ensurePayrollTables = async () => {};
delete require.cache[require.resolve("../controllers/payrollController")];
const payrollController = require("../controllers/payrollController");
payrollService.ensurePayrollTables = originalEnsurePayrollTables;

const restrictedStatuses = {
  DRAFT: "FINANCIAL_YEAR_DRAFT",
  RECONCILIATION: "FINANCIAL_YEAR_RECONCILIATION_RESTRICTED",
  CLOSING: "FINANCIAL_YEAR_CLOSING_RESTRICTED",
  CLOSED: "FINANCIAL_YEAR_CLOSED",
  LOCKED: "FINANCIAL_YEAR_LOCKED",
};

const fy = (id, status = "OPEN") => ({
  id,
  company_id: 4,
  code: `FY-${id}`,
  name: `FY ${id}`,
  start_date: id === 41 ? "2025-04-01" : "2026-04-01",
  end_date: id === 41 ? "2026-03-31" : "2027-03-31",
  status,
  is_default: id === 42 ? 1 : 0,
  source: "manual",
  created_by: null,
  created_at: null,
  updated_at: null,
});

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const baseEntryBody = (overrides = {}) => ({
  employee_id: 7,
  payroll_month: "2026-04",
  basic_salary: 25000,
  status: "Unpaid",
  ...overrides,
});

const request = (body = {}, id = "91") => ({
  body,
  params: { id },
  user: { company_id: 4, user_id: 8 },
});

const withConnection = async (connection, action) => {
  const originalGetConnection = db.getConnection;
  db.getConnection = async () => connection;
  try {
    return await action();
  } finally {
    db.getConnection = originalGetConnection;
  }
};

const transactionConnection = (query) => {
  const state = { begun: 0, committed: 0, rolledBack: 0, released: 0, calls: [] };
  return {
    state,
    async beginTransaction() { state.begun += 1; },
    async commit() { state.committed += 1; },
    async rollback() { state.rolledBack += 1; },
    release() { state.released += 1; },
    async query(sql, params = []) {
      const text = String(sql);
      state.calls.push({ text, params });
      return query(text, params, state);
    },
  };
};

const lifecycleRows = (mode, status = "OPEN") => {
  if (mode === "ZERO_MATCH") return [];
  if (mode === "MULTIPLE_MATCH") return [fy(42), { ...fy(42), id: 43 }];
  return [fy(42, status)];
};

const createConnection = (mode = "OPEN") => transactionConnection(async (sql, params) => {
  if (sql.includes("FROM financial_years")) return [lifecycleRows(mode, mode)];
  if (sql.includes("FROM payroll_employees")) {
    assert.deepEqual(params, [7, 4]);
    return [[{ id: 7, name: "Asha", monthly_salary: 25000 }]];
  }
  if (sql.includes("INSERT INTO payroll_entries")) return [{ insertId: 91 }];
  throw new Error(`Unexpected create SQL: ${sql}`);
});

test("Payroll create uses payroll_month date, authenticated tenant, transaction, and centralized OPEN posting guard", async () => {
  const connection = createConnection("OPEN");
  const res = response();
  await withConnection(connection, () => payrollController.createPayrollEntry(
    request(baseEntryBody({ payment_date: "2030-12-31", working_fy_id: 999 })),
    res
  ));

  assert.equal(res.statusCode, 201);
  assert.deepEqual(connection.state, {
    begun: 1,
    committed: 1,
    rolledBack: 0,
    released: 1,
    calls: connection.state.calls,
  });
  const fyCall = connection.state.calls.find(({ text }) => text.includes("FROM financial_years"));
  assert.deepEqual(fyCall.params, [4, "2026-04-01"]);
  assert.equal(fyCall.params.includes("2030-12-31"), false);
  const insert = connection.state.calls.find(({ text }) => text.includes("INSERT INTO payroll_entries"));
  assert.equal(insert.params[0], 4);
  assert.equal(insert.params[4], "2026-04-01");
  assert.equal(insert.params.includes(999), false);
});

test("Payroll create blocks every restricted, missing, or ambiguous FY before employee lookup/insert and rolls back", async (t) => {
  const cases = [
    ...Object.entries(restrictedStatuses),
    ["ZERO_MATCH", "FINANCIAL_YEAR_NOT_FOUND_FOR_DATE"],
    ["MULTIPLE_MATCH", "FINANCIAL_YEAR_AMBIGUOUS"],
  ];
  for (const [mode, code] of cases) {
    await t.test(mode, async () => {
      const connection = createConnection(mode);
      const res = response();
      await withConnection(connection, () => payrollController.createPayrollEntry(request(baseEntryBody()), res));
      assert.equal(res.statusCode, 409);
      assert.equal(res.body.code, code);
      assert.equal(connection.state.committed, 0);
      assert.equal(connection.state.rolledBack, 1);
      assert.equal(connection.state.calls.some(({ text }) => text.includes("FROM payroll_employees")), false);
      assert.equal(connection.state.calls.some(({ text }) => text.includes("INSERT INTO payroll_entries")), false);
    });
  }
});

test("invalid or client-controlled Payroll periods fail before connection or writes", async () => {
  const originalGetConnection = db.getConnection;
  let connections = 0;
  db.getConnection = async () => { connections += 1; throw new Error("connection must not be acquired"); };
  try {
    for (const payroll_month of ["2026-00", "2026-13", "bad-month"]) {
      const res = response();
      await payrollController.createPayrollEntry(request(baseEntryBody({ payroll_month })), res);
      assert.equal(res.statusCode, 400);
    }
    const res = response();
    await payrollController.createPayrollEntry(
      request(baseEntryBody({ financial_year_id: 42 })),
      res
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, "CLIENT_FINANCIAL_YEAR_NOT_ALLOWED");
    assert.equal(connections, 0);
  } finally {
    db.getConnection = originalGetConnection;
  }
});

const mutationConnection = ({ mode = "OPEN", operation }) => transactionConnection(async (sql, params) => {
  if (sql.includes("FROM payroll_entries") && sql.includes("FOR UPDATE")) {
    assert.deepEqual(params, ["91", 4]);
    return [[{ id: 91, payroll_date: "2026-04-01" }]];
  }
  if (sql.includes("FROM financial_years") && /AND id=\?/.test(sql)) {
    return [[fy(42, mode)]];
  }
  if (sql.includes("FROM financial_years")) return [lifecycleRows(mode, mode)];
  if (operation === "status" && sql.includes("UPDATE payroll_entries")) return [{ affectedRows: 1 }];
  if (operation === "delete" && sql.includes("DELETE FROM payroll_entries")) return [{ affectedRows: 1 }];
  throw new Error(`Unexpected mutation SQL: ${sql}`);
});

for (const [label, handler, operation] of [
  ["status/payment", payrollController.updatePayrollEntryStatus, "status"],
  ["delete", payrollController.deletePayrollEntry, "delete"],
]) {
  test(`Payroll ${label} allows OPEN and locks/reads by authenticated tenant before mutation`, async () => {
    const connection = mutationConnection({ mode: "OPEN", operation });
    const res = response();
    const body = operation === "status"
      ? { status: "Paid", payment_date: "2030-12-31", working_fy_id: 999 }
      : {};
    await withConnection(connection, () => handler(request(body), res));
    assert.equal(res.statusCode, 200);
    assert.equal(connection.state.committed, 1);
    assert.equal(connection.state.rolledBack, 0);
    const fyCalls = connection.state.calls.filter(({ text }) => text.includes("FROM financial_years"));
    assert.deepEqual(fyCalls[0].params, [4, "2026-04-01"]);
    assert.equal(fyCalls.some(({ params }) => params.includes("2030-12-31")), false);
    const write = connection.state.calls.find(({ text }) =>
      operation === "status" ? text.includes("UPDATE payroll_entries") : text.includes("DELETE FROM payroll_entries")
    );
    assert.equal(write.params.at(-1), 4);
  });

  test(`Payroll ${label} blocks every restricted, missing, or ambiguous source FY and preserves the row`, async (t) => {
    const cases = [
      ...Object.entries(restrictedStatuses),
      ["ZERO_MATCH", "FINANCIAL_YEAR_NOT_FOUND_FOR_DATE"],
      ["MULTIPLE_MATCH", "FINANCIAL_YEAR_AMBIGUOUS"],
    ];
    for (const [mode, code] of cases) {
      await t.test(mode, async () => {
        const connection = mutationConnection({ mode, operation });
        const res = response();
        const body = operation === "status" ? { status: "Paid", payment_date: "2030-12-31" } : {};
        await withConnection(connection, () => handler(request(body), res));
        assert.equal(res.statusCode, 409);
        assert.equal(res.body.code, code);
        assert.equal(connection.state.committed, 0);
        assert.equal(connection.state.rolledBack, 1);
        const mutatingSql = operation === "status" ? "UPDATE payroll_entries" : "DELETE FROM payroll_entries";
        assert.equal(connection.state.calls.some(({ text }) => text.includes(mutatingSql)), false);
      });
    }
  });
}

const attendanceRow = (month, code = "E1") => ({
  "Employee Code": code,
  "Payroll Month": month,
  "Working Days": 20,
  "Present Days": 20,
});

const importConnection = ({
  targetModeByDate = {},
  existingByMonth = {},
  sourceStatusById = {},
} = {}) => transactionConnection(async (sql, params) => {
  if (sql.includes("INSERT INTO payroll_attendance_imports")) return [{ insertId: 51 }];
  if (sql.includes("FROM payroll_employees")) {
    assert.equal(params[0], 4);
    return [[{ id: params.at(-1) === "E2" ? 8 : 7, name: params.at(-1), monthly_salary: 20000 }]];
  }
  if (sql.includes("FROM payroll_entries") && sql.includes("FOR UPDATE")) {
    assert.equal(params[0], 4);
    const existing = existingByMonth[params[2]];
    return [existing ? [{ id: existing.id, payroll_date: existing.payroll_date }] : []];
  }
  if (sql.includes("FROM financial_years") && /AND id=\?/.test(sql)) {
    const id = Number(params[1]);
    return [[fy(id, sourceStatusById[id] || "OPEN")]];
  }
  if (sql.includes("FROM financial_years")) {
    const date = params[1];
    const mode = targetModeByDate[date] || "OPEN";
    if (mode === "ZERO_MATCH") return [[]];
    if (mode === "MULTIPLE_MATCH") return [[fy(42), { ...fy(42), id: 43 }]];
    const id = date < "2026-04-01" ? 41 : 42;
    return [[fy(id, mode)]];
  }
  if (sql.includes("INSERT INTO payroll_entries")) {
    const month = params[3];
    return [{ affectedRows: existingByMonth[month] ? 2 : 1 }];
  }
  if (sql.includes("INSERT INTO payroll_attendance_lines")) return [{ affectedRows: 1 }];
  if (sql.includes("UPDATE payroll_attendance_imports")) return [{ affectedRows: 1 }];
  throw new Error(`Unexpected import SQL: ${sql}`);
});

const runImport = async (connection, rows, payroll_month = "2026-04") => {
  const res = response();
  await withConnection(connection, () => payrollController.importAttendance(
    request({ rows, payroll_month, standard_hours_per_day: 8 }),
    res
  ));
  return res;
};

test("attendance import permits one or multiple OPEN FYs and independently resolves each target date", async () => {
  for (const rows of [
    [attendanceRow("2026-04")],
    [attendanceRow("2026-03", "E1"), attendanceRow("2026-04", "E2")],
  ]) {
    const connection = importConnection();
    const res = await runImport(connection, rows);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.summary.created, rows.length);
    assert.equal(connection.state.committed, 1);
    assert.equal(connection.state.rolledBack, 0);
    const targetDates = connection.state.calls
      .filter(({ text }) => text.includes("FROM financial_years") && text.includes("FOR SHARE"))
      .map(({ params }) => params[1]);
    assert.deepEqual(targetDates, rows.map((row) => `${row["Payroll Month"]}-01`));
  }
});

test("every attendance target FY containment error is fatal, never skipped, and rolls back header/lines/payroll writes", async (t) => {
  const cases = [
    ...Object.entries(restrictedStatuses),
    ["ZERO_MATCH", "FINANCIAL_YEAR_NOT_FOUND_FOR_DATE"],
    ["MULTIPLE_MATCH", "FINANCIAL_YEAR_AMBIGUOUS"],
  ];
  for (const [mode, code] of cases) {
    await t.test(mode, async () => {
      const connection = importConnection({ targetModeByDate: { "2026-04-01": mode } });
      const res = await runImport(connection, [attendanceRow("2026-04")]);
      assert.equal(res.statusCode, 409);
      assert.equal(res.body.code, code);
      assert.equal(connection.state.committed, 0);
      assert.equal(connection.state.rolledBack, 1);
      assert.equal(connection.state.calls.some(({ text }) => text.includes("INSERT INTO payroll_attendance_imports")), true);
      assert.equal(connection.state.calls.some(({ text }) => text.includes("INSERT INTO payroll_entries")), false);
      assert.equal(connection.state.calls.some(({ text }) => text.includes("INSERT INTO payroll_attendance_lines")), false);
    });
  }
});

test("mixed OPEN plus restricted/missing/ambiguous rows rolls back earlier created and attendance rows", async (t) => {
  const cases = ["CLOSED", "ZERO_MATCH", "MULTIPLE_MATCH"];
  for (const mode of cases) {
    await t.test(mode, async () => {
      const connection = importConnection({ targetModeByDate: { "2026-05-01": mode } });
      const res = await runImport(connection, [attendanceRow("2026-04", "E1"), attendanceRow("2026-05", "E2")]);
      assert.equal(res.statusCode, 409);
      assert.equal(connection.state.committed, 0);
      assert.equal(connection.state.rolledBack, 1);
      assert.equal(connection.state.calls.filter(({ text }) => text.includes("INSERT INTO payroll_entries")).length, 1);
      assert.equal(connection.state.calls.filter(({ text }) => text.includes("INSERT INTO payroll_attendance_lines")).length, 1);
    });
  }
});

test("attendance upsert enforces existing source FY before target and blocks restricted-source escape", async () => {
  const connection = importConnection({
    existingByMonth: { "2026-04": { id: 91, payroll_date: "2026-03-31" } },
    sourceStatusById: { 41: "CLOSED" },
  });
  const res = await runImport(connection, [attendanceRow("2026-04")]);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, "FINANCIAL_YEAR_CLOSED");
  assert.equal(connection.state.rolledBack, 1);
  assert.equal(connection.state.calls.some(({ text }) => text.includes("INSERT INTO payroll_entries")), false);
  const fyCalls = connection.state.calls.filter(({ text }) => text.includes("FROM financial_years"));
  assert.deepEqual(fyCalls[0].params, [4, "2026-03-31"]);
  assert.deepEqual(fyCalls[1].params, [4, 41]);
});

test("attendance upsert blocks restricted target after permitted source and allows OPEN source/target updates", async () => {
  const existingByMonth = { "2026-04": { id: 91, payroll_date: "2026-03-31" } };
  const blocked = importConnection({
    existingByMonth,
    targetModeByDate: { "2026-04-01": "LOCKED" },
  });
  const blockedRes = await runImport(blocked, [attendanceRow("2026-04")]);
  assert.equal(blockedRes.statusCode, 409);
  assert.equal(blockedRes.body.code, "FINANCIAL_YEAR_LOCKED");
  assert.equal(blocked.state.rolledBack, 1);
  assert.equal(blocked.state.calls.some(({ text }) => text.includes("INSERT INTO payroll_entries")), false);

  const allowed = importConnection({ existingByMonth });
  const allowedRes = await runImport(allowed, [attendanceRow("2026-04")]);
  assert.equal(allowedRes.statusCode, 200);
  assert.equal(allowedRes.body.summary.updated, 1);
  assert.equal(allowed.state.committed, 1);
});

test("mixed import rollback also contains an earlier updated Payroll row", async () => {
  const connection = importConnection({
    existingByMonth: { "2026-04": { id: 91, payroll_date: "2026-04-01" } },
    targetModeByDate: { "2026-05-01": "RECONCILIATION" },
  });
  const res = await runImport(connection, [attendanceRow("2026-04", "E1"), attendanceRow("2026-05", "E2")]);
  assert.equal(res.statusCode, 409);
  assert.equal(connection.state.rolledBack, 1);
  assert.equal(connection.state.committed, 0);
  assert.equal(connection.state.calls.filter(({ text }) => text.includes("INSERT INTO payroll_entries")).length, 1);
});

test("attendance invalid fallback months fail before transaction and invalid row months never write Payroll", async () => {
  for (const month of ["2026-00", "2026-13", "malformed"]) {
    const connection = importConnection();
    const res = await runImport(connection, [attendanceRow("2026-04")], month);
    assert.equal(res.statusCode, 400);
    assert.equal(connection.state.begun, 0);
  }

  const connection = importConnection();
  const res = await runImport(connection, [attendanceRow("2026-00")]);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.summary.skipped, 1);
  assert.equal(connection.state.calls.some(({ text }) => text.includes("INSERT INTO payroll_entries")), false);
});

test("status and delete cannot observe or mutate a Payroll row outside the authenticated company", async () => {
  for (const [handler, body] of [
    [payrollController.updatePayrollEntryStatus, { status: "Paid" }],
    [payrollController.deletePayrollEntry, {}],
  ]) {
    const connection = transactionConnection(async (sql, params) => {
      if (sql.includes("FROM payroll_entries") && sql.includes("FOR UPDATE")) {
        assert.deepEqual(params, ["91", 4]);
        return [[]];
      }
      throw new Error(`Unexpected cross-tenant SQL: ${sql}`);
    });
    const res = response();
    await withConnection(connection, () => handler(request(body), res));
    assert.equal(res.statusCode, 404);
    assert.equal(connection.state.rolledBack, 1);
    assert.equal(connection.state.committed, 0);
    assert.equal(connection.state.calls.length, 1);
  }
});
