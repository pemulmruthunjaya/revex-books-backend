"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const baseRunner = require("../scripts/fy6c-legacy-vendor-repair-runner");
const manifest = require("../scripts/fy6c-legacy-vendor-repair-manifest.json");
const {
  VENDOR_COPY_COLUMNS,
  fingerprint,
} = require("../scripts/fy6c-legacy-vendor-repair-mysql-adapter");
const {
  PARTIAL_MAPPINGS,
  validateExactPartialPopulation,
  validatePartialVendor,
  executeCompletion,
  run,
} = require("../scripts/fy6c-legacy-vendor-repair-completion-runner");

const clone = (x) => JSON.parse(JSON.stringify(x));
const fields = (id) => Object.fromEntries(VENDOR_COPY_COLUMNS.map((name) => [name, `${name}-${id}`]));
class CompletionFake {
  constructor() {
    this.vendors = new Map();
    for (const id of [1, 2, 3, 5]) this.vendors.set(id, { vendorId: id, companyId: 1, protectedFields: fields(id) });
    for (const mapping of PARTIAL_MAPPINGS) {
      const partial = clone(this.vendors.get(mapping.sourceVendorId).protectedFields);
      Object.assign(partial, { phone: null, email: null, gst_number: null, address: null });
      this.vendors.set(mapping.targetVendorId, { vendorId: mapping.targetVendorId, companyId: mapping.targetCompanyId, protectedFields: partial });
    }
    this.begins = 0; this.commits = 0; this.rollbacks = 0; this.updates = 0;
    this.inTx = false; this.released = 0; this.ledger = [];
  }
  evidence(row) { const value = clone(row); value.fingerprint = fingerprint(value.protectedFields); return value; }
  async getVendorCopyEvidence(id, company) { const row = this.vendors.get(id); return row && row.companyId === company ? this.evidence(row) : null; }
  async getPopulationEvidence() {
    const targetByGroup = new Map(PARTIAL_MAPPINGS.map((x) => [x.groupId, x.targetVendorId]));
    const equivalents = PARTIAL_MAPPINGS.filter((m) => fingerprint(this.vendors.get(m.sourceVendorId).protectedFields) === fingerprint(this.vendors.get(m.targetVendorId).protectedFields)).map((m) => ({
      groupId: m.groupId, sourceVendorId: m.sourceVendorId, sourceCompanyId: 1,
      targetCompanyId: m.targetCompanyId, equivalentVendorId: m.targetVendorId,
      sourceFingerprint: fingerprint(this.vendors.get(m.sourceVendorId).protectedFields),
      equivalentFingerprint: fingerprint(this.vendors.get(m.targetVendorId).protectedFields),
    }));
    const bills = manifest.transactions.filter((x) => x.record_type === "BILL").map((x) => ({ id: x.record_id, company_id: x.expected_company_id, vendor_id: targetByGroup.get(x.group_id) }));
    const payments = manifest.transactions.filter((x) => x.record_type === "VENDOR_PAYMENT").map((x) => ({ id: x.record_id, company_id: x.expected_company_id, vendor_id: targetByGroup.get(x.group_id), bill_id: null }));
    const value = { billMismatches: 0, paymentMismatches: 0, bills, payments, equivalentTargetVendors: equivalents, fingerprint: null };
    value.fingerprint = fingerprint(value); return clone(value);
  }
  async getAccountingFingerprint() { return "accounting"; }
  async getStockFingerprint() { return "stock"; }
  async getSchemaFingerprint() { return "schema"; }
  async getBillEvidence(id) { const p = (await this.getPopulationEvidence()).bills.find((x) => x.id === id); return { recordId: id, vendorId: p.vendor_id, protectedFields: { id }, fingerprint: fingerprint({ id }) }; }
  async getPaymentEvidence(id) { const p = (await this.getPopulationEvidence()).payments.find((x) => x.id === id); return { recordId: id, vendorId: p.vendor_id, billId: p.bill_id, protectedFields: { id, bill_id: null }, fingerprint: fingerprint({ id, bill_id: null }) }; }
  async beginCompletionTransaction() { this.begins++; this.inTx = true; this.snapshot = clone([...this.vendors]); }
  async lockControlledRepairRows() { return true; }
  async getOperationLedger() { return clone(this.ledger); }
  async completeVendorCopy(source, sourceCompany, target, targetCompany) {
    assert.equal(this.inTx, true); const s = this.vendors.get(source), t = this.vendors.get(target);
    assert.equal(s.companyId, sourceCompany); assert.equal(t.companyId, targetCompany);
    t.protectedFields = clone(s.protectedFields); this.updates++;
    this.ledger.push({ sequence: this.ledger.length + 1, groupId: "COMPLETION", operationType: "VENDOR_COPY_COMPLETION", table: "vendors", recordId: target, companyId: targetCompany, sourceVendorId: source, affectedRows: 1, state: "ATTEMPTED" });
    return { affectedRows: 1 };
  }
  async commit() { this.commits++; this.ledger.forEach((x) => { x.state = "COMMITTED"; }); this.inTx = false; }
  async rollback() { this.rollbacks++; this.vendors = new Map(this.snapshot); this.ledger.forEach((x) => { if (x.state === "ATTEMPTED") x.state = "ROLLED_BACK"; }); this.inTx = false; }
  async release() { this.released++; }
}

test("exact preserved Vendors 11-15 partial state is accepted", async () => {
  const a = new CompletionFake();
  assert.equal(validateExactPartialPopulation(await a.getPopulationEvidence(), manifest).billMismatches, 0);
  for (const mapping of PARTIAL_MAPPINGS)
    assert.equal(validatePartialVendor(await a.getVendorCopyEvidence(mapping.sourceVendorId, 1), await a.getVendorCopyEvidence(mapping.targetVendorId, mapping.targetCompanyId), mapping), true);
});
test("one guarded completion changes only five vendor copies and reaches ALREADY_REPAIRED", async () => {
  const a = new CompletionFake();
  const beforeBills = clone((await a.getPopulationEvidence()).bills), beforePayments = clone((await a.getPopulationEvidence()).payments);
  const result = await executeCompletion(a, manifest);
  assert.deepEqual(result, { completedVendorCopies: 5, committedLedgerEntries: 5, classification: "ALREADY_REPAIRED" });
  assert.deepEqual([a.begins, a.updates, a.commits, a.rollbacks], [1, 5, 1, 0]);
  const after = await a.getPopulationEvidence();
  assert.equal(after.equivalentTargetVendors.length, 5);
  assert.deepEqual(after.bills, beforeBills); assert.deepEqual(after.payments, beforePayments);
  assert.ok(after.payments.every((x) => x.bill_id === null));
  await assert.rejects(executeCompletion(a, manifest), /ALREADY_REPAIRED/);
  assert.deepEqual([a.begins, a.updates, a.commits], [1, 5, 1]);
});
test("wrong target id, reference, or copied-field shape refuses before BEGIN", async () => {
  for (const mutate of [
    (a) => { a.vendors.get(11).vendorId = 99; },
    (a) => { a.getPopulationEvidence = async () => { const e = await CompletionFake.prototype.getPopulationEvidence.call(a); e.bills[0].vendor_id = 12; e.fingerprint = fingerprint({ ...e, fingerprint: null }); return e; }; },
    (a) => { a.vendors.get(11).protectedFields.pan_number = null; },
  ]) {
    const a = new CompletionFake(); mutate(a);
    await assert.rejects(executeCompletion(a, manifest), /PARTIAL_/);
    assert.equal(a.begins, 0); assert.equal(a.updates, 0);
  }
});
test("non-null Payment bill link refuses before BEGIN", async () => {
  const a = new CompletionFake(), get = a.getPopulationEvidence.bind(a);
  a.getPopulationEvidence = async () => { const e = await get(); e.payments[0].bill_id = 3; e.fingerprint = fingerprint({ ...e, fingerprint: null }); return e; };
  await assert.rejects(executeCompletion(a, manifest), /PAYMENT_BILL_LINK_DRIFT/);
  assert.equal(a.begins, 0);
});
test("drift during completion rolls back all vendor updates", async () => {
  const a = new CompletionFake(), original = a.completeVendorCopy.bind(a);
  a.completeVendorCopy = async (...args) => { const out = await original(...args); if (args[2] === 13) a.vendors.get(13).protectedFields.name = "drift"; return out; };
  await assert.rejects(executeCompletion(a, manifest), /VENDOR_COMPLETION_DRIFT/);
  assert.deepEqual([a.commits, a.rollbacks], [0, 1]);
  assert.equal((await a.getPopulationEvidence()).equivalentTargetVendors.length, 0);
});
test("uncertain COMMIT is never rolled back or retried", async () => {
  const a = new CompletionFake();
  a.commit = async () => { a.commits++; throw Error("socket lost"); };
  await assert.rejects(executeCompletion(a, manifest), (error) => error.code === "COMMIT_OUTCOME_UNCERTAIN");
  assert.deepEqual([a.commits, a.rollbacks, a.updates], [1, 0, 5]);
});
test("guarded disposable completion runs once then refuses ALREADY_REPAIRED before BEGIN", async () => {
  const a = new CompletionFake(), commit = "0123456789abcdef0123456789abcdef01234567";
  const backup = path.join(os.tmpdir(), `fy6-completion-${process.pid}.sql`);
  fs.writeFileSync(backup, "verified disposable backup");
  const backupSha = require("node:crypto").createHash("sha256").update(fs.readFileSync(backup)).digest("hex");
  const dbName = "revex_fy6c6e_vendor_repair_dryrun_completion_test";
  const db = { query: async () => [[{ host: "LOCAL-MYSQL", port: 3307, version: "8.0.44", db: dbName }]] };
  const argv = ["--execute", "--complete-preserved-partial", "--identity-mode=disposable", "--allow-disposable-proof", `--authorization=${baseRunner.AUTH}`, `--disposable-db=${dbName}`, "--disposable-host=127.0.0.1", "--disposable-server-hostname=LOCAL-MYSQL", "--disposable-version=8.0.44", `--manifest-sha=${baseRunner.loadManifest().hash}`, `--expected-runtime-commit=${commit}`, `--backup=${backup}`, `--backup-sha=${backupSha}`];
  try {
    const result = await run({ db, argv, runtimeEnv: { FY6_DEPLOYED_RUNTIME_COMMIT: commit }, adapterFactory: () => a });
    assert.equal(result.classification, "ALREADY_REPAIRED");
    assert.deepEqual([a.begins, a.commits, a.updates, a.released], [1, 1, 5, 1]);
    await assert.rejects(run({ db, argv, runtimeEnv: { FY6_DEPLOYED_RUNTIME_COMMIT: commit }, adapterFactory: () => a }), /ALREADY_REPAIRED/);
    assert.deepEqual([a.begins, a.commits, a.updates, a.released], [1, 1, 5, 2]);
  } finally { fs.unlinkSync(backup); }
});
test("completion authorization and identity failures occur before adapter creation", async () => {
  const commit = "0123456789abcdef0123456789abcdef01234567", dbName = "revex_fy6c6e_vendor_repair_dryrun_completion_test";
  let adapters = 0;
  const db = { query: async () => [[{ host: "WRONG", port: 3307, version: "8.0.44", db: dbName }]] };
  await assert.rejects(run({ db, argv: ["--execute"], runtimeEnv: { FY6_DEPLOYED_RUNTIME_COMMIT: commit }, adapterFactory: () => { adapters++; return new CompletionFake(); } }), /COMPLETION_AUTHORIZATION_REQUIRED/);
  assert.equal(adapters, 0);
});
test("completion runner is import-inert and absent from startup and migrations", () => {
  const scriptName = "fy6c-legacy-vendor-repair-completion-runner";
  for (const file of ["package.json", "index.js", "server.js", "railway.json"])
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), new RegExp(scriptName));
  for (const file of fs.readdirSync(path.join(__dirname, "../db/migrations")))
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "../db/migrations", file), "utf8"), new RegExp(scriptName));
});
