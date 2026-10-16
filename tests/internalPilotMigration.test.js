const test = require("node:test"), assert = require("node:assert/strict");
const { Fixture, installPhysicalMock, identity } = require("./helpers/internalPilotFixture");
installPhysicalMock();
const runner = require("../db/migrations/2026-10-14-internal-pilot-provenance");
const contract = require("../services/internalPilotSchemaContract");
const readiness = require("../services/trialInvitationReadinessService");
const options = { confirmation: runner.CONFIRMATION, transactionOwnership: "EXCLUSIVE_IDLE_CONNECTION", identity };

test("frozen trigger uses only length-free binary CASTs and retains null-safe bytewise comparison", () => {
  const sql = contract.statements().join("\n");
  assert.doesNotMatch(sql, /\bBINARY\s+(?:OLD|NEW)\./i);
  assert.equal((sql.match(/CAST\((?:OLD|NEW)\.internal_reason AS BINARY\)/g) || []).length, 2);
  assert.ok(sql.includes("NOT (CAST(OLD.internal_reason AS BINARY) <=> CAST(NEW.internal_reason AS BINARY))"));
  // The exact SQL uses no character collation, trim, length cap or padding.
  // The guarded MySQL case additionally executes these semantics on the server.
  const equal = (a, b) => a === null || b === null ? a === b : Buffer.from(a, "utf8").equals(Buffer.from(b, "utf8"));
  for (const [a, b, expected] of [["Case", "case", false], ["x", "x ", false], ["é", "e\u0301", false], ["same", "same", true], [null, null, true], [null, "", false]]) assert.equal(equal(a, b), expected);
});

test("DDL warning stop captures numeric diagnostics immediately and never exposes warning payload", async () => {
  const cx = new Fixture();
  cx.warningRows = [{ Level: "Warning", Code: 1287, Message: "sensitive SQL credentials token" }, { Code: "secret-code", Message: "private" }];
  await assert.rejects(runner.migrate(cx, options), error => {
    assert.equal(error.code, "PILOT_MIGRATION_STOPPED_REQUIRES_INSPECTION");
    assert.equal(error.stage, "CREATE_TRIGGER_1"); assert.equal(error.mysqlCode, null); assert.deepEqual(error.warningCodes, [1287]);
    assert.doesNotMatch(JSON.stringify(error) + error.stack, /sensitive|credentials|token|secret-code|private|CREATE TRIGGER/);
    assert.equal(Object.hasOwn(error, "cause"), false); return true;
  });
  const ddl = cx.calls.findIndex(c => c.sql.startsWith("CREATE TRIGGER"));
  assert.equal(cx.calls[ddl + 1].sql, "SHOW WARNINGS LIMIT 32");
  assert.equal(cx.calls.filter(c => c.sql.startsWith("CREATE TRIGGER")).length, 1); assert.equal(cx.locked, false);
});

test("DDL errors preserve only numeric MySQL code and a fixed stage", async () => {
  for (const errno of [1142, "1142-secret", -1, 1e99]) {
    const cx = new Fixture(); cx.onQuery = sql => { if (sql.startsWith("ALTER TABLE")) throw Object.assign(Error("secret SQL payload"), { errno, sql: "private", code: "arbitrary-secret" }); };
    await assert.rejects(runner.migrate(cx, options), error => {
      assert.equal(error.stage, "ALTER_INVITATIONS"); assert.equal(error.mysqlCode, errno === 1142 ? 1142 : null);
      assert.doesNotMatch(JSON.stringify(error) + error.stack, /secret|payload|private/); return true;
    });
    assert.equal(cx.locked, false);
  }
});

test("required MySQL cases stop after failed prerequisite without independent cascade failures", () => {
  const { spawnSync } = require("node:child_process"), fs = require("node:fs");
  const helper = JSON.stringify(require.resolve("./helpers/requiredMysqlCase"));
  for (const failFirst of [true, false]) {
    const source = `const test=require('node:test');const {requiredCase}=require(${helper});test('parent',async t=>{if(!await requiredCase(t,'prerequisite',async()=>{if(${failFirst})throw Error('synthetic prerequisite failure')}))return;if(!await requiredCase(t,'dependent',async()=>{}))return;});`;
    const child = spawnSync(process.execPath, ["--test-reporter=tap", "-e", source], { encoding: "utf8", env: { ...process.env, NODE_TEST_CONTEXT: "" } });
    assert.equal(child.status, failFirst ? 1 : 0);
    assert.match(child.stdout, failFirst ? /# fail 2\b/ : /# fail 0\b/);
    if (failFirst) assert.doesNotMatch(child.stdout, /Subtest: dependent/);
    else assert.match(child.stdout, /Subtest: dependent/);
  }
  const suite = fs.readFileSync(require.resolve("./internalPilot.mysql.test"), "utf8");
  assert.equal((suite.match(/if \(!await requiredCase\(t,/g) || []).length, 5);
  assert.equal((suite.match(/\}\)\) return;/g) || []).length, 5);
  assert.doesNotMatch(suite, /await t\.test\(/);
});
test("frozen migration applies once, preserves rows and resumes every trigger checkpoint", async () => {
  for (let step = 0; step <= 4; step++) {
    const cx = new Fixture(); if (step) { cx.applied = true; cx.triggerNames = contract.statements().slice(1, step).map(s => /^CREATE TRIGGER (\w+)/.exec(s)[1]); }
    const before = await runner.inspect(cx), result = await runner.migrate(cx, options);
    assert.deepEqual(result.snapshot, before.snapshot); assert.equal(result.after, "ALREADY_APPLIED"); assert.equal(cx.locked, false);
    cx.calls = []; const second = await runner.migrate(cx, options); assert.equal(second.before, "ALREADY_APPLIED");
    assert.equal(cx.calls.some(c => /^(ALTER|CREATE)/.test(c.sql)), false);
    await readiness.assertTrialInvitationReadiness({ executor: cx, schemaOnly: true, requireInternal: true });
  }
});
test("migration incompatible type/default/nullability/dependency and fake executors fail before lock/DDL", async () => {
  for (const [field, value] of [["COLUMN_TYPE", "datetime"], ["COLUMN_DEFAULT", "current_timestamp(6)"], ["IS_NULLABLE", "YES"], ["EXTRA", "on update current_timestamp(6)"]]) {
    const cx = new Fixture(); cx.mutateColumns = rows => { rows.find(r => r.TABLE_NAME === "trial_invitations" && r.COLUMN_NAME === "last_sent_at")[field] = value; };
    await assert.rejects(runner.migrate(cx, options)); assert.equal(cx.calls.some(c => /^(LOCK|ALTER|CREATE)/.test(c.sql)), false);
  }
  await assert.rejects(runner.migrate({ query() { throw Error("no call"); } }, options), { code: "PILOT_PINNED_CONNECTION_REQUIRED" });
  const cx = new Fixture(); await assert.rejects(runner.migrate(cx, { ...options, identity: { ...identity, hostname: "wrong" } }), { code: "PILOT_IDENTITY_MISMATCH" });
});
test("failure after ALTER stops without retry; separately invoked compatible partial resumes", async () => {
  const cx = new Fixture(); cx.onQuery = sql => { if (sql.startsWith("CREATE TRIGGER")) throw Error("injected"); };
  await assert.rejects(runner.migrate(cx, options), { code: "PILOT_MIGRATION_STOPPED_REQUIRES_INSPECTION" }); assert.equal(cx.applied, true); assert.equal(cx.locked, false);
  assert.equal(cx.calls.filter(c => c.sql.startsWith("CREATE TRIGGER")).length, 1);
  cx.onQuery = null; assert.equal((await runner.migrate(cx, options)).before, "COMPATIBLE_PARTIAL");
});
test("value loss, independent count mismatch and unlock uncertainty fail closed", async () => {
  const changed = new Fixture(); changed.onQuery = (sql, args, cx) => { if (sql.startsWith("ALTER")) cx.data[0].value = "corrupted"; };
  await assert.rejects(runner.migrate(changed, options), { code: "PILOT_MIGRATION_STOPPED_REQUIRES_INSPECTION" }); assert.equal(changed.triggerNames.length, 0);
  const count = new Fixture(); count.countOverride = "3"; await assert.rejects(runner.migrate(count, options), { code: "PILOT_MIGRATION_COUNT_MISMATCH" });
  const unlock = new Fixture(); unlock.onQuery = sql => { if (sql === "UNLOCK TABLES") throw Error("uncertain"); };
  await assert.rejects(runner.migrate(unlock, options), { code: "PILOT_CLEANUP_FAILED" }); assert.equal(unlock.destroyed, true);
});
test("BIGINT cursor pagination crosses 500-row pages without precision loss", async () => {
  const cx = new Fixture(); cx.data = Array.from({ length: 1001 }, (_, i) => ({ id: (9007199254740993n + BigInt(i)).toString(), value: "exact" }));
  assert.equal((await runner.migrate(cx, options)).snapshot.count, "1001");
});
test("strict provenance CHECK recognizes MySQL grouping but not different boolean semantics", () => {
  const clause = contract.checkClause(); assert.equal(contract.expression(clause), contract.expression(clause.replace(/'PUBLIC_TRIAL_REQUEST'/g, "_ascii'PUBLIC_TRIAL_REQUEST'").replace(/'INTERNAL_PILOT'/g, "_ascii'INTERNAL_PILOT'")));
  assert.notEqual(contract.expression(clause), contract.expression(clause.replace("AND trial_request_id", "OR trial_request_id")));
  assert.throws(() => contract.expression(clause.replace("'INTERNAL_PILOT'", "_latin1'INTERNAL_PILOT'")));
});
test("new readiness rejects incomplete triggers; old public schema remains supported", async () => {
  const cx = new Fixture(); await readiness.assertTrialInvitationReadiness({ executor: cx, schemaOnly: true });
  await assert.rejects(readiness.assertTrialInvitationReadiness({ executor: cx, schemaOnly: true, requireInternal: true }));
  cx.applied = true; await assert.rejects(readiness.assertTrialInvitationReadiness({ executor: cx, schemaOnly: true }));
});
test("physical socket switching and uncertain locks destroy or clean up the original session", async () => {
  for (const mode of ["switch-before", "switch-ddl", "lock"]) {
    const cx = new Fixture(), original = cx.connection;
    cx.onQuery = (sql, args, fixture) => {
      if ((mode === "switch-before" && sql.includes("information_schema.COLUMNS")) || (mode === "switch-ddl" && sql.startsWith("ALTER"))) fixture.connection = new Fixture().connection;
      if (mode === "lock" && sql.startsWith("LOCK TABLES")) { fixture.locked = true; throw Error("lost lock response"); }
    };
    await assert.rejects(runner.migrate(cx, options));
    if (mode === "switch-before") assert.equal(cx.calls.some(c => c.sql.startsWith("LOCK TABLES")), false);
    else if (mode === "switch-ddl") assert.equal(original.stream.destroyed, true);
    else assert.equal(cx.locked, false);
  }
});
test("cross-schema FKs and every disabled CHECK reject migration before lock or DDL", async () => {
  const { FOREIGN_KEY_CONTRACT, CHECK_CONTRACT } = readiness;
  for (const [, name] of FOREIGN_KEY_CONTRACT) {
    const cx = new Fixture(); cx.mutateFK = rows => { rows.find(r => r.CONSTRAINT_NAME === name).REFERENCED_TABLE_SCHEMA = "other"; };
    await assert.rejects(runner.migrate(cx, options), { code: "TR1B_SCHEMA_NOT_READY" });
    assert.equal(cx.calls.some(c => /^(LOCK|ALTER|CREATE|INSERT|UPDATE|DELETE)/.test(c.sql)), false);
  }
  for (const name of [...Object.keys(CHECK_CONTRACT), "chk_trial_invitation_provenance"]) {
    const cx = new Fixture(); cx.ready(); cx.mutateChecks = rows => { rows.find(r => r.CONSTRAINT_NAME === name).ENFORCED = "NO"; };
    await assert.rejects(runner.migrate(cx, options), { code: "TR1B_SCHEMA_NOT_READY" });
    assert.equal(cx.calls.some(c => /^(LOCK|ALTER|CREATE|INSERT|UPDATE|DELETE)/.test(c.sql)), false);
  }
});
