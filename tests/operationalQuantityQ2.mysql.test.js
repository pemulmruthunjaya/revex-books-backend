"use strict";
// Authored, NOT executed. Wrapper owns creation/removal of a fresh isolated
// database and exact database-only user, including LOCK TABLES privilege.
const test = require("node:test"), assert = require("node:assert/strict");
const runner = require("../db/migrations/2026-10-12-operational-quantity-q2"), guard = require("./helpers/q2MysqlGuard");
const options = { confirmation: runner.CONFIRMATION, dedicatedConnection: true };
test("guarded Q2 real DDL, exact preservation, lock exclusion and interrupted resumption", { skip: process.env.Q2_MYSQL_PROOF !== "DISPOSABLE_LOOPBACK_ONLY" }, async t => {
  const config = guard.target(process.env), mysql = require("mysql2/promise");
  const cx = await mysql.createConnection(config); let other;
  try {
    const [[identity]] = await cx.query("SELECT VERSION() version,@@port port,DATABASE() db,CURRENT_USER() user"); guard.identity(identity, config);
    guard.grants((await cx.query("SHOW GRANTS"))[0], config);
    const [[empty]] = await cx.query("SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()"); assert.equal(Number(empty.n), 0);
    other = await mysql.createConnection(config);
    // Test-only observation at the driver boundary preserves the actual pinned
    // physical connection; forwarding query executors are intentionally banned.
    const observe = async (hook, work) => {
      const prototype = require("mysql2").Connection.prototype, original = prototype.query;
      prototype.query = function(sql, args, done) {
        if (this !== cx.connection) return original.call(this, sql, args, done);
        Promise.resolve().then(() => hook("before", sql)).then(() => {
          original.call(this, sql, args, (error, rows, fields) => {
            if (error) return done(error);
            Promise.resolve().then(() => hook("after", sql)).then(() => done(null, rows, fields), done);
          });
        }, done);
      };
      try { return await work(); } finally { prototype.query = original; }
    };
    await cx.query("CREATE TABLE products (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,stock INT NULL DEFAULT 0,note VARCHAR(30) NULL) ENGINE=InnoDB");
    await cx.query("CREATE TABLE bill_items (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,quantity INT NULL DEFAULT NULL,note VARCHAR(30) NULL) ENGINE=InnoDB");
    await cx.query("INSERT INTO products (stock,note) VALUES (NULL,'null'),(-2147483648,'minimum'),(2147483647,'maximum'),(0,'zero')");
    await cx.query("INSERT INTO bill_items (quantity,note) VALUES (NULL,'null'),(-1,'negative'),(2,'two')");
    await t.test("complete preflight rejects incompatible second table before first ALTER", async () => {
      await cx.query("ALTER TABLE bill_items MODIFY quantity DECIMAL(12,3) NULL DEFAULT NULL");
      await cx.query("INSERT INTO bill_items (quantity,note) VALUES (1.001,'bad precision')");
      let writes = 0;
      await observe((phase, sql) => { if (phase === "before" && /^ALTER/.test(sql)) writes++; }, async () => {
        await assert.rejects(runner.migrate(cx, options), { code: "Q2_SCHEMA_INCOMPATIBLE" });
      }); assert.equal(writes, 0);
      await cx.query("DELETE FROM bill_items WHERE note='bad precision'");
      await cx.query("ALTER TABLE bill_items MODIFY quantity INT NULL DEFAULT NULL");
    });
    const before = await runner.inspect(cx);
    await t.test("real first ALTER commits, interruption releases locks, explicit resume preserves exact values", async () => {
      let ddls = 0;
      await observe((phase, sql) => { if (phase === "before" && /^ALTER/.test(sql) && ddls++ === 1) throw Error("controlled interruption"); }, async () => {
        await assert.rejects(runner.migrate(cx, options), /controlled interruption/);
      });
      const partial = await runner.inspect(cx); assert.equal(partial.classification, "COMPATIBLE_PARTIAL"); assert.deepEqual(partial.snapshot, before.snapshot);
      const done = await runner.migrate(cx, options); assert.deepEqual(done.applied, ["bill_items.quantity"]); assert.deepEqual(done.snapshot, before.snapshot);
      assert.deepEqual((await runner.migrate(cx, options)).applied, []);
      const [warnings] = await cx.query("SHOW WARNINGS"); assert.deepEqual(warnings, []);
    });
    await t.test("fractional target values and NULL/defaults survive already-applied verification", async () => {
      await cx.query("INSERT INTO products (stock,note) VALUES (9999999999.99,'q2-max'),(-9999999999.99,'q2-min'),(1.23,'fraction')");
      const snapshot = (await runner.inspect(cx)).snapshot; assert.deepEqual((await runner.migrate(cx, options)).snapshot, snapshot);
      const [rows] = await cx.query("SELECT CAST(stock AS CHAR) value FROM products WHERE note='fraction'"); assert.equal(rows[0].value, "1.23");
    });
    await t.test("exclusive table locks survive real ALTER and reject concurrent writes without loss", async () => {
      // Restore only synthetic INT-representable fixture rows before this
      // separately defined fresh scenario. Never execute on customer data.
      await cx.query("DELETE FROM products WHERE note IN ('q2-max','q2-min','fraction')");
      await cx.query("ALTER TABLE products MODIFY stock INT NULL DEFAULT 0");
      await cx.query("ALTER TABLE bill_items MODIFY quantity INT NULL DEFAULT NULL");
      await other.query("SET SESSION lock_wait_timeout=1");
      const seen = []; const done = await observe(async (phase, sql) => {
        if (phase === "after" && /^ALTER/.test(sql)) {
          await assert.rejects(other.query("UPDATE products SET stock=123 WHERE id=4"), e => e.code === "ER_LOCK_WAIT_TIMEOUT");
          await assert.rejects(other.query("UPDATE bill_items SET quantity=123 WHERE id=3"), e => e.code === "ER_LOCK_WAIT_TIMEOUT");
          seen.push(sql);
        }
      }, () => runner.migrate(cx, options));
      assert.equal(seen.length, 2); assert.deepEqual(done.snapshot, before.snapshot);
      await other.query("UPDATE products SET note=note WHERE id=4"); // proves unlock
    });
    await t.test("actual unsigned BIGINT cursor crosses 2^53 and reconciles COUNT independently", async () => {
      await cx.query("ALTER TABLE products MODIFY id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT");
      for (let i = 0; i < 503; i++) await cx.query("INSERT INTO products (id,stock,note) VALUES (CAST(? AS DECIMAL(20,0)),1.23,'bigint')", [(9007199254740990n + BigInt(i)).toString()]);
      await cx.query("INSERT INTO products (id,stock,note) VALUES (18446744073709551614,1.23,'bigint-max')");
      const expected = (await cx.query("SELECT CAST(COUNT(*) AS CHAR) n FROM products"))[0][0].n;
      const result = await runner.migrate(cx, options); assert.equal(result.snapshot.products.count, expected);
      assert.deepEqual(result.applied, []);
    });
  } finally { if (other) await other.end(); await cx.end(); }
  // No database deletion, retry, external service or application DB pool.
});
