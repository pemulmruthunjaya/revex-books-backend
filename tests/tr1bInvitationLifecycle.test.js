const test = require("node:test");
const assert = require("node:assert/strict");
const { activateAccount, enabled, hashToken, InvitationError, listTrialRequests, normalizeDeliveryRead, pageLimit } = require("../services/trialInvitationService");
const { sendTrialActivation } = require("../services/emailService");

const token = "A".repeat(43);
const invitation = () => ({ id: 9, owner_user_id: 22, company_id: 33, activation_required: 1, user_active: 1, company_status: "active", subscription_status: "trialing", status: "pending_activation", token_generation: 2, server_now: "2026-09-29T00:00:00.000Z", token_expires_at: "2099-01-01T00:00:00.000Z", trial_end_at: "2099-01-02T00:00:00.000Z" });
const activationExecutor = (row = invitation()) => {
  const calls = []; let committed = 0, rolledBack = 0;
  const connection = { async beginTransaction() { calls.push("begin"); }, async query(sql, params) { calls.push({ sql, params }); if (sql.includes("FROM trial_invitations")) return [row ? [row] : []]; if (sql.startsWith("UPDATE users")) return [{ affectedRows: 1 }]; if (sql.startsWith("UPDATE trial_invitations")) return [{ affectedRows: 1 }]; if (sql.startsWith("INSERT INTO trial_invitation_operations")) return [{ insertId: 1 }]; throw new Error("unexpected SQL"); }, async commit() { committed += 1; }, async rollback() { rolledBack += 1; }, release() {} };
  return { calls, get committed() { return committed; }, get rolledBack() { return rolledBack; }, executor: { async getConnection() { return connection; } } };
};

test("approval gate is opt-in only", () => { assert.equal(enabled({}), false); assert.equal(enabled({ TRIAL_REQUEST_APPROVAL_ENABLED: "false" }), false); assert.equal(enabled({ TRIAL_REQUEST_APPROVAL_ENABLED: "true" }), true); });
test("activation hashes the token, changes one user and invitation atomically, and returns no session", async () => {
  const harness = activationExecutor(); const result = await activateAccount({ token, password: "secure-pass" }, { executor: harness.executor, hash: async () => "bcrypt-hash" });
  assert.deepEqual(result, { code: "ACCOUNT_ACTIVATED" }); assert.equal(harness.committed, 1); assert.equal(harness.rolledBack, 0);
  const select = harness.calls.find((call) => call.sql?.includes("FROM trial_invitations")); assert.deepEqual(select.params, [hashToken(token)]); assert.notEqual(select.params[0], token);
  const userUpdate = harness.calls.find((call) => call.sql?.startsWith("UPDATE users")); assert.match(userUpdate.sql, /activation_required=0/); assert.match(userUpdate.sql, /password_reset_token_hash=NULL/); assert.equal(Object.hasOwn(result, "token"), false);
});
test("activation rejects replay/unknown tokens with the same sanitized code and rolls back", async () => {
  const harness = activationExecutor(null); await assert.rejects(activateAccount({ token, password: "secure-pass" }, { executor: harness.executor, hash: async () => "hash" }), (error) => error instanceof InvitationError && error.code === "ACTIVATION_INVALID"); assert.equal(harness.rolledBack, 1);
});
test("activation enforces minimum characters and bcrypt 72-byte UTF-8 boundary without trimming", async () => {
  await assert.rejects(activateAccount({ token, password: "short" }), (error) => error.code === "ACTIVATION_INVALID");
  await assert.rejects(activateAccount({ token, password: "💩".repeat(19) }), (error) => error.code === "ACTIVATION_INVALID");
  await assert.rejects(activateAccount({ token, password: 12345678 }), (error) => error.code === "ACTIVATION_INVALID");
  await assert.rejects(activateAccount({ token: [token], password: "secure-pass" }), (error) => error.code === "ACTIVATION_INVALID");
  await assert.rejects(activateAccount({ token: "too-short", password: "secure-pass" }), (error) => error.code === "ACTIVATION_INVALID");
  assert.equal(Array.from("💩".repeat(8)).length, 8);
});
test("activation email contains no password and uses the existing injected Graph boundary", async () => {
  let message; const result = await sendTrialActivation({ name: "Owner", email: "owner@example.test", token: "opaque-token", trialExpiresAt: "2026-10-13T00:00:00Z" }, { environment: { APP_URL: "https://app.example.test", EMAIL_PROVIDER: "microsoft_graph", MS_GRAPH_TENANT_ID: "00000000-0000-4000-8000-000000000001", MS_GRAPH_CLIENT_ID: "00000000-0000-4000-8000-000000000002", MS_GRAPH_CLIENT_SECRET: "synthetic-test-only", MS_GRAPH_SENDER: "support@revexbooks.com" }, provider: { async sendMail(value) { message = value; return { sent: true }; } } });
  assert.deepEqual(result, { sent: true }); assert.equal(message.replyTo, "support@revexbooks.com"); assert.match(message.text, /activate-account#token=opaque-token/); assert.doesNotMatch(message.text, /temporary password|default password/i);
  assert.match(message.text, /Trial expires: 2026-10-13T00:00:00\.000Z/); assert.doesNotMatch(message.text, /\.000Z UTC/);
});
test("activation email rejects an invalid trial expiry before delivery", async () => {
  let sent = 0; assert.throws(() => sendTrialActivation({ name: "Owner", email: "owner@example.test", token: "opaque-token", trialExpiresAt: "invalid" }, { environment: { APP_URL: "https://app.example.test" }, provider: { async sendMail() { sent += 1; } } }), (error) => error.code === "TRIAL_INVITATION_EXPIRY_INVALID"); assert.equal(sent, 0);
});
test("delivery reads distinguish recent in-progress from stale unknown using server time", () => {
  const base = { delivery_internal_status: "in_flight", server_now: "2026-09-29T10:00:00.000Z" };
  assert.equal(normalizeDeliveryRead({ ...base, delivery_operation_created_at: "2026-09-29T09:50:00.000Z" }).delivery_status, "in_progress");
  assert.equal(normalizeDeliveryRead({ ...base, delivery_operation_created_at: "2026-09-29T09:44:59.999Z" }).delivery_status, "unknown");
  assert.equal(normalizeDeliveryRead({ ...base, delivery_internal_status: "accepted", delivery_operation_created_at: "2026-09-29T09:00:00.000Z" }).delivery_status, "accepted");
});
test("platform listing validates bounded limits and traverses with a tamper-evident cursor", async () => {
  assert.equal(pageLimit(undefined), 20); for (const value of ["0", "51", "1.5", "x", 20]) assert.throws(() => pageLimit(value), (error) => error.code === "INVALID_PAGINATION");
  const secret = "s".repeat(32); const rows = [1, 2, 3].map((id) => ({ id, created_at: `2026-09-2${9 - id}T00:00:00.000Z`, delivery_internal_status: null, server_now: "2026-09-29T00:00:00.000Z" })); let captured;
  const first = await listTrialRequests({ limit: "2" }, { cursorSecret: secret, executor: { async query(sql, params) { captured = { sql, params }; return [rows]; } } });
  assert.equal(first.data.length, 2); assert.equal(typeof first.nextCursor, "string"); assert.deepEqual(captured.params, [3]); assert.match(captured.sql, /ORDER BY r\.created_at DESC,r\.id DESC LIMIT \?/);
  const second = await listTrialRequests({ limit: "2", cursor: first.nextCursor }, { cursorSecret: secret, executor: { async query(sql, params) { captured = { sql, params }; return [[rows[2]]]; } } });
  assert.equal(second.data.length, 1); assert.equal(second.nextCursor, null); assert.deepEqual(captured.params.slice(-1), [3]); assert.match(captured.sql, /r\.created_at<\?/);
  await assert.rejects(listTrialRequests({ cursor: `${first.nextCursor}x` }, { cursorSecret: secret, executor: { async query() { assert.fail(); } } }), (error) => error.code === "INVALID_PAGINATION");
});

for (const [label, companyStatus] of [["inactive", "inactive"], ["null", null], ["missing", undefined], ["invalid", "enabled"]]) {
  test("activation rejects " + label + " company status before writes, hashing or delivery", async () => {
    const row = { ...invitation(), company_status: companyStatus }; if (label === "missing") delete row.company_status;
    const harness = activationExecutor(row); let hashes = 0, sends = 0;
    await assert.rejects(activateAccount({ token, password: "secure-pass" }, { executor: harness.executor, hash: async () => { hashes += 1; return "hash"; }, send: async () => { sends += 1; } }), { code: "ACTIVATION_INVALID" });
    assert.equal(harness.committed, 0); assert.equal(harness.rolledBack, 1); assert.equal(hashes, 0); assert.equal(sends, 0);
    assert.equal(harness.calls.some((call) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(call.sql || "")), false);
    assert.equal(harness.calls.filter((call) => call.sql).length, 1);
  });
}
