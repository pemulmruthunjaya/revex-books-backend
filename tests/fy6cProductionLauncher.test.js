"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const launcherPath = path.resolve(__dirname, "../scripts/fy6c-legacy-vendor-repair-production-launcher.js");
const { launch } = require(launcherPath);
const commit = "0123456789abcdef0123456789abcdef01234567";
const env = {
  RAILWAY_PROJECT_ID: "ad98950f-48d4-4349-9aaf-026bd30a6d2a",
  RAILWAY_ENVIRONMENT_ID: "ff88ca7b-c8c3-43c7-8b67-4b3710ebc4c9",
  RAILWAY_SERVICE_ID: "37a33f8f-61e3-4560-a85d-564e4f358523",
  FY6_CANONICAL_DATABASE_SERVICE_ID: "29a5fb78-45a0-4781-a1d1-b2e3668efe85",
  DB_HOST: "mysql.railway.internal", DB_NAME: "railway", DB_PORT: "3306",
  FY6_PRODUCTION_EXECUTION_TOKEN: "secret", FY6_DEPLOYED_RUNTIME_COMMIT: commit,
};
const argv = ["--execute", "--identity-mode=production", "--expected-db=railway",
  "--production-execution-token=secret", "--expected-live-hostname=7102d71a58ff",
  "--expected-live-version=9.7.2", `--expected-runtime-commit=${commit}`];

test("launcher import performs no execution", () => {
  delete require.cache[launcherPath];
  const imported = require(launcherPath);
  assert.equal(typeof imported.launch, "function");
});
test("launcher invokes runner exactly once and closes its pool", async () => {
  let runs = 0, ends = 0, loads = 0;
  const pool = { end: async () => { ends++; } };
  const result = await launch({ argv, env, loadPool: () => { loads++; return pool; }, runner: async (input) => {
    runs++; assert.equal(input.db, pool); assert.equal(input.runtimeEnv, env); return { ok: true };
  }});
  assert.deepEqual(result, { ok: true });
  assert.equal(runs, 1); assert.equal(loads, 1); assert.equal(ends, 1);
});
test("launcher rejects local and duplicate contexts before loading the pool", async () => {
  for (const changed of [{ RAILWAY_PROJECT_ID: undefined }, { RAILWAY_PROJECT_ID: "duplicate" }, { RAILWAY_SERVICE_ID: "duplicate" }]) {
    let loads = 0, runs = 0;
    await assert.rejects(launch({ argv, env: { ...env, ...changed }, loadPool: () => { loads++; return {}; }, runner: async () => { runs++; } }), /PRODUCTION_/);
    assert.equal(loads, 0); assert.equal(runs, 0);
  }
});
test("launcher requires token, runtime commit, and database service identity", async () => {
  for (const key of ["FY6_PRODUCTION_EXECUTION_TOKEN", "FY6_DEPLOYED_RUNTIME_COMMIT", "FY6_CANONICAL_DATABASE_SERVICE_ID"]) {
    const bad = { ...env }; delete bad[key];
    await assert.rejects(launch({ argv, env: bad, loadPool: () => { throw Error("POOL_LOADED"); } }), /EXECUTION_AUTHORIZATION_FAILED|RUNTIME_COMMIT_REQUIRED|PRODUCTION_DB_SERVICE_ID_REQUIRED/);
  }
});
test("launcher preserves primary error when cleanup also fails and never retries", async () => {
  let runs = 0, ends = 0;
  const primary = Error("PRIMARY");
  await assert.rejects(launch({ argv, env, pool: { end: async () => { ends++; throw Error("CLEANUP"); } }, runner: async () => { runs++; throw primary; } }), (error) => {
    assert.equal(error, primary); assert.equal(error.cleanupError.message, "CLEANUP"); return true;
  });
  assert.equal(runs, 1); assert.equal(ends, 1);
});
test("launcher reports cleanup failure after successful runner", async () => {
  await assert.rejects(launch({ argv, env, pool: { end: async () => { throw Error("CLEANUP"); } }, runner: async () => ({ ok: true }) }), /CLEANUP/);
});
