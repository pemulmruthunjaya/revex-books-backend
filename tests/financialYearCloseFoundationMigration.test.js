const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const migrationPath = path.join(
  __dirname,
  "..",
  "db",
  "migrations",
  "2026-09-12-financial-year-close-foundation.sql"
);

const sql = fs.readFileSync(migrationPath, "utf8");
const compact = sql.replace(/\s+/g, " ").trim();
const executable = sql
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*--.*$/gm, "");

const expectedTables = [
  "system_account_role_assignments",
  "financial_year_close_runs",
  "financial_year_close_lines",
  "financial_year_close_reconciliations",
  "financial_year_subledger_snapshots",
  "financial_year_subledger_snapshot_items",
  "financial_year_inventory_snapshots",
  "financial_year_inventory_snapshot_items",
  "financial_year_close_events",
  "payment_reversals",
  "vendor_payment_reversals",
  "subledger_opening_items",
];

const expectedRoles = [
  "OPENING_BALANCE_EQUITY",
  "RETAINED_EARNINGS",
  "ACCOUNTS_RECEIVABLE",
  "ACCOUNTS_PAYABLE",
  "CUSTOMER_CREDITS",
  "VENDOR_ADVANCES",
  "CASH",
  "BANK",
  "INVENTORY",
  "INPUT_TAX",
  "OUTPUT_TAX",
];

const expectedRunStatuses = [
  "DRAFT",
  "VALIDATING",
  "READY",
  "GENERATING",
  "GENERATED",
  "RECONCILED",
  "FINALIZED",
  "FAILED",
  "ROLLED_BACK",
];

test("FY-6C-1 creates every additive schema object idempotently", () => {
  for (const table of expectedTables) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`));
  }

  assert.equal(
    (sql.match(/CREATE TABLE IF NOT EXISTS /g) || []).length,
    expectedTables.length,
    "the migration must create only the approved tables"
  );
  assert.doesNotMatch(executable, /\bDROP\s+TABLE\b/i);
  assert.doesNotMatch(executable, /\bTRUNCATE\b/i);
  assert.match(sql, /CREATE TRIGGER IF NOT EXISTS trg_fy_close_events_no_update/);
  assert.match(sql, /CREATE TRIGGER IF NOT EXISTS trg_fy_close_events_no_delete/);
  assert.match(sql, /UNIQUE KEY uq_fy_close_events_request \(close_run_id, event_type, request_identity\)/);
});

test("role, status, classification, reconciliation, event, and origin vocabularies are frozen", () => {
  for (const role of expectedRoles) assert.ok(compact.includes(`'${role}'`), `missing role ${role}`);
  for (const status of expectedRunStatuses) {
    assert.ok(compact.includes(`'${status}'`), `missing close-run status ${status}`);
  }

  for (const classification of ["PERMANENT", "PNL_INCOME", "PNL_EXPENSE", "RETAINED_EARNINGS"]) {
    assert.ok(compact.includes(`'${classification}'`), `missing classification ${classification}`);
  }
  for (const type of [
    "GL_BALANCE", "PNL_ZERO", "PERMANENT_BALANCE", "AR_CONTROL", "AP_CONTROL",
    "INVENTORY", "OPENING_JOURNAL", "FINGERPRINT", "FY_PAIR",
  ]) {
    assert.ok(compact.includes(`'${type}'`), `missing reconciliation type ${type}`);
  }
  for (const event of [
    "REQUESTED", "VALIDATION_STARTED", "VALIDATION_FAILED", "READY",
    "GENERATION_STARTED", "GENERATED", "RECONCILIATION_PASSED",
    "RECONCILIATION_FAILED", "FINALIZED", "ROLLED_BACK", "REVERSAL_LINKED",
    "ADJUSTMENT_REQUIRED",
  ]) {
    assert.ok(compact.includes(`'${event}'`), `missing close event ${event}`);
  }

  assert.match(sql, /origin ENUM\('ONBOARDING','HISTORICAL_MIGRATION'\) NOT NULL/);
  assert.doesNotMatch(sql, /CURRENT_YEAR_EARNINGS/);
  assert.doesNotMatch(sql, /ANNUAL_CARRY_FORWARD/);
});

test("tenant-bearing foreign keys and document identity checks prevent cross-company linkage", () => {
  const tenantReferences = [
    "REFERENCES financial_years(id, company_id)",
    "REFERENCES users(id, company_id)",
    "REFERENCES accounts(id, company_id)",
    "REFERENCES branches(id, company_id)",
    "REFERENCES customers(id, company_id)",
    "REFERENCES vendors(id, company_id)",
    "REFERENCES products(id, company_id)",
    "REFERENCES invoices(id, company_id)",
    "REFERENCES bills(id, company_id)",
    "REFERENCES payments(id, company_id)",
    "REFERENCES vendor_payments(id, company_id)",
    "REFERENCES journal_entries(id, company_id)",
  ];
  for (const reference of tenantReferences) {
    assert.ok(compact.includes(reference), `missing tenant reference: ${reference}`);
  }

  for (const table of [
    "users", "accounts", "branches", "customers", "vendors", "products",
    "invoices", "bills", "payments", "vendor_payments", "journal_entries",
  ]) {
    assert.ok(
      compact.includes(`CALL fy6c1_ensure_identity_scope_index('${table}',`),
      `missing safe composite-index guard for ${table}`
    );
  }

  assert.ok(compact.includes(
    "CALL fy6c1_ensure_identity_scope_index( 'journal_entry_details', " +
    "'uq_fy6_journal_details_id_journal', 'journal_entry_id' )"
  ));
  assert.match(sql, /FOREIGN KEY \(supersedes_run_id, company_id\)/);
  assert.match(sql, /FOREIGN KEY \(reversal_of_run_id, company_id\)/);
  assert.match(sql, /FOREIGN KEY \(closing_journal_detail_id, closing_journal_entry_id\)/);
  assert.match(sql, /FOREIGN KEY \(opening_journal_detail_id, opening_journal_entry_id\)/);

  assert.match(sql, /chk_subledger_opening_party/);
  assert.match(sql, /chk_fy_subledger_item_identity/);
  assert.match(sql, /trg_system_account_roles_validate_insert/);
  assert.match(sql, /trg_system_account_roles_validate_update/);
  assert.match(sql, /Singleton system account role effective ranges cannot overlap/);
});

test("close-run idempotency and active/finalized pair guards are enforced", () => {
  assert.match(sql, /UNIQUE KEY uq_fy_close_runs_generation_uuid \(generation_uuid\)/);
  assert.match(sql, /active_pair_guard TINYINT GENERATED ALWAYS AS/);
  assert.match(sql, /finalized_pair_guard TINYINT GENERATED ALWAYS AS/);
  assert.match(sql, /UNIQUE KEY uq_fy_close_runs_active_pair/);
  assert.match(sql, /UNIQUE KEY uq_fy_close_runs_finalized_pair/);
  assert.match(sql, /UNIQUE KEY uq_fy_close_runs_pair_attempt/);
  assert.match(sql, /CHECK \(source_financial_year_id <> destination_financial_year_id\)/);
  assert.match(sql, /UNIQUE KEY uq_fy_close_lines_scope \(close_run_id, account_id, normalized_branch_scope\)/);
  assert.match(sql, /normalized_branch_scope INT GENERATED ALWAYS AS \(COALESCE\(branch_id, 0\)\) STORED/);
});

test("accounting amounts use fixed-point types and effective dates use DATE", () => {
  assert.doesNotMatch(sql, /\b(?:FLOAT|DOUBLE|REAL)\b/i);
  assert.ok((sql.match(/DECIMAL\(/gi) || []).length >= 30, "expected fixed-point accounting fields");
  for (const field of ["effective_date", "due_date", "cutoff_date", "reversal_date"]) {
    assert.match(sql, new RegExp(`${field} DATE (?:NOT )?NULL`));
  }
  assert.match(sql, /generation_uuid CHAR\(36\) CHARACTER SET ascii COLLATE ascii_bin NOT NULL/);
  assert.match(sql, /source_fingerprint CHAR\(64\) CHARACTER SET ascii COLLATE ascii_bin NULL/);
});

test("evidence and reversal records have database immutability protection", () => {
  for (const stem of [
    "fy_close_lines", "fy_close_recon", "fy_subledger_snap", "fy_subledger_items",
    "fy_inventory_snap", "fy_inventory_items", "fy_close_events",
  ]) {
    assert.match(sql, new RegExp(`CREATE TRIGGER IF NOT EXISTS trg_${stem}_no_update`));
    assert.match(sql, new RegExp(`CREATE TRIGGER IF NOT EXISTS trg_${stem}_no_delete`));
  }
  assert.match(sql, /trg_payment_reversals_restricted_update/);
  assert.match(sql, /trg_payment_reversals_no_delete/);
  assert.match(sql, /trg_vendor_payment_reversals_restricted_update/);
  assert.match(sql, /trg_vendor_payment_reversals_no_delete/);
  assert.match(sql, /trg_subledger_opening_restricted_update/);
  assert.match(sql, /trg_subledger_opening_no_delete/);
  assert.match(sql, /one-time journal linkage/);
});

test("migration contains no business mutation or forbidden FY scope expansion", () => {
  assert.doesNotMatch(executable, /^\s*(?:INSERT|UPDATE|DELETE)\b/gim);
  assert.doesNotMatch(sql, /\bpayroll\w*\b[^;\n]*financial_year_id|financial_year_id[^;\n]*\bpayroll\w*\b/i);
  assert.doesNotMatch(
    executable,
    /ALTER\s+TABLE\s+`?(?:invoices|payments|bills|vendor_payments|ledger_entries|expenses|journal_entries)`?[\s\S]{0,160}\b(?:MODIFY|CHANGE)\b[\s\S]{0,80}\bfinancial_year_id\b/i
  );
  assert.doesNotMatch(executable, /UPDATE\s+(?:`?products`?|`?accounts`?|`?customers`?|`?vendors`?)/i);
  assert.doesNotMatch(executable, /UPDATE\s+(?:`?invoices`?|`?bills`?|`?payments`?|`?journal_entries`?)/i);
  assert.doesNotMatch(executable, /INSERT\s+INTO\s+(?:journal_entries|journal_entry_details|financial_year_close_runs|system_account_role_assignments)/i);
  assert.doesNotMatch(sql, /SET\s+invoice_date|SET\s+bill_date|SET\s+payment_date/i);
  assert.doesNotMatch(sql, /SET\s+(?:stock|opening_stock)/i);
});

test("journal source identity remains the existing minimal deterministic contract", () => {
  assert.match(sql, /CREATE UNIQUE INDEX uq_journal_source\s+ON journal_entries \(company_id, source_type, source_id\)/);
  assert.doesNotMatch(executable, /ALTER\s+TABLE\s+journal_entries\s+ADD\s+COLUMN/i);
  assert.match(sql, /closing_journal_entry_id INT NULL/);
  assert.match(sql, /opening_journal_entry_id INT NULL/);
});

console.log("financial-year close foundation migration contract tests passed");
