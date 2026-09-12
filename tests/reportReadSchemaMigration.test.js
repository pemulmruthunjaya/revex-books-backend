const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migrationPath = path.join(
  __dirname,
  "..",
  "db",
  "migrations",
  "2026-09-11-report-read-schema-foundation.sql"
);

const sql = fs.readFileSync(migrationPath, "utf8");
const compact = sql.replace(/\s+/g, " ").trim();
const executable = sql
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*--.*$/gm, "");
const runtimeSource = [
  "services/pettyCashService.js",
  "controllers/reportController.js",
  "controllers/returnController.js",
  "controllers/deliveryChallanController.js",
  "services/payrollService.js",
  "controllers/accountingSummary.js",
]
  .map((file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8"))
  .join("\n")
  .replace(/\s+/g, " ");

const requireFragment = (fragment, label = fragment) => {
  assert.ok(compact.includes(fragment.replace(/\s+/g, " ").trim()), `missing ${label}`);
};

const extractCreateDefinitions = (source, table) => {
  const marker = `CREATE TABLE IF NOT EXISTS ${table} (`;
  const definitions = [];
  let searchFrom = 0;
  while (true) {
    const start = source.indexOf(marker, searchFrom);
    if (start < 0) break;
    const opening = start + marker.length - 1;
    let depth = 0;
    for (let index = opening; index < source.length; index += 1) {
      if (source[index] === "(") depth += 1;
      if (source[index] === ")") depth -= 1;
      if (depth === 0) {
        definitions.push(
          source.slice(start, index + 1).replace(/\s+/g, " ").replace(/\s*,\s*/g, ",").trim()
        );
        searchFrom = index + 1;
        break;
      }
    }
  }
  return definitions;
};

const tableDefinitions = {
  petty_cash_settings: [
    "company_id BIGINT UNSIGNED NOT NULL",
    "opening_balance DECIMAL(15,2) NOT NULL DEFAULT 0",
    "UNIQUE KEY uq_petty_cash_settings_company (company_id)",
  ],
  petty_cash_user_permissions: [
    "user_id BIGINT UNSIGNED NOT NULL",
    "UNIQUE KEY uq_petty_cash_permission_user (company_id, user_id)",
    "KEY idx_petty_cash_permission_company (company_id)",
  ],
  petty_cash_transactions: [
    "transaction_type ENUM('EXPENSE','REPLENISHMENT') NOT NULL",
    "status ENUM('DRAFT','SUBMITTED','MANAGER_APPROVED','ACCOUNTS_APPROVED','POSTED','REJECTED') NOT NULL DEFAULT 'DRAFT'",
    "UNIQUE KEY uq_petty_cash_transaction_no (company_id, transaction_no)",
    "KEY idx_petty_cash_company_date (company_id, transaction_date)",
  ],
  petty_cash_attachments: [
    "file_data LONGBLOB NOT NULL",
    "CONSTRAINT fk_petty_cash_attachment_transaction FOREIGN KEY (transaction_id) REFERENCES petty_cash_transactions(id) ON DELETE CASCADE",
  ],
  petty_cash_workflow_history: [
    "KEY idx_petty_cash_history_transaction (company_id, transaction_id)",
    "CONSTRAINT fk_petty_cash_history_transaction FOREIGN KEY (transaction_id) REFERENCES petty_cash_transactions(id) ON DELETE CASCADE",
  ],
  product_returns: [
    "type VARCHAR(20) NOT NULL",
    "UNIQUE KEY uniq_product_returns_company_number (company_id, return_number)",
  ],
  return_items: [
    "quantity DECIMAL(10,2) NOT NULL DEFAULT 0",
    "INDEX idx_return_items_return (return_id)",
    "INDEX idx_return_items_company_product (company_id, product_id)",
  ],
  delivery_challans: [
    "type VARCHAR(10) NOT NULL",
    "status VARCHAR(30) NOT NULL DEFAULT 'Created'",
    "UNIQUE KEY uniq_delivery_challan_company_number (company_id, challan_number)",
  ],
  delivery_challan_items: [
    "unit VARCHAR(30) NULL",
    "INDEX idx_delivery_challan_items_challan (challan_id)",
    "INDEX idx_delivery_challan_items_company_product (company_id, product_id)",
  ],
  payroll_employees: [
    "employee_code VARCHAR(80) NULL",
    "monthly_salary DECIMAL(12,2) NOT NULL DEFAULT 0",
    "INDEX idx_payroll_employee_code (company_id, employee_code)",
  ],
  payroll_entries: [
    "salary_mode VARCHAR(40) NOT NULL DEFAULT 'Manual'",
    "attendance_import_id INT NULL",
    "UNIQUE KEY uniq_payroll_employee_month (company_id, employee_id, payroll_month)",
    "INDEX idx_payroll_entries_status (company_id, status)",
  ],
  payroll_attendance_imports: [
    "standard_hours_per_day DECIMAL(8,2) NOT NULL DEFAULT 8",
    "INDEX idx_payroll_attendance_import_company (company_id, created_at)",
  ],
  payroll_attendance_lines: [
    "calculated_salary DECIMAL(12,2) NOT NULL DEFAULT 0",
    "INDEX idx_payroll_attendance_lines_import (import_id)",
    "INDEX idx_payroll_attendance_lines_company (company_id, payroll_month)",
  ],
};

for (const [table, fragments] of Object.entries(tableDefinitions)) {
  requireFragment(`CREATE TABLE IF NOT EXISTS ${table} (`, `${table} idempotent creation`);
  assert.ok(
    runtimeSource.includes(`CREATE TABLE IF NOT EXISTS ${table} (`),
    `${table} must originate in a current runtime helper`
  );
  for (const fragment of fragments) {
    requireFragment(fragment, `${table}: ${fragment}`);
    assert.ok(runtimeSource.includes(fragment), `${table} runtime parity: ${fragment}`);
  }

  const migrationDefinitions = extractCreateDefinitions(sql, table);
  const runtimeDefinitions = extractCreateDefinitions(runtimeSource, table);
  assert.equal(migrationDefinitions.length, 1, `${table} must occur once in the migration`);
  assert.ok(runtimeDefinitions.length >= 1, `${table} must have a runtime definition`);
  for (const runtimeDefinition of runtimeDefinitions) {
    assert.equal(
      migrationDefinitions[0],
      runtimeDefinition,
      `${table} migration definition must exactly match every runtime copy`
    );
  }
}

assert.ok(
  (compact.match(/ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci/g) || []).length >= 5,
  "Petty Cash table engine and collation contracts must be represented"
);

const productColumns = new Map([
  ["mrp", "DECIMAL(10,2) NOT NULL DEFAULT 0"],
  ["sku", "VARCHAR(100) NULL"],
  ["hsn", "VARCHAR(30) NULL"],
  ["category", "VARCHAR(100) NULL"],
  ["batch_no", "VARCHAR(100) NULL"],
  ["manufactured_date", "DATE NULL"],
  ["expiry_date", "DATE NULL"],
  ["unit", "VARCHAR(30) NOT NULL DEFAULT ''PCS''"],
  ["gst", "DECIMAL(5,2) NOT NULL DEFAULT 18"],
  ["purchase_price", "DECIMAL(10,2) NOT NULL DEFAULT 0"],
  ["opening_stock", "DECIMAL(10,2) NOT NULL DEFAULT 0"],
  ["reorder_level", "DECIMAL(10,2) NOT NULL DEFAULT 0"],
  ["status", "VARCHAR(20) NOT NULL DEFAULT ''Active''"],
]);

for (const [column, definition] of productColumns) {
  const runtimeDefinition = definition.replace(/''/g, "'");
  assert.ok(
    runtimeSource.includes(`{ name: "${column}", definition: "${runtimeDefinition}" }`),
    `products.${column} must match a current runtime definition`
  );
  requireFragment(
    `TABLE_NAME = 'products' AND COLUMN_NAME = '${column}'`,
    `products.${column} information-schema guard`
  );
  requireFragment(
    `ALTER TABLE products ADD COLUMN \`${column}\` ${definition}`,
    `products.${column} runtime-compatible definition`
  );
}

const payrollEvolution = new Map([
  ["payroll_employees.employee_code", "VARCHAR(80) NULL AFTER name"],
  ["payroll_entries.salary_mode", "VARCHAR(40) NOT NULL DEFAULT ''Manual'' AFTER payroll_date"],
  ["payroll_entries.working_days", "DECIMAL(8,2) NOT NULL DEFAULT 0 AFTER salary_mode"],
  ["payroll_entries.present_days", "DECIMAL(8,2) NOT NULL DEFAULT 0 AFTER working_days"],
  ["payroll_entries.absent_days", "DECIMAL(8,2) NOT NULL DEFAULT 0 AFTER present_days"],
  ["payroll_entries.total_hours", "DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER absent_days"],
  ["payroll_entries.overtime_hours", "DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER total_hours"],
  ["payroll_entries.standard_hours", "DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER overtime_hours"],
  ["payroll_entries.attendance_import_id", "INT NULL AFTER notes"],
]);

for (const [target, definition] of payrollEvolution) {
  const [table, column] = target.split(".");
  const runtimeDefinition = definition.replace(/''/g, "'");
  assert.ok(
    runtimeSource.includes(`ensureColumn("${table}", "${column}", "${runtimeDefinition}")`),
    `${target} must match the current payroll runtime definition`
  );
  requireFragment(
    `TABLE_NAME = '${table}' AND COLUMN_NAME = '${column}'`,
    `${target} information-schema guard`
  );
  requireFragment(
    `ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`,
    `${target} runtime-compatible definition`
  );
}

assert.doesNotMatch(executable, /\bDROP\s+TABLE\b/i, "migration must not drop tables");
assert.doesNotMatch(executable, /\bTRUNCATE\b/i, "migration must not truncate data");
assert.doesNotMatch(
  executable,
  /(?:^|;)\s*(?:INSERT|UPDATE|DELETE)\s+/im,
  "migration must not contain business-data DML"
);
assert.doesNotMatch(sql, /payroll[^;\n]*financial_year_id|financial_year_id[^;\n]*payroll/i);
assert.doesNotMatch(sql, /financial_year_id\s+[^,;\n]*NOT\s+NULL/i);
assert.doesNotMatch(executable, /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?receipt_entries/i);
assert.doesNotMatch(executable, /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?customer_advances/i);
assert.doesNotMatch(executable, /ALTER\s+TABLE\s+payments/i);
assert.doesNotMatch(executable, /(?:uq|idx)_payments_receipt_entry/i);

const guardedAlterCount = (executable.match(/TABLE_SCHEMA\s*=\s*DATABASE\(\)/gi) || []).length;
const dynamicAlterCount = (executable.match(/'ALTER TABLE/gi) || []).length;
assert.equal(guardedAlterCount, productColumns.size + payrollEvolution.size);
assert.equal(dynamicAlterCount, guardedAlterCount);
assert.equal((executable.match(/(?:^|\n)\s*PREPARE rrsf_stmt/gi) || []).length, guardedAlterCount);
assert.equal((executable.match(/DEALLOCATE PREPARE rrsf_stmt/gi) || []).length, guardedAlterCount);

console.log("report-read schema migration contract tests passed");
