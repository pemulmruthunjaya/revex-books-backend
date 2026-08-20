const assert = require("node:assert/strict");
const {
  SubscriptionServiceError,
} = require("../services/subscriptionService");
const {
  createRequireValidSubscription,
} = require("../middleware/subscriptionMiddleware");

const makeResult = ({
  valid,
  reason,
  status = "active",
  expiresAt = null,
} = {}) => ({
  company: { id: 17, status: "active" },
  subscription: status === null ? null : { id: 31, company_id: 17, status },
  plan: null,
  access: { valid, reason, expires_at: expiresAt },
});

const invoke = async ({ result, error, req = { user: { company_id: 17 } } } = {}) => {
  const calls = { service: 0, next: 0, status: [], json: [], logs: [] };
  const middleware = createRequireValidSubscription({
    getSubscription: async (companyId) => {
      calls.service += 1;
      assert.equal(companyId, 17);
      if (error) throw error;
      return result;
    },
    logger: { error: (message) => calls.logs.push(message) },
  });
  const res = {
    status(code) { calls.status.push(code); return this; },
    json(body) { calls.json.push(body); return this; },
  };
  await middleware(req, res, () => { calls.next += 1; });
  return { calls, req };
};

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

for (const [name, status, reason, expiresAt] of [
  ["legacy active subscription", "active", "SUBSCRIPTION_ACTIVE", null],
  ["paid active subscription", "active", "SUBSCRIPTION_ACTIVE", "2026-09-20 00:00:00"],
  ["active trial", "trialing", "TRIAL_ACTIVE", "2026-08-27 00:00:00"],
]) {
  test(`allows ${name}, attaches the result, and calls next once`, async () => {
    const result = makeResult({ valid: true, status, reason, expiresAt });
    const { calls, req } = await invoke({ result });
    assert.equal(req.subscription, result);
    assert.equal(calls.service, 1);
    assert.equal(calls.next, 1);
    assert.deepEqual(calls.status, []);
  });
}

for (const [reason, status, message] of [
  ["TRIAL_EXPIRED", "trialing", "Your trial has expired"],
  ["PAID_PERIOD_EXPIRED", "active", "Your paid subscription period has expired"],
  ["SUBSCRIPTION_EXPIRED", "expired", "Your subscription has expired"],
  ["SUBSCRIPTION_SUSPENDED", "suspended", "Your subscription is suspended"],
  ["SUBSCRIPTION_CANCELLED", "cancelled", "Your subscription is cancelled"],
  ["SUBSCRIPTION_PAST_DUE", "past_due", "Your subscription payment is past due"],
  ["COMPANY_INACTIVE", "active", "This company is inactive"],
  ["SUBSCRIPTION_NOT_PROVISIONED", null, "A subscription has not been provisioned for this company"],
  ["SUBSCRIPTION_STATE_INVALID", "unknown", "Your subscription is not in a valid access state"],
]) {
  test(`blocks ${reason} with a stable 403 response`, async () => {
    const expiresAt = reason.includes("EXPIRED") ? "2026-08-20 00:00:00" : null;
    const result = makeResult({ valid: false, reason, status, expiresAt });
    const { calls, req } = await invoke({ result });
    assert.equal(req.subscription, result);
    assert.equal(calls.next, 0);
    assert.deepEqual(calls.status, [403]);
    assert.deepEqual(calls.json, [{
      message,
      code: reason,
      subscription_status: status,
      expires_at: expiresAt,
    }]);
  });
}

test("maps an unknown access reason to SUBSCRIPTION_STATE_INVALID", async () => {
  const { calls } = await invoke({
    result: makeResult({ valid: false, reason: "TRIAL_END_MISSING", status: "trialing" }),
  });
  assert.equal(calls.next, 0);
  assert.equal(calls.json[0].code, "SUBSCRIPTION_STATE_INVALID");
});

test("handles missing authenticated company context without calling the service", async () => {
  const { calls } = await invoke({ req: { user: {} } });
  assert.equal(calls.service, 0);
  assert.equal(calls.next, 0);
  assert.deepEqual(calls.status, [500]);
  assert.equal(calls.json[0].code, "SUBSCRIPTION_CHECK_FAILED");
});

test("maps known service errors to safe commercial responses", async () => {
  const { calls } = await invoke({
    error: new SubscriptionServiceError("COMPANY_INACTIVE", "Internal service wording"),
  });
  assert.equal(calls.next, 0);
  assert.deepEqual(calls.status, [403]);
  assert.deepEqual(calls.json[0], {
    message: "This company is inactive",
    code: "COMPANY_INACTIVE",
    subscription_status: null,
    expires_at: null,
  });
});

test("maps COMPANY_NOT_FOUND to a safe not-provisioned response", async () => {
  const { calls } = await invoke({
    error: new SubscriptionServiceError("COMPANY_NOT_FOUND", "Company table lookup failed"),
  });
  assert.equal(calls.next, 0);
  assert.equal(calls.status[0], 403);
  assert.equal(calls.json[0].code, "SUBSCRIPTION_NOT_PROVISIONED");
  assert.doesNotMatch(JSON.stringify(calls.json[0]), /table|lookup/i);
});

test("returns a safe 500 for unexpected service errors", async () => {
  const { calls } = await invoke({ error: new Error("SQL table secret") });
  assert.equal(calls.next, 0);
  assert.deepEqual(calls.status, [500]);
  assert.deepEqual(calls.json, [{
    message: "Unable to verify subscription access",
    code: "SUBSCRIPTION_CHECK_FAILED",
  }]);
  assert.doesNotMatch(JSON.stringify(calls.json), /SQL|table|secret/i);
  assert.equal(calls.logs.length, 1);
});

test("is read-only and invokes only the effective-subscription dependency", async () => {
  const result = makeResult({ valid: true, reason: "SUBSCRIPTION_ACTIVE" });
  const { calls } = await invoke({ result });
  assert.equal(calls.service, 1);
  assert.equal(calls.next, 1);
});

const run = async () => {
  let passed = 0;
  for (const item of tests) {
    await item.fn();
    passed += 1;
    console.log(`ok ${passed} - ${item.name}`);
  }
  console.log(`Subscription middleware unit tests: ${passed} passed`);
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
