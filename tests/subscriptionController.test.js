const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  SubscriptionServiceError,
} = require("../services/subscriptionService");
const {
  createGetSubscriptionStatus,
} = require("../controllers/subscriptionController");

const makeResult = ({
  status = "active",
  valid = true,
  reason = "SUBSCRIPTION_ACTIVE",
  expiresAt = null,
  subscription = undefined,
} = {}) => ({
  company: { id: 17, status: "active", internal_secret: "hidden" },
  subscription: subscription === undefined ? {
    id: 41,
    company_id: 17,
    plan_id: 3,
    status,
    billing_cycle: status === "trialing" ? "none" : "monthly",
    trial_start_at: status === "trialing" ? "2026-08-01 00:00:00" : null,
    trial_end_at: status === "trialing" ? expiresAt : null,
    subscription_start_at: status === "active" ? "2026-08-01 00:00:00" : null,
    current_period_start_at: "2026-08-01 00:00:00",
    current_period_end_at: status === "active" ? expiresAt : null,
    version: 9,
    suspension_reason: "internal",
    metadata: { secret: true },
  } : subscription,
  plan: { id: 3, code: "PRO", name: "Pro", price: "999.00", max_users: 50 },
  access: { valid, reason, expires_at: expiresAt, database_now: "hidden" },
});

const invoke = async ({
  result,
  error,
  req = { user: { company_id: 17 }, query: {}, body: {}, params: {} },
} = {}) => {
  const calls = { service: [], status: [], json: [], logs: [] };
  const controller = createGetSubscriptionStatus({
    getSubscription: async (companyId) => {
      calls.service.push(companyId);
      if (error) throw error;
      return result;
    },
    logger: { error: (message) => calls.logs.push(message) },
  });
  const res = {
    status(code) { calls.status.push(code); return this; },
    json(body) { calls.json.push(body); return this; },
  };
  await controller(req, res);
  return calls;
};

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

for (const [name, status, valid, reason, expiresAt] of [
  ["legacy active", "active", true, "SUBSCRIPTION_ACTIVE", null],
  ["paid active", "active", true, "SUBSCRIPTION_ACTIVE", "2026-09-01 00:00:00"],
  ["valid trial", "trialing", true, "TRIAL_ACTIVE", "2026-08-27 00:00:00"],
  ["expired trial", "trialing", false, "TRIAL_EXPIRED", "2026-08-20 00:00:00"],
  ["expired subscription", "expired", false, "SUBSCRIPTION_EXPIRED", null],
  ["suspended subscription", "suspended", false, "SUBSCRIPTION_SUSPENDED", null],
  ["cancelled subscription", "cancelled", false, "SUBSCRIPTION_CANCELLED", null],
  ["past-due subscription", "past_due", false, "SUBSCRIPTION_PAST_DUE", null],
  ["inactive company", "active", false, "COMPANY_INACTIVE", null],
]) {
  test(`returns normalized HTTP 200 for ${name}`, async () => {
    const calls = await invoke({ result: makeResult({ status, valid, reason, expiresAt }) });
    assert.deepEqual(calls.status, [200]);
    assert.equal(calls.json[0].access.valid, valid);
    assert.equal(calls.json[0].access.reason, reason);
    assert.equal(calls.service[0], 17);
  });
}

test("returns normalized HTTP 200 for a missing subscription", async () => {
  const calls = await invoke({ result: {
    ...makeResult(),
    subscription: null,
    plan: null,
    access: { valid: false, reason: "SUBSCRIPTION_NOT_PROVISIONED", expires_at: null },
  } });
  assert.equal(calls.status[0], 200);
  assert.equal(calls.json[0].subscription, null);
  assert.equal(calls.json[0].plan, null);
  assert.equal(calls.json[0].access.reason, "SUBSCRIPTION_NOT_PROVISIONED");
});

test("uses only req.user.company_id and ignores client-supplied company IDs", async () => {
  const calls = await invoke({
    result: makeResult(),
    req: {
      user: { company_id: 17 },
      query: { company_id: 999 },
      body: { company_id: 998 },
      params: { company_id: 997 },
    },
  });
  assert.deepEqual(calls.service, [17]);
});

test("does not expose internal service fields", async () => {
  const calls = await invoke({ result: makeResult() });
  const text = JSON.stringify(calls.json[0]);
  for (const field of [
    "version", "metadata", "suspension_reason", "internal_secret",
    "company_id", "plan_id", "price", "max_users", "database_now",
  ]) assert.doesNotMatch(text, new RegExp(field));
});

test("handles missing authenticated company context safely without a service call", async () => {
  const calls = await invoke({ req: { user: {}, query: {}, body: {}, params: {} } });
  assert.deepEqual(calls.status, [500]);
  assert.equal(calls.json[0].code, "SUBSCRIPTION_STATUS_FAILED");
  assert.deepEqual(calls.service, []);
});

test("returns a safe 404 for a company that no longer exists", async () => {
  const calls = await invoke({
    error: new SubscriptionServiceError("COMPANY_NOT_FOUND", "Internal lookup details"),
  });
  assert.equal(calls.status[0], 404);
  assert.deepEqual(calls.json[0], { message: "Company not found", code: "COMPANY_NOT_FOUND" });
});

test("returns a safe 500 for unexpected service failures", async () => {
  const calls = await invoke({ error: new Error("SQL table and password details") });
  assert.equal(calls.status[0], 500);
  assert.deepEqual(calls.json[0], {
    message: "Unable to retrieve subscription status",
    code: "SUBSCRIPTION_STATUS_FAILED",
  });
  assert.doesNotMatch(JSON.stringify(calls.json[0]), /SQL|table|password/i);
  assert.equal(calls.logs.length, 1);
});

test("route registration uses auth only and does not enable enforcement or scheduler", async () => {
  const root = path.resolve(__dirname, "..");
  const routeSource = fs.readFileSync(path.join(root, "routes", "subscriptionRoutes.js"), "utf8");
  const indexSource = fs.readFileSync(path.join(root, "index.js"), "utf8");
  assert.match(routeSource, /router\.get\("\/status", authMiddleware, getSubscriptionStatus\)/);
  assert.doesNotMatch(routeSource, /requireValidSubscription|subscriptionMiddleware/);
  assert.match(indexSource, /app\.use\("\/api\/subscription", subscriptionRoutes\)/);
  assert.doesNotMatch(indexSource, /startSubscriptionExpiryScheduler/);
});

test("controller is read-only and invokes only the status lookup dependency", async () => {
  const calls = await invoke({ result: makeResult() });
  assert.deepEqual(calls.service, [17]);
  assert.equal(calls.status[0], 200);
});

const run = async () => {
  let passed = 0;
  for (const item of tests) {
    await item.fn();
    passed += 1;
    console.log(`ok ${passed} - ${item.name}`);
  }
  console.log(`Subscription status controller tests: ${passed} passed`);
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
