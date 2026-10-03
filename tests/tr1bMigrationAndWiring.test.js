const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const { assertSafeTr1bMysqlTarget } = require("./helpers/tr1bMysqlTestGuard");

test("TR-1B migration is additive, idempotent and stores hashes rather than secrets", () => {
  const sql = read("db/migrations/2026-09-29-trial-request-invitation-activation.sql");
  for (const table of ["trial_requests", "trial_request_submissions", "trial_request_rate_buckets", "trial_invitations", "trial_invitation_operations"]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(sql, /activation_required TINYINT\(1\) NOT NULL DEFAULT 0/); assert.match(sql, /activated_at DATETIME\(6\) NULL/);
  assert.match(sql, /token_hash BINARY\(32\)/); assert.match(sql, /intent_hash BINARY\(32\)/); assert.match(sql, /public_reference VARCHAR\(32\) CHARACTER SET ascii COLLATE ascii_bin/); assert.doesNotMatch(sql, /raw_token|email_body|plaintext_password|connection_uri/i);
  assert.match(sql, /uq_trial_requests_email/); assert.match(sql, /uq_trial_request_submission_key/); assert.match(sql, /migration_error_tr1b_schema_incompatible/);
  assert.match(sql, /@new_table_column_count=69/); assert.match(sql, /@required_invitation_types=34/); assert.match(sql, /SEQ_IN_INDEX/); assert.match(sql, /REFERENCED_TABLE_NAME/); assert.match(sql, /CHECK_CLAUSE/);
  assert.doesNotMatch(sql, /INSERT INTO (?:trial_requests|trial_invitations|companies|users)/i);
});
test("public activation and intake routes are mounted while production registration fails closed", () => {
  const index = read("index.js"), auth = read("routes/authRoutes.js"), controller = read("controllers/authController.js");
  assert.match(index, /assembleApplicationBoundary\(app/); assert.match(read("middleware/applicationAssembly.js"), /app\.use\("\/api\/public", publicTrialRequestRoutes\)/); assert.match(auth, /post\("\/activate-account"/);
  assert.match(controller, /process\.env\.NODE_ENV === "production"/); assert.match(controller, /status\(404\)/);
});
test("approval routes are platform-authenticated and there is no revocation mutation", () => {
  const routes = read("routes/platformRoutes.js");
  assert.match(read("routes/platformAuthRoutes.js"), /get\("\/me"/);
  for (const route of ["/trial-requests", "/trial-requests/:requestId", "/trial-requests/:requestId/approve", "/trial-requests/:requestId/resend"]) assert.ok(routes.includes(route));
  assert.doesNotMatch(routes, /revoke/i); assert.equal((routes.match(/trialInvitations\.(?:approve|resend)/g) || []).length, 2);
});
test("launch gates default off and no module sends mail on import", () => {
  const env = read(".env.example"); assert.match(env, /TRIAL_REQUEST_INTAKE_ENABLED=false/); assert.match(env, /TRIAL_REQUEST_APPROVAL_ENABLED=false/);
  const service = read("services/trialInvitationService.js"); assert.doesNotMatch(service, /^sendTrialActivation\(/m);
});
test("isolated MySQL harness refuses missing, port-3306, non-loopback, Railway and unsafe database targets", () => {
  for (const value of [undefined, "mysql://u:p@127.0.0.1:3306/revex_tr1b_test_x", "mysql://u:p@example.test:3307/revex_tr1b_test_x", "mysql://u:p@production.railway.internal:3307/revex_tr1b_test_x", "mysql://u:p@127.0.0.1:3307/railway"]) assert.throws(() => assertSafeTr1bMysqlTarget(value));
  const safe = assertSafeTr1bMysqlTarget("mysql://synthetic:synthetic@127.0.0.1:3307/revex_tr1b_test_local"); assert.equal(safe.port, 3307); assert.equal(safe.database, "revex_tr1b_test_local");
});

test("TR-1B company queries and isolated fixture use the canonical status field", () => {
  const service = read("services/trialInvitationService.js");
  assert.equal((service.match(/c\.status AS company_status/g) || []).length, 2);
  assert.doesNotMatch(service, /c\.is_active/);
  const fixture = read("tests/tr1bConcurrency.mysql.test.js").match(/CREATE TABLE companies \([^;]+;/)[0];
  assert.match(fixture, /status ENUM\('active','inactive'\) DEFAULT 'active'/);
  assert.doesNotMatch(fixture, /\bis_active\b/);
});
