const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const express = require("express");
const { assembleApplicationBoundary } = require("../middleware/applicationAssembly");
const { createPlatformAuthRoutes } = require("../routes/platformAuthRoutes");
const { createPlatformLogin } = require("../controllers/platformAuthController");
const { authenticatePlatformAdmin } = require("../services/platformAdminService");
const { execFileSync } = require("node:child_process");
const { canonical, canonicalizeTrialRequestBody, gatewaySecret, sha256 } = require("../middleware/trialRequestGatewayAuth");
const { createPublicTrialRequestRoutes } = require("../routes/publicTrialRequestRoutes");
const { POLICY_VERSION } = require("../services/trialRequestService");
const { RESET_TOKEN, sendAuthFailure, validNewPassword } = require("../controllers/authController");
const { createPlatformAuthMiddleware } = require("../middleware/platformAuthMiddleware");
const { shape } = require("../controllers/trialInvitationController");

const listen = async (app) => new Promise((resolve) => { const server = app.listen(0, "127.0.0.1", () => resolve(server)); });
const request = (server, { path = "/", method = "POST", headers = {}, body = Buffer.alloc(0), chunks = null } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ hostname: "127.0.0.1", port: server.address().port, path, method, headers }, (res) => { const values = []; res.on("data", (chunk) => values.push(chunk)); res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(values).toString("utf8") })); }); req.on("error", reject); if (chunks) for (const chunk of chunks) req.write(chunk); else req.write(body); req.end();
});
const environment = { TRIAL_REQUEST_INTAKE_ENABLED: "true", TRIAL_REQUEST_GATEWAY_SECRET: Buffer.alloc(32, 9).toString("base64url"), TRIAL_REQUEST_ALLOWED_ORIGIN: "https://revexbooks.com" };
const signedHeaders = (body) => { const timestamp = "2026-09-29T10:00:00.000Z", idempotencyKey = "123e4567-e89b-42d3-a456-426614174000", bodySha256 = sha256(body), clientIpHash = "a".repeat(64); return { "content-type": "application/json", origin: environment.TRIAL_REQUEST_ALLOWED_ORIGIN, "x-revex-timestamp": timestamp, "idempotency-key": idempotencyKey, "x-revex-body-sha256": bodySha256, "x-revex-client-ip-hash": clientIpHash, "x-revex-signature": crypto.createHmac("sha256", gatewaySecret(environment.TRIAL_REQUEST_GATEWAY_SECRET)).update(canonical({ timestamp, idempotencyKey, bodySha256, clientIpHash })).digest("hex") }; };
const pass = (_req, _res, next) => next();
const assembled = ({ submit = async () => ({}), tenant = (_req, res) => res.sendStatus(204), login = (_req, res) => res.sendStatus(204), authenticate = (_req, res) => res.sendStatus(401) } = {}) => {
  const app = express(); const authRoutes = express.Router();
  authRoutes.post("/login", tenant);
  assembleApplicationBoundary(app, {
    publicTrialRequestRoutes: createPublicTrialRequestRoutes({ environment, clock: () => Date.parse("2026-09-29T10:00:00.000Z"), submit }),
    authRoutes, platformAuthRoutes: createPlatformAuthRoutes({ login, authenticate, apiRateLimiter: pass, authRateLimiter: pass, auditLogMiddleware: pass }),
    apiRateLimiter: pass, authRateLimiter: pass, auditLogMiddleware: pass, environment,
  });
  app.post("/api/later", (req, res) => res.json({ size: req.body.value.length }));
  return app;
};

test("loopback public route authenticates canonical streamed bytes and rejects malformed signed JSON", async (t) => {
  let calls = 0; const app = assembled({ submit: async () => { calls += 1; return { code: "TRIAL_REQUEST_RECEIVED", request_reference: "safe" }; } }); const server = await listen(app); t.after(() => server.close());
  const value = { full_name: "Owner", company_name: "Company", email: "owner@example.test", mobile: "+919876543210", city: "Pune", country: "IN", business_type: "services", note: "", privacy_communications_consent: true, privacy_policy_version: POLICY_VERSION, website: "" }; const body = Buffer.from(canonicalizeTrialRequestBody(value));
  const accepted = await request(server, { path: "/api/public/trial-requests", headers: { ...signedHeaders(body), "content-length": body.length }, body }); assert.equal(accepted.status, 202); assert.equal(calls, 1);
  const malformed = Buffer.from('{"full_name":'); const rejected = await request(server, { path: "/api/public/trial-requests", headers: signedHeaders(malformed), body: malformed }); assert.equal(rejected.status, 400); assert.equal(calls, 1);
});
test("loopback public route rejects oversized Content-Length and chunked bodies before handler", async (t) => {
  let calls = 0; const app = assembled({ submit: async () => { calls += 1; } }); const server = await listen(app); t.after(() => server.close()); const oversized = Buffer.alloc(16 * 1024 + 1, 0x61);
  const fixed = await request(server, { path: "/api/public/trial-requests", headers: { "content-type": "application/json", "content-length": oversized.length }, body: oversized }); assert.equal(fixed.status, 400);
  const chunked = await request(server, { path: "/api/public/trial-requests", headers: { "content-type": "application/json", "transfer-encoding": "chunked" }, chunks: [oversized.subarray(0, 9000), oversized.subarray(9000)] }); assert.equal(chunked.status, 400); assert.equal(calls, 0);
});
test("loopback auth parser caps fixed and chunked bodies, rejects malformed JSON and never invokes handler", async (t) => {
  let calls = 0; const app = assembled({ tenant: (_req, res) => { calls += 1; res.json({ ok: true }); } }); const server = await listen(app); t.after(() => server.close()); const oversized = Buffer.alloc(4097, 0x61);
  for (const options of [
    { headers: { "content-type": "application/json", "content-length": oversized.length }, body: oversized },
    { headers: { "content-type": "application/json", "transfer-encoding": "chunked" }, chunks: [oversized.subarray(0, 2000), oversized.subarray(2000)] },
    { headers: { "content-type": "application/json" }, body: Buffer.from("{") },
    { headers: { "content-type": "text/plain" }, body: Buffer.from("{}") },
  ]) { const result = await request(server, { path: "/api/auth/login", ...options }); assert.equal(result.status, 400); }
  assert.equal(calls, 0);
});
test("loopback auth route rejects non-string token/password and enforces Unicode and UTF-8 boundaries", async (t) => {
  const app = assembled({ tenant: (req, res) => res.status(typeof req.body.token === "string" && RESET_TOKEN.test(req.body.token) && validNewPassword(req.body.password) ? 204 : 400).end() }); const server = await listen(app); t.after(() => server.close());
  const token = Buffer.alloc(32, 3).toString("base64url"); const send = (value) => { const body = Buffer.from(JSON.stringify(value)); return request(server, { path: "/api/auth/login", headers: { "content-type": "application/json", "content-length": body.length }, body }); };
  for (const value of [{ token: 1, password: "12345678" }, { token: {}, password: "12345678" }, { token, password: 12345678 }, { token, password: [] }, { token: "short", password: "12345678" }, { token, password: "💩".repeat(19) }]) assert.equal((await send(value)).status, 400);
  assert.equal((await send({ token, password: "💩".repeat(8) })).status, 204); assert.equal((await send({ token, password: "a".repeat(72) })).status, 204); assert.equal((await send({ token, password: "a".repeat(73) })).status, 400);
});
test("authentication logging emits only fixed categories and request IDs", async () => {
  const captured = []; const original = console.error; console.error = (...args) => captured.push(args); try {
    const res = { status() { return this; }, json() { return this; } }; sendAuthFailure({ requestId: "req-safe" }, res, new Error("password=secret SQL SELECT users"), "failed");
    const middleware = createPlatformAuthMiddleware({ verifyToken: () => ({ actor_type: "platform_admin", role: "platform_admin", sub: "1" }), executor: { async query() { throw new Error("token=hostile database schema"); } } });
    await middleware({ requestId: "req-platform", headers: { authorization: "Bearer synthetic" } }, res, () => assert.fail());
  } finally { console.error = original; }
  const rendered = JSON.stringify(captured); assert.match(rendered, /AUTH_FAILURE/); assert.doesNotMatch(rendered, /password=secret|SQL SELECT|token=hostile|database schema/);
});
test("platform authentication denies tenant/forged/inactive identities and loads an active admin record", async () => {
  const response = () => ({ code: 200, body: null, status(value) { this.code = value; return this; }, json(value) { this.body = value; return this; } });
  let queried = 0; const active = createPlatformAuthMiddleware({ verifyToken: () => ({ actor_type: "platform_admin", role: "platform_admin", sub: "7" }), executor: { async query(sql, params) { queried += 1; assert.deepEqual(params, [7]); return [[{ id: 7, name: "Admin", email: "admin@example.test", status: "active" }]]; } } }); const req = { headers: { authorization: "Bearer synthetic" } }; let called = 0; await active(req, response(), () => { called += 1; }); assert.equal(called, 1); assert.equal(queried, 1); assert.equal(req.platformAdmin.id, 7);
  for (const claims of [{ actor_type: "tenant", role: "owner", sub: "7" }, { actor_type: "platform_admin", role: "platform_admin", sub: "invalid" }]) { const middleware = createPlatformAuthMiddleware({ verifyToken: () => claims, executor: { async query() { assert.fail(); } } }); const res = response(); await middleware({ headers: { authorization: "Bearer synthetic" } }, res, () => assert.fail()); assert.ok([401, 403].includes(res.code)); }
  const inactive = createPlatformAuthMiddleware({ verifyToken: () => ({ actor_type: "platform_admin", role: "platform_admin", sub: "7" }), executor: { async query() { return [[{ id: 7, status: "disabled" }]]; } } }); const res = response(); await inactive({ headers: { authorization: "Bearer synthetic" } }, res, () => assert.fail()); assert.equal(res.code, 403);
});
test("platform trial response shaping is allowlisted and never exposes hashes or secrets", () => {
  const result = shape({ id: 1, public_reference: "ref", full_name: "Owner", company_name: "Company", email: "owner@example.test", mobile: "+919876543210", city: "Pune", country: "IN", business_type: "services", privacy_policy_version: POLICY_VERSION, status: "pending", version: 1, token_hash: "forbidden", password: "forbidden", idempotency_key: "forbidden" }); const rendered = JSON.stringify(result); assert.doesNotMatch(rendered, /token_hash|password|idempotency_key|forbidden/);
});

test("shared platform assembly bounds fixed/chunked bodies and rejects types before authentication", async (t) => {
  let calls = 0;
  const login = createPlatformLogin({ authenticate: async ({ email, password }) => { calls += 1; assert.equal(email, "admin@example.test"); assert.equal(password, "synthetic-password"); return { token: "synthetic", admin: { id: 1 } }; } });
  const server = await listen(assembled({ login })); t.after(() => server.close());
  const send = (value) => request(server, { path: "/api/platform/auth/login", headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify(value)) });
  const credentials = { email: "admin@example.test", password: "synthetic-password" };
  assert.equal((await send(credentials)).status, 200); assert.equal(calls, 1);
  for (const field of ["email", "password"]) for (const value of [[], [credentials[field]], {}, 123, true, null]) {
    assert.equal((await send({ ...credentials, [field]: value })).status, 401);
    await assert.rejects(authenticatePlatformAdmin({ ...credentials, [field]: value }, { executor: { query() { assert.fail("database invoked"); } } }), (error) => error.code === "INVALID_CREDENTIALS");
  }
  for (const value of [{ ...credentials, email: "a".repeat(255) }, { ...credentials, password: "a".repeat(1025) }]) assert.equal((await send(value)).status, 401);
  const oversized = Buffer.from(JSON.stringify({ ...credentials, padding: "x".repeat(4096) }));
  for (const options of [
    { headers: { "content-type": "application/json", "content-length": oversized.length }, body: oversized },
    { headers: { "content-type": "application/json", "transfer-encoding": "chunked" }, chunks: [oversized.subarray(0, 2000), oversized.subarray(2000)] },
    { headers: { "content-type": "application/json" }, body: Buffer.from("{") },
    { headers: { "content-type": "text/plain" }, body: Buffer.from("{}") },
  ]) { const result = await request(server, { path: "/api/platform/auth/login", ...options }); assert.equal(result.status, 400); assert.equal(JSON.parse(result.body).code, "AUTH_REQUEST_INVALID"); }
  assert.equal(calls, 1);
});

test("shared platform me assembly queries active administrator once; later routes retain global parser", async (t) => {
  let queries = 0, tenantCalls = 0; let active = true;
  const authenticate = createPlatformAuthMiddleware({ verifyToken: () => ({ actor_type: "platform_admin", role: "platform_admin", sub: "7" }), executor: { async query() { queries += 1; return [[{ id: 7, status: active ? "active" : "disabled", name: "Admin", email: "admin@example.test" }]]; } } });
  const server = await listen(assembled({ authenticate, tenant: (_req, res) => { tenantCalls += 1; res.sendStatus(204); } })); t.after(() => server.close());
  const options = { path: "/api/platform/auth/me", method: "GET", headers: { authorization: "Bearer synthetic" } };
  assert.equal((await request(server, options)).status, 200); assert.equal(queries, 1);
  active = false; assert.equal((await request(server, options)).status, 403); assert.equal(queries, 2);
  assert.equal((await request(server, { path: "/api/auth/login", headers: { "content-type": "application/json" }, body: Buffer.from("{}") })).status, 204); assert.equal(tenantCalls, 1);
  const result = await request(server, { path: "/api/later", headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify({ value: "x".repeat(20000) })) });
  assert.equal(result.status, 200); assert.equal(JSON.parse(result.body).size, 20000);
});

test("production calls the exact shared assembly and its import has no I/O or startup effects", () => {
  const fs = require("node:fs"); const path = require("node:path");
  const index = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
  assert.equal((index.match(/assembleApplicationBoundary\(app,/g) || []).length, 1);
  assert.doesNotMatch(index, /app\.use\("\/api\/(?:auth|public|platform\/auth)"/);
  const later = fs.readFileSync(path.join(__dirname, "../routes/platformRoutes.js"), "utf8"); assert.doesNotMatch(later, /"\/auth\/(?:login|me)"/);
  const output = execFileSync(process.execPath, ["-e", `
    const net = require('node:net'); const Module = require('node:module');
    net.Server.prototype.listen = net.Socket.prototype.connect = () => { throw Error('network'); };
    global.fetch = () => { throw Error('external'); };
    const load = Module._load;
    Module._load = function(name, ...args) {
      if (/db[\\/]connection|mysql|scheduler|emailService|node-cron/.test(name)) throw Error('side-effect dependency');
      return load.call(this, name, ...args);
    };
    require('./middleware/applicationAssembly'); require('./routes/platformAuthRoutes');
    console.log('IMPORT_INERT');
  `], { cwd: require("node:path").join(__dirname, ".."), encoding: "utf8" });
  assert.equal(output.trim(), "IMPORT_INERT");
});
