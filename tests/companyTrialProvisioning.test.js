const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  TrialProvisioningError,
  configuredTrialPlanCode,
  provisionCompanyTrial,
} = require("../services/companyTrialProvisioningService");

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const connectionFor = (plans) => {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql: String(sql), params });
      return [plans];
    },
  };
};

test("requires an explicit stable trial-plan code", () => {
  assert.throws(
    () => configuredTrialPlanCode({}),
    (error) => error instanceof TrialProvisioningError
      && error.code === "DEFAULT_TRIAL_PLAN_NOT_CONFIGURED"
  );
  assert.equal(configuredTrialPlanCode({ DEFAULT_TRIAL_PLAN_CODE: " PLAN_2 " }), "PLAN_2");
});

test("resolves an active plan by code and provisions on the caller transaction", async () => {
  const connection = connectionFor([{ id: 72, code: "PLAN_2" }]);
  const trialCalls = [];
  const result = await provisionCompanyTrial({
    companyId: 31,
    actorUserId: 14,
    source: "owner_registration",
    connection,
    environment: { DEFAULT_TRIAL_PLAN_CODE: "PLAN_2" },
    createTrial: async (options) => {
      trialCalls.push(options);
      return { subscription: { status: "trialing" } };
    },
  });

  assert.equal(result.subscription.status, "trialing");
  assert.equal(connection.calls.length, 1);
  assert.match(connection.calls[0].sql, /WHERE code = \? AND is_active = 1/);
  assert.match(connection.calls[0].sql, /FOR UPDATE/);
  assert.deepEqual(connection.calls[0].params, ["PLAN_2"]);
  assert.equal(trialCalls.length, 1);
  assert.equal(trialCalls[0].companyId, 31);
  assert.equal(trialCalls[0].planId, 72);
  assert.equal(trialCalls[0].connection, connection);
  assert.equal(trialCalls[0].trialDays, undefined);
  assert.equal(trialCalls[0].idempotencyKey, "company-created-31");
  assert.equal(trialCalls[0].actor.userId, 14);
});

test("missing or inactive configured plan fails before trial creation", async () => {
  for (const plans of [[], []]) {
    let trialCalls = 0;
    await assert.rejects(
      provisionCompanyTrial({
        companyId: 31,
        actorUserId: 14,
        source: "owner_registration",
        connection: connectionFor(plans),
        environment: { DEFAULT_TRIAL_PLAN_CODE: "MISSING_OR_INACTIVE" },
        createTrial: async () => { trialCalls += 1; },
      }),
      (error) => error.code === "DEFAULT_TRIAL_PLAN_UNAVAILABLE"
    );
    assert.equal(trialCalls, 0);
  }
});

test("refuses provisioning without a caller-owned transaction connection", async () => {
  await assert.rejects(
    provisionCompanyTrial({
      companyId: 31,
      actorUserId: 14,
      environment: { DEFAULT_TRIAL_PLAN_CODE: "PLAN_2" },
    }),
    (error) => error.code === "TRIAL_TRANSACTION_REQUIRED"
  );
});

test("trial-service failure propagates so the owner transaction can roll back", async () => {
  const connection = connectionFor([{ id: 72, code: "PLAN_2" }]);
  await assert.rejects(
    provisionCompanyTrial({
      companyId: 31,
      actorUserId: 14,
      source: "owner_registration",
      connection,
      environment: { DEFAULT_TRIAL_PLAN_CODE: "PLAN_2" },
      createTrial: async () => { throw new Error("injected trial failure"); },
    }),
    /injected trial failure/
  );
});

test("initial registration provisions before commit and retains all setup operations", () => {
  const root = path.resolve(__dirname, "..");
  const auth = fs.readFileSync(path.join(root, "controllers", "authController.js"), "utf8");
  const provisionAt = auth.indexOf("await provisionCompanyTrial({");
  const commitAt = auth.indexOf("await connection.commit();", provisionAt);
  assert.ok(provisionAt >= 0 && commitAt > provisionAt);
  assert.match(auth, /source: "owner_registration"/);
  assert.match(auth, /INSERT INTO companies/);
  assert.match(auth, /INSERT INTO users/);
  assert.match(auth, /INSERT INTO user_company_memberships/);
  assert.match(auth, /INSERT INTO branches/);
  assert.match(auth, /INSERT INTO user_branch_memberships/);
  assert.match(auth, /INSERT INTO business_profiles/);
  assert.match(auth, /INSERT INTO company_business_settings/);
  assert.match(auth, /catch \(error\)[\s\S]*connection\.rollback\(\)/);
});

test("additional-business creation remains compatible and does not grant a trial", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "..", "controllers", "businessController.js"),
    "utf8"
  );
  const createBusiness = source.slice(
    source.indexOf("exports.createBusiness"),
    source.indexOf("exports.switchCompany")
  );
  assert.doesNotMatch(createBusiness, /provisionCompanyTrial|createTrialCompany/);
  assert.match(createBusiness, /INSERT INTO companies/);
  assert.match(createBusiness, /INSERT INTO user_company_memberships/);
  assert.match(createBusiness, /INSERT INTO branches/);
  assert.match(createBusiness, /INSERT INTO user_branch_memberships/);
  assert.match(createBusiness, /INSERT INTO business_profiles/);
  assert.match(createBusiness, /INSERT INTO company_business_settings/);
  assert.match(createBusiness, /await connection\.commit\(\)/);
  assert.match(createBusiness, /issueContextToken/);
});

test("registration payload does not accept a client-selected plan or trial duration", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "..", "controllers", "authController.js"),
    "utf8"
  );
  assert.match(source, /const \{ company_name, name, email, password \} = req\.body/);
  assert.doesNotMatch(source, /req\.body\.(plan_id|planId|plan_code|trialDays)/);
});

test("provisioning contains no hard-coded numeric plan ID", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "..", "services", "companyTrialProvisioningService.js"),
    "utf8"
  );
  assert.doesNotMatch(source, /planId:\s*\d+/);
  assert.match(source, /DEFAULT_TRIAL_PLAN_CODE/);
});

const run = async () => {
  let passed = 0;
  for (const item of tests) {
    await item.fn();
    passed += 1;
    console.log(`ok ${passed} - ${item.name}`);
  }
  console.log(`Company trial provisioning tests: ${passed} passed`);
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
