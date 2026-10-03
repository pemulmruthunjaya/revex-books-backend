// Excluded from non-live validation. Requires a separately authorized EMPTY
// disposable schema. Never cleans up or overwrites an existing schema.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { assertSafeTr1bMysqlTarget } = require("./helpers/tr1bMysqlTestGuard");
const target = assertSafeTr1bMysqlTarget(process.env.TR1B_TEST_DATABASE_URL);
// Server identity is independent of the guarded client transport endpoint.
function assertTr1bMysqlServerIdentity(identity, target, environment) {
  const expectedVersion = environment.TR1B_TEST_EXPECTED_MYSQL_VERSION;
  assert.match(expectedVersion || "", /^(?:0|[1-9]\d{0,2})\.(?:0|[1-9]\d{0,2})\.(?:0|[1-9]\d{0,2})$(?![\s\S])/, "Require an exact MySQL version expectation");
  assert.equal(identity.name, target.database);
  assert.equal(identity.version, expectedVersion);
  const internalPort = Number(identity.port);
  assert.ok(Number.isSafeInteger(internalPort) && internalPort >= 1 && internalPort <= 65535, "Invalid MySQL internal listening port");
  const expectedInternalPort = environment.TR1B_TEST_EXPECTED_INTERNAL_PORT;
  if (expectedInternalPort !== undefined) {
    assert.match(expectedInternalPort, /^[1-9]\d{0,4}$(?![\s\S])/, "Require an exact internal port expectation");
    assert.ok(Number(expectedInternalPort) <= 65535);
    assert.equal(internalPort, Number(expectedInternalPort));
  }
}
const mysql = require("mysql2/promise");
const { submitTrialRequest, reserveRateCapacity, POLICY_VERSION } = require("../services/trialRequestService");
const { approveTrialRequest, resendTrialInvitation, activateAccount } = require("../services/trialInvitationService");
const { assertTrialInvitationReadiness } = require("../services/trialInvitationReadinessService");
const read = (name) => fs.readFileSync(path.join(__dirname, "../db/migrations", name), "utf8");
const migration = read("2026-09-29-trial-request-invitation-activation.sql");
const foundation = read("2026-08-18-subscription-foundation.sql");
const environment = { TRIAL_REQUEST_APPROVAL_ENABLED: "true", TRIAL_REQUEST_INTAKE_ENABLED: "false" };
let pool, serial = 1000;
const key = () => crypto.randomUUID();
const ip = () => crypto.randomBytes(32).toString("hex");
const body = () => { const n = ++serial; return { full_name: "Synthetic Owner", company_name: `Synthetic ${n}`, email: `synthetic${n}@example.test`, mobile: `+91900000${String(n).padStart(4, "0")}`, city: "Pune", country: "IN", business_type: "services", note: "", privacy_communications_consent: true, privacy_policy_version: POLICY_VERSION, website: "" }; };
const input = (data = body(), clientIpHash = ip(), idempotencyKey = key()) => ({ body: data, gateway: { clientIpHash, idempotencyKey } });
const submit = (value, executor = pool) => submitTrialRequest(value, { executor });
const rows = async (sql, params = []) => (await pool.query(sql, params))[0];
const count = async (table) => Number((await rows(`SELECT COUNT(*) n FROM ${table}`))[0].n);
const scaffold = Object.freeze(["companies", "users", "user_company_memberships", "branches", "user_branch_memberships", "business_profiles", "company_business_settings", "company_subscriptions", "subscription_periods", "subscription_events", "trial_invitations", "trial_invitation_operations"]);
const snapshot = async () => Object.fromEntries(await Promise.all(scaffold.map(async (table) => [table, await count(table)])));
const successes = (results) => results.filter((r) => r.status === "fulfilled").length;
const pending = async () => { const value = input(); await submit(value); return (await rows("SELECT id FROM trial_requests WHERE email=?", [value.body.email]))[0].id; };
const approvalInput = (requestId) => ({ requestId, expectedVersion: 1, idempotencyKey: key(), admin: { id: 1 } });
const options = (executor = pool, send = async () => ({ sent: true })) => ({ executor, environment, send });

// Real SQL and real transaction first; faults are injected only afterward.
// Provisioning, subscriptions, result rows and locking are NOT mocked.
const observed = (afterQuery = async (_sql, _params, result) => result, beforeQuery = (_sql, params) => params) => {
  const events = []; let acquisitions = 0, writes = 0;
  return { events, get acquisitions() { return acquisitions; }, get writes() { return writes; }, query: (...args) => pool.query(...args),
    async getConnection() {
      acquisitions += 1; const connection = await pool.getConnection();
      return { async beginTransaction() { events.push("BEGIN"); return connection.beginTransaction(); },
        async commit() { events.push("COMMIT"); return connection.commit(); },
        async rollback() { events.push("ROLLBACK"); return connection.rollback(); },
        release() { events.push("RELEASE"); connection.release(); }, destroy() { connection.destroy(); },
        async query(sql, params) { events.push(sql); const result = await connection.query(sql, beforeQuery(sql, params)); if (/^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql)) writes += 1; return afterQuery(sql, params, result, { writes, connection }); },
      };
    },
  };
};

test.before(async () => {
  const url = new URL(process.env.TR1B_TEST_DATABASE_URL);
  pool = mysql.createPool({ ...target, user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), connectionLimit: 10, multipleStatements: true, timezone: "Z" });
  const connection = await pool.getConnection();
  try {
    const [[identity]] = await connection.query("SELECT DATABASE() name,VERSION() version,@@port port");
    assertTr1bMysqlServerIdentity(identity, target, process.env);
    const [existing] = await connection.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()");
    assert.equal(existing.length, 0, "Refuse to reuse any existing schema");
    await connection.query(`
      CREATE TABLE plans (id INT PRIMARY KEY,code VARCHAR(50),name VARCHAR(100),price DECIMAL(12,2),is_active TINYINT DEFAULT 1,default_trial_days INT DEFAULT 14,max_users INT,max_staff INT) ENGINE=InnoDB;
      CREATE TABLE companies (id INT AUTO_INCREMENT PRIMARY KEY,name VARCHAR(150),email VARCHAR(254) UNIQUE,plan_id INT,status ENUM('active','inactive') DEFAULT 'active') ENGINE=InnoDB;
      CREATE TABLE users (id INT AUTO_INCREMENT PRIMARY KEY,name VARCHAR(100),email VARCHAR(254) UNIQUE,password VARCHAR(255),company_id INT,role VARCHAR(30),access_role VARCHAR(30),is_active TINYINT DEFAULT 1,must_change_password TINYINT DEFAULT 0,password_changed_at DATETIME(6),password_reset_token_hash BINARY(32),password_reset_expires_at DATETIME(6)) ENGINE=InnoDB;
      CREATE TABLE platform_admins (id BIGINT UNSIGNED PRIMARY KEY) ENGINE=InnoDB;
      CREATE TABLE user_company_memberships (id INT AUTO_INCREMENT PRIMARY KEY,user_id INT,company_id INT,membership_role VARCHAR(30),is_default TINYINT,is_active TINYINT,UNIQUE(user_id,company_id)) ENGINE=InnoDB;
      CREATE TABLE branches (id INT AUTO_INCREMENT PRIMARY KEY,company_id INT,name VARCHAR(100),code VARCHAR(30),branch_type VARCHAR(30),is_head_office TINYINT,is_active TINYINT,created_by INT) ENGINE=InnoDB;
      CREATE TABLE user_branch_memberships (id INT AUTO_INCREMENT PRIMARY KEY,user_id INT,company_id INT,branch_id INT,is_default TINYINT,is_active TINYINT) ENGINE=InnoDB;
      CREATE TABLE business_profiles (id INT AUTO_INCREMENT PRIMARY KEY,company_id INT UNIQUE,name VARCHAR(150),email VARCHAR(254)) ENGINE=InnoDB;
      CREATE TABLE company_business_settings (id INT AUTO_INCREMENT PRIMARY KEY,company_id INT UNIQUE,industry_type VARCHAR(40),city VARCHAR(100)) ENGINE=InnoDB;
      INSERT INTO plans VALUES (2,'PLAN_2','Pro',100,1,14,10,10);
      INSERT INTO platform_admins VALUES (1);
      INSERT INTO users (name,email,password) VALUES ('Existing synthetic','existing@example.test','not-a-login');
    `);
    for (const name of ["company_subscriptions", "subscription_periods", "subscription_events"]) {
      const statement = foundation.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\([\\s\\S]*?ENGINE=InnoDB[^;]*;`));
      assert.ok(statement, `Missing real subscription foundation: ${name}`); await connection.query(statement[0]);
    }
    await connection.query(migration); await connection.query(migration);
  } finally { connection.release(); }
});
test.after(async () => { if (pool) await pool.end(); });

test("real migration twice, legacy defaults, exact readiness and incompatible named index rejection", async () => {
  await assertTrialInvitationReadiness({ executor: pool, environment });
  assert.equal((await rows("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='companies' AND COLUMN_NAME='is_active'")).length, 0);
  assert.equal(Number((await rows("SELECT activation_required FROM users WHERE email='existing@example.test'"))[0].activation_required), 0);
  await pool.query("ALTER TABLE trial_requests DROP INDEX idx_trial_requests_status_created, ADD INDEX idx_trial_requests_status_created(created_at,status)");
  await assert.rejects(assertTrialInvitationReadiness({ executor: pool, environment }), { code: "TR1B_SCHEMA_NOT_READY" });
  const connection = await pool.getConnection();
  try { await assert.rejects(connection.query(migration)); } finally { connection.release(); }
  await pool.query("ALTER TABLE trial_requests DROP INDEX idx_trial_requests_status_created, ADD INDEX idx_trial_requests_status_created(status,created_at)");
  await assertTrialInvitationReadiness({ executor: pool, environment });
});

test("six real concurrent intakes consume five durable slots; replay and rollback are quota-free", async () => {
  const hash = ip(), requests = Array.from({ length: 6 }, () => input(body(), hash));
  const outcomes = await Promise.allSettled(requests.map((value) => submit(value)));
  assert.equal(successes(outcomes), 5); assert.equal(outcomes.find((r) => r.status === "rejected").reason.code, "TRIAL_REQUEST_RATE_LIMITED");
  const quota = async () => Number((await rows("SELECT SUM(request_count) n FROM trial_request_rate_buckets WHERE client_ip_hash=UNHEX(?)", [hash]))[0].n);
  assert.equal(await quota(), 5);
  assert.equal(Number((await rows("SELECT COUNT(*) n FROM trial_request_submissions WHERE client_ip_hash=UNHEX(?)", [hash]))[0].n), 5);
  const winner = outcomes.findIndex((r) => r.status === "fulfilled"); assert.deepEqual(await submit(requests[winner]), outcomes[winner].value); assert.equal(await quota(), 5);
  const failed = input(), executor = observed((sql, params, result) => { if (sql.startsWith("INSERT INTO trial_requests")) throw new Error("synthetic after-write failure"); return result; });
  await assert.rejects(submit(failed, executor)); assert.equal(executor.acquisitions, 1);
  assert.equal((await rows("SELECT id FROM trial_request_submissions WHERE idempotency_key=?", [failed.gateway.idempotencyKey])).length, 0);
  assert.equal((await rows("SELECT request_count FROM trial_request_rate_buckets WHERE client_ip_hash=UNHEX(?)", [failed.gateway.clientIpHash])).length, 0);
});

test("real UTC bucket capture remains stable while a session crosses the boundary", async () => {
  const connection = await pool.getConnection(), hash = ip(); const before = 1800000899, after = before + 1;
  try {
    await connection.query("SET time_zone='+05:30'"); await connection.query("SET timestamp=?", [before]); await connection.beginTransaction();
    const wrapper = { async query(sql, params) { const result = await connection.query(sql, params); if (sql.startsWith("SELECT FLOOR")) await connection.query("SET timestamp=?", [after]); return result; } };
    await reserveRateCapacity(wrapper, hash); await connection.commit();
    const [stored] = await connection.query("SELECT bucket_number,request_count FROM trial_request_rate_buckets WHERE client_ip_hash=UNHEX(?)", [hash]);
    assert.equal(stored.length, 1); assert.equal(Number(stored[0].bucket_number), Math.floor(before / 900)); assert.equal(Number(stored[0].request_count), 1);
    await connection.beginTransaction(); await reserveRateCapacity(connection, hash); await connection.commit();
    const [next] = await connection.query("SELECT bucket_number FROM trial_request_rate_buckets WHERE client_ip_hash=UNHEX(?) ORDER BY bucket_number", [hash]);
    assert.deepEqual(next.map((r) => Number(r.bucket_number)), [Math.floor(before / 900), Math.floor(after / 900)]);
  } finally { await connection.rollback(); await connection.query("SET timestamp=0"); await connection.query("SET time_zone='+00:00'"); connection.release(); }
});

test("real same-key replay/conflict and normalized contact races disclose no existing reference", async () => {
  const same = input(); const replies = await Promise.all([submit(same), submit(same)]); assert.deepEqual(replies[0], replies[1]);
  const conflicting = input(), other = { ...conflicting, body: { ...conflicting.body, company_name: "Different intent" } };
  const outcomes = await Promise.allSettled([submit(conflicting), submit(other)]); assert.equal(successes(outcomes), 1); assert.equal(outcomes.find((r) => r.status === "rejected").reason.code, "TRIAL_REQUEST_IDEMPOTENCY_CONFLICT");
  for (const field of ["email", "mobile"]) {
    const a = body(), b = body(); b[field] = field === "email" ? ` ${a.email.toUpperCase()} ` : ` ${a.mobile} `;
    const values = [input(a), input(b)]; const results = await Promise.all(values.map((v) => submit(v)));
    assert.notEqual(results[0].request_reference, results[1].request_reference);
    const durable = await rows("SELECT response_reference,status,trial_request_id FROM trial_request_submissions WHERE idempotency_key IN (?,?)", values.map((v) => v.gateway.idempotencyKey));
    assert.deepEqual(durable.map((r) => r.status).sort(), ["accepted", "suppressed"]); assert.equal(durable[0].trial_request_id, durable[1].trial_request_id);
    const [request] = await rows("SELECT public_reference FROM trial_requests WHERE id=?", [durable[0].trial_request_id]);
    for (let i = 0; i < 2; i += 1) { assert.notEqual(results[i].request_reference, request.public_reference); assert.deepEqual(await submit(values[i]), results[i]); }
  }
});

test("real approval rolls back after EACH of fourteen provisioning writes without mail or retry", async () => {
  // Seven scaffold inserts; subscription/company/period/event; invitation,
  // operation, request. Failure is injected AFTER each real write succeeds.
  for (let stage = 1; stage <= 14; stage += 1) {
    const requestId = await pending(), before = await snapshot(); let sends = 0;
    const executor = observed((sql, params, result, context) => { if (context.writes === stage && /^\s*(INSERT|UPDATE)\b/i.test(sql)) throw new Error("synthetic stage failure"); return result; });
    await assert.rejects(approveTrialRequest(approvalInput(requestId), options(executor, async () => { sends += 1; return { sent: true }; })));
    assert.equal(executor.writes, stage); assert.equal(executor.acquisitions, 1); assert.equal(sends, 0); assert.deepEqual(await snapshot(), before);
    assert.equal((await rows("SELECT status FROM trial_requests WHERE id=?", [requestId]))[0].status, "pending");
    assert.equal(executor.events.filter((e) => e === "ROLLBACK").length, 1); assert.equal(executor.events.includes("COMMIT"), false);
  }
});

const approved = async () => {
  const requestId = await pending(), tokens = [], executor = observed();
  const send = async ({ token }) => { tokens.push(token); return { sent: true }; };
  await approveTrialRequest(approvalInput(requestId), options(executor, send));
  const [invitation] = await rows("SELECT * FROM trial_invitations WHERE trial_request_id=?", [requestId]);
  return { requestId, tokens, executor, send, invitation };
};
const resendInput = (requestId) => ({ requestId, expectedVersion: 2, idempotencyKey: key(), admin: { id: 1 } });
const cooldown = (requestId) => pool.query("UPDATE trial_invitations SET last_sent_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 11 MINUTE) WHERE trial_request_id=?", [requestId]);
const activate = (token, executor = pool) => activateAccount({ token, password: "Synthetic-test-password" }, { executor });

test("real approval race provisions once and locks company/subscription/plan in order", async () => {
  const requestId = await pending(), executor = observed(); let sends = 0;
  const outcomes = await Promise.allSettled([1, 2].map(() => approveTrialRequest(approvalInput(requestId), options(executor, async () => { sends += 1; return { sent: true }; }))));
  assert.equal(successes(outcomes), 1); assert.equal(sends, 1); assert.equal(executor.acquisitions, 2);
  assert.equal((await rows("SELECT id FROM trial_invitations WHERE trial_request_id=?", [requestId])).length, 1);
  const fixture = await approved(); const locks = fixture.executor.events.filter((sql) => /FOR UPDATE/.test(sql));
  const company = locks.findIndex((sql) => /SELECT id, status, plan_id/.test(sql)); assert.ok(company >= 0);
  assert.match(locks[company + 1], /FROM company_subscriptions/); assert.match(locks[company + 2], /FROM plans/);
  const [duration] = await rows("SELECT TIMESTAMPDIFF(DAY,trial_start_at,trial_end_at) days FROM trial_invitations WHERE trial_request_id=?", [fixture.requestId]); assert.equal(Number(duration.days), 14);
});

test("real resend/resend rotates once; old generation invalid; activation/activation commits once without extension", async () => {
  const fixture = await approved(); await cooldown(fixture.requestId); const executor = observed();
  const outcomes = await Promise.allSettled([1, 2].map(() => resendTrialInvitation(resendInput(fixture.requestId), options(executor, fixture.send))));
  assert.equal(successes(outcomes), 1); assert.equal(executor.acquisitions, 2); assert.equal(fixture.tokens.length, 2);
  await assert.rejects(activate(fixture.tokens[0]), { code: "ACTIVATION_INVALID" });
  const activationExecutor = observed(); const activated = await Promise.allSettled([activate(fixture.tokens[1], activationExecutor), activate(fixture.tokens[1], activationExecutor)]);
  assert.equal(successes(activated), 1); assert.equal(activationExecutor.acquisitions, 2);
  const [state] = await rows("SELECT * FROM trial_invitations WHERE trial_request_id=?", [fixture.requestId]);
  assert.equal(state.status, "activated"); assert.equal(state.token_hash, null); assert.equal(Number(state.token_generation), 2);
  assert.deepEqual(state.trial_start_at, fixture.invitation.trial_start_at); assert.deepEqual(state.trial_end_at, fixture.invitation.trial_end_at);
  assert.equal(Number((await rows("SELECT COUNT(*) n FROM trial_invitation_operations WHERE trial_invitation_id=? AND operation_type='activate'", [state.id]))[0].n), 1);
});

test("real resend/activation permits only one transition and no automatic retry", async () => {
  const fixture = await approved(); await cooldown(fixture.requestId); const executor = observed();
  const results = await Promise.allSettled([resendTrialInvitation(resendInput(fixture.requestId), options(executor, fixture.send)), activate(fixture.tokens[0], executor)]);
  assert.equal(successes(results), 1); assert.equal(executor.acquisitions, 2);
  const [state] = await rows("SELECT * FROM trial_invitations WHERE trial_request_id=?", [fixture.requestId]);
  assert.deepEqual(state.trial_end_at, fixture.invitation.trial_end_at); assert.deepEqual(state.trial_start_at, fixture.invitation.trial_start_at);
  assert.ok((state.status === "activated" && Number(state.token_generation) === 1) || (state.status === "pending_activation" && Number(state.token_generation) === 2));
});

test("real affectedRows failures roll back approval, resend and both activation updates without mail/retry", async () => {
  for (const mode of ["approve", "resend", "user", "invitation"]) {
    const fixture = mode === "approve" ? { requestId: await pending() } : await approved(); if (mode === "resend") await cooldown(fixture.requestId);
    const before = await snapshot(), beforeRows = await rows("SELECT * FROM trial_invitations WHERE trial_request_id=?", [fixture.requestId]);
    let altered = 0, sends = 0;
    const executor = observed(undefined, (sql, params) => {
      const match = mode === "approve" ? /^UPDATE trial_requests/ : mode === "user" ? /^UPDATE users/ : /^UPDATE trial_invitations/;
      // Force the actual optimistic WHERE predicate to miss. The real driver
      // returns affectedRows=0; no result packet is fabricated.
      if (match.test(sql)) { altered += 1; const values = [...params]; values[values.length - 1] = mode === "invitation" ? "0".repeat(64) : -1; return values; } return params;
    });
    const opts = options(executor, async () => { sends += 1; return { sent: true }; });
    await assert.rejects(mode === "approve" ? approveTrialRequest(approvalInput(fixture.requestId), opts) : mode === "resend" ? resendTrialInvitation(resendInput(fixture.requestId), opts) : activate(fixture.tokens[0], executor));
    assert.equal(altered, 1); assert.equal(executor.acquisitions, 1); assert.equal(sends, 0);
    assert.deepEqual(await snapshot(), before); assert.deepEqual(await rows("SELECT * FROM trial_invitations WHERE trial_request_id=?", [fixture.requestId]), beforeRows);
  }
});

test("real readiness rejects incompatible column metadata and accepts restored contract", async () => {
  await pool.query("ALTER TABLE trial_requests MODIFY note VARCHAR(501) NULL");
  await assert.rejects(assertTrialInvitationReadiness({ executor: pool, environment }), { code: "TR1B_SCHEMA_NOT_READY" });
  await pool.query("ALTER TABLE trial_requests MODIFY note VARCHAR(500) NULL");
  await assertTrialInvitationReadiness({ executor: pool, environment });
});

test("canonical company status without is_active gates real resend and activation without writes or delivery", async () => {
  const fixture = await approved(); await cooldown(fixture.requestId);
  for (const companyStatus of ["inactive", null]) {
    await pool.query("UPDATE companies SET status=? WHERE id=?", [companyStatus, fixture.invitation.company_id]);
    const before = await snapshot(), beforeRows = await rows("SELECT * FROM trial_invitations WHERE id=?", [fixture.invitation.id]); let sends = 0;
    const resendExecutor = observed();
    await assert.rejects(resendTrialInvitation(resendInput(fixture.requestId), options(resendExecutor, async () => { sends += 1; return { sent: true }; })), { code: "TRIAL_INVITATION_INELIGIBLE" });
    const activationExecutor = observed(); await assert.rejects(activate(fixture.tokens[0], activationExecutor), { code: "ACTIVATION_INVALID" });
    for (const executor of [resendExecutor, activationExecutor]) {
      assert.equal(executor.writes, 0); assert.equal(executor.acquisitions, 1);
      assert.equal(executor.events.includes("COMMIT"), false); assert.equal(executor.events.filter((event) => event === "ROLLBACK").length, 1);
    }
    assert.equal(sends, 0); assert.deepEqual(await snapshot(), before); assert.deepEqual(await rows("SELECT * FROM trial_invitations WHERE id=?", [fixture.invitation.id]), beforeRows);
  }
  await pool.query("UPDATE companies SET status='active' WHERE id=?", [fixture.invitation.company_id]);
  await resendTrialInvitation(resendInput(fixture.requestId), options(pool, fixture.send));
  assert.deepEqual(await activate(fixture.tokens[1]), { code: "ACCOUNT_ACTIVATED" });
});
