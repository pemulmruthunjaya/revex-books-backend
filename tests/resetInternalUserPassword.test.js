const assert = require("node:assert/strict");
const { PassThrough } = require("node:stream");
const test = require("node:test");
const bcrypt = require("bcryptjs");
const { resetPassword, run } = require("../scripts/resetInternalUserPassword");

const passwordInput = (value) => {
  const input = new PassThrough();
  input.isTTY = false;
  input.end(value);
  return input;
};

test("approved reset changes only the password and verifies the new hash", async () => {
  const originalHash = await bcrypt.hash("old-password", 10);
  const row = { id: 14, email: "qa.owner@revexbooks.com", name: "Admin", role: "owner", access_role: "sales", company_id: 5, organization_id: null, password: originalHash };
  const calls = [];
  let committed = false;
  const connection = {
    async beginTransaction() {},
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.startsWith("SELECT id") && sql.includes("email = ?")) return [[{ ...row }]];
      if (sql.startsWith("UPDATE users")) { row.password = values[0]; return [{ affectedRows: 1 }]; }
      if (sql.startsWith("SELECT id") && sql.includes("id = ?")) return [[{ ...row }]];
      throw new Error("Unexpected query");
    },
    async commit() { committed = true; },
    async rollback() { throw new Error("Unexpected rollback"); },
  };
  await resetPassword({ email: row.email, password: "new-password", executor: connection });
  assert.equal(committed, true);
  assert.notEqual(row.password, originalHash);
  assert.equal(await bcrypt.compare("new-password", row.password), true);
  assert.match(calls[1].sql, /^UPDATE users SET password = \? WHERE id = \? AND email = \?$/);
  assert.deepEqual(calls[1].values.slice(1), [14, row.email]);
});

test("unauthorized email is rejected before database creation", async () => {
  let databaseCreated = false;
  await assert.rejects(run({
    argv: ["--email", "dev.owner@revexbooks.com", "--password-stdin"],
    input: passwordInput("secret-password\n"),
    createDatabase() { databaseCreated = true; },
  }), (error) => error.code === "EMAIL_NOT_APPROVED");
  assert.equal(databaseCreated, false);
});

test("stdin plaintext is never written to output", async () => {
  const plaintext = "private-password";
  const messages = [];
  await run({
    argv: ["--email", "demo.staff@revexbooks.com", "--password-stdin"],
    input: passwordInput(`${plaintext}\n`),
    output: { log: (message) => messages.push(message), error: (message) => messages.push(message) },
    createDatabase: () => ({ end: async () => {} }),
    reset: async ({ email, password }) => {
      assert.equal(password, plaintext);
      return { id: 11, email };
    },
  });
  assert.equal(messages.join("\n").includes(plaintext), false);
});

test("short passwords and password command-line arguments are rejected", async () => {
  await assert.rejects(run({ argv: ["--email", "qa.owner@revexbooks.com", "--password-stdin"], input: passwordInput("short\n") }), (error) => error.code === "PASSWORD_TOO_SHORT");
  await assert.rejects(run({ argv: ["--email", "qa.owner@revexbooks.com", "--password=leaked"] }), (error) => error.code === "PASSWORD_ARGUMENT_FORBIDDEN");
});
