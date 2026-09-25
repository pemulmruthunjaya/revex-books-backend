const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  assertLaunchConfiguration,
  getLaunchConfigurationIssues,
} = require("../services/launchReadinessService");
const { appUrl } = require("../services/emailService");
const { assertTableColumns } = require("../services/schemaReadinessService");
const { trialBackupUnavailable } = require("../controllers/backupController");
const { unexpectedErrorBody } = require("../utils/errorResponse");

const root = path.join(__dirname, "..");
const source = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const launchEnvironment = (overrides = {}) => ({
  NODE_ENV: "production",
  SUBSCRIPTION_ENFORCEMENT_ENABLED: "true",
  SMTP_HOST: "smtp.example.test",
  SMTP_PORT: "587",
  SMTP_USER: "mailer",
  SMTP_PASSWORD: "not-a-real-secret",
  SMTP_FROM: "support@example.test",
  APP_URL: "https://books.example.test",
  ...overrides,
});

test("production and explicit trial launch modes require exact subscription enforcement", () => {
  assert.doesNotThrow(() => assertLaunchConfiguration(launchEnvironment()));
  for (const value of [undefined, "false", "TRUE", "True", "yes", " true "]) {
    const environment = launchEnvironment({ SUBSCRIPTION_ENFORCEMENT_ENABLED: value });
    assert.ok(getLaunchConfigurationIssues(environment).some((issue) => issue.code === "SUBSCRIPTION_ENFORCEMENT_REQUIRED"));
    assert.throws(() => assertLaunchConfiguration(environment), (error) => error.code === "TRIAL_LAUNCH_CONFIGURATION_INVALID");
  }
  assert.doesNotThrow(() => assertLaunchConfiguration({ NODE_ENV: "development" }));
  assert.throws(
    () => assertLaunchConfiguration({ ...launchEnvironment(), NODE_ENV: "test", TRIAL_LAUNCH_MODE: "true", SUBSCRIPTION_ENFORCEMENT_ENABLED: "false" }),
    (error) => error.code === "TRIAL_LAUNCH_CONFIGURATION_INVALID"
  );
});

test("launch email readiness requires SMTP fields and a public HTTPS APP_URL without sending mail", () => {
  for (const variable of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM", "APP_URL"]) {
    const environment = launchEnvironment({ [variable]: "" });
    assert.ok(getLaunchConfigurationIssues(environment).some((issue) => issue.variable === variable));
  }
  for (const value of ["http://localhost:5173", "http://books.example.test", "not-a-url"]) {
    assert.throws(() => appUrl(launchEnvironment({ APP_URL: value })), (error) => error.code === "PUBLIC_APP_URL_REQUIRED");
  }
  assert.equal(appUrl(launchEnvironment()), "https://books.example.test");
  assert.equal(appUrl({ NODE_ENV: "development" }), "http://localhost:5173");
});

test("authentication and product schema readiness probes issue SELECT only and fail closed", async () => {
  const calls = [];
  const executor = { query: async (sql) => { calls.push(String(sql)); return [[{ COLUMN_NAME: "one" }]]; } };
  await assert.rejects(
    assertTableColumns({ executor, table: "example", columns: ["one", "two"], code: "EXAMPLE_SCHEMA_NOT_READY" }),
    (error) => error.status === 503 && error.code === "EXAMPLE_SCHEMA_NOT_READY"
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^SELECT\s/i);
  assert.doesNotMatch(source("services/userAccessService.js"), /CREATE TABLE|ALTER TABLE|DROP TABLE|TRUNCATE|RENAME TABLE|CREATE INDEX/i);
  assert.doesNotMatch(source("routes/productRoutes.js"), /CREATE TABLE|ALTER TABLE|DROP TABLE|TRUNCATE|RENAME TABLE|CREATE INDEX/i);
  assert.doesNotMatch(source("services/auditLogService.js"), /CREATE TABLE|ALTER TABLE|DROP TABLE|TRUNCATE|RENAME TABLE|CREATE INDEX/i);
});

test("customer backup and import surface returns one controlled error before legacy helpers", () => {
  const res = { statusCode: null, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  trialBackupUnavailable({}, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "TRIAL_BACKUP_NOT_AVAILABLE");
  const routes = source("routes/backupRoutes.js");
  assert.doesNotMatch(routes, /exportCompanyBackup|exportModuleData|importMasterData|importTransactions|getDataHistory|rollbackImport/);
  assert.match(routes, /router\.post\("\/restore\/preview", previewRestoreBackup\)/);
});

test("unexpected error contract is sanitized and carries the request id", () => {
  const body = unexpectedErrorBody("req-123");
  assert.deepEqual(body, {
    success: false,
    message: "An unexpected error occurred",
    code: "INTERNAL_SERVER_ERROR",
    request_id: "req-123",
  });
  assert.doesNotMatch(JSON.stringify(body), /sql|password|stack|filesystem|ENOENT/i);
});

test("controlled migration owns exactly the eight runtime user-access columns and is idempotent", () => {
  const migration = source("db/migrations/2026-08-29-user-invitation-session-security-foundation.sql");
  for (const column of ["access_role", "permissions", "is_active", "last_login_at", "must_change_password", "password_reset_token_hash", "password_reset_expires_at", "password_changed_at"]) {
    assert.match(migration, new RegExp(`COLUMN_NAME='${column}'`));
  }
  assert.doesNotMatch(migration, /invitation_status|invitation_token_hash|token_version|CREATE PROCEDURE|DROP PROCEDURE/i);
  assert.match(migration, /IF\(EXISTS\(/);
  assert.match(migration, /users_unchanged/);
});
