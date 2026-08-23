const assert = require("node:assert/strict");
const { PassThrough } = require("node:stream");
const test = require("node:test");
const bcrypt = require("bcryptjs");
const { resetPlatformAdminPassword, run } = require("../scripts/resetPlatformAdminPassword");

const input = (value) => { const stream = new PassThrough(); stream.isTTY = false; stream.end(value); return stream; };

test("reset updates only password_hash and verifies protected fields", async () => {
  const oldHash = await bcrypt.hash("old-password", 10);
  const row = { id: 1, name: "RevEx Admin", email: "revex@test.com", status: "active", last_login_at: new Date("2026-08-22T10:00:00Z"), password_hash: oldHash };
  const calls = []; let committed = false;
  const executor = { async beginTransaction() {}, async query(sql, values) { calls.push({ sql, values }); if (sql.includes("WHERE email = ? FOR UPDATE")) return [[{ ...row }]]; if (sql.startsWith("UPDATE platform_admins")) { row.password_hash = values[0]; return [{ affectedRows: 1 }]; } if (sql.includes("WHERE id = ?")) return [[{ ...row }]]; throw new Error("Unexpected query"); }, async commit() { committed = true; }, async rollback() { throw new Error("Unexpected rollback"); } };
  await resetPlatformAdminPassword({ email: row.email, password: "new-password", executor });
  assert.equal(committed, true);
  assert.notEqual(row.password_hash, oldHash);
  assert.equal(await bcrypt.compare("new-password", row.password_hash), true);
  assert.equal(calls[1].sql, "UPDATE platform_admins SET password_hash = ? WHERE id = ? AND email = ?");
  assert.deepEqual(calls[1].values.slice(1), [1, "revex@test.com"]);
});

test("all non-approved emails are rejected before database creation", async () => {
  let databaseCreated = false;
  await assert.rejects(run({ argv: ["--email", "admin@revexbooks.com", "--password-stdin"], input: input("safe-password\n"), createDatabase() { databaseCreated = true; } }), (error) => error.code === "EMAIL_NOT_APPROVED");
  assert.equal(databaseCreated, false);
});

test("plaintext password is accepted only from stdin and never logged", async () => {
  const plaintext = "private-password", messages = [];
  await run({ argv: ["--email", "revex@test.com", "--password-stdin"], input: input(`${plaintext}\n`), output: { log: (message) => messages.push(message) }, createDatabase: () => ({ end: async () => {} }), reset: async ({ email, password }) => { assert.equal(password, plaintext); return { id: 1, email }; } });
  assert.equal(messages.join("\n").includes(plaintext), false);
  await assert.rejects(run({ argv: ["--email", "revex@test.com", "--password=leaked"] }), (error) => error.code === "PASSWORD_ARGUMENT_FORBIDDEN");
});

test("empty and short stdin passwords are rejected before database use", async () => {
  await assert.rejects(run({ argv: ["--email", "revex@test.com", "--password-stdin"], input: input("short\n") }), (error) => error.code === "PASSWORD_TOO_SHORT");
  await assert.rejects(run({ argv: ["--email", "revex@test.com", "--password-stdin"], input: input("\n") }), (error) => error.code === "EMPTY_PASSWORD");
});
