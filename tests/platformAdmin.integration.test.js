const assert = require("node:assert/strict");
const mysql = require("mysql2/promise");

const expectedDatabase = "revex_platform_admin_integration_20260821";
for (const name of ["REVEX_INTEGRATION_DB_HOST", "REVEX_INTEGRATION_DB_PORT", "REVEX_INTEGRATION_DB_USER", "REVEX_INTEGRATION_DB_PASSWORD", "REVEX_INTEGRATION_DB_NAME", "JWT_SECRET"]) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}
if (process.env.REVEX_INTEGRATION_DB_HOST !== "127.0.0.1" || process.env.REVEX_INTEGRATION_DB_NAME !== expectedDatabase) {
  throw new Error("Platform integration tests require the named disposable local database");
}

const pool = mysql.createPool({
  host: "127.0.0.1",
  port: Number(process.env.REVEX_INTEGRATION_DB_PORT),
  user: process.env.REVEX_INTEGRATION_DB_USER,
  password: process.env.REVEX_INTEGRATION_DB_PASSWORD,
  database: expectedDatabase,
  timezone: "Z",
  connectionLimit: 4,
});
const db = require("../db/connection");
const originalQuery = db.query;
const originalGetConnection = db.getConnection;
db.query = pool.query.bind(pool);
db.getConnection = pool.getConnection.bind(pool);

const { createPlatformAdmin, authenticatePlatformAdmin } = require("../services/platformAdminService");
const { createPlatformAuthMiddleware } = require("../middleware/platformAuthMiddleware");
const { activatePlatformSubscription } = require("../controllers/platformSubscriptionController");
const { getSubscriptionStatus } = require("../controllers/subscriptionController");
const { signAuthToken, verifyAuthToken } = require("../utils/jwtToken");

const invoke = async (handler, req) => {
  const calls = { status: [], json: [], next: 0 };
  const res = {
    status(code) { calls.status.push(code); return this; },
    json(body) { calls.json.push(body); return this; },
  };
  await handler(req, res, () => { calls.next += 1; });
  return calls;
};

const createExpiredTrial = async (planId) => {
  const [company] = await pool.query(
    "INSERT INTO companies (name, status, plan_id) VALUES (?, 'active', ?)",
    [`Platform Integration ${Date.now()} ${Math.random()}`, planId]
  );
  await pool.query(
    `INSERT INTO company_subscriptions
      (company_id, plan_id, status, billing_cycle, trial_start_at, trial_end_at,
       trial_duration_days, current_period_start_at, current_period_end_at,
       activation_source, auto_renew)
     VALUES (?, ?, 'expired', 'none', DATE_SUB(UTC_TIMESTAMP(), INTERVAL 15 DAY),
       DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY), 14,
       DATE_SUB(UTC_TIMESTAMP(), INTERVAL 15 DAY), DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY),
       'integration_test', 0)`,
    [company.insertId, planId]
  );
  const [[subscription]] = await pool.query("SELECT * FROM company_subscriptions WHERE company_id=?", [company.insertId]);
  await pool.query(
    `INSERT INTO subscription_periods
      (subscription_id, company_id, plan_id, period_type, billing_cycle, starts_at, ends_at, status, source_key, currency)
     VALUES (?, ?, ?, 'trial', 'none', ?, ?, 'completed', ?, 'INR')`,
    [subscription.id, company.insertId, planId, subscription.trial_start_at, subscription.trial_end_at, `platform-trial-${company.insertId}`]
  );
  return { companyId: Number(company.insertId), subscriptionId: Number(subscription.id) };
};

const checks = [];
const check = (name, fn) => checks.push({ name, fn });
let admin;
let token;
let plan;

check("disposable schema has idempotent platform table and local MySQL", async () => {
  const [[row]] = await pool.query("SELECT VERSION() version, DATABASE() database_name");
  assert.equal(row.database_name, expectedDatabase);
  assert.match(row.version, /^8\.0\./);
  const [[table]] = await pool.query("SELECT COUNT(*) count FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='platform_admins'");
  assert.equal(Number(table.count), 1);
});

check("creates one hashed platform administrator and prevents duplicate email", async () => {
  admin = await createPlatformAdmin({ name: "Integration Admin", email: "platform.integration@revex.test", password: "integration-password" });
  const [[stored]] = await pool.query("SELECT * FROM platform_admins WHERE id=?", [admin.id]);
  assert.notEqual(stored.password_hash, "integration-password");
  await assert.rejects(createPlatformAdmin({ name: "Duplicate", email: "PLATFORM.INTEGRATION@REVEX.TEST", password: "integration-password" }), (error) => error.code === "PLATFORM_ADMIN_EXISTS");
});

check("login validates password, status, and explicit JWT claims", async () => {
  const result = await authenticatePlatformAdmin({ email: admin.email, password: "integration-password" });
  token = result.token;
  const claims = verifyAuthToken(token);
  assert.equal(claims.sub, String(admin.id));
  assert.equal(claims.actor_type, "platform_admin");
  assert.equal(claims.role, "platform_admin");
  assert.equal(claims.company_id, undefined);
  await assert.rejects(authenticatePlatformAdmin({ email: admin.email, password: "wrong-password" }), (error) => error.code === "INVALID_CREDENTIALS");
  await pool.query("UPDATE platform_admins SET status='disabled' WHERE id=?", [admin.id]);
  await assert.rejects(authenticatePlatformAdmin({ email: admin.email, password: "integration-password" }), (error) => error.code === "PLATFORM_ADMIN_DISABLED");
  await pool.query("UPDATE platform_admins SET status='active' WHERE id=?", [admin.id]);
});

check("platform middleware rejects tenant tokens and accepts active platform admin", async () => {
  const middleware = createPlatformAuthMiddleware();
  for (const auth of [
    undefined,
    "Bearer invalid",
    `Bearer ${signAuthToken({ user_id: 1, company_id: 1, role: "owner" })}`,
    `Bearer ${signAuthToken({ user_id: 2, company_id: 1, role: "staff" })}`,
  ]) {
    const result = await invoke(middleware, { headers: { authorization: auth } });
    assert.equal(result.next, 0);
  }
  const req = { headers: { authorization: `Bearer ${token}` } };
  const allowed = await invoke(middleware, req);
  assert.equal(allowed.next, 1);
  assert.equal(req.platformAdmin.id, admin.id);
});

for (const cycle of ["monthly", "annual"]) {
  check(`${cycle} platform activation writes period, audit, plan and valid status`, async () => {
    const fixture = await createExpiredTrial(plan.id);
    const req = {
      platformAdmin: admin,
      body: { company_id: fixture.companyId, plan_code: plan.code, billing_cycle: cycle, request_id: `platform-${cycle}-${fixture.companyId}` },
    };
    const first = await invoke(activatePlatformSubscription, req);
    const second = await invoke(activatePlatformSubscription, req);
    assert.equal(first.status[0], 200);
    assert.equal(second.status[0], 200);
    assert.equal(first.json[0].access.valid, true);
    const [[state]] = await pool.query(
      `SELECT c.plan_id company_plan_id, cs.status, cs.billing_cycle,
        TIMESTAMPDIFF(MONTH, cs.current_period_start_at, cs.current_period_end_at) period_months,
        (SELECT COUNT(*) FROM subscription_periods sp WHERE sp.subscription_id=cs.id AND sp.period_type='paid') paid_periods,
        (SELECT COUNT(*) FROM subscription_events se WHERE se.subscription_id=cs.id AND se.event_type='activated') activation_events
       FROM companies c JOIN company_subscriptions cs ON cs.company_id=c.id WHERE c.id=?`,
      [fixture.companyId]
    );
    assert.equal(state.company_plan_id, plan.id);
    assert.equal(state.status, "active");
    assert.equal(state.billing_cycle, cycle);
    assert.equal(Number(state.period_months), cycle === "monthly" ? 1 : 12);
    assert.equal(Number(state.paid_periods), 1);
    assert.equal(Number(state.activation_events), 1);
    const [[event]] = await pool.query("SELECT actor_type, actor_user_id, metadata FROM subscription_events WHERE subscription_id=? AND event_type='activated'", [fixture.subscriptionId]);
    assert.equal(event.actor_type, "platform_admin");
    assert.equal(event.actor_user_id, null);
    const metadata = typeof event.metadata === "string" ? JSON.parse(event.metadata) : event.metadata;
    assert.equal(Number(metadata.actor_metadata.platform_admin_id), admin.id);
    const status = await invoke(getSubscriptionStatus, { user: { company_id: fixture.companyId } });
    assert.equal(status.json[0].access.valid, true);
    assert.equal(status.json[0].subscription.status, "active");
  });
}

check("late audit failure rolls back platform activation", async () => {
  const fixture = await createExpiredTrial(plan.id);
  const [[before]] = await pool.query("SELECT c.plan_id, cs.status, cs.version FROM companies c JOIN company_subscriptions cs ON cs.company_id=c.id WHERE c.id=?", [fixture.companyId]);
  await pool.query(`ALTER TABLE subscription_events ADD CONSTRAINT chk_platform_integration_rollback CHECK (NOT (event_type='activated' AND company_id=${fixture.companyId}))`);
  try {
    const result = await invoke(activatePlatformSubscription, {
      platformAdmin: admin,
      body: { company_id: fixture.companyId, plan_code: plan.code, billing_cycle: "monthly", request_id: `platform-rollback-${fixture.companyId}` },
    });
    assert.equal(result.status[0], 500);
  } finally {
    await pool.query("ALTER TABLE subscription_events DROP CHECK chk_platform_integration_rollback");
  }
  const [[after]] = await pool.query("SELECT c.plan_id, cs.status, cs.version FROM companies c JOIN company_subscriptions cs ON cs.company_id=c.id WHERE c.id=?", [fixture.companyId]);
  assert.deepEqual(after, before);
  const [[counts]] = await pool.query("SELECT COUNT(*) count FROM subscription_periods WHERE subscription_id=? AND period_type='paid'", [fixture.subscriptionId]);
  assert.equal(Number(counts.count), 0);
});

const run = async () => {
  const [[selectedPlan]] = await pool.query("SELECT id, code FROM plans WHERE code='PLAN_2' AND is_active=1 LIMIT 1");
  if (!selectedPlan) throw new Error("Active PLAN_2 fixture is required");
  plan = { id: Number(selectedPlan.id), code: selectedPlan.code };
  let passed = 0;
  for (const item of checks) {
    await item.fn();
    console.log(`ok ${++passed} - ${item.name}`);
  }
  console.log(`Platform admin real-MySQL integration: ${passed} checks passed`);
};

run()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => {
    db.query = originalQuery;
    db.getConnection = originalGetConnection;
    await pool.end();
  });
