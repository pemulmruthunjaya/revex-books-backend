"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const m = require("../services/inventoryValuationMath");
const v = require("../services/inventoryValuationService");
const schema = require("../services/inventoryValuationSchema");
const migration = require("../db/migrations/2026-10-05-immutable-inventory-valuation");
const { Fixture, evidence, base, approve, opening } = require("./helpers/inventoryValuationFixture");
const fs = require("node:fs");
const path = require("node:path");

async function acquire(cx, options = {}) {
  if (options.document_type !== "OPENING") await opening(cx);
  const source = await v.createAcquisition(cx, { ...base, date: "2026-04-01", document_type: "GRN", document_id: "7", source_line: "11", reference: "synthetic-grn", idempotency_key: "source", ...options });
  const cost = await v.recordCost(cx, { ...base, source_id: source.id, evidence: evidence(options.evidence), idempotency_key: "cost" });
  await approve(cx, { ...base, actor_id: "2", revision_id: cost.id, reason: "reviewed", idempotency_key: "approve" });
  const movement = await v.postAcquisition(cx, { ...base, source_id: source.id, revision_id: cost.id, idempotency_key: "receipt" });
  return { source, cost, movement };
}
const movement = (id, kind, quantity, total, sequence, more = {}) => ({ id, kind, quantity, ...(total === undefined ? {} : { total_minor: total }), sequence, date: "2026-04-01", source_line: id, ...more });

test("fixed-point Q6, half-up and full depletion preserve all paise", () => {
  assert.equal(m.quantity("0.000001"), 1n);
  assert.throws(() => m.quantity(0.1), /IV_QUANTITY_INVALID/);
  assert.throws(() => m.quantity("1.0000001"), /IV_QUANTITY_INVALID/);
  const r = m.replay([movement("a", "RECEIPT", "3", "100", "1"), movement("b", "ISSUE", "1", undefined, "2"), movement("c", "ISSUE", "2", undefined, "3")]);
  assert.deepEqual(r.results.map(x => x.cost_minor), ["100", "33", "67"]);
  assert.equal(r.value_minor, "0");
});
test("deterministic ordering ignores input order and supports large integer quantities", () => {
  const list = [movement("a", "RECEIPT", "10000000000000000", "12345678901234567890", "1"), movement("b", "ISSUE", "10000000000000000", undefined, "2")];
  assert.deepEqual(m.replay(list), m.replay([...list].reverse()));
  assert.equal(m.replay(list).value_minor, "0");
});
test("return cost follows exact original outbound with cumulative rounding", () => {
  const r = m.replay([movement("a", "RECEIPT", "3", "100", "1"), movement("b", "ISSUE", "3", undefined, "2"),
    movement("c", "CUSTOMER_RETURN", "1", undefined, "3", { target: "b", source_line: "b" }), movement("d", "CUSTOMER_RETURN", "2", undefined, "4", { target: "b", source_line: "b" })]);
  assert.equal(r.value_minor, "100");
  assert.deepEqual(r.results.slice(2).map(x => x.cost_minor), ["33", "67"]);
  assert.throws(() => m.replay([movement("x", "CUSTOMER_RETURN", "1", undefined, "1", { target: "missing" })]), /IV_RETURN_LINK_REQUIRED/);
});
test("vendor returns use acquisition cost and fail closed if average pool cannot fund it", () => {
  assert.equal(m.replay([movement("a", "RECEIPT", "2", "100", "1"), movement("r", "VENDOR_RETURN", "1", undefined, "2", { target: "a", source_line: "a" })]).value_minor, "50");
  assert.throws(() => m.replay([movement("a", "RECEIPT", "1", "1000", "1"), movement("b", "RECEIPT", "1", "0", "2"), movement("c", "ISSUE", "1", undefined, "3"), movement("d", "VENDOR_RETURN", "1", undefined, "4", { target: "a", source_line: "a" })]), /IV_NEGATIVE_OR_RESIDUAL_VALUE/);
});
test("allocation basis is explicit, immutable calculation conserves total, unknown tax cannot finalize", () => {
  const lines = [{ line: "b", weight: "1" }, { line: "a", weight: "1" }, { line: "c", weight: "1" }];
  assert.deepEqual(m.allocate("100", "QUANTITY", lines).map(x => x.amount_minor), ["33", "34", "33"]);
  assert.throws(() => m.allocate("100", undefined, lines), /IV_ALLOCATION_BASIS_REQUIRED/);
  assert.throws(() => m.validateCost(evidence({ state: "FINAL", taxes: [{ amount_minor: "100", recoverability: "UNKNOWN", reference: "tax-evidence" }] })), /IV_TAX_RECOVERABILITY_UNKNOWN/);
  const allocation = { kind: "FREIGHT_INWARD", reference: "freight", basis: "WEIGHT", total_minor: "100", lines, calculated: m.allocate("100", "WEIGHT", lines), line: "a" };
  m.validateCost(evidence({ allocations: [allocation], total_minor: "1033" }));
  assert.throws(() => m.validateCost(evidence({ allocations: [{ ...allocation, basis: "DEFAULT" }] })), /IV_ALLOCATION_BASIS_REQUIRED/);
});
test("acquisition UUID, approved revision and receipt are immutable and idempotent", async () => {
  const cx = new Fixture(), a = await acquire(cx);
  const count = cx.rows.length;
  const same = await v.postAcquisition(cx, { ...base, source_id: a.source.id, revision_id: a.cost.id, idempotency_key: "receipt" });
  assert.equal(same.id, a.movement.id); assert.equal(cx.rows.length, count);
  assert.equal(v.projection(await v.records(cx, base)).value_minor, "1000");
  await assert.rejects(v.createAcquisition(cx, { ...base, date: "2026-04-01", document_type: "GRN", document_id: "7", source_line: "11", reference: "changed", idempotency_key: "source" }), /IV_IDEMPOTENCY_CONFLICT/);
  await assert.rejects(v.recordCost(cx, { ...base, company_id: "2", source_id: a.source.id, evidence: evidence(), idempotency_key: "cross-tenant" }), /IV_LINK_NOT_FOUND/);
});
test("finalization replays later issues; original receipt/cost remain byte-for-byte unchanged", async () => {
  const cx = new Fixture(), a = await acquire(cx);
  await v.postMovement(cx, { ...base, kind: "ISSUE", date: "2026-04-02", quantity: "5", document_type: "INVOICE", document_id: "8", source_line: "8-1", idempotency_key: "issue" });
  const original = m.canonical(cx.rows.filter(r => [a.source.id, a.cost.id, a.movement.id].includes(r.id)));
  const revision = await v.recordCost(cx, { ...base, source_id: a.source.id, supersedes_id: a.cost.id, evidence: evidence({ state: "FINAL", purchase_minor: "1400", total_minor: "1400" }), idempotency_key: "final-cost" });
  await approve(cx, { ...base, actor_id: "2", revision_id: revision.id, reason: "supplier final", idempotency_key: "final-approval" });
  const input = { ...base, movement_id: a.movement.id, revision_id: revision.id, idempotency_key: "finalize" };
  await v.finalizeAcquisition(cx, input);
  const result = v.projection(await v.records(cx, base));
  assert.equal(result.value_minor, "700"); assert.equal(result.results.at(-1).cost_minor, "700");
  assert.equal(m.canonical(cx.rows.filter(r => [a.source.id, a.cost.id, a.movement.id].includes(r.id))), original);
  const count = cx.rows.length;
  await v.finalizeAcquisition(cx, input); assert.equal(cx.rows.length, count);
  assert.equal(cx.rows.filter(r => r.kind === "COST_REVERSAL").length, 1);
});
test("all non-OPEN periods reject mutation and failed replay rolls evidence and counters back", async () => {
  for (const status of ["DRAFT", "RECONCILIATION", "CLOSING", "CLOSED", "LOCKED"]) {
    const cx = new Fixture(); cx.status = status;
    await assert.rejects(cx.transaction(() => acquire(cx)), /IV_OPEN_FY_REQUIRED/); assert.equal(cx.rows.length, 0);
  }
  const cx = new Fixture(); await acquire(cx);
  const before = m.canonical(cx.rows), counters = [...cx.counters];
  await assert.rejects(cx.transaction(() => v.postMovement(cx, { ...base, kind: "ISSUE", date: "2026-04-02", quantity: "11", document_type: "INVOICE", document_id: "8", source_line: "8-1", idempotency_key: "excess" })), /IV_NEGATIVE_STOCK/);
  assert.equal(m.canonical(cx.rows), before); assert.deepEqual([...cx.counters], counters);
});
test("opening requires a separate owner approver and final explicit total value", async () => {
  const cx = new Fixture();
  const source = await v.createAcquisition(cx, { ...base, actor_id: "2", date: "2026-04-01", document_type: "OPENING", document_id: "opening-ref", source_line: "1", reference: "signed opening", idempotency_key: "opening" });
  const cost = await v.recordCost(cx, { ...base, actor_id: "2", source_id: source.id, evidence: evidence({ state: "FINAL", basis: "OPENING" }), idempotency_key: "opening-cost" });
  await assert.rejects(v.approveCost(cx, { ...base, actor_id: "2", revision_id: cost.id, reason: "self", idempotency_key: "self" }), /IV_SEPARATE_OPENING_APPROVER_REQUIRED/);
  cx.owner = "3";
  await approve(cx, { ...base, actor_id: "3", revision_id: cost.id, reason: "independent", idempotency_key: "other" });
  await v.postAcquisition(cx, { ...base, source_id: source.id, revision_id: cost.id, idempotency_key: "open-post" });
  assert.equal(v.projection(await v.records(cx, base)).quantity, "10.000000");
});
test("exact schema contract is SELECT-only; migration rerun emits no DDL; conflicts precede DDL", async () => {
  const cx = new Fixture(); assert.equal((await schema.inspect(cx)).ready, true);
  assert.ok(cx.calls.every(([sql]) => sql.startsWith("SELECT")));
  assert.deepEqual(await migration.migrate(cx), { created: [] });
  assert.ok(cx.calls.every(([sql]) => sql.startsWith("SELECT")));
  cx.conflict = "fingerprint";
  await assert.rejects(migration.migrate(cx), /IV_SCHEMA_INCOMPATIBLE/);
  assert.ok(cx.calls.every(([sql]) => sql.startsWith("SELECT")));
});
test("posting adapters require approved evidence; no price inference or close wiring", async () => {
  const p = require("../services/inventoryValuationPostingService");
  await assert.rejects(p.postGrn(new Fixture(), { user: { company_id: 1 }, body: {} }, {}, []), /IV_APPROVED_COST_EVIDENCE_REQUIRED/);
  for (const name of ["inventoryValuationMath", "inventoryValuationService", "inventoryValuationPostingService", "inventoryValuationReadinessService"]) {
    const source = fs.readFileSync(path.join(__dirname, `../services/${name}.js`), "utf8");
    assert.doesNotMatch(source, /require\(["'].*db\/connection|sellingPrice|purchase_price|INSERT INTO journal|financialYearCloseService/);
  }
});

test("valuation writes refuse an autocommit connection before lock or evidence writes", async () => {
  const cx = new Fixture(); cx.autocommitOnly = true;
  await assert.rejects(v.createAcquisition(cx, { ...base }), /IV_TRANSACTION_REQUIRED/);
  assert.deepEqual(cx.calls.map(c => c[0]), ["DO 0"]);
});

test("revision forks, tampered fingerprints and non-owner approval are rejected", async () => {
  const cx = new Fixture(), a = await acquire(cx);
  await assert.rejects(v.approveCost(cx, { ...base, revision_id: a.cost.id, reason: "staff", idempotency_key: "staff" }), /IV_ACTOR_NOT_AUTHORIZED/);
  await v.recordCost(cx, { ...base, source_id: a.source.id, supersedes_id: a.cost.id, evidence: evidence({ state: "FINAL" }), idempotency_key: "first-revision" });
  await assert.rejects(v.recordCost(cx, { ...base, source_id: a.source.id, supersedes_id: a.cost.id, evidence: evidence({ state: "FINAL" }), idempotency_key: "fork" }), /IV_REVISION_CONFLICT/);
  cx.rows.find(r => r.id === a.cost.id).payload.total_minor = "999";
  await assert.rejects(v.records(cx, base), /IV_EVIDENCE_FINGERPRINT_MISMATCH/);
});

test("backdated inbound replays later outbounds and changes the valuation fingerprint", async () => {
  const cx = new Fixture(); await acquire(cx);
  await v.postMovement(cx, { ...base, kind: "ISSUE", date: "2026-04-03", quantity: "5", document_type: "INVOICE", document_id: "9", source_line: "9-1", idempotency_key: "issue" });
  const before = v.projection(await v.records(cx, base));
  const source = await v.createAcquisition(cx, { ...base, date: "2026-04-02", document_type: "SUPPLIER", document_id: "second", source_line: "1", reference: "backdated", idempotency_key: "source2" });
  const cost = await v.recordCost(cx, { ...base, source_id: source.id, evidence: evidence({ purchase_minor: "3000", total_minor: "3000" }), idempotency_key: "cost2" });
  await approve(cx, { ...base, actor_id: "2", revision_id: cost.id, reason: "reviewed", idempotency_key: "approve2" });
  await v.postAcquisition(cx, { ...base, source_id: source.id, revision_id: cost.id, idempotency_key: "receipt2" });
  const after = v.projection(await v.records(cx, base));
  assert.equal(after.results.at(-1).cost_minor, "1000"); assert.equal(after.value_minor, "3000"); assert.notEqual(before.fingerprint, after.fingerprint);
});

test("replay refuses to revalue a later frozen period even when the receipt FY is OPEN", async () => {
  const cx = new Fixture(), a = await acquire(cx);
  await v.postMovement(cx, { ...base, kind: "ISSUE", date: "2027-04-01", quantity: "1", document_type: "INVOICE", document_id: "9", source_line: "9-1", idempotency_key: "later" });
  const revision = await v.recordCost(cx, { ...base, source_id: a.source.id, supersedes_id: a.cost.id, evidence: evidence({ state: "FINAL" }), idempotency_key: "final" });
  await approve(cx, { ...base, actor_id: "2", revision_id: revision.id, reason: "final", idempotency_key: "approve-final" });
  const query = cx.query.bind(cx);
  cx.query = async (sql, params) => sql.includes("FROM financial_years") && params[1] === "2027-04-01" ? [[{ id: "2", status: "CLOSED" }]] : query(sql, params);
  const before = m.canonical(cx.rows);
  await assert.rejects(cx.transaction(() => v.finalizeAcquisition(cx, { ...base, movement_id: a.movement.id, revision_id: revision.id, idempotency_key: "finalize" })), /IV_OPEN_FY_REQUIRED/);
  assert.equal(m.canonical(cx.rows), before);
});

test("approved opening corrections retain original quantity/value and linked reversal/replacement", async () => {
  const cx = new Fixture(), a = await acquire(cx, { document_type: "OPENING", document_id: "opening", source_line: "1", evidence: { state: "FINAL", basis: "OPENING" } });
  const before = m.canonical(cx.rows.filter(r => r.id === a.cost.id));
  const correction = await v.recordCost(cx, { ...base, source_id: a.source.id, supersedes_id: a.cost.id,
    evidence: evidence({ state: "FINAL", basis: "OPENING", quantity: "12", purchase_minor: "1800", total_minor: "1800" }), idempotency_key: "correction" });
  await approve(cx, { ...base, actor_id: "2", revision_id: correction.id, reason: "separate approval", idempotency_key: "correction-approved" });
  await v.finalizeAcquisition(cx, { ...base, movement_id: a.movement.id, revision_id: correction.id, idempotency_key: "correct-opening" });
  assert.equal(v.projection(await v.records(cx, base)).quantity, "12.000000");
  assert.equal(m.canonical(cx.rows.filter(r => r.id === a.cost.id)), before);
  const reversal = cx.rows.find(r => r.kind === "COST_REVERSAL"), replacement = cx.rows.find(r => r.kind === "COST_REPLACEMENT");
  assert.equal(reversal.payload.quantity, "10.000000"); assert.equal(replacement.payload.reversal_id, reversal.id);
});

test("versioned SQL is SHA-pinned and exactly matches the frozen runtime contract; runner is import-inert", () => {
  const crypto = require("node:crypto");
  const sql = fs.readFileSync(path.join(__dirname, "../db/migrations/2026-10-05-immutable-inventory-valuation.sql"));
  assert.equal(crypto.createHash("sha256").update(sql).digest("hex"), migration.MIGRATION_SHA256);
  const statements = [...sql.toString("utf8").matchAll(/-- IV_OBJECT (table|trigger) ([a-z0-9_]+)\r?\n([\s\S]*?)(?=\r?\n-- IV_OBJECT |$)/g)].map(match => ({ type: match[1], name: match[2], sql: match[3].trim().replace(/;$/, "").replace(/\r\n/g, "\n") }));
  const expected = [...Object.keys(schema.tables).map(name => ({ type: "table", name, sql: schema.createSQL(name) })), ...schema.ownedTriggers.map(t => ({ type: "trigger", name: t.name, sql: `CREATE TRIGGER ${t.name} BEFORE ${t.event} ON ${t.table} FOR EACH ROW ${t.body}` }))];
  assert.deepEqual(statements, expected);
  const runner = fs.readFileSync(path.join(__dirname, "../db/migrations/2026-10-05-immutable-inventory-valuation.js"), "utf8");
  assert.doesNotMatch(runner, /require\(["'].*services\/|dotenv|db\/connection/);
  assert.match(runner, /if \(require.main === module\)/);
  assert.match(runner, /--apply-isolated-proof/);
  assert.match(runner, /host:"127\.0\.0\.1",port:3307/);
  for (const file of ["index.js", "package.json"]) assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), /immutable-inventory-valuation|inventoryValuationSchema|inventoryValuationService/);
});

test("first receipt without an explicitly approved opening rejects before all writes", async () => {
  const cx = new Fixture();
  const source = await v.createAcquisition(cx, { ...base, date: "2026-04-01", document_type: "SUPPLIER", document_id: "no-opening", source_line: "1", reference: "synthetic", idempotency_key: "no-opening-source" });
  const cost = await v.recordCost(cx, { ...base, source_id: source.id, evidence: evidence(), idempotency_key: "no-opening-cost" });
  await approve(cx, { ...base, actor_id: "2", revision_id: cost.id, reason: "approved", idempotency_key: "no-opening-review" });
  const start = cx.calls.length;
  await assert.rejects(v.postAcquisition(cx, { ...base, source_id: source.id, revision_id: cost.id, idempotency_key: "no-opening-post" }), /IV_OPENING_EVIDENCE_REQUIRED/);
  assert.ok(cx.calls.slice(start).every(([sql]) => !/^(INSERT|UPDATE|DELETE|CREATE|ALTER)/.test(sql)));
});
