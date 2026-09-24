"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  Fy6MysqlReadAdapter,
  VENDOR_COPY_COLUMNS,
  fingerprint,
} = require("./fy6c-legacy-vendor-repair-mysql-adapter");
const base = require("./fy6c-legacy-vendor-repair-runner");

const MANIFEST_PATH = path.join(__dirname, "fy6c-legacy-vendor-repair-manifest.json");
const PARTIAL_MAPPINGS = Object.freeze([
  Object.freeze({ groupId: "G1", sourceVendorId: 1, sourceCompanyId: 1, targetCompanyId: 6, targetVendorId: 11 }),
  Object.freeze({ groupId: "G2", sourceVendorId: 1, sourceCompanyId: 1, targetCompanyId: 7, targetVendorId: 12 }),
  Object.freeze({ groupId: "G3", sourceVendorId: 3, sourceCompanyId: 1, targetCompanyId: 4, targetVendorId: 13 }),
  Object.freeze({ groupId: "G4", sourceVendorId: 2, sourceCompanyId: 1, targetCompanyId: 4, targetVendorId: 14 }),
  Object.freeze({ groupId: "G5", sourceVendorId: 5, sourceCompanyId: 1, targetCompanyId: 4, targetVendorId: 15 }),
]);
const PARTIAL_DEFAULT_FIELDS = Object.freeze({
  phone: null,
  email: null,
  gst_number: null,
  address: null,
});

const fail = (code) => {
  throw Object.assign(new Error(code), { code });
};
const same = (a, b) => fingerprint(a) === fingerprint(b);
const copy = (value) => JSON.parse(JSON.stringify(value));

function validateBackup(args) {
  if (!args.backup || !args.backupSha) fail("BACKUP_REQUIRED");
  let stat;
  try { stat = fs.statSync(args.backup); } catch { fail("BACKUP_NOT_FOUND"); }
  if (!stat.isFile() || stat.size <= 0) fail("BACKUP_INVALID");
  if (stat.mtimeMs > Date.now() + 60000 || Date.now() - stat.mtimeMs > 86400000)
    fail("BACKUP_STALE");
  const actual = crypto.createHash("sha256").update(fs.readFileSync(args.backup)).digest("hex");
  if (!/^[0-9a-f]{64}$/i.test(args.backupSha) || actual !== args.backupSha.toLowerCase())
    fail("BACKUP_SHA_MISMATCH");
  return Object.freeze({ path: path.resolve(args.backup), size: stat.size, sha256: actual });
}

function expectedRecordVendorIds(manifest) {
  const groupTargets = new Map(PARTIAL_MAPPINGS.map((x) => [x.groupId, x.targetVendorId]));
  return new Map(manifest.transactions.map((x) => [
    `${x.record_type}:${x.record_id}`,
    groupTargets.get(x.group_id),
  ]));
}

function validateExactPartialPopulation(evidence, manifest) {
  if (!evidence || fingerprint({ ...evidence, fingerprint: null }) !== evidence.fingerprint)
    fail("PARTIAL_POPULATION_EVIDENCE_INVALID");
  if (evidence.billMismatches !== 0 || evidence.paymentMismatches !== 0)
    fail("PARTIAL_MISMATCH_COUNTS_INVALID");
  if (!Array.isArray(evidence.equivalentTargetVendors) || evidence.equivalentTargetVendors.length !== 0)
    fail("PARTIAL_EQUIVALENTS_INVALID");
  const expected = expectedRecordVendorIds(manifest);
  const rows = [
    ...evidence.bills.map((row) => ["BILL", row]),
    ...evidence.payments.map((row) => ["VENDOR_PAYMENT", row]),
  ];
  if (rows.length !== manifest.transactions.length) fail("PARTIAL_RECORD_SET_INVALID");
  const seen = new Set();
  for (const [type, row] of rows) {
    const key = `${type}:${row && row.id}`;
    const transaction = manifest.transactions.find((x) => `${x.record_type}:${x.record_id}` === key);
    if (!transaction || seen.has(key) || row.company_id !== transaction.expected_company_id || row.vendor_id !== expected.get(key))
      fail("PARTIAL_RECORD_IDENTITY_INVALID");
    if (type === "VENDOR_PAYMENT" && row.bill_id !== null)
      fail("PAYMENT_BILL_LINK_DRIFT");
    seen.add(key);
  }
  if (seen.size !== manifest.transactions.length) fail("PARTIAL_RECORD_SET_INVALID");
  return evidence;
}

function validatePartialVendor(source, target, mapping) {
  if (!source || !target || source.vendorId !== mapping.sourceVendorId ||
      source.companyId !== mapping.sourceCompanyId || target.vendorId !== mapping.targetVendorId ||
      target.companyId !== mapping.targetCompanyId)
    fail("PARTIAL_VENDOR_IDENTITY_INVALID");
  const differences = VENDOR_COPY_COLUMNS.filter(
    (name) => !same(source.protectedFields[name], target.protectedFields[name]),
  );
  const expectedDifferences = Object.keys(PARTIAL_DEFAULT_FIELDS);
  if (!same(differences.sort(), expectedDifferences.sort()))
    fail("PARTIAL_VENDOR_SHAPE_INVALID");
  for (const [name, expected] of Object.entries(PARTIAL_DEFAULT_FIELDS))
    if (!same(target.protectedFields[name], expected)) fail("PARTIAL_VENDOR_DEFAULT_INVALID");
  return true;
}

async function executeCompletion(adapter, manifest, productionIdentity = null) {
  const initialEvidence = await adapter.getPopulationEvidence(manifest);
  try {
    const valid = base.validatePopulationEvidence(initialEvidence, manifest);
    if (base.classifyPopulation(valid, manifest) === "ALREADY_REPAIRED")
      fail("ALREADY_REPAIRED");
    fail("COMPLETION_PARTIAL_STATE_REQUIRED");
  } catch (error) {
    if (error.message === "ALREADY_REPAIRED" ||
        error.message === "COMPLETION_PARTIAL_STATE_REQUIRED")
      throw error;
    if (error.message !== "POPULATION_MISMATCH") throw error;
  }
  const beforePopulation = validateExactPartialPopulation(
    initialEvidence, manifest,
  );
  const beforePopulationRepeat = validateExactPartialPopulation(
    await adapter.getPopulationEvidence(manifest), manifest,
  );
  if (beforePopulation.fingerprint !== beforePopulationRepeat.fingerprint)
    fail("POPULATION_DRIFT");
  const accounting = await adapter.getAccountingFingerprint();
  const stock = await adapter.getStockFingerprint();
  const schema = await adapter.getSchemaFingerprint();
  const billEvidence = new Map();
  const paymentEvidence = new Map();
  for (const t of manifest.transactions) {
    const evidence = t.record_type === "BILL"
      ? await adapter.getBillEvidence(t.record_id)
      : await adapter.getPaymentEvidence(t.record_id);
    (t.record_type === "BILL" ? billEvidence : paymentEvidence).set(t.record_id, evidence);
  }
  const sources = new Map();
  for (const mapping of PARTIAL_MAPPINGS) {
    if (!sources.has(mapping.sourceVendorId))
      sources.set(mapping.sourceVendorId, await adapter.getVendorCopyEvidence(mapping.sourceVendorId, mapping.sourceCompanyId));
    validatePartialVendor(
      sources.get(mapping.sourceVendorId),
      await adapter.getVendorCopyEvidence(mapping.targetVendorId, mapping.targetCompanyId),
      mapping,
    );
  }

  const ledgerBaseline = await adapter.getOperationLedger();
  let commitAttempted = false, committed = false;
  await adapter.beginCompletionTransaction();
  try {
    if (productionIdentity && !base.sameProductionIdentity(await adapter.getProductionIdentityEvidence(), productionIdentity))
      fail("PRODUCTION_DB_IDENTITY_DRIFT");
    if (typeof adapter.lockControlledRepairRows !== "function")
      fail("COMPLETION_ROW_LOCK_REQUIRED");
    await adapter.lockControlledRepairRows(manifest);
    validateExactPartialPopulation(await adapter.getPopulationEvidence(manifest), manifest);
    for (const mapping of PARTIAL_MAPPINGS) {
      const source = await adapter.getVendorCopyEvidence(mapping.sourceVendorId, mapping.sourceCompanyId, { lock: true });
      const target = await adapter.getVendorCopyEvidence(mapping.targetVendorId, mapping.targetCompanyId, { lock: true });
      validatePartialVendor(source, target, mapping);
      if (source.fingerprint !== sources.get(mapping.sourceVendorId).fingerprint)
        fail("SOURCE_VENDOR_DRIFT");
      await adapter.completeVendorCopy(
        mapping.sourceVendorId,
        mapping.sourceCompanyId,
        mapping.targetVendorId,
        mapping.targetCompanyId,
      );
      const completed = await adapter.getVendorCopyEvidence(mapping.targetVendorId, mapping.targetCompanyId);
      if (!completed || completed.fingerprint !== source.fingerprint || !same(completed.protectedFields, source.protectedFields))
        fail("VENDOR_COMPLETION_DRIFT");
    }
    const ledger = await adapter.getOperationLedger();
    const suffix = ledger.slice(ledgerBaseline.length);
    if (ledger.length !== ledgerBaseline.length + PARTIAL_MAPPINGS.length ||
        ledgerBaseline.some((entry, index) => !same(entry, ledger[index])) ||
        suffix.some((entry, index) => entry.sequence !== ledgerBaseline.length + index + 1 ||
          entry.groupId !== "COMPLETION" || entry.operationType !== "VENDOR_COPY_COMPLETION" ||
          entry.table !== "vendors" || entry.recordId !== PARTIAL_MAPPINGS[index].targetVendorId ||
          entry.companyId !== PARTIAL_MAPPINGS[index].targetCompanyId ||
          entry.sourceVendorId !== PARTIAL_MAPPINGS[index].sourceVendorId ||
          entry.affectedRows !== 1 || entry.state !== "ATTEMPTED"))
      fail("COMPLETION_OPERATION_LEDGER_INVALID");
    const finalPopulation = base.validatePopulationEvidence(await adapter.getPopulationEvidence(manifest), manifest);
    if (base.classifyPopulation(finalPopulation, manifest) !== "ALREADY_REPAIRED")
      fail("COMPLETION_POST_STATE_INVALID");
    for (const t of manifest.transactions) {
      const finalEvidence = t.record_type === "BILL"
        ? await adapter.getBillEvidence(t.record_id)
        : await adapter.getPaymentEvidence(t.record_id);
      const baseline = (t.record_type === "BILL" ? billEvidence : paymentEvidence).get(t.record_id);
      if (!finalEvidence || finalEvidence.fingerprint !== baseline.fingerprint ||
          finalEvidence.vendorId !== baseline.vendorId ||
          (t.record_type === "VENDOR_PAYMENT" && finalEvidence.billId !== null))
        fail(t.record_type === "BILL" ? "BILL_DRIFT" : "PAYMENT_DRIFT");
    }
    if ((await adapter.getAccountingFingerprint()) !== accounting) fail("ACCOUNTING_DRIFT");
    if ((await adapter.getStockFingerprint()) !== stock) fail("STOCK_DRIFT");
    if ((await adapter.getSchemaFingerprint()) !== schema) fail("SCHEMA_DRIFT");
    if (productionIdentity && !base.sameProductionIdentity(await adapter.getProductionIdentityEvidence(), productionIdentity))
      fail("PRODUCTION_DB_IDENTITY_DRIFT");
    commitAttempted = true;
    await adapter.commit();
    committed = true;
    const committedLedger = await adapter.getOperationLedger();
    const committedSuffix = committedLedger.slice(ledgerBaseline.length);
    if (committedSuffix.length !== PARTIAL_MAPPINGS.length ||
        committedSuffix.some((entry) => entry.state !== "COMMITTED") ||
        new Set(committedSuffix.map((entry) => entry.sequence)).size !== PARTIAL_MAPPINGS.length)
      fail("COMPLETION_OPERATION_LEDGER_INVALID");
    const postCommitPopulation = base.validatePopulationEvidence(await adapter.getPopulationEvidence(manifest), manifest);
    if (base.classifyPopulation(postCommitPopulation, manifest) !== "ALREADY_REPAIRED" ||
        (await adapter.getAccountingFingerprint()) !== accounting ||
        (await adapter.getStockFingerprint()) !== stock ||
        (await adapter.getSchemaFingerprint()) !== schema)
      fail("COMPLETION_POST_COMMIT_VERIFICATION_FAILED");
    return {
      completedVendorCopies: PARTIAL_MAPPINGS.length,
      committedLedgerEntries: committedSuffix.length,
      classification: "ALREADY_REPAIRED",
    };
  } catch (error) {
    if (commitAttempted && !committed) {
      throw Object.assign(new Error("COMMIT_OUTCOME_UNCERTAIN", { cause: error }), {
        code: "COMMIT_OUTCOME_UNCERTAIN",
      });
    }
    if (!committed) await adapter.rollback();
    throw error;
  }
}

async function run({ db, argv = process.argv.slice(2), runtimeEnv = process.env, adapterFactory } = {}) {
  const args = base.parseArgs(argv);
  if (!args.execute || !argv.includes("--complete-preserved-partial"))
    fail("COMPLETION_AUTHORIZATION_REQUIRED");
  const { manifest, hash } = base.loadManifest(MANIFEST_PATH);
  base.assertManifest(manifest);
  if (args.manifestSha !== hash) fail("EXECUTION_AUTHORIZATION_FAILED");
  const productionIdentity = base.validateProductionContext(args, runtimeEnv);
  const runtimeCommit = base.validateRuntimeCommit(args, runtimeEnv);
  const backup = validateBackup(args);
  const ownedPool = db || require("../db/connection");
  let disposableIdentity = null;
  if (args.mode === "disposable") {
    disposableIdentity = (await ownedPool.query("SELECT @@hostname host,@@port port,@@version version,DATABASE() db"))[0][0];
    base.validateIdentity(args.mode, disposableIdentity, args);
    if (args.auth !== base.AUTH) fail("EXECUTION_AUTHORIZATION_FAILED");
  }
  const adapter = adapterFactory ? adapterFactory(ownedPool) : new Fy6MysqlReadAdapter(ownedPool);
  let released = false;
  try {
    const actualIdentity = args.mode === "production"
      ? await adapter.getProductionIdentityEvidence()
      : disposableIdentity;
    base.validateIdentity(args.mode, actualIdentity, args);
    const initial = await adapter.getPopulationEvidence(manifest);
    try {
      const valid = base.validatePopulationEvidence(initial, manifest);
      if (base.classifyPopulation(valid, manifest) === "ALREADY_REPAIRED")
        fail("ALREADY_REPAIRED");
    } catch (error) {
      if (error.message !== "POPULATION_MISMATCH") throw error;
    }
    const result = await executeCompletion(adapter, manifest, productionIdentity);
    released = true;
    await adapter.release();
    return { ...result, runtimeCommit, backup };
  } catch (error) {
    if (!released) {
      try { released = true; await adapter.release(); }
      catch (cleanupError) { error.cleanupError = cleanupError; }
    }
    throw error;
  } finally {
    if (!db && ownedPool && typeof ownedPool.end === "function")
      await ownedPool.end();
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(`REFUSED: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  PARTIAL_MAPPINGS,
  PARTIAL_DEFAULT_FIELDS,
  validateExactPartialPopulation,
  validatePartialVendor,
  executeCompletion,
  run,
};
