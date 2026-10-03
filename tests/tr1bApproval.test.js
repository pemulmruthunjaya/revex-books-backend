const test = require("node:test");
const assert = require("node:assert/strict");
const { approveTrialRequest, resendTrialInvitation, InvitationError, tokenState } = require("../services/trialInvitationService");
const { provisionCompanyOwner } = require("../services/companyOwnerProvisioningService");

const key = "123e4567-e89b-42d3-a456-426614174000";
const request = { id: 7, status: "pending", version: 3, email: "owner@example.test", full_name: "Owner", company_name: "Company" };
const build = ({ failAt = 0, prior = [] } = {}) => {
  const events = []; let queryIndex = 0;
  const connection = {
    async beginTransaction() { events.push("begin"); },
    async query(sql, params) {
      queryIndex += 1; events.push({ sql, params }); if (queryIndex === failAt) throw new Error("forced");
      if (sql.includes("FROM trial_invitation_operations")) return [prior];
      if (sql.includes("FROM trial_requests")) return [[request]];
      if (sql.startsWith("SELECT UTC_TIMESTAMP(6) generated_at")) return [[{ generated_at: "2026-09-29T00:00:00.000Z", expires_at: "2026-09-30T00:00:00.000Z" }]];
      if (sql.startsWith("INSERT INTO trial_invitations")) return [{ insertId: 91 }];
      if (sql.startsWith("INSERT INTO trial_invitation_operations")) return [{ insertId: 92 }];
      if (sql.startsWith("UPDATE trial_requests")) return [{ affectedRows: 1 }];
      throw new Error(`unexpected SQL ${sql}`);
    },
    async commit() { events.push("commit"); }, async rollback() { events.push("rollback"); }, release() { events.push("release"); },
  };
  const executor = { async getConnection() { return connection; }, async query(sql, params) { events.push({ sql, params, postCommit: true }); return [{ affectedRows: 1 }]; } };
  return { events, executor };
};
const options = (harness, send) => ({
  executor: harness.executor, environment: { TRIAL_REQUEST_APPROVAL_ENABLED: "true", APP_URL: "https://app.example.test" },
  randomBytes: (size) => Buffer.alloc(size, 7), now: () => new Date("2099-01-01T00:00:00.000Z"),
  provision: async () => ({ companyId: 31, ownerId: 41, subscription: { trial_start_at: "2026-09-29T00:00:00.000Z", trial_end_at: "2026-10-13T00:00:00.000Z" } }), send,
});

test("approval commits provisioning and hash-only invitation before its at-most-one automatic email attempt", async () => {
  const harness = build(); let sends = 0;
  const result = await approveTrialRequest({ requestId: 7, expectedVersion: 3, idempotencyKey: key, admin: { id: 2 } }, options(harness, async ({ token }) => { sends += 1; assert.equal(typeof token, "string"); assert.equal(harness.events.includes("commit"), true); return { sent: true }; }));
  assert.equal(sends, 1); assert.equal(result.delivery_status, "accepted"); assert.equal(harness.events.filter((item) => item === "commit").length, 1);
  const invitationInsert = harness.events.find((item) => item.sql?.startsWith("INSERT INTO trial_invitations"));
  assert.match(invitationInsert.params[6], /^[0-9a-f]{64}$/); assert.equal(invitationInsert.params.some((value) => typeof value === "string" && value.length === 43), false);
});
test("every pre-commit query failure rolls back and never invokes email", async () => {
  for (let failAt = 1; failAt <= 6; failAt += 1) {
    const harness = build({ failAt }); let sends = 0;
    await assert.rejects(approveTrialRequest({ requestId: 7, expectedVersion: 3, idempotencyKey: key, admin: { id: 2 } }, options(harness, async () => { sends += 1; return { sent: true }; })));
    assert.equal(sends, 0, `query ${failAt}`); assert.equal(harness.events.includes("rollback"), true, `query ${failAt}`); assert.equal(harness.events.includes("commit"), false, `query ${failAt}`);
  }
});
test("duplicate approval operation cannot provision or send again", async () => {
  const harness = build({ prior: [{ intent_hash: "different", status: "accepted", operation_type: "approve" }] }); let provisioned = 0, sends = 0;
  await assert.rejects(approveTrialRequest({ requestId: 7, expectedVersion: 3, idempotencyKey: key, admin: { id: 2 } }, { ...options(harness, async () => { sends += 1; }), provision: async () => { provisioned += 1; } }), (error) => error instanceof InvitationError && error.code === "IDEMPOTENCY_CONFLICT");
  assert.equal(provisioned, 0); assert.equal(sends, 0);
});
test("Graph conclusive failure and timeout uncertainty are recorded without automatic retry", async () => {
  for (const [delivery, expected] of [[{ sent: false, code: "MS_GRAPH_SEND_FAILED" }, "failed"], [{ sent: false, code: "MS_GRAPH_TIMEOUT" }, "unknown"]]) {
    const harness = build(); let sends = 0;
    const result = await approveTrialRequest({ requestId: 7, expectedVersion: 3, idempotencyKey: key, admin: { id: 2 } }, options(harness, async () => { sends += 1; return delivery; }));
    assert.equal(sends, 1); assert.equal(result.delivery_status, expected);
    const update = harness.events.find((item) => item.postCommit); assert.equal(update.params[0], expected);
  }
});
test("database time alone controls token generation despite application clock skew and trial boundary", async () => {
  for (const now of [() => new Date("1900-01-01T00:00:00Z"), () => new Date("2200-01-01T00:00:00Z")]) {
    const harness = build(); const result = await approveTrialRequest({ requestId: 7, expectedVersion: 3, idempotencyKey: key, admin: { id: 2 } }, { ...options(harness, async () => ({ sent: true })), now }); assert.equal(result.delivery_status, "accepted");
  }
  const connection = { async query() { return [[{ generated_at: "2026-09-29T00:00:00.000Z", expires_at: "2026-09-29T00:00:00.000Z" }]]; } };
  await assert.rejects(tokenState({ connection, randomBytes: () => Buffer.alloc(32, 1), trialEnd: "2026-09-29T00:00:00.000Z" }), (error) => error.code === "TRIAL_INVITATION_INELIGIBLE");
});
test("post-commit delivery status failure is unknown and never triggers an automatic resend", async () => {
  const harness = build(); harness.executor.query = async () => [{ affectedRows: 0 }]; let sends = 0;
  await assert.rejects(approveTrialRequest({ requestId: 7, expectedVersion: 3, idempotencyKey: key, admin: { id: 2 } }, options(harness, async () => { sends += 1; return { sent: true }; })), (error) => error.code === "TRIAL_INVITATION_DELIVERY_UNKNOWN"); assert.equal(sends, 1);
});
test("deadlock and unique provisioning races map to deterministic sanitized states", async () => {
  for (const [driverCode, publicCode] of [["ER_LOCK_DEADLOCK", "TRIAL_OPERATION_CONFLICT"], ["ER_DUP_ENTRY", "TRIAL_PROVISIONING_CONFLICT"]]) {
    const harness = build(); const error = new Error("hostile database detail"); error.code = driverCode;
    await assert.rejects(approveTrialRequest({ requestId: 7, expectedVersion: 3, idempotencyKey: key, admin: { id: 2 } }, { ...options(harness, async () => assert.fail()), provision: async () => { throw error; } }), (caught) => caught.code === publicCode && !caught.message.includes("hostile")); assert.equal(harness.events.includes("rollback"), true);
  }
});

const resendHarness = ({ cooldown = false, affectedRows = 1, companyStatus = "active", missingCompanyStatus = false } = {}) => {
  const events = []; let queryIndex = 0;
  const connection = { async beginTransaction() { events.push("begin"); }, async query(sql, params) { queryIndex += 1; events.push({ sql, params });
    if (sql.includes("FROM trial_invitations i JOIN")) return [[{ id: 91, trial_request_id: 7, company_id: 31, owner_user_id: 41, request_version: 3, version: 4, email: request.email, full_name: request.full_name, status: "pending_activation", activation_required: 1, user_active: 1, ...(missingCompanyStatus ? {} : { company_status: companyStatus }), subscription_status: "trialing", token_generation: 1, trial_end_at: "2026-10-13T00:00:00.000Z" }]];
    if (sql.includes("cooldown_until")) return [[{ now_at: "2026-09-29T00:20:00.000Z", cooldown_until: cooldown ? "2026-09-29T00:21:00.000Z" : "2026-09-29T00:19:00.000Z" }]];
    if (sql.includes("FROM trial_invitation_operations")) return [[]];
    if (sql.startsWith("SELECT UTC_TIMESTAMP(6) generated_at")) return [[{ generated_at: "2026-09-29T00:20:00.000Z", expires_at: "2026-09-30T00:20:00.000Z" }]];
    if (sql.startsWith("UPDATE trial_invitations")) return [{ affectedRows }]; if (sql.startsWith("INSERT INTO trial_invitation_operations")) return [{ insertId: 2 }]; throw new Error(`unexpected ${sql}`); },
    async commit() { events.push("commit"); }, async rollback() { events.push("rollback"); }, release() {} };
  return { events, executor: { async getConnection() { return connection; }, async query(sql, params) { events.push({ sql, params, postCommit: true }); return [{ affectedRows: 1 }]; } } };
};
test("resend enforces cooldown, rotates the hash/generation before one send, and never changes trial dates", async () => {
  const blocked = resendHarness({ cooldown: true }); await assert.rejects(resendTrialInvitation({ requestId: 7, expectedVersion: 3, idempotencyKey: key, admin: { id: 2 } }, { ...options(blocked, async () => ({ sent: true })) }), (error) => error.code === "TRIAL_INVITATION_COOLDOWN"); assert.equal(blocked.events.includes("commit"), false);
  const harness = resendHarness(); let sends = 0; const result = await resendTrialInvitation({ requestId: 7, expectedVersion: 3, idempotencyKey: key, admin: { id: 2 } }, { ...options(harness, async () => { sends += 1; assert.equal(harness.events.includes("commit"), true); return { sent: true }; }) });
  assert.equal(sends, 1); assert.equal(result.delivery_status, "accepted"); const update = harness.events.find((item) => item.sql?.startsWith("UPDATE trial_invitations")); assert.match(update.sql, /token_hash=UNHEX\(\?\),token_generation=\?/); assert.doesNotMatch(update.sql, /trial_(?:start|end)_at/); assert.equal(update.params[1], 2);
});
test("resend optimistic race rolls back before mail", async () => {
  const harness = resendHarness({ affectedRows: 0 }); let sends = 0; await assert.rejects(resendTrialInvitation({ requestId: 7, expectedVersion: 3, idempotencyKey: key, admin: { id: 2 } }, { ...options(harness, async () => { sends += 1; }) }), (error) => error.code === "TRIAL_INVITATION_VERSION_CONFLICT"); assert.equal(sends, 0); assert.equal(harness.events.includes("rollback"), true);
});
test("company provisioning fixes active PLAN_2 Pro to 14 days and creates activation-required owner topology", async () => {
  const calls = []; let nextId = 100; let trialInput;
  const connection = { async query(sql, params) { calls.push({ sql, params }); if (sql.includes("FROM plans")) return [[{ id: 2, code: "PLAN_2", name: "Pro", default_trial_days: 14 }]]; if (sql.includes("FROM users") || sql.includes("FROM companies WHERE")) return [[]]; if (sql.startsWith("INSERT")) return [{ insertId: nextId += 1 }]; throw new Error(sql); } };
  const result = await provisionCompanyOwner({ connection, request: { full_name: "Owner", company_name: "Company", email: "owner@example.test", business_type: "services", city: "Pune" }, adminId: 9, approvalKey: key, randomBytes: () => Buffer.alloc(48, 1), hash: async (value) => { assert.equal(value.length > 8, true); return "bcrypt-placeholder"; }, createTrial: async (input) => { trialInput = input; return { subscription: { trial_start_at: "start", trial_end_at: "end" } }; } });
  assert.deepEqual(result.subscription, { trial_start_at: "start", trial_end_at: "end" });
  assert.equal(result.companyId, 101); assert.equal(trialInput.planId, 2); assert.equal(trialInput.trialDays, 14); assert.equal(trialInput.connection, connection);
  assert.deepEqual(trialInput.expectedPlanContract, { code: "PLAN_2", name: "Pro", defaultTrialDays: 14 });
  assert.doesNotMatch(calls[0].sql, /FOR UPDATE/);
  const ownerInsert = calls.find((call) => call.sql.startsWith("INSERT INTO users")); assert.match(ownerInsert.sql, /activation_required/); assert.equal(ownerInsert.params.includes("bcrypt-placeholder"), true);
  assert.equal(calls.some((call) => call.sql.includes("Head Office")), true); assert.equal(calls.some((call) => call.sql.startsWith("INSERT INTO company_business_settings")), true);
});

for (const [label, companyStatus, missingCompanyStatus] of [["inactive", "inactive"], ["null", null], ["missing", undefined, true], ["invalid", "enabled"]]) {
  test("resend rejects " + label + " company status before writes or email", async () => {
    const harness = resendHarness({ companyStatus, missingCompanyStatus }); let sends = 0;
    await assert.rejects(resendTrialInvitation({ requestId: 7, expectedVersion: 3, idempotencyKey: key, admin: { id: 2 } }, options(harness, async () => { sends += 1; return { sent: true }; })), { code: "TRIAL_INVITATION_INELIGIBLE" });
    assert.equal(sends, 0); assert.equal(harness.events.includes("commit"), false); assert.equal(harness.events.includes("rollback"), true);
    assert.equal(harness.events.some((event) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(event.sql || "")), false);
    assert.equal(harness.events.filter((event) => event.sql).length, 1);
  });
}
