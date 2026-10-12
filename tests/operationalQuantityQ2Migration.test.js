"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { Q2Fixture, runner, FakeCore } = require("./helpers/q2MigrationFixture");
const options = { confirmation: runner.CONFIRMATION, dedicatedConnection: true };

test("Q2 signed fixed-point boundaries, NULL and exact trailing zeros; no coercion or rounding", () => {
  for (const [input, expected] of [[null, null], ["0", "0"], ["-0.00", "0"], ["1", "100"], ["1.2", "120"], ["1.20", "120"], ["1.23", "123"], ["1.230000", "123"], ["-2147483648", "-214748364800"], ["9999999999.99", "999999999999"], ["-9999999999.99", "-999999999999"]]) assert.equal(runner.exactQ2(input), expected);
  for (const input of ["1.234", "1.000001", "1e2", "+1", "01", " 1", "", "NaN", 1, undefined, "1."]) assert.throws(() => runner.exactQ2(input), { code: "Q2_VALUE_NOT_EXACT" });
  for (const input of ["10000000000", "-10000000000.00"]) assert.throws(() => runner.exactQ2(input), { code: "Q2_VALUE_OUT_OF_RANGE" });
});
test("Q2 pinned immutable SQL contains exactly two owned ALTERs; explicit dedicated connection required", async () => {
  assert.equal(runner.statements().length, 2);
  const cx = new Q2Fixture(); await assert.rejects(runner.migrate(cx), { code: "Q2_EXPLICIT_DEDICATED_CONNECTION_REQUIRED" }); assert.equal(cx.calls.length, 0);
  for (const status of [0, 1, 3, undefined]) { const c = new Q2Fixture(); c.serverStatus = status; await assert.rejects(runner.migrate(c, options), { code: "Q2_DEDICATED_IDLE_CONNECTION_REQUIRED" }); assert.equal(c.ddl.length, 0); }
});
test("Q2 runner import is inert and a changed frozen SQL hash fails before any query", async () => {
  const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
  const filename = require.resolve("../db/migrations/2026-10-12-operational-quantity-q2");
  const source = fs.readFileSync(filename, "utf8"), module = { exports: {} }; let reads = 0;
  vm.runInNewContext(source, { module, __dirname: path.dirname(filename), require(name) {
    assert.ok(["node:fs", "node:path", "node:crypto"].includes(name));
    return name === "node:fs" ? { readFileSync() { reads++; return "ALTER TABLE unrelated ADD value INT;"; } } : require(name);
  } });
  assert.equal(reads, 0); const cx = new Q2Fixture();
  await assert.rejects(module.exports.migrate(cx, options), e => e.code === "Q2_MIGRATION_HASH_MISMATCH"); assert.equal(cx.calls.length, 0);
});
test("Q2 fresh, already-applied and both compatible partial permutations preserve all row fingerprints", async () => {
  for (const applied of [[], [0], [1], [0, 1]]) {
    const cx = new Q2Fixture(); for (const i of applied) { cx.types[i] = "decimal(12,2)"; if (!i) cx.defaults[i] = "0.00"; }
    const before = await runner.inspect(cx); const result = await runner.migrate(cx, options);
    assert.equal(result.applied.length, 2 - applied.length); assert.deepEqual(result.snapshot, before.snapshot);
    assert.equal(result.after, "ALREADY_APPLIED"); assert.equal(cx.locked, false);
    const n = cx.ddl.length; assert.deepEqual((await runner.migrate(cx, options)).applied, []); assert.equal(cx.ddl.length, n);
  }
});
test("Q2 every incompatible definition/dependency rejects before ANY DDL on either table", async () => {
  for (const mutate of [c => c.types[1] = "double", c => c.types[1] = "decimal(12,3)", c => c.types[0] = "int unsigned", c => c.defaults[0] = "1", c => c.defaults[1] = "0", c => c.engine = "MyISAM",
    c => c.editColumns = rows => rows[1].IS_NULLABLE = "NO", c => c.editColumns = rows => rows[1].EXTRA = "INVISIBLE", c => c.editColumns = rows => rows[1].COLUMN_COMMENT = "unreviewed",
    c => c.editColumns = rows => rows[2].GENERATION_EXPRESSION = "stock+1",
    c => c.extraIndexes.push({ INDEX_NAME: "idx_qty", COLUMN_NAME: "quantity" }),
    c => c.extraFks.push({ TABLE_NAME: "dependent", COLUMN_NAME: "x", REFERENCED_TABLE_NAME: "products", REFERENCED_COLUMN_NAME: "stock" }),
    c => c.extraChecks.push({ CHECK_CLAUSE: "stock>=0" })]) {
    const cx = new Q2Fixture(); mutate(cx); await assert.rejects(runner.migrate(cx, options), e => /^Q2_/.test(e.code)); assert.equal(cx.ddl.length, 0); assert.equal(cx.calls.some(s => s.startsWith("LOCK TABLES")), false);
  }
});
test("Q2 precision/range failure, including the second table, precedes all writes", async () => {
  for (const value of ["1.001", "10000000000.00", "-10000000000"]) { const cx = new Q2Fixture(); cx.data[1][0].value = value; await assert.rejects(runner.migrate(cx, options), e => /^Q2_VALUE_/.test(e.code)); assert.equal(cx.ddl.length, 0); }
});
test("Q2 rechecks under locks and stops on schema/value races before ALTER", async () => {
  for (const mutate of [c => c.types[1] = "float", c => c.data[1][0].value = "1.001"]) { const cx = new Q2Fixture(); cx.onLock = mutate; await assert.rejects(runner.migrate(cx, options)); assert.equal(cx.ddl.length, 0); assert.equal(cx.locked, false); }
});
test("Q2 interrupted DDL is not retried or reversed; separate partial resumption is exact", async () => {
  const cx = new Q2Fixture(); cx.failAt = 1;
  await assert.rejects(runner.migrate(cx, options), /synthetic interruption/); assert.equal(cx.ddl.length, 1); assert.equal(cx.locked, false);
  assert.equal((await runner.inspect(cx)).classification, "COMPATIBLE_PARTIAL"); cx.failAt = undefined;
  assert.deepEqual((await runner.migrate(cx, options)).applied, ["bill_items.quantity"]); assert.equal(cx.ddl.length, 2);
});
test("Q2 postflight detects unrelated data, counts, schema drift and DDL warnings", async () => {
  for (const mutate of [c => c.data[0][0].note = "changed", c => c.data[1].push({ id: "9", value: "1", note: "extra" }), c => c.triggers.push({ ACTION_STATEMENT: "changed" })]) {
    const cx = new Q2Fixture(); cx.onDdl = state => { mutate(state); state.onDdl = undefined; }; await assert.rejects(runner.migrate(cx, options), { code: "Q2_POSTFLIGHT_MISMATCH" }); assert.equal(cx.locked, false);
  }
  const cx = new Q2Fixture(); cx.warnings = 1; await assert.rejects(runner.migrate(cx, options), { code: "Q2_DDL_WARNING" }); assert.equal(cx.ddl.length, 1); assert.equal(cx.locked, false);
});
test("Q2 snapshots paginate deterministically without JS-number quantity conversion", async () => {
  const cx = new Q2Fixture(); cx.data[0] = Array.from({ length: 1001 }, (_, i) => ({ id: String(i + 1), value: "9999999999.99", note: "synthetic" }));
  const result = await runner.migrate(cx, options); assert.equal(result.snapshot.products.count, "1001");
});
test("Q2 equivalent old INT display width is accepted without broad schema normalization", async () => {
  const cx = new Q2Fixture(); cx.types = ["int(11)", "int(11)"];
  assert.equal((await runner.migrate(cx, options)).applied.length, 2);
});
test("Q2 BIGINT pages above 2^53, signed/unsigned limits and independent counts are exact", async () => {
  const cx = new Q2Fixture();
  cx.data[0] = ["-9223372036854775808", ...Array.from({ length: 1002 }, (_, i) => (9007199254740493n + BigInt(i)).toString()), "9223372036854775807", "18446744073709551615"].map(id => ({ id, value: "1.23", note: "boundary" }));
  const result = await runner.migrate(cx, options); assert.equal(result.snapshot.products.count, "1005");
  assert.ok(cx.calls.some(s => s.includes("id > CAST(? AS DECIMAL(20,0))")));
  for (const count of ["0", "4", "9007199254740993"]) {
    const bad = new Q2Fixture(); bad.countOverride = count;
    await assert.rejects(runner.migrate(bad, options), { code: "Q2_ROW_COUNT_MISMATCH" }); assert.equal(bad.ddl.length, 0); assert.equal(bad.locked, false);
  }
});
test("Q2 physical guard rejects pools and forwarding/switching executors before queries or locks", async () => {
  for (const cx of [{ query() { throw Error("must not call pool"); }, getConnection() {} }, { connection: {}, query() { throw Error("must not call wrapper"); } }])
    await assert.rejects(runner.migrate(cx, options), { code: "Q2_PINNED_CONNECTION_REQUIRED" });
  const cx = new Q2Fixture(); cx.query = async () => { throw Error("forwarder must not run"); };
  await assert.rejects(runner.migrate(cx, options), { code: "Q2_PINNED_CONNECTION_REQUIRED" }); assert.equal(cx.calls.length, 0);
});
test("Q2 detects session identity and physical connection switching before any lock/write", async () => {
  for (const mutate of [c => c.serverId = "8", c => c.connection = new FakeCore(c), c => c.connection.stream = {}]) {
    const cx = new Q2Fixture(); cx.onQuery = (sql, c) => { if (sql.includes("information_schema.TABLES")) { mutate(c); c.onQuery = undefined; } };
    await assert.rejects(runner.migrate(cx, options), { code: "Q2_CONNECTION_CHANGED" }); assert.equal(cx.ddl.length, 0); assert.equal(cx.calls.some(s => s.startsWith("LOCK TABLES")), false);
  }
});
test("Q2 cleanup remains on original physical socket after switching, failed unlock or uncertain lock", async () => {
  for (const mode of ["switch", "unlock", "uncertain-lock"]) {
    const cx = new Q2Fixture(), original = cx.connection;
    cx.onQuery = (sql, c) => {
      if (mode === "switch" && sql.startsWith("ALTER")) c.connection = new FakeCore(c);
      if (mode === "unlock" && sql === "UNLOCK TABLES") throw Error("synthetic unlock failure");
      if (mode === "uncertain-lock" && sql.startsWith("LOCK TABLES")) { c.locked = true; throw Error("synthetic lost response"); }
    };
    await assert.rejects(runner.migrate(cx, options)); assert.equal(cx.locked, false);
    if (mode !== "uncertain-lock") { assert.equal(original.stream.destroyed, true); assert.equal(cx.destroyed, true); }
    else assert.ok(cx.calls.includes("UNLOCK TABLES"));
  }
});
