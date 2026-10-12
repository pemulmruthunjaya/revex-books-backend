"use strict";

// Exact metadata contracts; this module never imports the database pool.
const columns = {
  subledger_opening_items: {
    origin: ["enum('ONBOARDING','HISTORICAL_MIGRATION','ANNUAL_CARRY_FORWARD')", "NO"],
    original_invoice_id: ["int", "YES"], original_bill_id: ["int", "YES"],
    original_opening_item_id: ["bigint unsigned", "YES"], original_financial_year_id: ["bigint unsigned", "YES"],
    predecessor_opening_item_id: ["bigint unsigned", "YES"], close_run_id: ["bigint unsigned", "YES"],
    carry_source_financial_year_id: ["bigint unsigned", "YES"], financial_year_id: ["bigint unsigned", "NO"], company_id: ["int", "NO"],
  },
  annual_subledger_allocations: {
    id: ["bigint unsigned", "NO"], company_id: ["int", "NO"], financial_year_id: ["bigint unsigned", "NO"],
    opening_item_id: ["bigint unsigned", "NO"], amount: ["decimal(15,2)", "NO"], settlement_date: ["date", "NO"],
    party_type: ["enum('CUSTOMER','VENDOR')", "NO"], customer_id: ["int", "YES"], vendor_id: ["int", "YES"],
    receipt_entry_id: ["bigint unsigned", "YES"], receipt_company_id: ["bigint unsigned", "YES"],
    receipt_journal_entry_id: ["bigint unsigned", "YES"], vendor_payment_id: ["int", "YES"], journal_entry_id: ["int", "NO"],
    idempotency_key: ["char(36)", "NO"], request_fingerprint: ["char(64)", "NO"], created_by: ["int", "NO"],
  },
  annual_subledger_allocation_reversals: {
    id: ["bigint unsigned", "NO"], company_id: ["int", "NO"], financial_year_id: ["bigint unsigned", "NO"],
    allocation_id: ["bigint unsigned", "NO"], amount: ["decimal(15,2)", "NO"], reversal_date: ["date", "NO"],
    reversal_journal_entry_id: ["int", "NO"], idempotency_key: ["char(36)", "NO"], request_fingerprint: ["char(64)", "NO"],
    reason: ["varchar(500)", "NO"], created_by: ["int", "NO"],
  },
};
const foreignKeys = {
  fk_annual_opening_invoice: ["subledger_opening_items", "original_invoice_id,company_id,original_financial_year_id", "invoices", "id,company_id,financial_year_id"],
  fk_annual_opening_bill: ["subledger_opening_items", "original_bill_id,company_id,original_financial_year_id", "bills", "id,company_id,financial_year_id"],
  fk_annual_opening_root: ["subledger_opening_items", "original_opening_item_id,company_id,original_financial_year_id", "subledger_opening_items", "id,company_id,financial_year_id"],
  fk_annual_opening_predecessor: ["subledger_opening_items", "predecessor_opening_item_id,company_id,carry_source_financial_year_id", "subledger_opening_items", "id,company_id,financial_year_id"],
  fk_annual_opening_run: ["subledger_opening_items", "close_run_id,company_id,carry_source_financial_year_id,financial_year_id", "financial_year_close_runs", "id,company_id,source_financial_year_id,destination_financial_year_id"],
  fk_annual_allocation_opening: ["annual_subledger_allocations", "opening_item_id,company_id,financial_year_id", "subledger_opening_items", "id,company_id,financial_year_id"],
  fk_annual_allocation_receipt: ["annual_subledger_allocations", "receipt_entry_id,receipt_company_id,receipt_journal_entry_id", "receipt_entries", "id,company_id,journal_entry_id"],
  fk_annual_allocation_vendor_payment: ["annual_subledger_allocations", "vendor_payment_id,company_id,financial_year_id", "vendor_payments", "id,company_id,financial_year_id"],
  fk_annual_allocation_journal: ["annual_subledger_allocations", "journal_entry_id,company_id,financial_year_id", "journal_entries", "id,company_id,financial_year_id"],
  fk_annual_allocation_customer: ["annual_subledger_allocations", "customer_id,company_id", "customers", "id,company_id"],
  fk_annual_allocation_vendor: ["annual_subledger_allocations", "vendor_id,company_id", "vendors", "id,company_id"],
  fk_annual_allocation_actor: ["annual_subledger_allocations", "created_by,company_id", "users", "id,company_id"],
  fk_annual_reversal_allocation: ["annual_subledger_allocation_reversals", "allocation_id,company_id,financial_year_id", "annual_subledger_allocations", "id,company_id,financial_year_id"],
  fk_annual_reversal_journal: ["annual_subledger_allocation_reversals", "reversal_journal_entry_id,company_id,financial_year_id", "journal_entries", "id,company_id,financial_year_id"],
  fk_annual_reversal_actor: ["annual_subledger_allocation_reversals", "created_by,company_id", "users", "id,company_id"],
};
const indexes = {
  uq_annual_opening_scope: ["subledger_opening_items", "id,company_id,financial_year_id"],
  uq_annual_close_pair: ["financial_year_close_runs", "id,company_id,source_financial_year_id,destination_financial_year_id"],
  uq_annual_invoice_destination: ["subledger_opening_items", "company_id,financial_year_id,original_invoice_id"],
  uq_annual_bill_destination: ["subledger_opening_items", "company_id,financial_year_id,original_bill_id"],
  uq_annual_legacy_destination: ["subledger_opening_items", "company_id,financial_year_id,original_opening_item_id"],
  uq_annual_allocation_request: ["annual_subledger_allocations", "company_id,idempotency_key,opening_item_id"],
  uq_annual_allocation_receipt: ["annual_subledger_allocations", "receipt_entry_id,opening_item_id"],
  uq_annual_allocation_vendor_payment: ["annual_subledger_allocations", "vendor_payment_id,opening_item_id"],
  uq_annual_reversal_allocation: ["annual_subledger_allocation_reversals", "company_id,allocation_id"],
  uq_annual_reversal_request: ["annual_subledger_allocation_reversals", "company_id,idempotency_key,allocation_id"],
};
const checkFragments = {
  chk_annual_opening_lineage: ["ORIGIN", "ANNUAL_CARRY_FORWARD", "CLOSE_RUN_ID", "PREDECESSOR_OPENING_ITEM_ID"],
  chk_annual_allocation_amount: ["AMOUNT", "> 0"],
  chk_annual_allocation_payment: ["CUSTOMER", "VENDOR", "RECEIPT_ENTRY_ID", "VENDOR_PAYMENT_ID"],
  chk_annual_reversal_amount: ["AMOUNT", "> 0"],
  chk_annual_reversal_reason: ["TRIM", "REASON"],
};
const triggers = {
  trg_annual_opening_lineage_immutable: ["subledger_opening_items", "UPDATE", "NEW.original_amount", "NEW.financial_year_id"],
  trg_annual_opening_no_delete: ["subledger_opening_items", "DELETE", "ANNUAL_CARRY_FORWARD", "SIGNAL SQLSTATE '45000'"],
  trg_annual_allocations_no_update: ["annual_subledger_allocations", "UPDATE", "SIGNAL"],
  trg_annual_allocations_no_delete: ["annual_subledger_allocations", "DELETE", "SIGNAL"],
  trg_annual_reversals_no_update: ["annual_subledger_allocation_reversals", "UPDATE", "SIGNAL"],
  trg_annual_reversals_no_delete: ["annual_subledger_allocation_reversals", "DELETE", "SIGNAL"],
};
const checks = ["chk_annual_opening_lineage", "chk_annual_allocation_amount", "chk_annual_allocation_payment", "chk_annual_reversal_amount", "chk_annual_reversal_reason"];
const inspectAnnualSchema = async executor => {
  try {
    const [tables] = await executor.query("SELECT TABLE_NAME,ENGINE,TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()");
    const [cs] = await executor.query("SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()");
    const [ks] = await executor.query(`SELECT TABLE_NAME,CONSTRAINT_NAME,COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME,ORDINAL_POSITION
      FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY CONSTRAINT_NAME,ORDINAL_POSITION`);
    const [rs] = await executor.query("SELECT CONSTRAINT_NAME,DELETE_RULE,UPDATE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()");
    const [ix] = await executor.query("SELECT TABLE_NAME,INDEX_NAME,COLUMN_NAME,NON_UNIQUE,SEQ_IN_INDEX FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() ORDER BY INDEX_NAME,SEQ_IN_INDEX");
    const [ts] = await executor.query("SELECT TRIGGER_NAME,EVENT_OBJECT_TABLE,EVENT_MANIPULATION,ACTION_TIMING,ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()");
    const [ch] = await executor.query("SELECT CONSTRAINT_NAME,ENFORCED FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND CONSTRAINT_TYPE='CHECK'");
    const [clauses] = await executor.query("SELECT CONSTRAINT_NAME,CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()");
    const failures = [];
    for (const table of ["subledger_opening_items", "financial_year_close_runs", "annual_subledger_allocations", "annual_subledger_allocation_reversals"]) {
      const row = tables.find(r => r.TABLE_NAME === table);
      if (!row || row.TABLE_TYPE !== "BASE TABLE" || row.ENGINE !== "InnoDB") failures.push("ANNUAL_SCHEMA_TABLE_ENGINE_INCOMPATIBLE");
    }
    for (const [table, fields] of Object.entries(columns)) for (const [name, [type, nullable]] of Object.entries(fields)) {
      const row = cs.find(r => r.TABLE_NAME === table && r.COLUMN_NAME === name);
      if (!row || row.COLUMN_TYPE.toLowerCase() !== type.toLowerCase() || row.IS_NULLABLE !== nullable) failures.push("ANNUAL_SCHEMA_COLUMN_INCOMPATIBLE");
    }
    for (const [name, [table, fields, target, refs]] of Object.entries(foreignKeys)) {
      const rows = ks.filter(r => r.CONSTRAINT_NAME === name && r.TABLE_NAME === table);
      const rule = rs.find(r => r.CONSTRAINT_NAME === name);
      if (rows.map(r => r.COLUMN_NAME).join(",") !== fields || rows.map(r => r.REFERENCED_COLUMN_NAME).join(",") !== refs
        || rows.some((r, i) => r.REFERENCED_TABLE_NAME !== target || Number(r.ORDINAL_POSITION) !== i + 1) || !rule
        || !["RESTRICT", "NO ACTION"].includes(rule.DELETE_RULE) || !["RESTRICT", "NO ACTION"].includes(rule.UPDATE_RULE)) failures.push("ANNUAL_SCHEMA_FK_INCOMPATIBLE");
      const targetKey = refs.split(",");
      const targetHasUniqueKey = ix.some(index => index.TABLE_NAME === target && Number(index.NON_UNIQUE) === 0 && targetKey.every((field, i) =>
        ix.some(row => row.TABLE_NAME === target && row.INDEX_NAME === index.INDEX_NAME && Number(row.NON_UNIQUE) === 0
          && Number(row.SEQ_IN_INDEX) === i + 1 && row.COLUMN_NAME === field)));
      if (!targetHasUniqueKey) failures.push("ANNUAL_SCHEMA_FK_TARGET_UNIQUE_KEY_MISSING");
    }
    for (const [name, [table, fields]] of Object.entries(indexes)) {
      const rows = ix.filter(r => r.INDEX_NAME === name && r.TABLE_NAME === table);
      if (rows.map(r => r.COLUMN_NAME).join(",") !== fields || rows.some(r => Number(r.NON_UNIQUE) !== 0)) failures.push("ANNUAL_SCHEMA_UNIQUENESS_MISSING");
    }
    for (const [name, [table, event, ...bodies]] of Object.entries(triggers)) {
      const row = ts.find(r => r.TRIGGER_NAME === name);
      if (!row || row.EVENT_OBJECT_TABLE !== table || row.EVENT_MANIPULATION !== event || row.ACTION_TIMING !== "BEFORE"
        || bodies.some(body => !row.ACTION_STATEMENT.includes(body))) failures.push("ANNUAL_SCHEMA_IMMUTABILITY_MISSING");
    }
    for (const name of checks) {
      const clause = String(clauses.find(r => r.CONSTRAINT_NAME === name)?.CHECK_CLAUSE || "").toUpperCase()
        .replaceAll("`", "").replaceAll("'", "").replaceAll("(", " ").replaceAll(")", " ");
      if (!ch.some(r => r.CONSTRAINT_NAME === name && r.ENFORCED === "YES")
        || checkFragments[name].some(fragment => !clause.includes(fragment))) failures.push("ANNUAL_SCHEMA_CHECK_MISSING");
    }
    return { ready: !failures.length, blockers: [...new Set(failures)].sort().map(code => ({ code, count: failures.filter(x => x === code).length })) };
  } catch { return { ready: false, blockers: [{ code: "ANNUAL_SCHEMA_INSPECTION_FAILED", count: 1 }] }; }
};
module.exports = { inspectAnnualSchema, columns, foreignKeys, indexes, triggers, checks, checkFragments };
