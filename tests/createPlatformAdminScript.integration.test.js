const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const mysql = require("mysql2/promise");
const { createPlatformAdmin } = require("../services/platformAdminService");
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
const createAdmin = (input) => createPlatformAdmin(input, { executor: pool });
const args = ["--name", "Windows Bootstrap Admin", "--email", "windows.bootstrap@revex.test"];

const runTest = async () => {
  const logs = [];
  await run({ argv: args, passwordPrompt: async () => "Windows-safe-password", createAdmin, output: { log: (message) => logs.push(message) } });
  const [[stored]] = await pool.query("SELECT id, email, password_hash FROM platform_admins WHERE email=?", ["windows.bootstrap@revex.test"]);
  assert(stored);
  assert.notEqual(stored.password_hash, "Windows-safe-password");
  assert.equal(await bcrypt.compare("Windows-safe-password", stored.password_hash), true);
  assert.doesNotMatch(logs.join(" "), /Windows-safe-password/);

  await assert.rejects(
    run({ argv: args, passwordPrompt: async () => "Windows-safe-password", createAdmin, output: { log() {} } }),
    (error) => error.code === "PLATFORM_ADMIN_EXISTS"
  );
  await assert.rejects(
    run({ argv: ["--name", "Short", "--email", "short@revex.test"], passwordPrompt: async () => "short", createAdmin, output: { log() {} } }),
    (error) => error.code === "PASSWORD_TOO_SHORT"
  );
  await assert.rejects(
    run({ argv: ["--name", "Cancel", "--email", "cancel@revex.test"], passwordPrompt: async () => { throw new BootstrapPromptError("PROMPT_CANCELLED", "cancelled"); }, createAdmin, output: { log() {} } }),
    (error) => error.code === "PROMPT_CANCELLED"
  );
  const [[notCreated]] = await pool.query("SELECT COUNT(*) count FROM platform_admins WHERE email IN ('short@revex.test','cancel@revex.test')");
  assert.equal(Number(notCreated.count), 0);
  console.log("Platform admin bootstrap real-MySQL integration: 7 checks passed");
};

runTest()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(async () => { await pool.end(); });
