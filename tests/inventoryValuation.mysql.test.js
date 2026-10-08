"use strict";

// AUTHORING ONLY until separately authorized. No connection or DDL occurs on
// import, or without both explicit guards. Never use the application's DB pool.
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const identityGuard = require("./helpers/inventoryValuationMysqlGuard");
const enabled = process.env.IV_MYSQL_PROOF === "DISPOSABLE_LOOPBACK_ONLY";

test("isolated inventory valuation migration, concurrency, rollback and replay proof", { skip: !enabled }, async t => {
  const database = `iv_proof_${randomUUID().replace(/-/g, "")}`;
  const config = identityGuard.target(process.env, database);
  const mysql = require("mysql2/promise");
  const admin = await mysql.createConnection(config);
  assert.match(database, /^iv_proof_[a-f0-9]{32}$/);
  let pool, created = false;
  const migration = require("../db/migrations/2026-10-05-immutable-inventory-valuation");
  const v = require("../services/inventoryValuationService");
  const schema = require("../services/inventoryValuationSchema");
  const m = require("../services/inventoryValuationMath");
  const { evidence } = require("./helpers/inventoryValuationFixture");
  const x = { company_id: "1", product_id: "1", actor_id: "1" };
  try {
    const [[identity]] = await admin.query("SELECT @@port port,VERSION() version");
    identityGuard.server(identity);
    await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`); created = true;
    pool = mysql.createPool({ ...config, database, connectionLimit: 6 });
    await pool.query("CREATE TABLE companies (id BIGINT UNSIGNED PRIMARY KEY) ENGINE=InnoDB");
    await pool.query("CREATE TABLE products (id BIGINT UNSIGNED PRIMARY KEY,company_id BIGINT UNSIGNED NOT NULL,stock DECIMAL(10,2) NOT NULL DEFAULT 0,opening_stock DECIMAL(10,2) NOT NULL DEFAULT 0) ENGINE=InnoDB");
    await pool.query("CREATE TABLE users (id BIGINT UNSIGNED PRIMARY KEY,company_id BIGINT UNSIGNED NOT NULL,role VARCHAR(30) NOT NULL,is_active INT NOT NULL) ENGINE=InnoDB");
    await pool.query("CREATE TABLE financial_years (id BIGINT UNSIGNED PRIMARY KEY,company_id BIGINT UNSIGNED NOT NULL,start_date DATE,end_date DATE,status VARCHAR(30)) ENGINE=InnoDB");
    await pool.query("CREATE TABLE bills (id BIGINT UNSIGNED PRIMARY KEY,company_id BIGINT UNSIGNED NOT NULL) ENGINE=InnoDB");
    await pool.query("CREATE TABLE bill_items (id BIGINT UNSIGNED PRIMARY KEY,bill_id BIGINT UNSIGNED,product_id BIGINT UNSIGNED,quantity DECIMAL(10,2) NOT NULL) ENGINE=InnoDB");
    await pool.query("CREATE TABLE goods_receipts (id BIGINT UNSIGNED PRIMARY KEY,company_id BIGINT UNSIGNED NOT NULL,status VARCHAR(30) NOT NULL) ENGINE=InnoDB");
    await pool.query("CREATE TABLE goods_receipt_items (id BIGINT UNSIGNED PRIMARY KEY,company_id BIGINT UNSIGNED NOT NULL,product_id BIGINT UNSIGNED NOT NULL,goods_receipt_id BIGINT UNSIGNED NOT NULL,received_qty DECIMAL(10,2) NOT NULL,rejected_qty DECIMAL(10,2) NOT NULL,accepted_qty DECIMAL(10,2) NOT NULL) ENGINE=InnoDB");
    await pool.query("CREATE TABLE inventory_transactions (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,company_id BIGINT UNSIGNED NOT NULL,product_id BIGINT UNSIGNED NOT NULL,reference_type VARCHAR(30),reference_id BIGINT UNSIGNED,quantity_in DECIMAL(10,2) NOT NULL,quantity_out DECIMAL(10,2) NOT NULL) ENGINE=InnoDB");
    await pool.query("CREATE TABLE purchase_order_items (id BIGINT UNSIGNED PRIMARY KEY,quantity DECIMAL(10,2) NOT NULL) ENGINE=InnoDB");
    await pool.query("CREATE TABLE invoices (id BIGINT UNSIGNED PRIMARY KEY,company_id BIGINT UNSIGNED NOT NULL) ENGINE=InnoDB");
    await pool.query("CREATE TABLE invoice_items (id BIGINT UNSIGNED PRIMARY KEY,invoice_id BIGINT UNSIGNED,product_id BIGINT UNSIGNED) ENGINE=InnoDB");
    for (const table of ["return_items", "delivery_challan_items"]) await pool.query(`CREATE TABLE ${table} (id BIGINT UNSIGNED PRIMARY KEY,company_id BIGINT UNSIGNED NOT NULL,product_id BIGINT UNSIGNED NOT NULL) ENGINE=InnoDB`);
    await pool.query("INSERT INTO companies VALUES (1),(2)");
    await pool.query("INSERT INTO products (id,company_id) VALUES (1,1),(2,1)");
    await pool.query("INSERT INTO users VALUES (1,1,'accountant',1),(2,1,'owner',1)");
    await pool.query("INSERT INTO financial_years VALUES (1,1,'2026-04-01','2027-03-31','OPEN')");
    const transaction = async fn => {
      const cx = await pool.getConnection();
      try { await cx.beginTransaction(); const result = await fn(cx); await cx.commit(); return result; }
      catch (error) { await cx.rollback(); throw error; } finally { cx.release(); }
    };
    await t.test("fresh install and rerun preserve exact schema and immutability triggers", async () => {
      const cx = await pool.getConnection();
      try {
        assert.equal((await migration.migrate(cx)).created.length, 4);
        assert.equal((await schema.inspect(cx)).ready, true);
        assert.deepEqual(await migration.migrate(cx), { created: [] });
        const [warnings] = await cx.query("SHOW WARNINGS"); assert.equal(warnings.length, 0);
      } finally { cx.release(); }
    });
    const approve = async (cx, revision, key, context = x) => {
      await v.submitCost(cx, { ...context, revision_id: revision.id, reason: "synthetic submission", idempotency_key: `${key}-submit` });
      return v.approveCost(cx, { ...context, actor_id: "2", revision_id: revision.id, reason: "synthetic owner approval", idempotency_key: `${key}-approve` });
    };
    const opening = async (cx, context = x) => {
      const key = `opening-${context.product_id}`;
      const a = await v.createAcquisition(cx, { ...context, date: "2026-04-01", document_type: "OPENING", document_id: key, source_line: "1", reference: "synthetic zero opening", idempotency_key: key });
      const c = await v.recordCost(cx, { ...context, source_id: a.id, evidence: evidence({ state: "FINAL", basis: "OPENING", quantity: "0", purchase_minor: "0", total_minor: "0" }), idempotency_key: `${key}-cost` });
      await approve(cx, c, key, context);
      return v.postAcquisition(cx, { ...context, source_id: a.id, revision_id: c.id, idempotency_key: `${key}-post` });
    };
    await transaction(cx => opening(cx));
    let source, cost, movement;
    await t.test("concurrent same-key acquisition creates one UUID and one record", async () => {
      const input = { ...x, document_type: "SUPPLIER", document_id: "synthetic-supplier-doc", source_line: "1", date: "2026-04-01", reference: "synthetic", idempotency_key: "source" };
      const results = await Promise.all([transaction(cx => v.createAcquisition(cx, input)), transaction(cx => v.createAcquisition(cx, input))]);
      assert.equal(results[0].id, results[1].id); source = results[0];
      const [[count]] = await pool.query("SELECT COUNT(*) n FROM iv_records WHERE kind='ACQUISITION' AND document_type='SUPPLIER'"); assert.equal(Number(count.n), 1);
      await assert.rejects(transaction(cx => v.createAcquisition(cx, { ...input, reference: "changed" })), /IV_IDEMPOTENCY_CONFLICT/);
      cost = await transaction(cx => v.recordCost(cx, { ...x, source_id: source.id, evidence: evidence(), idempotency_key: "cost" }));
      await transaction(cx => approve(cx, cost, "initial"));
      movement = await transaction(cx => v.postAcquisition(cx, { ...x, source_id: source.id, revision_id: cost.id, idempotency_key: "receipt" }));
    });
    await t.test("concurrent issues serialize sequences and cannot overspend stock", async () => {
      const results = await Promise.allSettled(["a", "b"].map(line => transaction(cx => v.postMovement(cx, { ...x, kind: "ISSUE", date: "2026-04-02", quantity: "6", document_type: "INVOICE", document_id: line, source_line: line, idempotency_key: `issue-${line}` }))));
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      assert.equal(results.filter(r => r.status === "rejected")[0].reason.code, "IV_NEGATIVE_STOCK");
      const [rows] = await pool.query("SELECT effective_date,sequence,COUNT(*) n FROM iv_records GROUP BY effective_date,sequence HAVING COUNT(*)>1"); assert.equal(rows.length, 0);
      const r = await transaction(async cx => v.projection(await v.records(cx, x))); assert.equal(r.quantity, "4.000000");
    });
    await t.test("one supplier source-line identity cannot be reused across products", async () => {
      await assert.rejects(transaction(cx => v.createAcquisition(cx, { ...x, product_id: "2", document_type: "SUPPLIER", document_id: "synthetic-supplier-doc", source_line: "1", date: "2026-04-01", reference: "synthetic", idempotency_key: "duplicate-source" })), /IV_DUPLICATE_EVIDENCE/);
      const [[count]] = await pool.query("SELECT COUNT(*) n FROM iv_records WHERE product_id=2"); assert.equal(Number(count.n), 0);
    });
    await t.test("finalization replays costs and immutable original rows remain unchanged", async () => {
      const [before] = await pool.query("SELECT * FROM iv_records WHERE id IN (?,?)", [movement.id, cost.id]);
      const revision = await transaction(cx => v.recordCost(cx, { ...x, source_id: source.id, supersedes_id: cost.id, evidence: evidence({ state: "FINAL", purchase_minor: "1500", total_minor: "1500" }), idempotency_key: "final" }));
      await transaction(cx => approve(cx, revision, "final"));
      const input = { ...x, movement_id: movement.id, revision_id: revision.id, idempotency_key: "finalize" };
      await transaction(cx => v.finalizeAcquisition(cx, input));
      await transaction(cx => v.finalizeAcquisition(cx, input));
      assert.equal((await transaction(async cx => v.projection(await v.records(cx, x)))).value_minor, "600");
      const [after] = await pool.query("SELECT * FROM iv_records WHERE id IN (?,?)", [movement.id, cost.id]); assert.deepEqual(after, before);
      await assert.rejects(pool.query("UPDATE iv_records SET document_id='tampered' WHERE id=?", [cost.id]), /IV_IMMUTABLE_EVIDENCE/);
      await assert.rejects(pool.query("DELETE FROM iv_records WHERE id=?", [cost.id]), /IV_IMMUTABLE_EVIDENCE/);
    });
    await t.test("stock and evidence rollback together on outer transaction failure", async () => {
      const before = await transaction(cx => v.records(cx, x));
      await assert.rejects(transaction(async cx => {
        await v.postMovement(cx, { ...x, kind: "ISSUE", date: "2026-04-03", quantity: "1", document_type: "INVOICE", document_id: "rollback", source_line: "rollback", idempotency_key: "rollback" });
        await cx.query("UPDATE products SET stock=99 WHERE id=1"); throw new Error("synthetic outer failure");
      }), /synthetic outer failure/);
      assert.equal(m.canonical(await transaction(cx => v.records(cx, x))), m.canonical(before));
      const [[product]] = await pool.query("SELECT stock FROM products WHERE id=1"); assert.equal(Number(product.stock), 0);
    });
    await t.test("tenant lock is a real transactional lock, released on rollback", async () => {
      const first = await pool.getConnection(), second = await pool.getConnection();
      try {
        await first.beginTransaction(); await first.query("SELECT id FROM companies WHERE id=1 FOR UPDATE");
        await second.query("SET SESSION innodb_lock_wait_timeout=1"); await second.beginTransaction();
        await assert.rejects(v.createAcquisition(second, { ...x, document_type: "SUPPLIER", document_id: "lock-test", source_line: "1", date: "2026-04-01", reference: "synthetic", idempotency_key: "lock-test" }), e => e.code === "ER_LOCK_WAIT_TIMEOUT");
        await second.rollback(); await first.rollback();
        await second.beginTransaction();
        const created = await v.createAcquisition(second, { ...x, document_type: "SUPPLIER", document_id: "lock-test", source_line: "1", date: "2026-04-01", reference: "synthetic", idempotency_key: "lock-test" });
        assert.match(created.id, /^[a-f0-9-]{36}$/); await second.rollback();
      } finally { await first.rollback(); await second.rollback(); first.release(); second.release(); }
    });
    await t.test("database malformed inserts fail for their exact intended guard with valid positive controls", async () => {
      const [before] = await pool.query("SELECT * FROM iv_records ORDER BY id");
      const [countersBefore] = await pool.query("SELECT * FROM iv_date_sequences ORDER BY company_id,product_id,effective_date");
      const [operationsBefore] = await pool.query("SELECT * FROM iv_operations ORDER BY company_id,operation_key");
      const cases = [
        ["ACQUISITION", { company_id: "2" }, "IV_IDENTITY_INVALID"],
        ["ACQUISITION", { product_id: "999" }, "IV_IDENTITY_INVALID"],
        ["ACQUISITION", { creator_id: "999" }, "IV_IDENTITY_INVALID"],
        ["ACQUISITION", { id: source.id }, "ER_DUP_ENTRY"],
        ["COST", { source_id: null }, "IV_SOURCE_REQUIRED"],
        ["COST", "wrong-source-kind", "IV_SOURCE_TYPE_INVALID"],
        ["APPROVAL", "wrong-target-kind", "IV_TARGET_TYPE_INVALID"],
        ["RECEIPT", { payload: {} }, "IV_REQUIRED_REFERENCE"],
        ["COST_REPLACEMENT", "missing-reversal", "IV_REVERSAL_REQUIRED"],
        ["BILL_LINK", "cost-quantity", "IV_BILL_COST_QUANTITY_MISMATCH"],
        ["OPENING", "supplier-opening", "IV_OPENING_SOURCE_INVALID"],
      ];
      for (const [kind, change, expected] of cases) {
        const rolledBack = new Error("rollback synthetic guard fixture");
        await assert.rejects(transaction(async cx => {
          const context = { ...x, product_id: "800" };
          await cx.query("INSERT INTO products (id,company_id) VALUES (800,1)");
          if (kind !== "OPENING") await opening(cx, context);
          const a = await v.createAcquisition(cx, { ...context, date: "2026-04-10", document_type: kind === "OPENING" ? "OPENING" : "SUPPLIER", document_id: "guard-source", source_line: "1", reference: "synthetic", idempotency_key: "guard-source" });
          const c = await v.recordCost(cx, { ...context, source_id: a.id, evidence: evidence({ state: "FINAL", basis: kind === "OPENING" ? "OPENING" : "SUPPLIER_DOCUMENT" }), idempotency_key: "guard-cost" });
          await v.submitCost(cx, { ...context, revision_id: c.id, reason: "synthetic", idempotency_key: "guard-submit" });
          if (kind !== "APPROVAL") await v.approveCost(cx, { ...context, actor_id: "2", revision_id: c.id, reason: "synthetic", idempotency_key: "guard-approve" });
          let template = { ...v.ref(a), kind, source_id: a.id, target_id: c.id, supersedes_id: null, payload: { revision_id: c.id }, creator_id: "1" };
          if (kind === "ACQUISITION") template = { ...template, source_id: null, target_id: null, document_id: "new-guard-source", payload: { reference: "synthetic", currency: "INR" } };
          if (kind === "COST") template = { ...template, target_id: null, supersedes_id: c.id, payload: c.payload };
          if (kind === "APPROVAL") template = { ...template, creator_id: "2", payload: { reason: "synthetic" } };
          if (kind === "COST_REPLACEMENT") {
            const receipt = await v.postAcquisition(cx, { ...context, source_id: a.id, revision_id: c.id, idempotency_key: "guard-receipt" });
            const next = await v.recordCost(cx, { ...context, source_id: a.id, supersedes_id: c.id, evidence: evidence({ state: "FINAL", basis: "SUPPLIER_DOCUMENT", purchase_minor: "1200", total_minor: "1200" }), idempotency_key: "guard-next" });
            await approve(cx, next, "guard-next", context);
            const reversal = await v.append(cx, context, { ...v.ref(a), kind: "COST_REVERSAL", target_id: c.id, idempotency_key: "guard-reverse", payload: { movement_id: receipt.id, revision_id: c.id, quantity: c.payload.quantity, total_minor: c.payload.total_minor } });
            template = { ...template, target_id: receipt.id, payload: { revision_id: next.id, reversal_id: reversal.id, variance_minor: "200" } };
          }
          if (kind === "BILL_LINK") {
            await cx.query("INSERT INTO bills VALUES (800,1)");
            await cx.query("INSERT INTO bill_items VALUES (801,800,800,10.00)");
            template = { ...template, document_type: "BILL", document_id: "800", source_line: "801", payload: { revision_id: c.id, quantity: "10" } };
          }
          let invalid = typeof change === "object" ? change : {};
          if (change === "wrong-source-kind") invalid = { source_id: c.id };
          if (change === "wrong-target-kind") invalid = { target_id: a.id };
          if (change === "missing-reversal") invalid = { payload: { ...template.payload, reversal_id: null } };
          if (change === "cost-quantity") invalid = { payload: { ...template.payload, quantity: "9" } };
          if (change === "supplier-opening") {
            const supplier = await v.createAcquisition(cx, { ...context, date: "2026-04-10", document_type: "SUPPLIER", document_id: "supplier-not-opening", source_line: "1", reference: "synthetic", idempotency_key: "guard-supplier" });
            const supplierCost = await v.recordCost(cx, { ...context, source_id: supplier.id, evidence: evidence({ state: "FINAL", basis: "SUPPLIER_DOCUMENT" }), idempotency_key: "guard-supplier-cost" });
            await approve(cx, supplierCost, "guard-supplier", context);
            invalid = { ...v.ref(supplier), target_id: supplierCost.id, payload: { revision_id: supplierCost.id } };
          }
          const [[counter]] = await cx.query("SELECT CAST(last_sequence AS CHAR) n FROM iv_date_sequences WHERE company_id=1 AND product_id=800 AND effective_date='2026-04-10' FOR UPDATE");
          const sequence = (BigInt(counter.n) + 1n).toString();
          await cx.query("UPDATE iv_date_sequences SET last_sequence=? WHERE company_id=1 AND product_id=800 AND effective_date='2026-04-10'", [sequence]);
          const valid = { ...context, id: randomUUID(), effective_date: "2026-04-10", sequence, idempotency_key: randomUUID(), fingerprint: "0".repeat(64), ...template };
          const insert = async changes => {
            const row = { ...valid, ...changes };
            row.acquisition_key = row.kind === "ACQUISITION" ? m.acquisitionKey(row) : null;
            const keys = ["company_id","product_id","id","kind","effective_date","sequence","source_id","supersedes_id","target_id","document_type","document_id","source_line","acquisition_key","idempotency_key","fingerprint","payload","creator_id"];
            await cx.query(`INSERT INTO iv_records (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`, keys.map(key => key === "payload" ? JSON.stringify(row[key]) : row[key]));
          };
          await cx.query("SAVEPOINT positive_control");
          await insert({}); // The otherwise-identical baseline must actually be insertable.
          await cx.query("ROLLBACK TO SAVEPOINT positive_control");
          if (change === "cost-quantity") await cx.query("UPDATE bill_items SET quantity=9.00 WHERE id=801");
          await assert.rejects(insert(invalid), error => expected === "ER_DUP_ENTRY" ? error.code === expected : error.code === "ER_SIGNAL_EXCEPTION" && error.sqlMessage === expected, `${kind}: ${expected}`);
          throw rolledBack;
        }), error => error === rolledBack);
      }
      const [after] = await pool.query("SELECT * FROM iv_records ORDER BY id"); assert.deepEqual(after, before);
      const [countersAfter] = await pool.query("SELECT * FROM iv_date_sequences ORDER BY company_id,product_id,effective_date"); assert.deepEqual(countersAfter, countersBefore);
      const [operationsAfter] = await pool.query("SELECT * FROM iv_operations ORDER BY company_id,operation_key"); assert.deepEqual(operationsAfter, operationsBefore);
      const [[fixtureProducts]] = await pool.query("SELECT COUNT(*) n FROM products WHERE id=800"); assert.equal(Number(fixtureProducts.n), 0);
      await assert.rejects(pool.query("UPDATE products SET company_id=2 WHERE id=1"), /IV_MASTER_REFERENCED/);
      await assert.rejects(pool.query("UPDATE users SET company_id=2 WHERE id=1"), /IV_MASTER_REFERENCED/);
      await assert.rejects(pool.query("DELETE FROM companies WHERE id=1"), /IV_MASTER_REFERENCED/);
    });
    await t.test("direct bill quantity correction preserves immutable history and commits exact physical delta once", async () => {
      const corrections = require("../services/inventoryValuationCorrectionService"), context = { ...x, product_id: "2" };
      await transaction(cx => opening(cx, context));
      let acquisition, firstCost, firstLink, correction, nextCost;
      await transaction(async cx => {
        acquisition = await v.createAcquisition(cx, { ...context, date: "2026-04-01", document_type: "SUPPLIER", document_id: "correction-source", source_line: "1", reference: "synthetic", idempotency_key: "correction-source" });
        firstCost = await v.recordCost(cx, { ...context, source_id: acquisition.id, evidence: evidence({ state: "FINAL", basis: "SUPPLIER_DOCUMENT", quantity: "1", purchase_minor: "100", total_minor: "100" }), idempotency_key: "correction-cost" });
        await approve(cx, firstCost, "correction-first", context);
        await cx.query("INSERT INTO bills VALUES (81,1)"); await cx.query("INSERT INTO bill_items VALUES (91,81,2,1.00)");
        firstLink = await v.applyBillCost(cx, context, { source_id: acquisition.id, revision_id: firstCost.id, bill_id: "81", bill_date: "2026-04-01", line_id: "91" });
        await cx.query("UPDATE products SET stock=1.00 WHERE id=2");
      });
      const [original] = await pool.query("SELECT * FROM iv_records WHERE product_id=2 ORDER BY id");
      await transaction(async cx => {
        const receipt = (await v.records(cx, context)).find(r => r.kind === "RECEIPT");
        nextCost = await v.recordCost(cx, { ...context, source_id: acquisition.id, supersedes_id: firstCost.id, evidence: evidence({ state: "FINAL", basis: "SUPPLIER_DOCUMENT", quantity: "2", purchase_minor: "200", total_minor: "200" }), idempotency_key: "corrected-cost" });
        await approve(cx, nextCost, "correction-next", context);
        correction = await corrections.create(cx, { ...context, bill_id: "81", movement_id: receipt.id, previous_bill_link_id: firstLink.id, new_source_id: acquisition.id, new_revision_id: nextCost.id, reason: "synthetic approved quantity correction", idempotency_key: "quantity-correction" });
        await corrections.approve(cx, { ...context, actor_id: "2", correction_id: correction.id, reason: "owner review", idempotency_key: "quantity-correction-review" });
      });
      const input = { source_id: acquisition.id, revision_id: nextCost.id, correction_id: correction.id, bill_id: "81", bill_date: "2026-04-01", line_id: "92" };
      const apply = async cx => {
        const rows = await v.records(cx, context), proof = await v.previewBillCost(cx, context, rows, acquisition, nextCost, "81", "2026-04-01", correction.id);
        await cx.query("DELETE FROM bill_items WHERE bill_id=81"); await cx.query("INSERT INTO bill_items VALUES (92,81,2,2.00)");
        return v.applyBillCost(cx, context, { ...input, proof });
      };
      await assert.rejects(transaction(async cx => { await apply(cx); throw Error("synthetic downstream failure"); }), /synthetic downstream failure/);
      assert.equal((await pool.query("SELECT CAST(stock AS CHAR) stock FROM products WHERE id=2"))[0][0].stock, "1.00");
      const committed = await transaction(apply);
      const retry = await transaction(cx => v.applyBillCost(cx, context, input)); assert.equal(retry.id, committed.id);
      assert.equal((await pool.query("SELECT CAST(stock AS CHAR) stock FROM products WHERE id=2"))[0][0].stock, "2.00");
      const [after] = await pool.query("SELECT * FROM iv_records WHERE product_id=2 ORDER BY id");
      for (const row of original) assert.deepEqual(after.find(r => r.id === row.id), row);
      assert.equal(after.filter(r => r.kind === "STOCK_REVERSAL").length, 1);
      assert.equal(after.filter(r => r.kind === "STOCK_REPLACEMENT").length, 1);
      const editCost = async (source, prior, key) => {
        const [beforeEdit] = await pool.query("SELECT * FROM iv_records WHERE product_id=2 ORDER BY id");
        const cost = await transaction(async cx => {
          const revision = await v.recordCost(cx, { ...context, source_id: source.id, supersedes_id: prior.id, evidence: { ...prior.payload, purchase_minor: "300", total_minor: "300" }, idempotency_key: `${key}-cost` });
          await approve(cx, revision, key, context); return revision;
        });
        const edit = { source_id: source.id, revision_id: cost.id, bill_id: "81", bill_date: "2026-04-01", line_id: "92" };
        const link = await transaction(cx => v.applyBillCost(cx, context, edit));
        assert.equal((await transaction(cx => v.applyBillCost(cx, context, edit))).id, link.id);
        assert.equal((await pool.query("SELECT CAST(stock AS CHAR) stock FROM products WHERE id=2"))[0][0].stock, "2.00");
        const [afterEdit] = await pool.query("SELECT * FROM iv_records WHERE product_id=2 ORDER BY id");
        for (const row of beforeEdit) assert.deepEqual(afterEdit.find(r => r.id === row.id), row);
        assert.equal((await transaction(async cx => v.projection(await v.records(cx, context)))).value_minor, "300");
        return { cost, link };
      };
      const edited = await editCost(acquisition, nextCost, "after-quantity");
      const replaced = await transaction(async cx => {
        const source = await v.createAcquisition(cx, { ...context, date: "2026-04-01", document_type: "SUPPLIER", document_id: "corrected-document", source_line: "2", reference: "synthetic replacement", idempotency_key: "new-source" });
        const cost = await v.recordCost(cx, { ...context, source_id: source.id, evidence: edited.cost.payload, idempotency_key: "new-source-cost" });
        await approve(cx, cost, "new-source", context);
        const receipt = (await v.records(cx, context)).find(r => r.kind === "RECEIPT");
        const correction = await corrections.create(cx, { ...context, bill_id: "81", movement_id: receipt.id, previous_bill_link_id: edited.link.id, new_source_id: source.id, new_revision_id: cost.id, reason: "synthetic source correction", idempotency_key: "new-source-correction" });
        await corrections.approve(cx, { ...context, actor_id: "2", correction_id: correction.id, reason: "owner approval", idempotency_key: "new-source-correction-approval" });
        await v.applyBillCost(cx, context, { source_id: source.id, revision_id: cost.id, correction_id: correction.id, bill_id: "81", bill_date: "2026-04-01", line_id: "92" });
        return { source, cost };
      });
      await editCost(replaced.source, replaced.cost, "after-source");
    });
    await t.test("GRN movement, physical inventory, stock and operation result roll back and retry atomically", async () => {
      const posting = require("../services/inventoryValuationPostingService"), ops = require("../services/inventoryValuationOperationService");
      await pool.query("INSERT INTO products(id,company_id) VALUES (3,1)");
      const context = { ...x, product_id: "3" }; let revision;
      await transaction(async cx => {
        await opening(cx, context);
        await cx.query("INSERT INTO goods_receipts VALUES (31,1,'Draft')"); await cx.query("INSERT INTO goods_receipt_items VALUES (41,1,3,31,10.00,0.00,10.00)");
        const a = await v.createAcquisition(cx, { ...context, date: "2026-04-01", document_type: "GRN", document_id: "31", source_line: "41", reference: "synthetic GRN", idempotency_key: "grn-source" });
        revision = await v.recordCost(cx, { ...context, source_id: a.id, evidence: evidence(), idempotency_key: "grn-cost" }); await approve(cx, revision, "grn", context);
      });
      const apply = async (cx, fail = false) => {
        const req = { user: { company_id: "1", id: "1" }, headers: { "idempotency-key": "grn-post" }, body: { valuation_lines: [{ source_grn_item_id: "41", revision_id: revision.id }] } };
        const retry = await ops.beginRequest(cx, req, "grn-post", "31"); if (retry) return retry;
        await posting.postGrn(cx, req, { id: "31", grn_date: "2026-04-01" }, [{ id: "41", product_id: "3", accepted_qty: "10.00" }]);
        await cx.query("INSERT INTO inventory_transactions(company_id,product_id,reference_type,reference_id,quantity_in,quantity_out) VALUES (1,3,'GRN',31,10.00,0.00)");
        await cx.query("UPDATE products SET stock=stock+10.00 WHERE id=3"); await cx.query("UPDATE goods_receipts SET status='Posted' WHERE id=31");
        await ops.completeRequest(cx, req, 200, { posted: true });
        if (fail) throw Error("synthetic final write failure");
        return { status: 200, body: { posted: true } };
      };
      await assert.rejects(transaction(cx => apply(cx, true)), /synthetic final write failure/);
      assert.equal(Number((await pool.query("SELECT COUNT(*) n FROM inventory_transactions WHERE product_id=3"))[0][0].n), 0);
      const results = await Promise.all([transaction(cx => apply(cx)), transaction(cx => apply(cx))]); assert.deepEqual(results[0], results[1]);
      assert.equal(Number((await pool.query("SELECT COUNT(*) n FROM inventory_transactions WHERE product_id=3"))[0][0].n), 1);
      assert.equal((await pool.query("SELECT CAST(stock AS CHAR) stock FROM products WHERE id=3"))[0][0].stock, "10.00");
      assert.equal((await pool.query("SELECT status FROM goods_receipts WHERE id=31"))[0][0].status, "Posted");
    });
    await t.test("component allocations serialize document identity, preserve totals and reject revision forks", async () => {
      const components = require("../services/inventoryValuationComponentService");
      const recipients = [];
      for (const product_id of ["1", "2"]) recipients.push(await transaction(cx => v.createAcquisition(cx, { ...x, product_id, date: "2026-04-05", document_type: "SUPPLIER", document_id: "allocation-document", source_line: product_id, reference: "synthetic allocation source", idempotency_key: `allocation-source-${product_id}` })));
      const input = { ...x, date: "2026-04-05", kind: "FREIGHT_INWARD", document_id: "freight-reference", component_line: "1", reference: "synthetic freight invoice", total_minor: "101", basis: "WEIGHT", recipients: recipients.map(source => ({ acquisition_id: source.id, weight: "1" })), idempotency_key: "freight-create" };
      const result = await Promise.all([transaction(cx => components.create(cx, input)), transaction(cx => components.create(cx, input))]);
      assert.equal(result[0].id, result[1].id);
      assert.equal(result[0].payload.calculated.reduce((sum, part) => sum + BigInt(part.amount_minor), 0n), 101n);
      const outcomes = await Promise.allSettled(["a", "b"].map(key => transaction(cx => components.create(cx, { ...input, supersedes_id: result[0].id, total_minor: "103", idempotency_key: `freight-correction-${key}` }))));
      assert.equal(outcomes.filter(r => r.status === "fulfilled").length, 1);
      assert.equal(outcomes.find(r => r.status === "rejected").reason.code, "IV_REVISION_CONFLICT");
      const [stored] = await pool.query("SELECT payload FROM iv_records WHERE id=?", [result[0].id]);
      assert.equal(m.canonical(typeof stored[0].payload === "string" ? JSON.parse(stored[0].payload) : stored[0].payload), m.canonical(result[0].payload));
      const changed = outcomes.find(r => r.status === "fulfilled").value;
      assert.deepEqual(changed.payload.reversal, { revision_id: result[0].id, calculated: result[0].payload.calculated });
      await assert.rejects(transaction(cx => components.create(cx, { ...input, idempotency_key: "duplicate-reference" })), /IV_COMPONENT_IDENTITY_CONFLICT/);
      const counts = async () => (await pool.query("SELECT COUNT(*) n FROM iv_records"))[0][0].n;
      const before = await counts();
      await assert.rejects(transaction(cx => v.recordCost(cx, { ...x, source_id: recipients[0].id, evidence: evidence({ allocations: [{ component_id: result[0].id, kind: "FREIGHT_INWARD", reference: input.reference, total_minor: "101", basis: "WEIGHT", lines: result[0].payload.lines, calculated: result[0].payload.calculated, line: recipients[0].id }], total_minor: (1000n + BigInt(result[0].payload.calculated.find(r => r.line === recipients[0].id).amount_minor)).toString() }), idempotency_key: "obsolete-allocation" })), /IV_COMPONENT_REVISION_SUPERSEDED/);
      assert.equal(await counts(), before);
    });
    await t.test("incompatible existing index rejects migration without modifying evidence", async () => {
      const before = await transaction(cx => v.records(cx, x));
      await pool.query("CREATE INDEX iv_unexpected ON iv_records(creator_id)");
      const cx = await pool.getConnection();
      try { await assert.rejects(migration.migrate(cx), /IV_SCHEMA_INCOMPATIBLE/); } finally { cx.release(); }
      assert.equal(m.canonical(await transaction(cx => v.records(cx, x))), m.canonical(before));
      await pool.query("DROP INDEX iv_unexpected ON iv_records");
      assert.equal((await schema.inspect(pool)).ready, true);
    });
    await t.test("incompatible columns, defaults, foreign actions and triggers fail before repair", async () => {
      const expectConflict = async () => {
        const cx = await pool.getConnection();
        try { await assert.rejects(migration.migrate(cx), /IV_SCHEMA_INCOMPATIBLE/); } finally { cx.release(); }
      };
      await pool.query("ALTER TABLE iv_records MODIFY fingerprint CHAR(65) NOT NULL");
      await expectConflict();
      await pool.query("ALTER TABLE iv_records MODIFY fingerprint CHAR(64) NOT NULL");
      await pool.query("ALTER TABLE iv_records ALTER COLUMN document_type SET DEFAULT 'UNEXPECTED'");
      await expectConflict();
      await pool.query("ALTER TABLE iv_records ALTER COLUMN document_type DROP DEFAULT");
      await pool.query("ALTER TABLE iv_date_sequences DROP FOREIGN KEY iv_sequence_scope");
      await pool.query("ALTER TABLE iv_date_sequences ADD CONSTRAINT iv_sequence_scope FOREIGN KEY(company_id,product_id) REFERENCES iv_product_locks(company_id,product_id) ON DELETE CASCADE ON UPDATE RESTRICT");
      await expectConflict();
      await pool.query("ALTER TABLE iv_date_sequences DROP FOREIGN KEY iv_sequence_scope");
      await pool.query("ALTER TABLE iv_date_sequences ADD CONSTRAINT iv_sequence_scope FOREIGN KEY(company_id,product_id) REFERENCES iv_product_locks(company_id,product_id) ON DELETE RESTRICT ON UPDATE RESTRICT");
      await pool.query("DROP TRIGGER iv_records_no_update");
      await pool.query("CREATE TRIGGER iv_records_no_update BEFORE UPDATE ON iv_records FOR EACH ROW SET @iv_test_unexpected=1");
      await expectConflict();
      await pool.query("DROP TRIGGER iv_records_no_update");
      await pool.query(`CREATE TRIGGER iv_records_no_update BEFORE UPDATE ON iv_records FOR EACH ROW ${schema.triggerBody}`);
      assert.equal((await schema.inspect(pool)).ready, true);
    });
  } finally {
    if (pool) await pool.end();
    if (created) { assert.match(database, /^iv_proof_[a-f0-9]{32}$/); await admin.query(`DROP DATABASE \`${database}\``); }
    await admin.end();
  }
});
