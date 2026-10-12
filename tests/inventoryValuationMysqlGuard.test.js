"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const guard = require("./helpers/inventoryValuationMysqlGuard");
const database = `iv_proof_${"a".repeat(32)}`;
const env = { IV_MYSQL_PROOF: "DISPOSABLE_LOOPBACK_ONLY", IV_MYSQL_PROOF_DATABASE: database, IV_MYSQL_PROOF_HOST: "127.0.0.1", IV_MYSQL_PROOF_PORT: "3407", IV_MYSQL_PROOF_USER: "iv_disposable", IV_MYSQL_PROOF_PASSWORD: "synthetic-test-only" };
const rejected = fn => assert.throws(fn, error => error.code === "IV_ISOLATION_MISMATCH" && error.message === "IV_ISOLATION_MISMATCH");

test("isolated guard distinguishes authorized loopback host port from exact server identity", () => {
  assert.deepEqual(guard.target(env, database), { host: "127.0.0.1", port: 3407, database, user: "iv_disposable", password: "synthetic-test-only", dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, multipleStatements: false });
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

test("preallocated name must match exactly and cannot escape the disposable namespace", () => {
  for (const name of [undefined, "railway", database + "?x=1", database + "#x", database + " ", `iv_proof_${"b".repeat(32)}`])
    rejected(() => guard.target({ ...env, IV_MYSQL_PROOF_DATABASE: name }, database));
  for (const name of ["railway", "iv_proof_abc", database + ";DROP DATABASE mysql", database.toUpperCase()])
    rejected(() => guard.target({ ...env, IV_MYSQL_PROOF_DATABASE: name }, name));
});

test("test child consumes the preallocated name and cannot create or delete databases", () => {
  const source = require("node:fs").readFileSync(require.resolve("./inventoryValuation.mysql.test.js"), "utf8");
  assert.doesNotMatch(source, /\b(?:CREATE|DROP)\s+DATABASE\b/i);
  assert.match(source, /const database = process\.env\.IV_MYSQL_PROOF_DATABASE/);
  assert.match(source, /assert\.equal\(identity\.db, database\)/);
  assert.match(source, /assert\.equal\(Number\(empty\.n\), 0/);
});

test("wrapper provisions only an exact escaped database scope and non-SUPER user", () => {
  const { provisionSql, PRIVILEGES } = require("./helpers/inventoryMysqlProofProvisioning");
  const user = `iv_test_${"b".repeat(16)}`, password = "c".repeat(64);
  for (const prefix of ["iv_proof_", "annual_gl_proof_", "annual_migration_proof_"]) {
    const db = prefix + "a".repeat(32), sql = provisionSql(db, user, password);
    assert.ok(sql.includes(`CREATE DATABASE \`${db}\``));
    assert.ok(sql.includes(`ON \`${db.replace(/_/g, "\\_")}\`.*`));
    assert.doesNotMatch(sql, /SUPER|GRANT OPTION|ALL PRIVILEGES|ON \*\.\*|DROP DATABASE/);
    assert.equal(PRIVILEGES.length, 10);
  }
  for (const db of ["railway", "mysql", database + "#x", database + "?x", database + ";", database.toUpperCase()])
    assert.throws(() => provisionSql(db, user, password), { message: "IV_ISOLATION_MISMATCH" });
  for (const name of ["root", "iv_test_'", "iv_test_abc"])
    assert.throws(() => provisionSql(database, name, password), { message: "IV_ISOLATION_MISMATCH" });
  assert.throws(() => provisionSql(database, user, "unsafe'"), { message: "IV_ISOLATION_MISMATCH" });
});
