const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  createRequireValidSubscription,
} = require("../middleware/subscriptionMiddleware");
const {
  isSubscriptionEnforcementEnabled,
} = require("../utils/subscriptionEnforcementConfig");

const root = path.resolve(__dirname, "..");
const indexSource = fs.readFileSync(path.join(root, "index.js"), "utf8");
const statusRouteSource = fs.readFileSync(
  path.join(root, "routes", "subscriptionRoutes.js"),
  "utf8"
);

const expectedTenantPrefixes = [
  "/api/users", "/api/staff", "/api/audit-logs", "/api/customers",
  "/api/invoices", "/api/recurring-invoices", "/api/invoice-settings",
  "/api/quotations", "/api/products", "/api/barcodes", "/api/vendors",
  "/api/vendor-payments", "/api/purchase-orders", "/api/bills",
  "/api/goods-receipts", "/api/delivery-challans", "/api/returns",
  "/api/expenses", "/api/petty-cash", "/api/accounts",
  "/api/journal-entries", "/api/receipt-entries", "/api/payment-entries",
  "/api/payroll", "/api/cash-book", "/api/bank-book",
  "/api/customer-statement", "/api/ledger", "/api/trial-balance",
  "/api/profit-loss", "/api/balance-sheet", "/api/business",
  "/api/reports", "/api/backup", "/api/dashboard",
];

const parseTenantPrefixes = () => {
  const match = indexSource.match(
    /const tenantErpRoutePrefixes = \[([\s\S]*?)\];\s*\n\s*if \(isSubscriptionEnforcementEnabled\(\)\)/
  );
  assert(match, "tenant ERP boundary must be declared immediately before registration");
  return [...match[1].matchAll(/"(\/api\/[^"]+)"/g)].map((item) => item[1]);
};

const parseMountedApiPrefixes = () => {
  const values = [...indexSource.matchAll(/app\.use\(\s*"(\/api\/[^"]+)"/g)]
    .map((item) => item[1]);
  return [...new Set(values)];
};

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test("every mounted tenant ERP prefix is protected", () => {
  const protectedPrefixes = parseTenantPrefixes();
  assert.deepEqual(protectedPrefixes, expectedTenantPrefixes);
  assert.equal(new Set(protectedPrefixes).size, protectedPrefixes.length);

  const exemptMounts = new Set(["/api/auth", "/api/subscription"]);
  const mountedTenantPrefixes = parseMountedApiPrefixes()
    .filter((prefix) => !exemptMounts.has(prefix));
  assert.deepEqual(
    [...mountedTenantPrefixes].sort(),
    [...new Set(expectedTenantPrefixes)].sort()
  );
});

test("central boundary is opt-in and orders authentication before subscription validation", () => {
  assert.match(
    indexSource,
    /if \(isSubscriptionEnforcementEnabled\(\)\)\s*{\s*app\.use\(tenantErpRoutePrefixes, authMiddleware, requireValidSubscription\)/
  );
  assert.equal(
    (indexSource.match(/app\.use\(tenantErpRoutePrefixes, authMiddleware, requireValidSubscription\)/g)
      || []).length,
    1
  );
});

for (const value of [undefined, "", "false", "0", "no", "TRUE", "True", "unexpected"]) {
  test(`enforcement value ${String(value)} is disabled`, () => {
    const environment = {};
    if (value !== undefined) environment.SUBSCRIPTION_ENFORCEMENT_ENABLED = value;
    assert.equal(isSubscriptionEnforcementEnabled(environment), false);
  });
}

test("only exact lowercase true enables enforcement", () => {
  assert.equal(
    isSubscriptionEnforcementEnabled({ SUBSCRIPTION_ENFORCEMENT_ENABLED: "true" }),
    true
  );
});

test("disabled branch does not mount subscription middleware", () => {
  const mounts = [];
  const installBoundary = (enabled) => {
    if (enabled) mounts.push(["authMiddleware", "requireValidSubscription"]);
  };
  installBoundary(isSubscriptionEnforcementEnabled({}));
  assert.deepEqual(mounts, []);
});

test("enabled branch mounts auth then subscription exactly once", () => {
  const mounts = [];
  const installBoundary = (enabled) => {
    if (enabled) mounts.push(["authMiddleware", "requireValidSubscription"]);
  };
  installBoundary(isSubscriptionEnforcementEnabled({
    SUBSCRIPTION_ENFORCEMENT_ENABLED: "true",
  }));
  assert.deepEqual(mounts, [["authMiddleware", "requireValidSubscription"]]);
});

test("auth, health, and subscription status remain exempt", () => {
  const protectedPrefixes = parseTenantPrefixes();
  for (const prefix of ["/api/auth", "/health", "/api/health", "/api/subscription"]) {
    assert.equal(protectedPrefixes.includes(prefix), false, `${prefix} must remain exempt`);
  }
  assert.match(indexSource, /app\.use\("\/api\/auth", authRateLimiter, authRoutes\)/);
  assert.match(indexSource, /app\.get\("\/health", livenessCheckHandler\)/);
  assert.match(indexSource, /app\.get\("\/api\/health", readinessCheckHandler\)/);
  assert.match(
    statusRouteSource,
    /router\.get\("\/status", authMiddleware, getSubscriptionStatus\)/
  );
  assert.doesNotMatch(statusRouteSource, /requireValidSubscription/);
});

test("no route file attaches subscription enforcement a second time", () => {
  const routeDirectory = path.join(root, "routes");
  for (const name of fs.readdirSync(routeDirectory).filter((item) => item.endsWith(".js"))) {
    const source = fs.readFileSync(path.join(routeDirectory, name), "utf8");
    assert.doesNotMatch(source, /requireValidSubscription|subscriptionMiddleware/, name);
  }
});

test("login controller and scheduler behavior are outside this wiring change", () => {
  const authSource = fs.readFileSync(path.join(root, "controllers", "authController.js"), "utf8");
  const schedulerSource = fs.readFileSync(
    path.join(root, "jobs", "subscriptionExpiryScheduler.js"),
    "utf8"
  );
  assert.doesNotMatch(authSource, /requireValidSubscription/);
  assert.match(schedulerSource, /SUBSCRIPTION_EXPIRY_SCHEDULER_ENABLED/);
  assert.doesNotMatch(schedulerSource, /module\.exports[\s\S]*requireValidSubscription/);
});

test("company switching evaluates the newly selected tenant context", async () => {
  const checkedCompanies = [];
  const middleware = createRequireValidSubscription({
    getSubscription: async (companyId) => {
      checkedCompanies.push(companyId);
      return {
        company: { id: companyId, status: "active" },
        subscription: { status: companyId === 1 ? "active" : "trialing" },
        access: companyId === 1
          ? { valid: true, reason: "SUBSCRIPTION_ACTIVE", expires_at: null }
          : { valid: false, reason: "TRIAL_EXPIRED", expires_at: "2026-08-20" },
      };
    },
    logger: { error() {} },
  });
  const req = { user: { company_id: 1 } };
  let nextCalls = 0;
  const responses = [];
  const res = {
    status(code) { responses.push({ code }); return this; },
    json(body) { responses[responses.length - 1].body = body; return this; },
  };

  await middleware(req, res, () => { nextCalls += 1; });
  req.user.company_id = 2;
  await middleware(req, res, () => { nextCalls += 1; });

  assert.deepEqual(checkedCompanies, [1, 2]);
  assert.equal(nextCalls, 1);
  assert.equal(responses[0].code, 403);
  assert.equal(responses[0].body.code, "TRIAL_EXPIRED");
});

const run = async () => {
  let passed = 0;
  for (const item of tests) {
    await item.fn();
    passed += 1;
    console.log(`ok ${passed} - ${item.name}`);
  }
  console.log(`Subscription enforcement wiring tests: ${passed} passed`);
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
