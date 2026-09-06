const assert = require("node:assert/strict");
const test = require("node:test");
const { validateTestTarget } = require("./helpers/mysqlTestHarness");

test("MySQL harness accepts only explicit local prefixed targets", () => {
  assert.deepEqual(validateTestTarget({ host: "127.0.0.1", database: "revex_fy_test_ok" }), { host: "127.0.0.1", database: "revex_fy_test_ok" });
  assert.throws(() => validateTestTarget({ host: "127.0.0.1", database: "railway" }), /must start/);
  assert.throws(() => validateTestTarget({ host: "127.0.0.1", database: "billing" }), /must start/);
  assert.throws(() => validateTestTarget({ host: "shinkansen.proxy.rlwy.net", database: "revex_fy_test_bad" }), /must be local/);
  assert.throws(() => validateTestTarget({}), /required/);
});
