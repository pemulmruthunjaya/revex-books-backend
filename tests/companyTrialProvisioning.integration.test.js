const assert = require("node:assert/strict");
const mysql = require("mysql2/promise");
const db = require("../db/connection");
const {
  provisionCompanyTrial,
} = require("../services/companyTrialProvisioningService");

const REQUIRED_ENV = [
  "REVEX_INTEGRATION_DB_HOST",
  "REVEX_INTEGRATION_DB_PORT",
  "REVEX_INTEGRATION_DB_USER",
  "REVEX_INTEGRATION_DB_PASSWORD",
  "REVEX_INTEGRATION_DB_NAME",
  "DEFAULT_TRIAL_PLAN_CODE",
];
for (const name of REQUIRED_ENV) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}
if (process.env.REVEX_INTEGRATION_DB_HOST !== "127.0.0.1") {
  throw new Error("Integration tests are restricted to 127.0.0.1");
}
if (process.env.REVEX_INTEGRATION_DB_NAME !== "revex_company_trial_integration_20260820") {
  throw new Error("Unexpected integration database name");
}

const pool = mysql.createPool({
  host: process.env.REVEX_INTEGRATION_DB_HOST,
  port: Number(process.env.REVEX_INTEGRATION_DB_PORT),
  user: process.env.REVEX_INTEGRATION_DB_USER,
  password: process.env.REVEX_INTEGRATION_DB_PASSWORD,
  database: process.env.REVEX_INTEGRATION_DB_NAME,
  timezone: "Z",
  connectionLimit: 3,
});

const originalQuery = db.query;
const originalGetConnection = db.getConnection;
db.query = pool.query.bind(pool);
db.getConnection = pool.getConnection.bind(pool);

const unique = (prefix) => `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;

const createCompanyScaffold = async (connection, suffix) => {
  const email = `${suffix.toLowerCase()}@integration.invalid`;
  const [companyResult] = await connection.query(
    "INSERT INTO companies (name, email) VALUES (?, ?)",
    [suffix, email]
  );
  const companyId = companyResult.insertId;
  const [userResult] = await connection.query(
    `INSERT INTO users (name, email, password, company_id, role, access_role)
     VALUES (?, ?, 'integration-test-hash', ?, 'owner', 'owner')`,
    ["Integration Owner", email, companyId]
  );
  const userId = userResult.insertId;
  await connection.query(
    `INSERT INTO user_company_memberships
      (user_id, company_id, membership_role, is_default, is_active)
     VALUES (?, ?, 'owner', 1, 1)`,
    [userId, companyId]
  );
  const [branchResult] = await connection.query(
    `INSERT INTO branches
      (company_id, name, code, branch_type, is_head_office, is_active, created_by)
     VALUES (?, 'Head Office', 'HO', 'HEAD_OFFICE', 1, 1, ?)`,
    [companyId, userId]
  );
  await connection.query(
    `INSERT INTO user_branch_memberships
      (user_id, company_id, branch_id, is_default, is_active)
     VALUES (?, ?, ?, 1, 1)`,
    [userId, companyId, branchResult.insertId]
  );
  await connection.query(
    "INSERT INTO business_profiles (company_id, name, email) VALUES (?, ?, ?)",
    [companyId, suffix, email]
  );
  await connection.query(
    "INSERT INTO company_business_settings (company_id) VALUES (?)",
    [companyId]
  );
  return { companyId, userId, branchId: branchResult.insertId, email };
};

const scalar = async (sql, params = []) => {
  const [rows] = await pool.query(sql, params);
  return rows[0];
};

const run = async () => {
  const [versionRows] = await pool.query("SELECT VERSION() version");
  console.log(`Local MySQL version: ${versionRows[0].version}`);
  const baseline = await scalar("SELECT COUNT(*) count FROM companies");
  const [planRows] = await pool.query(
    "SELECT id, code, default_trial_days FROM plans WHERE code = ? AND is_active = 1",
    [process.env.DEFAULT_TRIAL_PLAN_CODE]
  );
  assert.equal(planRows.length, 1, "configured active test plan must exist");
  const plan = planRows[0];

  const connection = await pool.getConnection();
  let created;
  try {
    await connection.beginTransaction();
    created = await createCompanyScaffold(connection, unique("TrialCompany"));
    await provisionCompanyTrial({
      companyId: created.companyId,
      actorUserId: created.userId,
      source: "owner_registration",
      connection,
    });
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  const provisioned = await scalar(
    `SELECT c.plan_id company_plan_id, cs.id subscription_id, cs.status,
            cs.plan_id, cs.trial_start_at, cs.trial_end_at,
            TIMESTAMPDIFF(DAY, cs.trial_start_at, cs.trial_end_at) trial_days,
            (SELECT COUNT(*) FROM subscription_periods sp
              WHERE sp.subscription_id = cs.id AND sp.period_type = 'trial') period_count,
            (SELECT COUNT(*) FROM subscription_events se
              WHERE se.subscription_id = cs.id AND se.event_type = 'trial_created') event_count,
            (SELECT COUNT(*) FROM user_company_memberships m
              WHERE m.company_id = c.id AND m.user_id = ?) company_membership_count,
            (SELECT COUNT(*) FROM branches b WHERE b.company_id = c.id) branch_count,
            (SELECT COUNT(*) FROM user_branch_memberships bm
              WHERE bm.company_id = c.id AND bm.user_id = ?) branch_membership_count,
            (SELECT COUNT(*) FROM business_profiles bp WHERE bp.company_id = c.id) profile_count,
            (SELECT COUNT(*) FROM company_business_settings s WHERE s.company_id = c.id) settings_count
       FROM companies c
       JOIN company_subscriptions cs ON cs.company_id = c.id
      WHERE c.id = ?`,
    [created.userId, created.userId, created.companyId]
  );
  assert.equal(provisioned.status, "trialing");
  assert.equal(provisioned.plan_id, plan.id);
  assert.equal(provisioned.company_plan_id, plan.id);
  assert.ok(provisioned.trial_start_at && provisioned.trial_end_at);
  assert.equal(provisioned.trial_days, plan.default_trial_days);
  for (const field of [
    "period_count", "event_count", "company_membership_count", "branch_count",
    "branch_membership_count", "profile_count", "settings_count",
  ]) assert.equal(provisioned[field], 1, field);
  console.log("ok 1 - complete company scaffold and trial commit atomically");

  const rollbackName = unique("RollbackMissingPlan");
  const rollbackConnection = await pool.getConnection();
  try {
    await rollbackConnection.beginTransaction();
    const scaffold = await createCompanyScaffold(rollbackConnection, rollbackName);
    await assert.rejects(
      provisionCompanyTrial({
        companyId: scaffold.companyId,
        actorUserId: scaffold.userId,
        source: "owner_registration",
        connection: rollbackConnection,
        environment: { DEFAULT_TRIAL_PLAN_CODE: "DOES_NOT_EXIST" },
      }),
      (error) => error.code === "DEFAULT_TRIAL_PLAN_UNAVAILABLE"
    );
    await rollbackConnection.rollback();
  } finally {
    rollbackConnection.release();
  }
  const missingAfter = await scalar(
    "SELECT COUNT(*) count FROM companies WHERE name = ?", [rollbackName]
  );
  assert.equal(missingAfter.count, 0);
  console.log("ok 2 - missing plan rolls back the entire company scaffold");

  const inactiveCode = unique("INACTIVE_PLAN").slice(0, 50);
  await pool.query(
    `INSERT INTO plans
      (code, name, price, is_active, default_trial_days)
     VALUES (?, ?, 0, 0, 21)`,
    [inactiveCode, inactiveCode]
  );
  const inactiveName = unique("RollbackInactivePlan");
  const inactiveConnection = await pool.getConnection();
  try {
    await inactiveConnection.beginTransaction();
    const scaffold = await createCompanyScaffold(inactiveConnection, inactiveName);
    await assert.rejects(
      provisionCompanyTrial({
        companyId: scaffold.companyId,
        actorUserId: scaffold.userId,
        source: "owner_registration",
        connection: inactiveConnection,
        environment: { DEFAULT_TRIAL_PLAN_CODE: inactiveCode },
      }),
      (error) => error.code === "DEFAULT_TRIAL_PLAN_UNAVAILABLE"
    );
    await inactiveConnection.rollback();
  } finally {
    inactiveConnection.release();
  }
  const inactiveAfter = await scalar(
    "SELECT COUNT(*) count FROM companies WHERE name = ?", [inactiveName]
  );
  assert.equal(inactiveAfter.count, 0);
  console.log("ok 3 - inactive plan rolls back the entire company scaffold");

  const current = await scalar("SELECT COUNT(*) count FROM companies");
  assert.equal(current.count, Number(baseline.count) + 1);
  console.log("ok 4 - pre-existing companies remain unchanged; only the committed fixture was added");
  console.log("Company trial provisioning real-MySQL integration: 4 checks passed");
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
