"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const {
  Fy6MysqlReadAdapter,
  fingerprint: populationFingerprint,
} = require("./fy6c-legacy-vendor-repair-mysql-adapter");
const MANIFEST_PATH = path.join(
    __dirname,
    "fy6c-legacy-vendor-repair-manifest.json",
  ),
  AUTH = "FY6C-6D-EXPLICIT-REPAIR-AUTH",
  EXPECTED_DB = "railway",
  EXPECTED_HOST = "55457156b444",
  EXPECTED_MYSQL = "9.4.0",
  DISPOSABLE_PREFIX = "revex_fy6c6e_vendor_repair_dryrun_",
  DISPOSABLE_REGEX =
    /^revex_fy6c6e_vendor_repair_dryrun_[a-z0-9][a-z0-9_-]{0,47}$/;
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
function loadManifest(file = MANIFEST_PATH) {
  const raw = fs.readFileSync(file, "utf8");
  return { raw, manifest: JSON.parse(raw), hash: sha(raw) };
}
function sourceCanonical(x) {
  if (x && typeof x === "object") {
    if (Array.isArray(x))
      return "[" + x.map(sourceCanonical).sort().join(",") + "]";
    return (
      "{" +
      Object.keys(x)
        .sort()
        .map((k) => k + ":" + sourceCanonical(x[k]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(x);
}
function validateSourceBaseline(e, g) {
  if (
    !e ||
    typeof e !== "object" ||
    Array.isArray(e) ||
    e.vendorId !== g.source_vendor_id ||
    e.companyId !== g.source_vendor_company_id ||
    typeof e.fingerprint !== "string" ||
    !/^[0-9a-f]{64}$/.test(e.fingerprint) ||
    !e.protectedFields ||
    typeof e.protectedFields !== "object" ||
    Array.isArray(e.protectedFields) ||
    populationFingerprint(e.protectedFields) !== e.fingerprint
  )
    throw Object.assign(new Error("SOURCE_VENDOR_DRIFT"), {
      code: "SOURCE_VENDOR_DRIFT",
    });
  return e;
}
function validateBillBaseline(e, t) {
  if (
    !e ||
    typeof e !== "object" ||
    Array.isArray(e) ||
    e.recordType !== "BILL" ||
    e.recordId !== t.record_id ||
    e.companyId !== t.expected_company_id ||
    e.vendorId !== t.expected_current_vendor_id ||
    !e.protectedFields ||
    typeof e.protectedFields !== "object" ||
    Array.isArray(e.protectedFields) ||
    typeof e.fingerprint !== "string" ||
    !/^[0-9a-f]{64}$/.test(e.fingerprint) ||
    populationFingerprint(e.protectedFields) !== e.fingerprint
  )
    throw Object.assign(new Error("BILL_EVIDENCE_INVALID"), {
      code: "BILL_EVIDENCE_INVALID",
    });
  return e;
}
function validateBillFinal(e, t) {
  try {
    return validateBillBaseline(e, t);
  } catch (c) {
    throw Object.assign(new Error("BILL_DRIFT", { cause: c }), {
      code: "BILL_DRIFT",
      cause: c,
    });
  }
}
function validatePaymentBaseline(e, t) {
  if (
    !e ||
    typeof e !== "object" ||
    Array.isArray(e) ||
    e.recordType !== "VENDOR_PAYMENT" ||
    e.recordId !== t.record_id ||
    e.companyId !== t.expected_company_id ||
    e.vendorId !== t.expected_current_vendor_id ||
    e.billId !== null
  )
    throw Object.assign(
      new Error(
        e && e.billId !== null
          ? "PAYMENT_BILL_LINK_DRIFT"
          : "PAYMENT_EVIDENCE_INVALID",
      ),
      {
        code:
          e && e.billId !== null
            ? "PAYMENT_BILL_LINK_DRIFT"
            : "PAYMENT_EVIDENCE_INVALID",
      },
    );
  if (
    !e.protectedFields ||
    typeof e.protectedFields !== "object" ||
    Array.isArray(e.protectedFields) ||
    typeof e.fingerprint !== "string" ||
    !/^[0-9a-f]{64}$/.test(e.fingerprint) ||
    populationFingerprint(e.protectedFields) !== e.fingerprint
  )
    throw Object.assign(new Error("PAYMENT_EVIDENCE_INVALID"), {
      code: "PAYMENT_EVIDENCE_INVALID",
    });
  return e;
}
function validatePaymentFinal(e, t) {
  try {
    return validatePaymentBaseline(e, t);
  } catch (c) {
    if (c.code === "PAYMENT_BILL_LINK_DRIFT") throw c;
    throw Object.assign(new Error("PAYMENT_DRIFT", { cause: c }), {
      code: "PAYMENT_DRIFT",
      cause: c,
    });
  }
}
function validateLedger(entries, g) {
  if (
    !Array.isArray(entries) ||
    entries.some(
      (e, i) =>
        !e ||
        typeof e !== "object" ||
        !Number.isInteger(e.sequence) ||
        e.sequence <= 0 ||
        (i && e.sequence <= entries[i - 1].sequence),
    )
  )
    throw Object.assign(new Error("OPERATION_LEDGER_INVALID"), {
      code: "OPERATION_LEDGER_INVALID",
    });
}
function validateLedgerExact(entries, g, id, manifest) {
  validateLedger(entries, g);
  const a = entries.filter(
    (e) => e.groupId === g.group_id && e.state === "ATTEMPTED",
  );
  if (
    a.some(
      (e) =>
        e.groupId !== g.group_id ||
        e.state !== "ATTEMPTED" ||
        !["VENDOR_INSERT", "BILL_UPDATE", "VENDOR_PAYMENT_UPDATE"].includes(
          e.operationType,
        ) ||
        !["vendors", "bills", "vendor_payments"].includes(e.entity || e.table),
    )
  )
    throw Object.assign(new Error("UNAUTHORIZED_OPERATION"), {
      code: "UNAUTHORIZED_OPERATION",
    });
  const expected = 1 + g.records.length;
  if (
    a.length !== expected ||
    a.filter((e) => e.operationType === "VENDOR_INSERT").length !== 1 ||
    a.filter((e) => e.operationType === "BILL_UPDATE").length !==
      g.records.filter((r) => r.record_type === "BILL").length ||
    a.filter((e) => e.operationType === "VENDOR_PAYMENT_UPDATE").length !==
      g.records.filter((r) => r.record_type !== "BILL").length
  )
    throw Object.assign(new Error("OPERATION_COUNT_MISMATCH"), {
      code: "OPERATION_COUNT_MISMATCH",
    });
  const v = a.find((e) => e.operationType === "VENDOR_INSERT");
  if (
    !v ||
    v.recordId !== id ||
    v.companyId !== g.target_company_id ||
    v.sourceVendorId !== g.source_vendor_id
  )
    throw Object.assign(new Error("UNAUTHORIZED_OPERATION"), {
      code: "UNAUTHORIZED_OPERATION",
    });
  for (const r of g.records) {
    const t = manifest.transactions.find(
      (x) => x.record_type === r.record_type && x.record_id === r.record_id,
    );
    const e = a.find(
      (x) =>
        x.recordId === r.record_id &&
        x.operationType ===
          (r.record_type === "BILL" ? "BILL_UPDATE" : "VENDOR_PAYMENT_UPDATE"),
    );
    if (
      !e ||
      e.companyId !== t.expected_company_id ||
      e.oldVendorId !== t.expected_current_vendor_id ||
      e.newVendorId !== id
    )
      throw Object.assign(new Error("UNAUTHORIZED_OPERATION"), {
        code: "UNAUTHORIZED_OPERATION",
      });
  }
}
function sourceCanonical(x) {
  if (x && typeof x === "object") {
    if (Array.isArray(x))
      return "[" + x.map(sourceCanonical).sort().join(",") + "]";
    return (
      "{" +
      Object.keys(x)
        .sort()
        .map((k) => k + ":" + sourceCanonical(x[k]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(x);
}
function validateSourceBaseline(e, g) {
  if (
    !e ||
    typeof e !== "object" ||
    Array.isArray(e) ||
    !Number.isInteger(e.vendorId) ||
    e.vendorId <= 0 ||
    e.vendorId !== g.source_vendor_id ||
    !Number.isInteger(e.companyId) ||
    e.companyId <= 0 ||
    e.companyId !== g.source_vendor_company_id ||
    !e.protectedFields ||
    typeof e.protectedFields !== "object" ||
    Array.isArray(e.protectedFields) ||
    typeof e.fingerprint !== "string" ||
    !/^[0-9a-f]{64}$/.test(e.fingerprint) ||
    populationFingerprint(e.protectedFields) !== e.fingerprint
  )
    throw Object.assign(new Error("SOURCE_VENDOR_EVIDENCE_INVALID"), {
      code: "SOURCE_VENDOR_EVIDENCE_INVALID",
    });
  return e;
}
function canonicalEvidence(x) {
  if (x && typeof x === "object") {
    if (Array.isArray(x))
      return "[" + x.map(canonicalEvidence).sort().join(",") + "]";
    return (
      "{" +
      Object.keys(x)
        .sort()
        .map((k) => k + ":" + canonicalEvidence(x[k]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(x);
}
function validateSourceEvidence(e, g) {
  if (
    !e ||
    typeof e !== "object" ||
    Array.isArray(e) ||
    e.vendorId !== g.source_vendor_id ||
    e.companyId !== g.source_vendor_company_id ||
    typeof e.fingerprint !== "string" ||
    !/^[0-9a-f]{64}$/.test(e.fingerprint) ||
    !e.protectedFields ||
    typeof e.protectedFields !== "object" ||
    Array.isArray(e.protectedFields) ||
    populationFingerprint(e.protectedFields) !== e.fingerprint
  )
    throw Error("SOURCE_VENDOR_EVIDENCE_INVALID");
  return e;
}
function assertManifest(m) {
  if (m.groups?.length !== 5 || m.transactions?.length !== 8)
    throw Error("MANIFEST_SHAPE");
  if (
    new Set(m.transactions.map((x) => `${x.record_type}:${x.record_id}`))
      .size !== 8
  )
    throw Error("MANIFEST_DUPLICATE");
}
function parseArgs(argv) {
  const get = (p) => argv.find((x) => x.startsWith(p))?.slice(p.length);
  return {
    execute: argv.includes("--execute"),
    auth: get("--authorization="),
    db: get("--expected-db="),
    manifestSha: get("--manifest-sha="),
    runtimeCommit: get("--runtime-commit="),
    expectedRuntimeCommit: get("--expected-runtime-commit="),
    backup: get("--backup="),
    backupSha: get("--backup-sha="),
    mode: get("--identity-mode="),
    disposableDb: get("--disposable-db="),
    disposableHost: get("--disposable-host="),
    disposableServerHostname: get("--disposable-server-hostname="),
    disposableVersion: get("--disposable-version="),
    allowDisposable: argv.includes("--allow-disposable-proof"),
  };
}
function validateRuntimeCommit(a,env=process.env){const actual=env.FY6_DEPLOYED_RUNTIME_COMMIT;if(!actual||!a.expectedRuntimeCommit)throw Error("RUNTIME_COMMIT_REQUIRED");if(!/^[0-9a-f]{40}$/i.test(actual)||!/^[0-9a-f]{40}$/i.test(a.expectedRuntimeCommit))throw Error("RUNTIME_COMMIT_INVALID");const x=Buffer.from(actual.toLowerCase()),y=Buffer.from(a.expectedRuntimeCommit.toLowerCase());if(x.length!==y.length||!crypto.timingSafeEqual(x,y))throw Error("RUNTIME_COMMIT_MISMATCH");return actual.toLowerCase()}
function validateBackup(a){if(!a.backup||!a.backupSha)throw Error("BACKUP_REQUIRED");let st;try{st=fs.statSync(a.backup)}catch{throw Error("BACKUP_NOT_FOUND")}if(!st.isFile())throw Error("BACKUP_INVALID");if(st.size<=0)throw Error("BACKUP_EMPTY");if(st.mtimeMs>Date.now()+60000||Date.now()-st.mtimeMs>86400000)throw Error("BACKUP_STALE");const actual=sha(fs.readFileSync(a.backup));if(!/^[0-9a-f]{64}$/i.test(a.backupSha)||actual!==a.backupSha.toLowerCase())throw Error("BACKUP_SHA_MISMATCH");return {path:path.resolve(a.backup),size:st.size,mtime:st.mtime.toISOString(),sha256:actual}}
function populationMismatch() {
  throw Object.assign(new Error("POPULATION_MISMATCH"), {
    code: "POPULATION_MISMATCH",
  });
}
function analyzePopulation(e, manifest) {
  const groups = new Map(manifest.groups.map((g) => [g.group_id, g]));
  const transactions = new Map(
    manifest.transactions.map((t) => [
      `${t.record_type}:${t.record_id}`,
      t,
    ]),
  );
  const expectedBillIds = manifest.transactions
    .filter((t) => t.record_type === "BILL")
    .map((t) => t.record_id)
    .sort((a, b) => a - b);
  const expectedPaymentIds = manifest.transactions
    .filter((t) => t.record_type === "VENDOR_PAYMENT")
    .map((t) => t.record_id)
    .sort((a, b) => a - b);
  const actualBillIds = e.bills.map((x) => x?.id).sort((a, b) => a - b);
  const actualPaymentIds = e.payments
    .map((x) => x?.id)
    .sort((a, b) => a - b);
  if (
    JSON.stringify(actualBillIds) !== JSON.stringify(expectedBillIds) ||
    JSON.stringify(actualPaymentIds) !== JSON.stringify(expectedPaymentIds)
  )
    populationMismatch();

  const equivalents = new Map();
  const equivalentIds = new Set();
  for (const value of e.equivalentTargetVendors) {
    const group = value && groups.get(value.groupId);
    if (
      !group ||
      equivalents.has(value.groupId) ||
      !Number.isInteger(value.equivalentVendorId) ||
      value.equivalentVendorId <= 0 ||
      value.equivalentVendorId === group.source_vendor_id ||
      equivalentIds.has(value.equivalentVendorId) ||
      value.sourceVendorId !== group.source_vendor_id ||
      value.sourceCompanyId !== group.source_vendor_company_id ||
      value.targetCompanyId !== group.target_company_id ||
      typeof value.sourceFingerprint !== "string" ||
      !/^[0-9a-f]{64}$/.test(value.sourceFingerprint) ||
      value.equivalentFingerprint !== value.sourceFingerprint
    )
      populationMismatch();
    equivalents.set(value.groupId, value.equivalentVendorId);
    equivalentIds.add(value.equivalentVendorId);
  }

  let billMismatches = 0;
  let paymentMismatches = 0;
  let sourceRows = 0;
  let equivalentRows = 0;
  const inspect = (row, recordType) => {
    if (!row || typeof row !== "object" || Array.isArray(row))
      populationMismatch();
    const transaction = transactions.get(`${recordType}:${row.id}`);
    const group = manifest.groups.find((g) =>
      g.records.some(
        (r) => r.record_type === recordType && r.record_id === row.id,
      ),
    );
    if (!transaction || !group || row.company_id !== transaction.expected_company_id)
      populationMismatch();
    if (recordType === "VENDOR_PAYMENT" && row.bill_id !== null)
      populationMismatch();
    if (row.vendor_id === transaction.expected_current_vendor_id) {
      sourceRows += 1;
      if (recordType === "BILL") billMismatches += 1;
      else paymentMismatches += 1;
      return;
    }
    if (row.vendor_id === equivalents.get(group.group_id)) {
      equivalentRows += 1;
      return;
    }
    populationMismatch();
  };
  e.bills.forEach((row) => inspect(row, "BILL"));
  e.payments.forEach((row) => inspect(row, "VENDOR_PAYMENT"));
  if (
    e.billMismatches !== billMismatches ||
    e.paymentMismatches !== paymentMismatches
  )
    populationMismatch();

  const totalRows = e.bills.length + e.payments.length;
  if (equivalents.size === 0 && sourceRows === totalRows) return "PRISTINE";
  if (
    equivalents.size === groups.size &&
    equivalentRows === totalRows &&
    sourceRows === 0
  )
    return "ALREADY_REPAIRED";
  return "PARTIAL_PRIOR_RUN";
}
function validatePopulationEvidence(e, manifest) {
  if (
    !e ||
    typeof e !== "object" ||
    Array.isArray(e) ||
    !Array.isArray(e.bills) ||
    !Array.isArray(e.payments) ||
    !Array.isArray(e.equivalentTargetVendors) ||
    !Number.isInteger(e.billMismatches) ||
    e.billMismatches < 0 ||
    !Number.isInteger(e.paymentMismatches) ||
    e.paymentMismatches < 0 ||
    typeof e.fingerprint !== "string" ||
    !/^[0-9a-f]{64}$/.test(e.fingerprint) ||
    populationFingerprint({ ...e, fingerprint: null }) !== e.fingerprint
  )
    throw Object.assign(new Error("POPULATION_EVIDENCE_INVALID"), {
      code: "POPULATION_EVIDENCE_INVALID",
    });
  analyzePopulation(e, manifest);
  return e;
}
function classifyPopulation(e, manifest) {
  try {
    return analyzePopulation(e, manifest);
  } catch {
    return "POPULATION_MISMATCH";
  }
}
function validateIdentity(mode, actual, a) {
  if (mode === "production") {
    if (
      a.db !== EXPECTED_DB ||
      actual.db !== EXPECTED_DB ||
      actual.host !== EXPECTED_HOST ||
      String(actual.version) !== EXPECTED_MYSQL
    )
      throw Error("IDENTITY_MISMATCH");
    return;
  }
  if (mode !== "disposable") throw Error("IDENTITY_MODE_REQUIRED");
  if (
    !a.allowDisposable ||
    !a.disposableDb ||
    !DISPOSABLE_REGEX.test(a.disposableDb)
  )
    throw Error("DISPOSABLE_AUTHORIZATION_FAILED");
  if (
    !["127.0.0.1", "localhost"].includes(a.disposableHost) ||
    typeof a.disposableServerHostname !== "string" ||
    a.disposableServerHostname.length === 0 ||
    a.disposableVersion !== "8.0.44" ||
    actual.host !== a.disposableServerHostname ||
    Number(actual.port) !== 3307 ||
    actual.db !== a.disposableDb ||
    String(actual.version) !== a.disposableVersion
  )
    throw Error("DISPOSABLE_IDENTITY_MISMATCH");
}
async function executeRepair(adapter, manifest, options = {}) {
  const typed = options.requireTypedEvidence === true;
  if (
    typed &&
    options.requirePaymentPostState === true &&
    typeof adapter.getPaymentEvidence !== "function"
  )
    throw Object.assign(new Error("PAYMENT_EVIDENCE_REQUIRED"), {
      code: "PAYMENT_EVIDENCE_REQUIRED",
    });
  if (
    typed &&
    options.requireOperationLedger === true &&
    typeof adapter.getOperationLedger !== "function"
  )
    throw Object.assign(new Error("OPERATION_LEDGER_REQUIRED"), {
      code: "OPERATION_LEDGER_REQUIRED",
    });
  if (
    (options.requireBillPostState === true ||
      options.requirePaymentPostState === true ||
      options.requireOperationLedger === true) &&
    !typed
  )
    throw Object.assign(new Error("TYPED_EVIDENCE_PREREQUISITE_REQUIRED"), {
      code: "TYPED_EVIDENCE_PREREQUISITE_REQUIRED",
    });
  if (typed && typeof adapter.getSourceVendorEvidence !== "function")
    throw Object.assign(new Error("SOURCE_VENDOR_EVIDENCE_REQUIRED"), {
      code: "SOURCE_VENDOR_EVIDENCE_REQUIRED",
    });
  const strict = options.requireAccountingFingerprint === true;
  if (
    typed &&
    options.requireOperationLedger === true &&
    typeof adapter.getOperationLedger !== "function"
  )
    throw Object.assign(new Error("OPERATION_LEDGER_REQUIRED"), {
      code: "OPERATION_LEDGER_REQUIRED",
    });
  if (typed) {
    for (const k of [
      "getSourceVendorEvidence",
      "getBillEvidence",
      "getPaymentEvidence",
      "getOperationLedger",
    ]) {
      if (typeof adapter[k] !== "function")
        throw Error("TYPED_EVIDENCE_REQUIRED");
    }
  }
  const stockStrict = options.requireStockFingerprint === true;
  const schemaStrict = options.requireSchemaFingerprint === true;
  if (schemaStrict && typeof adapter.getSchemaFingerprint !== "function")
    throw Error("SCHEMA_FINGERPRINT_REQUIRED");
  if (stockStrict && typeof adapter.getStockFingerprint !== "function")
    throw Error("STOCK_FINGERPRINT_REQUIRED");
  if (strict && typeof adapter.getAccountingFingerprint !== "function")
    throw Error("ACCOUNTING_FINGERPRINT_REQUIRED");
  const s = await adapter.getInitialState(manifest);
  if (s.billMismatches !== 6 || s.paymentMismatches !== 2)
    throw Error("MISMATCH_COUNT");
  for (const g of manifest.groups) {
    await adapter.beginTransaction(g.group_id);
    const accountingBaseline = strict
      ? await adapter.getAccountingFingerprint()
      : null;
    const stockBaseline = stockStrict
      ? await adapter.getStockFingerprint()
      : null;
    const schemaBaseline = schemaStrict
      ? await adapter.getSchemaFingerprint()
      : null;
    if (schemaStrict && (typeof schemaBaseline !== "string" || !schemaBaseline))
      throw Error("SCHEMA_FINGERPRINT_INVALID");
    try {
      const billBaselines = {},
        paymentBaselines = {},
        ledgerBaseline =
          typed && options.requireOperationLedger === true
            ? await adapter.getOperationLedger()
            : null;
      const src = await adapter.getVendorById(
        g.source_vendor_id,
        g.source_vendor_company_id,
      );
      const sourceBaseline = typed
        ? validateSourceBaseline(
            await adapter.getSourceVendorEvidence(
              g.source_vendor_id,
              g.source_vendor_company_id,
            ),
            g,
          )
        : null;
      if (typed && typeof adapter.getSourceVendorEvidence !== "function")
        throw Object.assign(new Error("SOURCE_VENDOR_EVIDENCE_REQUIRED"), {
          code: "SOURCE_VENDOR_EVIDENCE_REQUIRED",
        });
      if (
        !src ||
        (await adapter.findEquivalentVendorInCompany(src, g.target_company_id))
      )
        throw Error("VENDOR_PRECONDITION");
      for (const r of g.records) {
        const t = manifest.transactions.find(
          (x) => x.record_type === r.record_type && x.record_id === r.record_id,
        );
        if (
          typed &&
          adapter.strictTyped &&
          r.record_type === "BILL" &&
          typeof adapter.getBillEvidence !== "function"
        )
          throw Object.assign(new Error("BILL_EVIDENCE_REQUIRED"), {
            code: "BILL_EVIDENCE_REQUIRED",
          });
        if (typed && adapter.strictTyped && r.record_type === "BILL") {
          billBaselines[r.record_id] = validateBillBaseline(
            await adapter.getBillEvidence(r.record_id),
            t,
          );
        }
        if (
          typed &&
          options.requirePaymentPostState === true &&
          r.record_type !== "BILL"
        ) {
          if (typeof adapter.getPaymentEvidence !== "function")
            throw Object.assign(new Error("PAYMENT_EVIDENCE_REQUIRED"), {
              code: "PAYMENT_EVIDENCE_REQUIRED",
            });
          paymentBaselines[r.record_id] = validatePaymentBaseline(
            await adapter.getPaymentEvidence(r.record_id),
            t,
          );
        }
        const row =
          r.record_type === "BILL"
            ? await adapter.getBillForRepair(r.record_id)
            : await adapter.getVendorPaymentForRepair(r.record_id);
        if (
          !t ||
          !row ||
          row.company_id !== t.expected_company_id ||
          row.vendor_id !== t.expected_current_vendor_id ||
          row.vendor_company_id !== t.expected_current_vendor_company_id ||
          row.financial_year_id !== t.expected_financial_year_id ||
          row.transaction_date !== t.expected_transaction_date ||
          row.status !== t.expected_status ||
          (r.record_type !== "BILL" && row.bill_id !== null)
        )
          throw Error("PRECONDITION_MISMATCH");
      }
      const id = await adapter.insertVendorCopy(src, g.target_company_id);
      if (typed) {
        if (
          !id ||
          Array.isArray(id) ||
          id.operationType !== "VENDOR_INSERT" ||
          id.table !== "vendors" ||
          id.groupId !== g.group_id ||
          !Number.isInteger(id.recordId) ||
          id.recordId <= 0 ||
          id.companyId !== g.target_company_id ||
          id.sourceVendorId !== g.source_vendor_id ||
          typeof id.copiedFingerprint !== "string" ||
          !/^[0-9a-f]{64}$/.test(id.copiedFingerprint)
        )
          throw Error("TYPED_MUTATION_EVIDENCE_INVALID");
      } else if (!Number.isInteger(id) || id <= 0)
        throw Error("VENDOR_INSERT_INVALID");
      const insertedVendorId = typed ? id.recordId : id;
      for (const r of g.records) {
        const t = manifest.transactions.find(
          (x) => x.record_type === r.record_type && x.record_id === r.record_id,
        );
        const n =
          r.record_type === "BILL"
            ? await adapter.updateBillVendor(
                r.record_id,
                t.expected_company_id,
                t.expected_current_vendor_id,
                insertedVendorId,
              )
            : await adapter.updateVendorPaymentVendor(
                r.record_id,
                t.expected_company_id,
                t.expected_current_vendor_id,
                insertedVendorId,
              );
        if (typed) {
          if (
            !n ||
            Array.isArray(n) ||
            n.operationType !==
              (r.record_type === "BILL"
                ? "BILL_UPDATE"
                : "VENDOR_PAYMENT_UPDATE") ||
            n.table !==
              (r.record_type === "BILL" ? "bills" : "vendor_payments") ||
            n.groupId !== g.group_id ||
            n.recordId !== r.record_id ||
            n.companyId !== t.expected_company_id ||
            n.oldVendorId !== t.expected_current_vendor_id ||
            n.newVendorId !== insertedVendorId ||
            n.affectedRows !== 1
          )
            throw Error("TYPED_MUTATION_EVIDENCE_INVALID");
        } else if (n !== 1) throw Error("UPDATE_ROW_COUNT");
      }
      await adapter.verifyGroupPostState(g, insertedVendorId);
      if (typed && options.requireOperationLedger === true) {
        const ledgerNow = await adapter.getOperationLedger();
        const expectedSuffix = 1 + g.records.length;
        if (
          !Array.isArray(ledgerBaseline) ||
          ledgerNow.length !== ledgerBaseline.length + expectedSuffix ||
          ledgerBaseline.some(
            (e, i) => sourceCanonical(e) !== sourceCanonical(ledgerNow[i]),
          )
        )
          throw Object.assign(new Error("OPERATION_LEDGER_INVALID"), {
            code: "OPERATION_LEDGER_INVALID",
          });
        validateLedgerExact(
          ledgerNow.slice(ledgerBaseline.length),
          g,
          insertedVendorId,
          manifest,
        );
      }
      if (
        typed &&
        options.requirePaymentPostState === true &&
        adapter.strictTyped
      ) {
        for (const r of g.records.filter((x) => x.record_type !== "BILL")) {
          const t = manifest.transactions.find(
            (x) =>
              x.record_type === r.record_type && x.record_id === r.record_id,
          );
          const final = validatePaymentFinal(
            await adapter.getPaymentEvidence(r.record_id),
            { ...t, expected_current_vendor_id: insertedVendorId },
          );
          const base = paymentBaselines[r.record_id];
          if (
            final.vendorId !== insertedVendorId ||
            final.fingerprint !== base.fingerprint ||
            sourceCanonical(final.protectedFields) !==
              sourceCanonical(base.protectedFields)
          )
            throw Object.assign(new Error("PAYMENT_DRIFT"), {
              code: "PAYMENT_DRIFT",
            });
        }
      }
      if (
        typed &&
        options.requireBillPostState === true &&
        adapter.strictTyped
      ) {
        for (const r of g.records.filter((x) => x.record_type === "BILL")) {
          const t = manifest.transactions.find(
            (x) =>
              x.record_type === r.record_type && x.record_id === r.record_id,
          );
          const final = validateBillFinal(
            await adapter.getBillEvidence(r.record_id),
            { ...t, expected_current_vendor_id: insertedVendorId },
          );
          const base = billBaselines[r.record_id];
          if (
            final.vendorId !== insertedVendorId ||
            final.fingerprint !== base.fingerprint ||
            sourceCanonical(final.protectedFields) !==
              sourceCanonical(base.protectedFields)
          )
            throw Object.assign(new Error("BILL_DRIFT"), {
              code: "BILL_DRIFT",
            });
        }
      }
      if (typed) {
        const sourceFinal = validateSourceBaseline(
          await adapter.getSourceVendorEvidence(
            g.source_vendor_id,
            g.source_vendor_company_id,
          ),
          g,
        );
        if (
          sourceFinal.vendorId !== sourceBaseline.vendorId ||
          sourceFinal.companyId !== sourceBaseline.companyId ||
          sourceFinal.fingerprint !== sourceBaseline.fingerprint ||
          sourceCanonical(sourceFinal.protectedFields) !==
            sourceCanonical(sourceBaseline.protectedFields)
        )
          throw Object.assign(new Error("SOURCE_VENDOR_DRIFT"), {
            code: "SOURCE_VENDOR_DRIFT",
          });
      }
      if (
        strict &&
        (await adapter.getAccountingFingerprint()) !== accountingBaseline
      )
        throw Error("ACCOUNTING_DRIFT");
      if (
        stockStrict &&
        (await adapter.getStockFingerprint()) !== stockBaseline
      )
        throw Error("STOCK_DRIFT");
      if (schemaStrict) {
        const schemaCurrent = await adapter.getSchemaFingerprint();
        if (typeof schemaCurrent !== "string" || !schemaCurrent)
          throw Error("SCHEMA_FINGERPRINT_INVALID");
        if (schemaCurrent !== schemaBaseline) throw Error("SCHEMA_DRIFT");
      }
      await adapter.commit();
    } catch (e) {
      await adapter.rollback();
      throw e;
    }
  }
  const p = await adapter.getGlobalPostState(manifest);
  if (p.billMismatches !== 0 || p.paymentMismatches !== 0)
    throw Error("GLOBAL_POSTCONDITION");
  return adapter.counters || {};
}
async function run({
  db,
  adapterFactory,
  runtimeEnv,
  argv = process.argv.slice(2),
  manifestFile = MANIFEST_PATH,
  log = console.log,
} = {}) {
  const { manifest, hash } = loadManifest(manifestFile);
  assertManifest(manifest);
  const a = parseArgs(argv);
  log(`Manifest SHA: ${hash}`);
  if (!db) {
    if (a.execute) throw Error("IDENTITY_MODE_REQUIRED");
    log("READ-ONLY PREVIEW; no database client supplied");
    return { mode: "preview", manifestHash: hash };
  }
  if (!a.execute) {
    log("READ-ONLY PREVIEW; DML not enabled");
    return { mode: "preview", manifestHash: hash };
  }
  if (!a.mode) throw Error("IDENTITY_MODE_REQUIRED");
  const [identity] = await db.query(
    "SELECT @@hostname host,@@port port,@@version version,DATABASE() db",
  );
  validateIdentity(a.mode, identity[0], a);
  if (a.auth !== AUTH || a.manifestSha !== hash)
    throw Error("EXECUTION_AUTHORIZATION_FAILED");
  if (typeof db.getAccountingFingerprint !== "function")
    throw Error("ACCOUNTING_FINGERPRINT_REQUIRED");
  if (typeof db.getSchemaFingerprint !== "function") throw Error("SCHEMA_FINGERPRINT_REQUIRED");
  const runtimeCommit = validateRuntimeCommit(a, runtimeEnv || process.env);
  const backupEvidence = validateBackup(a);
  const adapter = adapterFactory ? adapterFactory(db) : new Fy6MysqlReadAdapter(db);
  let executionError, released = false;
  try {
    if (typeof adapter.getPopulationEvidence !== "function") throw Object.assign(new Error("POPULATION_EVIDENCE_REQUIRED"),{code:"POPULATION_EVIDENCE_REQUIRED"});
    const popA=validatePopulationEvidence(await adapter.getPopulationEvidence(manifest),manifest); const popB=validatePopulationEvidence(await adapter.getPopulationEvidence(manifest),manifest); if (popA.fingerprint!==popB.fingerprint) throw Object.assign(new Error("POPULATION_DRIFT"),{code:"POPULATION_DRIFT"}); const cls=classifyPopulation(popA,manifest); if(cls==="ALREADY_REPAIRED") throw Error("ALREADY_REPAIRED"); if(cls==="PARTIAL_PRIOR_RUN") throw Error("PARTIAL_PRIOR_RUN"); if(cls!=="PRISTINE") throw Error("POPULATION_MISMATCH");
    const result = await executeRepair(adapter, manifest, {
      requireTypedEvidence: true,
      requireBillPostState: true,
      requirePaymentPostState: true,
      requireOperationLedger: true,
      requireAccountingFingerprint: true,
      requireStockFingerprint: true,
      requireSchemaFingerprint: true,
    });
    try { released = true; await adapter.release(); } catch (releaseError) { throw releaseError; }
    return { ...result, runtimeCommit, backup: backupEvidence };
  } catch (error) {
    executionError = error;
    if (!released) { try { released = true; await adapter.release(); } catch (cleanupError) { error.cleanupError = cleanupError; } }
    throw error;
  } finally {
    if (!executionError) { /* release already completed on success */ }
  }
}
if (require.main === module) {
  run().catch((e) => {
    console.error(`REFUSED: ${e.message}`);
    process.exitCode = 1;
  });
}
module.exports = {
  AUTH,
  MANIFEST_PATH,
  DISPOSABLE_PREFIX,
  DISPOSABLE_REGEX,
  loadManifest,
  assertManifest,
  parseArgs,
  validateIdentity,
  validatePopulationEvidence,
  classifyPopulation,
  validateSourceBaseline,
  validateBillBaseline,
  validatePaymentBaseline,
  executeRepair,
  run,
};
