const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const bcrypt = require("bcryptjs");

process.env.JWT_SECRET = "step-28-unit-test-secret-at-least-32-characters";
process.env.JWT_EXPIRES_IN = "1d";

const { verifyAuthToken, signAuthToken } = require("../utils/jwtToken");
const {
  PlatformAdminError,
  authenticatePlatformAdmin,
  createPlatformAdmin,
} = require("../services/platformAdminService");
const { createPlatformAuthMiddleware } = require("../middleware/platformAuthMiddleware");
const { createPlatformSubscriptionActivation } = require("../controllers/platformSubscriptionController");

const root = path.resolve(__dirname, "..");
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const responseHarness = () => {
  const calls = { status: [], json: [], next: 0 };
  return {
    calls,
    res: {
      status(code) { calls.status.push(code); return this; },
      json(body) { calls.json.push(body); return this; },
    },
    next: () => { calls.next += 1; },
  };
};

test("platform administrator creation hashes passwords and rejects duplicates", async () => {
  const stored = [];
  const executor = { query: async (sql, params) => {
    if (sql.startsWith("SELECT id")) return [stored.filter((row) => row.email === params[0])];
    stored.push({ id: 71, name: params[0], email: params[1], password_hash: params[2], status: "active" });
    return [{ insertId: 71 }];
  } };
  const admin = await createPlatformAdmin({ name: " Platform Admin ", email: " ADMIN@REVEX.TEST ", password: "safe-password" }, { executor });
  assert.equal(admin.email, "admin@revex.test");
  assert.notEqual(stored[0].password_hash, "safe-password");
  assert.equal(await bcrypt.compare("safe-password", stored[0].password_hash), true);
  await assert.rejects(
    createPlatformAdmin({ name: "Again", email: "admin@revex.test", password: "safe-password" }, { executor }),
    (error) => error.code === "PLATFORM_ADMIN_EXISTS"
  );
});

test("platform login returns explicit platform JWT without company context", async () => {
  const hash = await bcrypt.hash("safe-password", 10);
  const executor = { query: async (sql) => sql.startsWith("SELECT")
    ? [[{ id: 71, name: "Admin", email: "admin@revex.test", password_hash: hash, status: "active" }]]
    : [{ affectedRows: 1 }] };
  const result = await authenticatePlatformAdmin({ email: "admin@revex.test", password: "safe-password" }, { executor });
  const claims = verifyAuthToken(result.token);
  assert.equal(claims.sub, "71");
  assert.equal(claims.actor_type, "platform_admin");
  assert.equal(claims.role, "platform_admin");
  assert.equal(claims.company_id, undefined);
  assert.equal(result.admin.password_hash, undefined);
});

test("platform login rejects bad passwords and disabled administrators", async () => {
  const hash = await bcrypt.hash("safe-password", 10);
  const executor = (status) => ({ query: async () => [[{ id: 71, password_hash: hash, status }]] });
  await assert.rejects(authenticatePlatformAdmin({ email: "a@b.com", password: "wrong-password" }, { executor: executor("active") }), (error) => error.code === "INVALID_CREDENTIALS");
  await assert.rejects(authenticatePlatformAdmin({ email: "a@b.com", password: "safe-password" }, { executor: executor("disabled") }), (error) => error.code === "PLATFORM_ADMIN_DISABLED");
});

test("platform middleware accepts active platform identity", async () => {
  const executor = { query: async () => [[{ id: 71, name: "Admin", email: "admin@revex.test", status: "active" }]] };
  const middleware = createPlatformAuthMiddleware({ executor, verifyToken: verifyAuthToken });
  const harness = responseHarness();
  const token = signAuthToken({ sub: "71", actor_type: "platform_admin", role: "platform_admin" });
  const req = { headers: { authorization: `Bearer ${token}` } };
  await middleware(req, harness.res, harness.next);
  assert.equal(harness.calls.next, 1);
  assert.equal(req.platformAdmin.id, 71);
});

test("platform middleware rejects missing, invalid, tenant and disabled identities", async () => {
  const activeExecutor = { query: async () => [[{ id: 71, status: "active" }]] };
  for (const [authorization, expected] of [
    [undefined, 401],
    ["Bearer invalid", 401],
    [`Bearer ${signAuthToken({ user_id: 3, company_id: 8, role: "owner" })}`, 403],
    [`Bearer ${signAuthToken({ user_id: 4, company_id: 8, role: "staff" })}`, 403],
  ]) {
    const harness = responseHarness();
    await createPlatformAuthMiddleware({ executor: activeExecutor, verifyToken: verifyAuthToken })({ headers: { authorization } }, harness.res, harness.next);
    assert.equal(harness.calls.status[0], expected);
    assert.equal(harness.calls.next, 0);
  }
  const disabled = responseHarness();
  const token = signAuthToken({ sub: "71", actor_type: "platform_admin", role: "platform_admin" });
  await createPlatformAuthMiddleware({ executor: { query: async () => [[{ id: 71, status: "disabled" }]] }, verifyToken: verifyAuthToken })({ headers: { authorization: `Bearer ${token}` } }, disabled.res, disabled.next);
  assert.equal(disabled.calls.status[0], 403);
});

test("platform activation derives audit actor from middleware identity, never body", async () => {
  const calls = [];
  const handler = createPlatformSubscriptionActivation({ activate: async (options) => {
    calls.push(options);
    return {
      company: { id: 8, status: "active" },
      subscription: { status: "active", billing_cycle: "monthly" },
      plan: { id: 2, code: "PLAN_2", name: "Pro" },
      access: { valid: true, reason: "SUBSCRIPTION_ACTIVE", expires_at: "2026-09-21 00:00:00" },
    };
  } });
  const harness = responseHarness();
  await handler({
    platformAdmin: { id: 71, email: "admin@revex.test" },
    body: { company_id: 8, plan_code: "PLAN_2", billing_cycle: "monthly", request_id: "manual-8", actor_user_id: 999 },
  }, harness.res);
  assert.equal(harness.calls.status[0], 200);
  assert.equal(calls[0].actor.type, "platform_admin");
  assert.equal(calls[0].actor.userId, null);
  assert.equal(calls[0].actor.metadata.platform_admin_id, 71);
});

test("platform namespace is isolated and outside tenant enforcement", () => {
  const routes = fs.readFileSync(path.join(root, "routes", "platformRoutes.js"), "utf8");
  const index = fs.readFileSync(path.join(root, "index.js"), "utf8");
  assert.match(routes, /router\.post\("\/auth\/login", authRateLimiter, platformLogin\)/);
  assert.match(routes, /router\.post\("\/subscriptions\/activate", platformAuthMiddleware, activatePlatformSubscription\)/);
  assert.match(index, /app\.use\("\/api\/platform", platformRoutes\)/);
  const prefixes = index.slice(index.indexOf("const tenantErpRoutePrefixes"), index.indexOf("if (isSubscriptionEnforcementEnabled())"));
  assert.doesNotMatch(prefixes, /\/api\/platform/);
});

test("tenant authentication files remain structurally unchanged", () => {
  const authRoutes = fs.readFileSync(path.join(root, "routes", "authRoutes.js"), "utf8");
  const authMiddleware = fs.readFileSync(path.join(root, "middleware", "authMiddleware.js"), "utf8");
  assert.match(authRoutes, /router\.post\("\/login", login\)/);
  assert.match(authRoutes, /router\.post\("\/staff\/login", staffLogin\)/);
  assert.match(authMiddleware, /assertCompanyAccess\(user\.id, decoded\.company_id\)/);
});

test("platform token does not grant access through ordinary tenant auth middleware", async () => {
  const db = require("../db/connection");
  const userAccess = require("../services/userAccessService");
  const originalQuery = db.query;
  const originalEnsure = userAccess.ensureUserAccessColumns;
  const middlewarePath = require.resolve("../middleware/authMiddleware");
  try {
    db.query = async () => [[]];
    userAccess.ensureUserAccessColumns = async () => {};
    delete require.cache[middlewarePath];
    const tenantAuthMiddleware = require("../middleware/authMiddleware");
    const harness = responseHarness();
    const token = signAuthToken({ sub: "71", actor_type: "platform_admin", role: "platform_admin" });
    await tenantAuthMiddleware({ headers: { authorization: `Bearer ${token}` } }, harness.res, harness.next);
    assert.equal(harness.calls.status[0], 401);
    assert.equal(harness.calls.next, 0);
  } finally {
    db.query = originalQuery;
    userAccess.ensureUserAccessColumns = originalEnsure;
    delete require.cache[middlewarePath];
  }
});

const run = async () => {
  let passed = 0;
  for (const item of tests) {
    await item.fn();
    console.log(`ok ${++passed} - ${item.name}`);
  }
  console.log(`Platform admin foundation: ${passed} focused tests passed`);
};

run().catch((error) => { console.error(error); process.exitCode = 1; });
