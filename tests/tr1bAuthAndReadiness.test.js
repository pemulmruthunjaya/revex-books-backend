const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { CHECK_CONTRACT, COLUMN_CONTRACT, FOREIGN_KEY_CONTRACT, INDEX_CONTRACT, assertTrialInvitationReadiness } = require("../services/trialInvitationReadinessService");
const { validNewPassword, RESET_TOKEN } = require("../controllers/authController");

const schemaRows = () => Object.entries(COLUMN_CONTRACT).flatMap(([TABLE_NAME, columns]) => Object.entries(columns).map(([COLUMN_NAME, value]) => ({
  TABLE_NAME, COLUMN_NAME, COLUMN_TYPE: value.type, IS_NULLABLE: value.nullable ? "YES" : "NO", COLUMN_DEFAULT: value.defaultValue,
  EXTRA: value.extra, CHARACTER_SET_NAME: value.charset, COLLATION_NAME: value.collation,
})));
const indexRows = () => INDEX_CONTRACT.flatMap(([TABLE_NAME, INDEX_NAME, nonUnique, columns]) => columns.map((COLUMN_NAME, index) => ({ TABLE_NAME, INDEX_NAME, NON_UNIQUE: Number(nonUnique), SEQ_IN_INDEX: index + 1, COLUMN_NAME, SUB_PART: null })));
const foreignKeyRows = () => FOREIGN_KEY_CONTRACT.map(([TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME]) => ({ TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME, UPDATE_RULE: "RESTRICT", DELETE_RULE: "RESTRICT" }));
const checkRows = () => Object.entries(CHECK_CONTRACT).map(([CONSTRAINT_NAME, CHECK_CLAUSE]) => ({ CONSTRAINT_NAME, CHECK_CLAUSE }));
const readyExecutor = (mutate = () => {}) => ({ async query(sql) {
  assert.match(sql, /^SELECT /);
  if (sql.includes("information_schema.TABLES")) { const rows = [{ TABLE_NAME: "companies", TABLE_TYPE: "BASE TABLE", COLUMN_NAME: "status", COLUMN_TYPE: "enum('active','inactive')", IS_NULLABLE: "YES", COLUMN_DEFAULT: "active", EXTRA: "" }]; mutate("company", rows); return [rows]; }
  if (sql.includes("information_schema.COLUMNS")) { const rows = schemaRows(); mutate("columns", rows); return [rows]; }
  if (sql.includes("information_schema.STATISTICS")) { const rows = indexRows(); mutate("indexes", rows); return [rows]; }
  if (sql.includes("REFERENTIAL_CONSTRAINTS")) { const rows = foreignKeyRows(); mutate("foreignKeys", rows); return [rows]; }
  if (sql.includes("CHECK_CONSTRAINTS")) { const rows = checkRows(); mutate("checks", rows); return [rows]; }
  throw new Error(sql);
} });

test("readiness uses five SELECT-only probes and validates exact columns, ordered indexes, foreign keys and checks", async () => {
  const calls = []; const executor = readyExecutor((kind) => calls.push(kind)); await assertTrialInvitationReadiness({ executor, environment: { TRIAL_REQUEST_INTAKE_ENABLED: "false" } }); assert.deepEqual(calls, ["company", "columns", "indexes", "foreignKeys", "checks"]);
});
test("readiness fails closed on wrong types, index order, FK rule or check clause", async () => {
  const mutations = [
    (kind, rows) => { if (kind === "columns") rows.find((row) => row.TABLE_NAME === "trial_requests" && row.COLUMN_NAME === "public_reference").COLLATION_NAME = "ascii_general_ci"; },
    (kind, rows) => { if (kind === "indexes") rows.find((row) => row.INDEX_NAME === "idx_trial_requests_status_created").SUB_PART = 8; },
    (kind, rows) => { if (kind === "foreignKeys") rows[0].DELETE_RULE = "CASCADE"; },
    (kind, rows) => { if (kind === "checks") rows[0].CHECK_CLAUSE = "1=1"; },
  ];
  for (const mutate of mutations) await assert.rejects(assertTrialInvitationReadiness({ executor: readyExecutor(mutate), environment: { TRIAL_REQUEST_INTAKE_ENABLED: "false" } }), (error) => error.code === "TR1B_SCHEMA_NOT_READY");
});
test("readiness requires a strong gateway secret only when intake is enabled and never exposes it", async () => {
  const hidden = "synthetic-hostile-secret-value"; await assert.rejects(assertTrialInvitationReadiness({ executor: readyExecutor(), environment: { TRIAL_REQUEST_INTAKE_ENABLED: "true", TRIAL_REQUEST_GATEWAY_SECRET: hidden, TRIAL_REQUEST_ALLOWED_ORIGIN: "https://revexbooks.com" } }), (error) => error.code === "TR1B_GATEWAY_CONFIGURATION_INVALID" && !error.message.includes(hidden));
  await assertTrialInvitationReadiness({ executor: readyExecutor(), environment: { TRIAL_REQUEST_INTAKE_ENABLED: "true", TRIAL_REQUEST_GATEWAY_SECRET: Buffer.alloc(32, 1).toString("base64url"), TRIAL_REQUEST_ALLOWED_ORIGIN: "https://revexbooks.com" } });
});
test("password contract uses Unicode code points, exact token syntax and 72 UTF-8 bytes", () => {
  assert.equal(validNewPassword("💩".repeat(8)), true); assert.equal(validNewPassword("💩".repeat(19)), false); assert.equal(validNewPassword(12345678), false); assert.equal(validNewPassword("1234567"), false);
  assert.equal(RESET_TOKEN.test(Buffer.alloc(32, 1).toString("base64url")), true); assert.equal(RESET_TOKEN.test("A".repeat(64)), false);
});
test("authentication source enforces activation, bounded parsing and purpose-separated reset state", () => {
  const root = path.resolve(__dirname, ".."); const auth = fs.readFileSync(path.join(root, "controllers/authController.js"), "utf8"); const middleware = fs.readFileSync(path.join(root, "middleware/authMiddleware.js"), "utf8"); const index = fs.readFileSync(path.join(root, "index.js"), "utf8");
  assert.match(auth, /Number\(user\.activation_required\) === 1/); assert.match(auth, /activation_required = 0/); assert.match(auth, /affectedRows !== 1/); assert.match(auth, /Array\.from\(value\)\.length >= 8/);
  assert.match(auth, /WHERE id = \? AND password_reset_token_hash = \?/); assert.match(middleware, /Number\(user\.activation_required\) === 1/);
  const assembly = fs.readFileSync(path.join(root, "middleware/applicationAssembly.js"), "utf8");
  assert.match(index, /assembleApplicationBoundary\(app/);
  assert.ok(assembly.indexOf('app.use("/api/auth", boundedAuthJson') >= 0);
  assert.ok(assembly.indexOf('app.use("/api/auth", boundedAuthJson') < assembly.indexOf("app.use(express.json"));
});

test("readiness treats canonical company status as a separate existing-schema prerequisite", async () => {
  assert.equal(Object.hasOwn(COLUMN_CONTRACT, "companies"), false);
  assert.equal(Object.keys(COLUMN_CONTRACT).filter((name) => name !== "users").length, 5);
  assert.equal(INDEX_CONTRACT.some(([table]) => table === "companies"), false);
  const failures = [
    ["missing table or status column", (rows) => rows.splice(0)],
    ["duplicate metadata", (rows) => rows.push({ ...rows[0] })],
    ...Object.entries({ TABLE_NAME: "other", TABLE_TYPE: "VIEW", COLUMN_NAME: "other", COLUMN_TYPE: "varchar(30)", IS_NULLABLE: "NO", COLUMN_DEFAULT: "inactive", EXTRA: "VIRTUAL GENERATED" }).map(([field, value]) => [field, (rows) => { rows[0][field] = value; }]),
    ["missing column type", (rows) => { delete rows[0].COLUMN_TYPE; }],
    ["null default", (rows) => { rows[0].COLUMN_DEFAULT = null; }],
    ["missing default", (rows) => { delete rows[0].COLUMN_DEFAULT; }],
    ["incomplete enum", (rows) => { rows[0].COLUMN_TYPE = "enum('active')"; }],
    ["extra enum value", (rows) => { rows[0].COLUMN_TYPE = "enum('active','inactive','enabled')"; }],
  ];
  for (const [label, change] of failures) {
    const probes = [];
    await assert.rejects(assertTrialInvitationReadiness({ executor: readyExecutor((kind, rows) => { probes.push(kind); if (kind === "company") change(rows); }), environment: { TRIAL_REQUEST_INTAKE_ENABLED: "false" } }), { code: "TR1B_SCHEMA_NOT_READY" }, label);
    assert.deepEqual(probes, ["company"], label);
  }
});
