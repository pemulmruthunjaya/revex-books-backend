const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const mysql = require("mysql2/promise");
const { Readable } = require("node:stream");
const { BootstrapPromptError, run } = require("../scripts/createPlatformAdmin");

const database = "revex_platform_bootstrap_integration_20260821";
if (process.env.REVEX_INTEGRATION_DB_HOST !== "127.0.0.1" || process.env.REVEX_INTEGRATION_DB_NAME !== database) {
  throw new Error("Bootstrap integration test requires the named disposable local database");
}
const pool = mysql.createPool({
  host: "127.0.0.1",
  port: Number(process.env.REVEX_INTEGRATION_DB_PORT || 3306),
  user: process.env.REVEX_INTEGRATION_DB_USER,
  password: process.env.REVEX_INTEGRATION_DB_PASSWORD,
  database,
  timezone: "Z",
});
const args = ["--name", "Windows Bootstrap Admin", "--email", "windows.bootstrap@revex.test", "--password-stdin"];
const bootstrapEnvironment = {
  REVEX_BOOTSTRAP_DB_HOST: "127.0.0.1",
  REVEX_BOOTSTRAP_DB_PORT: String(process.env.REVEX_INTEGRATION_DB_PORT || 3306),
  REVEX_BOOTSTRAP_DB_USER: process.env.REVEX_INTEGRATION_DB_USER,
  REVEX_BOOTSTRAP_DB_PASSWORD: process.env.REVEX_INTEGRATION_DB_PASSWORD,
  REVEX_BOOTSTRAP_DB_NAME: database,
};
const passwordInput = (value) => {
  const input = Readable.from([value]);
  input.isTTY = false;
  return input;
};

const runTest = async () => {
  const logs = [];
  await run({ argv: args, input: passwordInput("Windows-safe-password\r\n"), environment: bootstrapEnvironment, output: { log: (message) => logs.push(message) } });
  const [[stored]] = await pool.query("SELECT id, email, password_hash FROM platform_admins WHERE email=?", ["windows.bootstrap@revex.test"]);
  assert(stored);
  assert.notEqual(stored.password_hash, "Windows-safe-password");
  assert.equal(await bcrypt.compare("Windows-safe-password", stored.password_hash), true);
  assert.doesNotMatch(logs.join(" "), /Windows-safe-password/);

  await assert.rejects(
    run({ argv: args, input: passwordInput("Windows-safe-password\n"), environment: bootstrapEnvironment, output: { log() {} } }),
    (error) => error.code === "PLATFORM_ADMIN_EXISTS"
  );
  await assert.rejects(
    run({ argv: ["--name", "Short", "--email", "short@revex.test", "--password-stdin"], input: passwordInput("short\n"), environment: bootstrapEnvironment, output: { log() {} } }),
    (error) => error.code === "PASSWORD_TOO_SHORT"
  );
  await assert.rejects(
    run({ argv: ["--name", "Cancel", "--email", "cancel@revex.test"], passwordPrompt: async () => { throw new BootstrapPromptError("PROMPT_CANCELLED", "cancelled"); }, environment: bootstrapEnvironment, output: { log() {} } }),
    (error) => error.code === "PROMPT_CANCELLED"
  );
  await assert.rejects(
    run({ argv: ["--name", "Empty", "--email", "empty@revex.test", "--password-stdin"], input: passwordInput("\n"), environment: bootstrapEnvironment, output: { log() {} } }),
    (error) => error.code === "EMPTY_PASSWORD"
  );
  const [[notCreated]] = await pool.query("SELECT COUNT(*) count FROM platform_admins WHERE email IN ('short@revex.test','cancel@revex.test','empty@revex.test')");
  assert.equal(Number(notCreated.count), 0);
  console.log("Platform admin bootstrap real-MySQL integration: 8 checks passed");
};

runTest()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await pool.end(); });
