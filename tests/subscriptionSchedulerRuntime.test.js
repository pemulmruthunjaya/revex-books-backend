const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const withScheduler = async ({ enabled, cronExpression, scheduleError }, work) => {
  const cron = require("node-cron");
  const originalValidate = cron.validate;
  const originalSchedule = cron.schedule;
  const originalEnabled = process.env.SUBSCRIPTION_EXPIRY_SCHEDULER_ENABLED;
  const originalCron = process.env.SUBSCRIPTION_EXPIRY_CRON;
  const calls = [];

  cron.validate = (expression) => expression !== "invalid";
  cron.schedule = (expression, callback, options) => {
    calls.push({ expression, callback, options });
    if (scheduleError) throw scheduleError;
    return { stop() {} };
  };
  if (enabled === undefined) delete process.env.SUBSCRIPTION_EXPIRY_SCHEDULER_ENABLED;
  else process.env.SUBSCRIPTION_EXPIRY_SCHEDULER_ENABLED = enabled;
  if (cronExpression === undefined) delete process.env.SUBSCRIPTION_EXPIRY_CRON;
  else process.env.SUBSCRIPTION_EXPIRY_CRON = cronExpression;

  const modulePath = require.resolve("../jobs/subscriptionExpiryScheduler");
  delete require.cache[modulePath];
  try {
    return await work(require(modulePath), calls);
  } finally {
    delete require.cache[modulePath];
    cron.validate = originalValidate;
    cron.schedule = originalSchedule;
    if (originalEnabled === undefined) delete process.env.SUBSCRIPTION_EXPIRY_SCHEDULER_ENABLED;
    else process.env.SUBSCRIPTION_EXPIRY_SCHEDULER_ENABLED = originalEnabled;
    if (originalCron === undefined) delete process.env.SUBSCRIPTION_EXPIRY_CRON;
    else process.env.SUBSCRIPTION_EXPIRY_CRON = originalCron;
  }
};

for (const value of [undefined, "", "false", "0", "no"]) {
  test(`enable value ${String(value)} keeps the scheduler disabled`, async () => {
    await withScheduler({ enabled: value }, async (scheduler, calls) => {
      assert.equal(scheduler.startSubscriptionExpiryScheduler(), null);
      assert.equal(calls.length, 0);
    });
  });
}

test("explicit true initializes the scheduler with its safe default", async () => {
  await withScheduler({ enabled: "true" }, async (scheduler, calls) => {
    const task = scheduler.startSubscriptionExpiryScheduler();
    assert(task);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].expression, "*/15 * * * *");
    assert.deepEqual(calls[0].options, { noOverlap: true });
  });
});

test("invalid cron is contained without scheduling work", async () => {
  await withScheduler(
    { enabled: "true", cronExpression: "invalid" },
    async (scheduler, calls) => {
      assert.equal(scheduler.startSubscriptionExpiryScheduler(), null);
      assert.equal(calls.length, 0);
    }
  );
});

test("runtime wiring contains an initialization exception", async () => {
  const source = fs.readFileSync(path.resolve(__dirname, "..", "index.js"), "utf8");
  assert.match(
    source,
    /try\s*{\s*startSubscriptionExpiryScheduler\(\);\s*}\s*catch \(error\)/
  );
  assert.match(source, /Subscription expiry scheduler initialization failed/);

  let backendContinued = false;
  const safeRuntimeStart = (start) => {
    try { start(); } catch { /* same containment contract as index */ }
    backendContinued = true;
  };
  safeRuntimeStart(() => { throw new Error("injected initialization failure"); });
  assert.equal(backendContinued, true);
});

test("recurring scheduler initialization remains present and independent", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "..", "index.js"), "utf8");
  const recurringCall = source.indexOf("startRecurringInvoiceScheduler();");
  const subscriptionCall = source.indexOf("startSubscriptionExpiryScheduler();");
  assert.ok(recurringCall >= 0);
  assert.ok(subscriptionCall > recurringCall);
  assert.doesNotMatch(
    source.slice(recurringCall, subscriptionCall),
    /SUBSCRIPTION_EXPIRY_SCHEDULER_ENABLED/
  );
});

test("runtime wiring does not enable commercial enforcement", () => {
  const root = path.resolve(__dirname, "..");
  const indexSource = fs.readFileSync(path.join(root, "index.js"), "utf8");
  const routeFiles = fs.readdirSync(path.join(root, "routes"))
    .filter((name) => name.endsWith(".js"));
  assert.doesNotMatch(indexSource, /requireValidSubscription|subscriptionMiddleware/);
  for (const file of routeFiles) {
    const source = fs.readFileSync(path.join(root, "routes", file), "utf8");
    assert.doesNotMatch(source, /requireValidSubscription|subscriptionMiddleware/);
  }
});

test("authenticated subscription status route remains outside enforcement", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "..", "routes", "subscriptionRoutes.js"),
    "utf8"
  );
  assert.match(source, /router\.get\("\/status", authMiddleware, getSubscriptionStatus\)/);
  assert.doesNotMatch(source, /requireValidSubscription|subscriptionMiddleware/);
});

const run = async () => {
  let passed = 0;
  for (const item of tests) {
    await item.fn();
    passed += 1;
    console.log(`ok ${passed} - ${item.name}`);
  }
  console.log(`Subscription scheduler runtime tests: ${passed} passed`);
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
