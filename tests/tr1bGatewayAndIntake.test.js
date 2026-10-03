const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const {
  MAX_BODY_BYTES, TRIAL_BODY_FIELD_ORDER, canonical, canonicalizeTrialRequestBody,
  configurationIssues, createTrialRequestGatewayAuth, gatewaySecret, safeEqualHex, sha256,
} = require("../middleware/trialRequestGatewayAuth");
const { POLICY_VERSION, TrialRequestError, intentHash, normalize, persistTrialRequest, reserveRateCapacity, submitTrialRequest } = require("../services/trialRequestService");

const secret = Buffer.alloc(32, 7).toString("base64url");
const environment = { TRIAL_REQUEST_INTAKE_ENABLED: "true", TRIAL_REQUEST_GATEWAY_SECRET: secret, TRIAL_REQUEST_ALLOWED_ORIGIN: "https://revexbooks.com" };
const now = Date.parse("2026-09-29T10:00:00.000Z");
const valid = () => ({ full_name: "Test Owner", company_name: "Test Co", email: "owner@example.test", mobile: "+919876543210", city: "Pune", country: "IN", business_type: "services", note: "Please contact me", privacy_communications_consent: true, privacy_policy_version: POLICY_VERSION, website: "" });
const bodyText = (value = valid()) => canonicalizeTrialRequestBody(value);
const signed = (body, overrides = {}) => {
  const timestamp = overrides.timestamp || new Date(now).toISOString();
  const idempotencyKey = overrides.key || "123e4567-e89b-42d3-a456-426614174000";
  const bodySha256 = sha256(body); const clientIpHash = "a".repeat(64);
  const signature = crypto.createHmac("sha256", gatewaySecret(environment.TRIAL_REQUEST_GATEWAY_SECRET)).update(canonical({ timestamp, idempotencyKey, bodySha256, clientIpHash })).digest("hex");
  return { "content-type": "application/json", origin: environment.TRIAL_REQUEST_ALLOWED_ORIGIN, "x-revex-timestamp": timestamp, "idempotency-key": idempotencyKey, "x-revex-body-sha256": bodySha256, "x-revex-client-ip-hash": clientIpHash, "x-revex-signature": signature, ...overrides.headers };
};
const response = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, set() { return this; }, json(body) { this.body = body; return this; } });
const invoke = (body, headers = signed(body)) => { const req = { method: "POST", path: "/trial-requests", headers, body }; const res = response(); let called = false; createTrialRequestGatewayAuth({ environment, clock: () => now })(req, res, () => { called = true; }); return { called, req, res }; };

test("gateway documents and accepts only the fixed-order canonical body and exact-byte HMAC", () => {
  const body = Buffer.from(bodyText()); const result = invoke(body);
  assert.equal(result.called, true); assert.deepEqual(result.req.body, valid());
  assert.deepEqual(Object.keys(result.req.body), TRIAL_BODY_FIELD_ORDER); assert.equal(result.req.trialGateway.clientIpHash, "a".repeat(64));
});
test("gateway is unavailable by default and weak, malformed, or missing secrets fail closed", () => {
  for (const value of [undefined, "short", "!not-base64url!", Buffer.alloc(31).toString("base64url"), `${secret}=`]) {
    const env = { ...environment, TRIAL_REQUEST_GATEWAY_SECRET: value }; assert.ok(configurationIssues(env).includes("TRIAL_REQUEST_GATEWAY_SECRET"));
    const res = response(); createTrialRequestGatewayAuth({ environment: env, clock: () => now })({ method: "POST", path: "/trial-requests", headers: {}, body: Buffer.from("{}") }, res, () => assert.fail()); assert.equal(res.statusCode, 503);
  }
});
test("gateway rejects noncanonical timestamp, UUID and lowercase-hex boundary violations", () => {
  const body = Buffer.from(bodyText());
  const cases = [
    signed(body, { timestamp: "2026-09-29T15:30:00.000+05:30" }), signed(body, { timestamp: "2026-09-29T10:00:00Z" }), signed(body, { timestamp: "2026-09-29T10:00:00.00Z" }),
    signed(body, { key: "123E4567-E89B-42D3-A456-426614174000" }), { ...signed(body), "x-revex-body-sha256": "A".repeat(64) },
    { ...signed(body), "x-revex-client-ip-hash": "a".repeat(63) }, { ...signed(body), "x-revex-signature": "a".repeat(65) },
  ];
  for (const headers of cases) { const result = invoke(body, headers); assert.equal(result.called, false); assert.equal(result.res.body.code, "TRIAL_REQUEST_INVALID"); }
});
test("gateway rejects whitespace, order, duplicate keys, escapes, trailing data and malformed UTF-8", () => {
  const canonicalBody = bodyText();
  const reordered = JSON.stringify({ company_name: "Test Co", full_name: "Test Owner", ...Object.fromEntries(Object.entries(valid()).slice(2)) });
  const duplicate = canonicalBody.replace('"full_name":"Test Owner"', '"full_name":"Other","full_name":"Test Owner"');
  const escaped = canonicalBody.replace("Test Owner", "Test\\u0020Owner");
  const bodies = [Buffer.from(` ${canonicalBody}`), Buffer.from(reordered), Buffer.from(duplicate), Buffer.from(escaped), Buffer.from(`${canonicalBody}x`), Buffer.from([0xc3, 0x28])];
  for (const body of bodies) { const result = invoke(body); assert.equal(result.called, false); assert.equal(result.res.body.code, "TRIAL_REQUEST_INVALID"); }
});
test("gateway rejects wrong origin, exact-byte hash, stale time, content type and oversized body", () => {
  const body = Buffer.from(bodyText()); const stale = signed(body, { timestamp: "2026-09-29T09:54:59.000Z" });
  const cases = [
    { headers: { ...signed(body), origin: "https://evil.test" }, body }, { headers: { ...signed(body), "x-revex-signature": "b".repeat(64) }, body },
    { headers: { ...signed(body), "x-revex-body-sha256": "b".repeat(64) }, body }, { headers: stale, body },
    { headers: { ...signed(body), "content-type": "text/plain" }, body }, { headers: signed(Buffer.alloc(MAX_BODY_BYTES + 1)), body: Buffer.alloc(MAX_BODY_BYTES + 1) },
  ];
  for (const item of cases) { const result = invoke(item.body, item.headers); assert.equal(result.called, false); assert.equal(result.res.body.code, "TRIAL_REQUEST_INVALID"); }
});
test("constant-time helper accepts only equal exact lowercase hex digests", () => { assert.equal(safeEqualHex("a".repeat(64), "a".repeat(64)), true); assert.equal(safeEqualHex("a".repeat(64), "b".repeat(64)), false); assert.equal(safeEqualHex("bad", "bad"), false); assert.equal(safeEqualHex("A".repeat(64), "A".repeat(64)), false); });

test("intake normalizes the complete allowlist and produces deterministic intent hashes", () => { const a = normalize({ ...valid(), full_name: " Test Owner ", email: "OWNER@EXAMPLE.TEST" }); assert.equal(a.email, "owner@example.test"); assert.equal(a.full_name, "Test Owner"); assert.equal(intentHash(a), intentHash({ ...a })); });
test("intake rejects unexpected fields, non-string fields, honeypot, consent, policy, country, control chars and invalid mobile", () => {
  const variants = [{ extra: 1 }, { email: {} }, { website: "bot" }, { privacy_communications_consent: false }, { privacy_policy_version: "old" }, { country: "US" }, { note: "bad\u0001" }, { mobile: "9876543210" }];
  for (const change of variants) assert.throws(() => normalize({ ...valid(), ...change }), (error) => error instanceof TrialRequestError && error.code === "TRIAL_REQUEST_INVALID");
});
test("rate-bucket reservation locks one UTC bucket and caps it atomically without retry", async () => {
  const calls = []; const connection = { async query(sql) { calls.push(sql); if (sql.startsWith("SELECT FLOOR")) return [[{ bucket_number: 123 }]]; if (sql.startsWith("SELECT request_count")) return [[{ request_count: 4 }]]; if (sql.startsWith("UPDATE trial_request_rate_buckets")) return [{ affectedRows: 1 }]; return [{ affectedRows: 1 }]; } };
  await reserveRateCapacity(connection, "a".repeat(64)); assert.match(calls[2], /FOR UPDATE/); assert.match(calls[3], /request_count<5/); assert.equal(calls.length, 4);
  connection.query = async (sql) => sql.startsWith("SELECT FLOOR") ? [[{ bucket_number: 123 }]] : sql.startsWith("SELECT request_count") ? [[{ request_count: 5 }]] : [{ affectedRows: 1 }];
  await assert.rejects(reserveRateCapacity(connection, "a".repeat(64)), (error) => error.code === "TRIAL_REQUEST_RATE_LIMITED");
});
test("mocked concurrent rate reservations serialize through the same locked bucket", async () => {
  let count = 4; let tail = Promise.resolve();
  const connection = () => { let release; return { async query(sql) {
    if (sql.startsWith("SELECT FLOOR")) return [[{ bucket_number: 123 }]];
    if (sql.startsWith("INSERT INTO trial_request_rate_buckets")) return [{ affectedRows: 1 }];
    if (sql.startsWith("SELECT request_count")) { const previous = tail; tail = new Promise((resolve) => { release = resolve; }); await previous; return [[{ request_count: count }]]; }
    if (sql.startsWith("UPDATE trial_request_rate_buckets")) { if (count >= 5) { release(); return [{ affectedRows: 0 }]; } count += 1; release(); return [{ affectedRows: 1 }]; }
    throw new Error(sql);
  } }; };
  const outcomes = await Promise.allSettled([reserveRateCapacity(connection(), "a".repeat(64)), reserveRateCapacity(connection(), "a".repeat(64))]);
  assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1); assert.equal(outcomes.filter((item) => item.status === "rejected" && item.reason.code === "TRIAL_REQUEST_RATE_LIMITED").length, 1); assert.equal(count, 5);
});
test("public-reference collisions retry boundedly while normalized email/mobile duplicates suppress", async () => {
  let inserts = 0; const connection = { async query(sql) { if (sql.startsWith("INSERT INTO trial_requests")) { inserts += 1; if (inserts === 1) throw Object.assign(new Error("hidden"), { code: "ER_DUP_ENTRY" }); return [{ insertId: inserts, affectedRows: 1 }]; } if (sql.includes("WHERE email=?")) return [[]]; if (sql.includes("WHERE public_reference=?")) return [[{ id: 1 }]]; throw new Error(sql); } };
  const created = await persistTrialRequest({ connection, data: normalize(valid()), clientIpHash: "a".repeat(64), randomBytes: () => Buffer.alloc(18, inserts + 1) }); assert.equal(created.status, "accepted"); assert.equal(inserts, 2);
  const duplicate = { async query(sql) { if (sql.startsWith("INSERT INTO trial_requests")) throw Object.assign(new Error("hidden"), { code: "ER_DUP_ENTRY" }); return [[{ id: 9 }]]; } };
  assert.deepEqual(await persistTrialRequest({ connection: duplicate, data: normalize(valid()), clientIpHash: "a".repeat(64), randomBytes: () => Buffer.alloc(18, 1) }), { requestId: 9, status: "suppressed" });
});
test("same idempotency key and intent replays the exact stored safe response reference", async () => {
  const events = []; const connection = { async beginTransaction() {}, async query(sql) { events.push(sql); throw Object.assign(new Error("hidden"), { code: "ER_DUP_ENTRY" }); }, async rollback() {}, release() {} };
  const result = await submitTrialRequest({ body: valid(), gateway: { idempotencyKey: "123e4567-e89b-42d3-a456-426614174000", clientIpHash: "a".repeat(64) } }, { executor: { async getConnection() { return connection; }, async query() { return [[{ intent_hash: intentHash(normalize(valid())), status: "accepted", result_code: "TRIAL_REQUEST_RECEIVED", response_reference: "s".repeat(24) }]]; } } });
  assert.deepEqual(result, { code: "TRIAL_REQUEST_RECEIVED", request_reference: "s".repeat(24) }); assert.equal(events.length, 1);
});

// Models unique-key waiting and commit visibility, with transaction-local quota
// and request effects. No database or network is used by these behavioral tests.
const intakeHarness = ({ reservationFailures = [], collision = false, ownerFails = false } = {}) => {
  let durable = null, pending = null, acquisitions = 0, quota = 0, requests = 0, lookups = 0;
  const executor = {
    async query(sql) { lookups += 1; if (sql.includes("WHERE response_reference=?")) return [collision ? [{ id: 9 }] : []]; return [durable ? [durable] : []]; },
    async getConnection() {
      acquisitions += 1; let own = null, reserved = false, inserted = false, first = true;
      return {
        async beginTransaction() {},
        async query(sql, params) {
          if (first) { assert.match(sql, /^INSERT INTO trial_request_submissions/); first = false; }
          if (sql.startsWith("INSERT INTO trial_request_submissions")) {
            const failure = reservationFailures.shift(); if (failure) throw Object.assign(new Error("hidden"), { code: failure });
            if (pending) await pending.done;
            if (durable) throw Object.assign(new Error("hidden"), { code: "ER_DUP_ENTRY" });
            let resolve; pending = { done: new Promise((r) => { resolve = r; }), resolve: () => resolve() };
            own = { intent_hash: params[1], result_code: "TRIAL_REQUEST_RECEIVED", response_reference: params[2], status: "in_flight" };
            return [{ affectedRows: 1 }];
          }
          if (sql.startsWith("SELECT FLOOR")) return [[{ bucket_number: 123 }]];
          if (sql.startsWith("INSERT INTO trial_request_rate_buckets")) return [{ affectedRows: 1 }];
          if (sql.startsWith("SELECT request_count")) return [[{ request_count: quota }]];
          if (sql.startsWith("UPDATE trial_request_rate_buckets")) { reserved = true; return [{ affectedRows: 1 }]; }
          if (sql.startsWith("INSERT INTO trial_requests")) { if (ownerFails) { ownerFails = false; throw new Error("forced owner rollback"); } inserted = true; return [{ insertId: 1, affectedRows: 1 }]; }
          if (sql.startsWith("UPDATE trial_request_submissions")) { own.status = params[1]; return [{ affectedRows: 1 }]; }
          throw Error("unexpected SQL");
        },
        async commit() { durable = own; quota += Number(reserved); requests += Number(inserted); pending.resolve(); pending = null; },
        async rollback() { if (own) { pending.resolve(); pending = null; } },
        release() {},
      };
    },
  };
  return { executor, seed: (row) => { durable = row; }, stats: () => ({ acquisitions, quota, requests, lookups }) };
};
const intakeInput = (body = valid()) => ({ body, gateway: { idempotencyKey: "123e4567-e89b-42d3-a456-426614174000", clientIpHash: "a".repeat(64) } });

test("insert-first concurrent same-key requests replay one committed owner without quota or side-effect replay", async () => {
  const h = intakeHarness(); const results = await Promise.all([submitTrialRequest(intakeInput(), h), submitTrialRequest(intakeInput(), h)]);
  assert.deepEqual(results[0], results[1]); assert.equal(h.stats().quota, 1); assert.equal(h.stats().requests, 1); assert.equal(h.stats().acquisitions, 2);
});
test("insert-first concurrent different intent returns deterministic conflict after owner commits", async () => {
  const h = intakeHarness(); const results = await Promise.allSettled([submitTrialRequest(intakeInput(), h), submitTrialRequest(intakeInput({ ...valid(), city: "Mumbai" }), h)]);
  assert.equal(results[0].status, "fulfilled"); assert.equal(results[1].reason.code, "TRIAL_REQUEST_IDEMPOTENCY_CONFLICT"); assert.equal(h.stats().requests, 1);
});
test("when the first owner rolls back, a waiting insert becomes the sole durable owner", async () => {
  const h = intakeHarness({ ownerFails: true }); const results = await Promise.allSettled([submitTrialRequest(intakeInput(), h), submitTrialRequest(intakeInput(), h)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1); assert.equal(h.stats().quota, 1); assert.equal(h.stats().requests, 1); assert.equal(h.stats().acquisitions, 2);
});
test("deadlock/lock-wait victims only look up durable winners and never retry writes", async () => {
  for (const code of ["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"]) for (const exists of [true, false]) {
    const h = intakeHarness({ reservationFailures: [code] });
    if (exists) h.seed({ intent_hash: intentHash(normalize(valid())), status: "accepted", result_code: "TRIAL_REQUEST_RECEIVED", response_reference: "s".repeat(24) });
    if (exists) assert.equal((await submitTrialRequest(intakeInput(), h)).request_reference, "s".repeat(24));
    else await assert.rejects(submitTrialRequest(intakeInput(), h), (e) => e.code === "TRIAL_REQUEST_UNAVAILABLE");
    assert.equal(h.stats().acquisitions, 1); assert.equal(h.stats().quota, 0); assert.equal(h.stats().requests, 0); assert.ok(h.stats().lookups <= 3);
  }
});
test("response-reference collision retries reservation only; three collisions exhaust safely", async () => {
  const h = intakeHarness({ reservationFailures: ["ER_DUP_ENTRY"], collision: true });
  await submitTrialRequest(intakeInput(), h); assert.equal(h.stats().acquisitions, 2); assert.equal(h.stats().quota, 1); assert.equal(h.stats().requests, 1);
  const blocked = intakeHarness({ reservationFailures: Array(3).fill("ER_DUP_ENTRY"), collision: true });
  await assert.rejects(submitTrialRequest(intakeInput(), blocked), (e) => e.code === "TRIAL_REQUEST_UNAVAILABLE");
  assert.equal(blocked.stats().acquisitions, 3); assert.equal(blocked.stats().quota, 0); assert.equal(blocked.stats().requests, 0);
});

test("owner-stage deadlocks roll back quota and do not repeat intake effects", async () => {
  for (const code of ["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"]) {
    const h = intakeHarness(), acquire = h.executor.getConnection; let rollbacks = 0;
    h.executor.getConnection = async () => {
      const connection = await acquire(), query = connection.query, rollback = connection.rollback;
      connection.query = async (sql, params) => { if (sql.startsWith("INSERT INTO trial_requests")) throw Object.assign(Error("hidden"), { code }); return query(sql, params); };
      connection.rollback = async () => { rollbacks += 1; return rollback(); }; return connection;
    };
    await assert.rejects(submitTrialRequest(intakeInput(), h), { code: "TRIAL_REQUEST_UNAVAILABLE" });
    assert.equal(rollbacks, 1); assert.equal(h.stats().acquisitions, 1); assert.equal(h.stats().quota, 0); assert.equal(h.stats().requests, 0);
  }
});

test("uncertain commit discards the connection and only accepts a durable winner, never repeating writes", async () => {
  for (const durable of [true, false]) {
    const h = intakeHarness(), acquire = h.executor.getConnection; let destroyed = 0;
    h.executor.getConnection = async () => {
      const connection = await acquire(), commit = connection.commit;
      connection.commit = async () => { if (durable) await commit(); throw Error("uncertain commit"); };
      connection.destroy = () => { destroyed += 1; }; return connection;
    };
    if (durable) assert.equal((await submitTrialRequest(intakeInput(), h)).code, "TRIAL_REQUEST_RECEIVED");
    else await assert.rejects(submitTrialRequest(intakeInput(), h), { code: "TRIAL_REQUEST_UNAVAILABLE" });
    assert.equal(destroyed, 1); assert.equal(h.stats().acquisitions, 1); assert.equal(h.stats().requests, Number(durable));
  }
});
