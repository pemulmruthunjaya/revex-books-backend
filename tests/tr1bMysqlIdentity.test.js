const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { assertSafeTr1bMysqlTarget } = require("./helpers/tr1bMysqlTestGuard");

// Evaluate only the pure assertion from the live harness; never import its
// database setup, services or test hooks in this non-database regression suite.
const source = fs.readFileSync(path.join(__dirname, "tr1bConcurrency.mysql.test.js"), "utf8");
const declaration = source.match(/function assertTr1bMysqlServerIdentity\([^]*?\n\}/);
assert.ok(declaration, "Server identity assertion must exist in the live harness");
const check = vm.runInNewContext(`(${declaration[0]})`, { assert, Number });
const url = "mysql://synthetic:synthetic@127.0.0.1:3407/revex_tr1b_test_20261001";
const target = assertSafeTr1bMysqlTarget(url);
const identity = { name: target.database, version: "9.4.0", port: 3306 };
const environment = { TR1B_TEST_EXPECTED_MYSQL_VERSION: "9.4.0", TR1B_TEST_EXPECTED_INTERNAL_PORT: "3306" };

test("published host port 3407 and internal MySQL port 3306 are compatible", () => {
  check(identity, target, environment);
  check(identity, target, { TR1B_TEST_EXPECTED_MYSQL_VERSION: "9.4.0" });
  assert.match(source, /SELECT DATABASE\(\) name,VERSION\(\) version,@@port port/);
  assert.match(source, /assertTr1bMysqlServerIdentity\(identity, target, process\.env\)/);
  assert.doesNotMatch(source, /assert\.equal\(Number\(identity\.port\), target\.port\)/);
});

test("client guard still rejects host port 3306 and unsafe endpoints", () => {
  for (const unsafe of [url.replace(":3407", ":3306"), url.replace("127.0.0.1", "example.test"), url.replace("127.0.0.1", "production.railway.internal"), url.replace("revex_tr1b_test_20261001", "production"), `${url}?redirect=x`, `${url}#fragment`, url.replace(":3407", "")]) {
    assert.throws(() => assertSafeTr1bMysqlTarget(unsafe));
  }
});

test("server database and exact version must match expectations", () => {
  assert.throws(() => check({ ...identity, name: "revex_tr1b_test_other" }, target, environment));
  assert.throws(() => check({ ...identity, version: "9.4.1" }, target, environment));
  for (const version of [undefined, "9.4", "9.4.0-commercial", "9.4.0\n", "09.4.0"]) {
    assert.throws(() => check(identity, target, { ...environment, TR1B_TEST_EXPECTED_MYSQL_VERSION: version }));
  }
});

test("internal-port expectations cannot redirect or relax client transport", () => {
  const before = { ...target };
  assert.throws(() => check(identity, target, { ...environment, TR1B_TEST_EXPECTED_INTERNAL_PORT: "3407" }));
  check({ ...identity, port: 3408 }, target, { ...environment, TR1B_TEST_EXPECTED_INTERNAL_PORT: "3408" });
  assert.deepEqual(target, before);
  assert.equal(target.host, "127.0.0.1"); assert.equal(target.port, 3407);
  assert.match(source, /mysql\.createPool\(\{ \.\.\.target, user:/);
  for (const port of [0, 65536, 3.5, "invalid"]) assert.throws(() => check({ ...identity, port }, target, environment));
});
