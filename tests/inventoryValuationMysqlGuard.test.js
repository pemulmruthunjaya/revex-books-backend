"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const guard = require("./helpers/inventoryValuationMysqlGuard");
const database = `iv_proof_${"a".repeat(32)}`;
const env = { IV_MYSQL_PROOF: "DISPOSABLE_LOOPBACK_ONLY", IV_MYSQL_PROOF_HOST: "127.0.0.1", IV_MYSQL_PROOF_PORT: "3407", IV_MYSQL_PROOF_USER: "iv_disposable", IV_MYSQL_PROOF_PASSWORD: "synthetic-test-only" };
const rejected = fn => assert.throws(fn, error => error.code === "IV_ISOLATION_MISMATCH" && error.message === "IV_ISOLATION_MISMATCH");

test("isolated guard distinguishes authorized loopback host port from exact server identity", () => {
  assert.deepEqual(guard.target(env, database), { host: "127.0.0.1", port: 3407, user: "iv_disposable", password: "synthetic-test-only", dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, multipleStatements: false });
  guard.server({ port: 3306, version: "9.7.2" });
  guard.server({ port: "3306", version: "9.7.2" });
});
test("guard rejects nonloopback hosts, host port 3306, URLs, query strings and fragments", () => {
  for (const host of [undefined, "localhost", "0.0.0.0", "::1", "mysql.railway.internal", "production", "127.0.0.1?x=1", "127.0.0.1#x", "mysql://127.0.0.1:3407", "127.0.0.1 "])
    rejected(() => guard.target({ ...env, IV_MYSQL_PROOF_HOST: host }, database));
  for (const port of [undefined, 3407, "3306", "3307", "3407?x=1", "3407#x", "03407", "3407 "])
    rejected(() => guard.target({ ...env, IV_MYSQL_PROOF_PORT: port }, database));
});
test("guard rejects nonallowlisted databases and missing isolation credentials without exposing values", () => {
  for (const name of [undefined, "railway", "mysql", "production", "iv_proof_abc", database + "?x=1", database + "#x", database + ";DROP DATABASE mysql", database.toUpperCase()]) rejected(() => guard.target(env, name));
  for (const field of Object.keys(env)) rejected(() => guard.target({ ...env, [field]: undefined }, database));
  rejected(() => guard.target({ ...env, IV_MYSQL_PROOF_USER: "root" }, database));
});
test("guard rejects wrong internal port and any nonexact MySQL version", () => {
  for (const port of [3407, 3307, "3306?x=1", null]) rejected(() => guard.server({ port, version: "9.7.2" }));
  for (const version of ["9.7.1", "9.7.2-commercial", "9.7.20", "8.4.0", undefined]) rejected(() => guard.server({ port: 3306, version }));
  rejected(() => guard.server(null));
});
