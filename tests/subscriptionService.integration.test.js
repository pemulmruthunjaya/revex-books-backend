const assert = require("node:assert/strict");
const mysql = require("mysql2/promise");
const db = require("../db/connection");
const {
  activateSubscription,
  createTrialCompany,
  getEffectiveSubscription,
} = require("../services/subscriptionService");

const REQUIRED_ENV = [
  "REVEX_INTEGRATION_DB_HOST",
  "REVEX_INTEGRATION_DB_PORT",
  "REVEX_INTEGRATION_DB_USER",
  "REVEX_INTEGRATION_DB_PASSWORD",
  "REVEX_INTEGRATION_DB_NAME",
];

for (const name of REQUIRED_ENV) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}
if (process.env.REVEX_INTEGRATION_DB_HOST !== "127.0.0.1") {
  throw new Error("Integration tests are restricted to 127.0.0.1");
}
if (process.env.REVEX_INTEGRATION_DB_NAME
  !== "revex_subscription_service_integration_20260820") {
  throw new Error("Unexpected integration database name");
}

const pool = mysql.createPool({
  host: process.env.REVEX_INTEGRATION_DB_HOST,
  port: Number(process.env.REVEX_INTEGRATION_DB_PORT),
  user: process.env.REVEX_INTEGRATION_DB_USER,
  password: process.env.REVEX_INTEGRATION_DB_PASSWORD,
  database: process.env.REVEX_INTEGRATION_DB_NAME,
  timezone: "Z",
  waitForConnections: true,
  connectionLimit: 4,
  queueLimit: 0,
});

const originalQuery = db.query;
const originalGetConnection = db.getConnection;
db.query = pool.query.bind(pool);
db.getConnection = pool.getConnection.bind(pool);

let sequence = 0;
const unique = (prefix) => `${prefix}_${Date.now()}_${++sequence}`;

const expectCode = async (promise, code) => {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    return true;
  });
};

const insertPlan = async ({ active = true, trialDays = 9 } = {}) => {
  const code = unique(active ? "INT_ACTIVE" : "INT_INACTIVE").slice(0, 50);
  const [result] = await pool.query(
    `INSERT INTO plans
      (code, name, price, dashboard, is_active, is_public,
       default_trial_days, max_users, max_staff, max_branches, sort_order)
     VALUES (?, ?, 100.00, 1, ?, 0, ?, 5, 4, 2, 999)`,
    [code, code, active ? 1 : 0, trialDays]
  );
  return result.insertId;
};

const insertCompany = async ({ status = "active", planId = null } = {}) => {
  const [result] = await pool.query(
    "INSERT INTO companies (name, status, plan_id) VALUES (?, ?, ?)",
    [unique("Integration Company"), status, planId]
  );
  return result.insertId;
};

const insertSubscription = async ({
  companyId,
  planId = null,
  status,
  billingCycle = "none",
  trialStart = null,
  trialEnd = null,
  periodStart = null,
  periodEnd = null,
  source = "integration_test",
}) => {
  const [result] = await pool.query(
    `INSERT INTO company_subscriptions
      (company_id, plan_id, status, billing_cycle, trial_start_at, trial_end_at,
       trial_duration_days, subscription_start_at, current_period_start_at,
       current_period_end_at, activation_source, auto_renew)
     VALUES (?, ?, ?, ?, ?, ?,
       CASE WHEN ? IS NULL OR ? IS NULL THEN NULL ELSE TIMESTAMPDIFF(DAY, ?, ?) END,
       ?, ?, ?, ?, 0)`,
    [
      companyId, planId, status, billingCycle, trialStart, trialEnd,
      trialStart, trialEnd, trialStart, trialEnd,
      periodStart, periodStart, periodEnd, source,
    ]
  );
  return result.insertId;
};

const scalar = async (sql, params = []) => {
  const [rows] = await pool.query(sql, params);
  return rows[0];
};

const checks = [];
const check = (name, fn) => checks.push({ name, fn });

let activePlanId;
let inactivePlanId;

check("local server and disposable database are selected", async () => {
  const row = await scalar(
    "SELECT @@hostname hostname, VERSION() version, DATABASE() database_name"
  );
  assert.equal(row.database_name, process.env.REVEX_INTEGRATION_DB_NAME);
  assert.match(row.version, /^8\.0\./);
});

check("legacy active subscription without expiry is valid", async () => {
  const companyId = await insertCompany();
  await insertSubscription({ companyId, status: "active", source: "legacy_migration" });
  const result = await getEffectiveSubscription(companyId);
  assert.equal(result.access.valid, true);
  assert.equal(result.access.expires_at, null);
});

check("active subscription with NULL plan is valid", async () => {
  const companyId = await insertCompany();
  await insertSubscription({ companyId, planId: null, status: "active" });
  const result = await getEffectiveSubscription(companyId);
  assert.equal(result.plan, null);
  assert.equal(result.access.valid, true);
});

check("valid trial is valid", async () => {
  const companyId = await insertCompany({ planId: activePlanId });
  await insertSubscription({
    companyId, planId: activePlanId, status: "trialing",
    trialStart: new Date(Date.now() - 86400000),
    trialEnd: new Date(Date.now() + 86400000),
  });
  const result = await getEffectiveSubscription(companyId);
  assert.equal(result.access.reason, "TRIAL_ACTIVE");
});

check("trial at or after expiry is invalid before scheduler", async () => {
  const companyId = await insertCompany({ planId: activePlanId });
  await insertSubscription({
    companyId, planId: activePlanId, status: "trialing",
    trialStart: new Date(Date.now() - 172800000),
    trialEnd: new Date(Date.now() - 86400000),
  });
  const result = await getEffectiveSubscription(companyId);
  assert.equal(result.access.valid, false);
  assert.equal(result.access.reason, "TRIAL_EXPIRED");
});

for (const [status, reason] of [
  ["suspended", "SUBSCRIPTION_SUSPENDED"],
  ["cancelled", "SUBSCRIPTION_CANCELLED"],
]) {
  check(`${status} subscription is invalid`, async () => {
    const companyId = await insertCompany({ planId: activePlanId });
    await insertSubscription({ companyId, planId: activePlanId, status });
    const result = await getEffectiveSubscription(companyId);
    assert.equal(result.access.valid, false);
    assert.equal(result.access.reason, reason);
  });
}

check("missing subscription is reported", async () => {
  const companyId = await insertCompany();
  const result = await getEffectiveSubscription(companyId);
  assert.equal(result.access.reason, "SUBSCRIPTION_NOT_PROVISIONED");
});

check("trial creation uses plan default and writes tenant history", async () => {
  const companyId = await insertCompany();
  const result = await createTrialCompany({
    companyId,
    planId: activePlanId,
    idempotencyKey: unique("trial_default"),
    actor: { type: "system", reason: "integration test" },
  });
  assert.equal(result.access.valid, true);
  const row = await scalar(
    `SELECT c.plan_id company_plan_id, cs.id subscription_id, cs.plan_id,
            cs.status, cs.trial_duration_days,
            TIMESTAMPDIFF(DAY, cs.trial_start_at, cs.trial_end_at) actual_days,
            (SELECT COUNT(*) FROM subscription_periods sp
              WHERE sp.subscription_id=cs.id AND sp.period_type='trial') trial_periods,
            (SELECT COUNT(*) FROM subscription_events se
              WHERE se.subscription_id=cs.id AND se.event_type='trial_created') trial_events
       FROM companies c JOIN company_subscriptions cs ON cs.company_id=c.id
      WHERE c.id=?`,
    [companyId]
  );
  assert.equal(row.company_plan_id, activePlanId);
  assert.equal(row.plan_id, activePlanId);
  assert.equal(row.status, "trialing");
  assert.equal(row.trial_duration_days, 9);
  assert.equal(row.actual_days, 9);
  assert.equal(row.trial_periods, 1);
  assert.equal(row.trial_events, 1);
});

check("explicit trial duration and idempotent retry work", async () => {
  const companyId = await insertCompany();
  const key = unique("trial_retry");
  const input = { companyId, planId: activePlanId, trialDays: 21, idempotencyKey: key };
  await createTrialCompany(input);
  await createTrialCompany(input);
  const row = await scalar(
    `SELECT cs.trial_duration_days,
            (SELECT COUNT(*) FROM subscription_periods WHERE subscription_id=cs.id) periods,
            (SELECT COUNT(*) FROM subscription_events WHERE subscription_id=cs.id) events
       FROM company_subscriptions cs WHERE cs.company_id=?`,
    [companyId]
  );
  assert.equal(row.trial_duration_days, 21);
  assert.equal(row.periods, 1);
  assert.equal(row.events, 1);
  await expectCode(createTrialCompany({ ...input, trialDays: 22 }), "IDEMPOTENCY_CONFLICT");
});

check("invalid trial duration is rejected", async () => {
  await expectCode(createTrialCompany({
    companyId: await insertCompany(), planId: activePlanId,
    trialDays: 366, idempotencyKey: unique("invalid_trial"),
  }), "INVALID_TRIAL_DURATION");
});

check("inactive and nonexistent plans are rejected", async () => {
  await expectCode(createTrialCompany({
    companyId: await insertCompany(), planId: inactivePlanId,
    idempotencyKey: unique("inactive_plan"),
  }), "PLAN_INACTIVE");
  await expectCode(createTrialCompany({
    companyId: await insertCompany(), planId: 2147483647,
    idempotencyKey: unique("missing_plan"),
  }), "PLAN_NOT_FOUND");
});

check("legacy active subscription cannot become a trial", async () => {
  const companyId = await insertCompany();
  await insertSubscription({ companyId, status: "active", source: "legacy_migration" });
  await expectCode(createTrialCompany({
    companyId, planId: activePlanId, idempotencyKey: unique("protect_legacy"),
  }), "SUBSCRIPTION_ALREADY_ACTIVE");
});

const createServiceTrial = async (days = 14) => {
  const companyId = await insertCompany();
  await createTrialCompany({
    companyId, planId: activePlanId, trialDays: days,
    idempotencyKey: unique("seed_trial"),
  });
  return companyId;
};

check("monthly activation updates subscription and preserves trial history", async () => {
  const companyId = await createServiceTrial();
  const before = await scalar(
    `SELECT cs.trial_start_at, cs.trial_end_at, sp.id trial_period_id,
            sp.starts_at period_start, sp.ends_at period_end
       FROM company_subscriptions cs
       JOIN subscription_periods sp ON sp.subscription_id=cs.id AND sp.period_type='trial'
      WHERE cs.company_id=?`,
    [companyId]
  );
  const key = unique("activate_monthly");
  await activateSubscription({
    companyId, planId: activePlanId, billingCycle: "monthly", idempotencyKey: key,
  });
  const after = await scalar(
    `SELECT c.plan_id company_plan_id, cs.id subscription_id, cs.status,
            cs.billing_cycle, cs.trial_start_at, cs.trial_end_at,
            TIMESTAMPDIFF(MONTH, cs.current_period_start_at,
              cs.current_period_end_at) paid_months,
            (SELECT COUNT(*) FROM subscription_periods sp
              WHERE sp.subscription_id=cs.id AND sp.period_type='paid') paid_periods,
            (SELECT COUNT(*) FROM subscription_events se
              WHERE se.subscription_id=cs.id AND se.event_type='activated') activation_events,
            (SELECT status FROM subscription_periods sp
              WHERE sp.id=?) trial_period_status
       FROM companies c JOIN company_subscriptions cs ON cs.company_id=c.id
      WHERE c.id=?`,
    [before.trial_period_id, companyId]
  );
  assert.equal(after.company_plan_id, activePlanId);
  assert.equal(after.status, "active");
  assert.equal(after.billing_cycle, "monthly");
  assert.equal(after.paid_months, 1);
  assert.equal(after.paid_periods, 1);
  assert.equal(after.activation_events, 1);
  assert.equal(after.trial_period_status, "completed");
  assert.deepEqual(after.trial_start_at, before.trial_start_at);
  assert.deepEqual(after.trial_end_at, before.trial_end_at);

  await activateSubscription({
    companyId, planId: activePlanId, billingCycle: "monthly", idempotencyKey: key,
  });
  const counts = await scalar(
    `SELECT
       (SELECT COUNT(*) FROM subscription_periods sp
         JOIN company_subscriptions cs ON cs.id=sp.subscription_id
        WHERE cs.company_id=? AND sp.period_type='paid') paid_periods,
       (SELECT COUNT(*) FROM subscription_events se
         JOIN company_subscriptions cs ON cs.id=se.subscription_id
        WHERE cs.company_id=? AND se.event_type='activated') events`,
    [companyId, companyId]
  );
  assert.equal(counts.paid_periods, 1);
  assert.equal(counts.events, 1);
  await expectCode(activateSubscription({
    companyId, planId: activePlanId, billingCycle: "annual", idempotencyKey: key,
  }), "IDEMPOTENCY_CONFLICT");
});

check("expired trial activates with an annual period", async () => {
  const companyId = await insertCompany({ planId: activePlanId });
  await insertSubscription({
    companyId, planId: activePlanId, status: "expired",
    trialStart: new Date(Date.now() - 30 * 86400000),
    trialEnd: new Date(Date.now() - 16 * 86400000),
  });
  await activateSubscription({
    companyId, planId: activePlanId, billingCycle: "annual",
    idempotencyKey: unique("activate_annual"),
  });
  const row = await scalar(
    `SELECT status, billing_cycle,
            TIMESTAMPDIFF(YEAR, current_period_start_at, current_period_end_at) paid_years
       FROM company_subscriptions WHERE company_id=?`,
    [companyId]
  );
  assert.equal(row.status, "active");
  assert.equal(row.billing_cycle, "annual");
  assert.equal(row.paid_years, 1);
});

check("custom activation validates and stores the requested period", async () => {
  const invalidCompanyId = await createServiceTrial();
  await expectCode(activateSubscription({
    companyId: invalidCompanyId,
    planId: activePlanId,
    billingCycle: "custom",
    periodStartAt: "2026-09-01T00:00:00Z",
    periodEndAt: "2026-08-31T00:00:00Z",
    idempotencyKey: unique("invalid_custom"),
  }), "INVALID_PERIOD");

  const companyId = await createServiceTrial();
  await activateSubscription({
    companyId,
    planId: activePlanId,
    billingCycle: "custom",
    periodStartAt: "2026-09-01T00:00:00Z",
    periodEndAt: "2026-12-31T00:00:00Z",
    idempotencyKey: unique("valid_custom"),
  });
  const row = await scalar(
    `SELECT billing_cycle,
            DATE_FORMAT(current_period_start_at, '%Y-%m-%d %H:%i:%s') period_start,
            DATE_FORMAT(current_period_end_at, '%Y-%m-%d %H:%i:%s') period_end
       FROM company_subscriptions WHERE company_id=?`,
    [companyId]
  );
  assert.equal(row.billing_cycle, "custom");
  assert.equal(row.period_start, "2026-09-01 00:00:00");
  assert.equal(row.period_end, "2026-12-31 00:00:00");
});

check("invalid activation transition is rejected", async () => {
  const companyId = await insertCompany({ planId: activePlanId });
  await insertSubscription({ companyId, planId: activePlanId, status: "suspended" });
  await expectCode(activateSubscription({
    companyId, planId: activePlanId, billingCycle: "monthly",
    idempotencyKey: unique("invalid_transition"),
  }), "INVALID_SUBSCRIPTION_TRANSITION");
});

check("event foreign-key failure rolls back every activation write", async () => {
  const companyId = await createServiceTrial();
  const before = await scalar(
    `SELECT c.plan_id company_plan_id, cs.status, cs.plan_id,
            cs.current_period_start_at, cs.current_period_end_at,
            (SELECT COUNT(*) FROM subscription_periods WHERE subscription_id=cs.id) periods,
            (SELECT COUNT(*) FROM subscription_events WHERE subscription_id=cs.id) events
       FROM companies c JOIN company_subscriptions cs ON cs.company_id=c.id
      WHERE c.id=?`,
    [companyId]
  );
  await assert.rejects(activateSubscription({
    companyId,
    planId: activePlanId,
    billingCycle: "monthly",
    idempotencyKey: unique("force_rollback"),
    actor: { type: "admin", userId: 2147483647 },
  }), (error) => error.code === "ER_NO_REFERENCED_ROW_2");
  const after = await scalar(
    `SELECT c.plan_id company_plan_id, cs.status, cs.plan_id,
            cs.current_period_start_at, cs.current_period_end_at,
            (SELECT COUNT(*) FROM subscription_periods WHERE subscription_id=cs.id) periods,
            (SELECT COUNT(*) FROM subscription_events WHERE subscription_id=cs.id) events
       FROM companies c JOIN company_subscriptions cs ON cs.company_id=c.id
      WHERE c.id=?`,
    [companyId]
  );
  assert.deepEqual(after, before);
});

check("composite tenant foreign key rejects mismatched company", async () => {
  const companyId = await createServiceTrial();
  const otherCompanyId = await insertCompany();
  const subscription = await scalar(
    "SELECT id FROM company_subscriptions WHERE company_id=?",
    [companyId]
  );
  await assert.rejects(pool.query(
    `INSERT INTO subscription_periods
      (subscription_id, company_id, plan_id, period_type, billing_cycle,
       starts_at, ends_at, status, source_key, currency)
     VALUES (?, ?, ?, 'trial', 'none', UTC_TIMESTAMP(),
       DATE_ADD(UTC_TIMESTAMP(), INTERVAL 1 DAY), 'active', ?, 'INR')`,
    [subscription.id, otherCompanyId, activePlanId, unique("bad_tenant")]
  ), (error) => error.code === "ER_NO_REFERENCED_ROW_2");
});

check("period source key and event request id are unique", async () => {
  const companyId = await createServiceTrial();
  const subscription = await scalar(
    "SELECT id FROM company_subscriptions WHERE company_id=?",
    [companyId]
  );
  const period = await scalar(
    "SELECT * FROM subscription_periods WHERE subscription_id=? LIMIT 1",
    [subscription.id]
  );
  await assert.rejects(pool.query(
    `INSERT INTO subscription_periods
      (subscription_id, company_id, plan_id, period_type, billing_cycle,
       starts_at, ends_at, status, source_key, currency)
     VALUES (?, ?, ?, 'trial', 'none', ?, ?, 'active', ?, 'INR')`,
    [subscription.id, companyId, activePlanId,
      period.starts_at, period.ends_at, period.source_key]
  ), (error) => error.code === "ER_DUP_ENTRY");

  const event = await scalar(
    "SELECT * FROM subscription_events WHERE subscription_id=? LIMIT 1",
    [subscription.id]
  );
  await assert.rejects(pool.query(
    `INSERT INTO subscription_events
      (subscription_id, company_id, event_type, effective_at, request_id)
     VALUES (?, ?, 'trial_created', UTC_TIMESTAMP(), ?)`,
    [subscription.id, companyId, event.request_id]
  ), (error) => error.code === "ER_DUP_ENTRY");
});

check("trial and paid-period date checks are enforced", async () => {
  const companyId = await createServiceTrial();
  const subscription = await scalar(
    "SELECT id FROM company_subscriptions WHERE company_id=?",
    [companyId]
  );
  await assert.rejects(pool.query(
    `UPDATE company_subscriptions
        SET trial_start_at=DATE_ADD(trial_end_at, INTERVAL 1 DAY)
      WHERE id=?`,
    [subscription.id]
  ), (error) => error.code === "ER_CHECK_CONSTRAINT_VIOLATED");
  await assert.rejects(pool.query(
    `INSERT INTO subscription_periods
      (subscription_id, company_id, plan_id, period_type, billing_cycle,
       starts_at, ends_at, status, source_key, currency)
     VALUES (?, ?, ?, 'paid', 'custom', UTC_TIMESTAMP(),
       DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY), 'active', ?, 'INR')`,
    [subscription.id, companyId, activePlanId, unique("bad_dates")]
  ), (error) => error.code === "ER_CHECK_CONSTRAINT_VIOLATED");
});

check("subscription boolean checks are enforced", async () => {
  const companyId = await createServiceTrial();
  await assert.rejects(pool.query(
    "UPDATE company_subscriptions SET cancel_at_period_end=2 WHERE company_id=?",
    [companyId]
  ), (error) => error.code === "ER_CHECK_CONSTRAINT_VIOLATED");
  await assert.rejects(pool.query(
    "UPDATE company_subscriptions SET auto_renew=2 WHERE company_id=?",
    [companyId]
  ), (error) => error.code === "ER_CHECK_CONSTRAINT_VIOLATED");
});

const run = async () => {
  const [versionRows] = await pool.query("SELECT VERSION() version");
  console.log(`Local MySQL version: ${versionRows[0].version}`);
  activePlanId = await insertPlan({ active: true, trialDays: 9 });
  inactivePlanId = await insertPlan({ active: false, trialDays: 9 });

  let passed = 0;
  for (const item of checks) {
    await item.fn();
    passed += 1;
    console.log(`ok ${passed} - ${item.name}`);
  }
  console.log(`Subscription service real-MySQL integration: ${passed} checks passed`);
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    db.query = originalQuery;
    db.getConnection = originalGetConnection;
    await pool.end();
  });
