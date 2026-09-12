"use strict";
// Static source analysis only. No application modules, drivers or SQL execution.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const test = require("node:test");
const root = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const sql = read("tests/fixtures/fy6c2-current-schema-bootstrap.sql");
const migration = read("db/migrations/2026-09-12-financial-year-close-foundation.sql");
const clean = (s) => s.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
const executable = clean(sql);
const required = "companies users accounts branches customers vendors products invoices payments bills vendor_payments journal_entries journal_entry_details financial_years financial_year_events".split(" ");
const core = "invoices payments bills vendor_payments journal_entries".split(" ");
const names = (s) => s.replace(/[\x60\s]/g, "").split(",");
function tables(s) {
  const out = {};
  for (const m of clean(s).matchAll(/CREATE TABLE (?:IF NOT EXISTS )?[\x60]?(\w+)[\x60]?\s*\(([\s\S]*?)\)\s*ENGINE=[^;]+;/gi)) {
    assert.ok(!out[m[1]], "duplicate table " + m[1]);
    const columns = {};
    for (const c of m[2].matchAll(/^\s*[\x60]?(\w+)[\x60]?\s+((?:BIGINT|INT|TINYINT|VARCHAR|CHAR|DECIMAL|DATE|TIMESTAMP|TEXT|LONGTEXT|JSON|ENUM)\b[^\n]*)/gim)) {
      columns[c[1]] = c[2].replace(/,$/, "");
    }
    const keys = [...m[2].matchAll(/(?:PRIMARY KEY|UNIQUE KEY\s+[\x60]?\w+[\x60]?)\s*\(([^)]+)\)/gi)].map(k => names(k[1]).join(","));
    out[m[1]] = { columns, keys, body: m[2], ddl: m[0] };
  }
  for (const a of clean(s).matchAll(/ALTER TABLE (\w+) (ADD|MODIFY) COLUMN (\w+) ([^;]+);/gi)) {
    assert.ok(out[a[1]], "ALTER target exists");
    out[a[1]].columns[a[3]] = a[4].split(/,\s*ADD COLUMN/i)[0];
    for (const c of a[4].matchAll(/,\s*ADD COLUMN (\w+) ([^;]+)/gi)) out[a[1]].columns[c[1]] = c[2];
  }
  return out;
}
const parents = tables(sql);
const future = tables(migration);
const type = (definition) => {
  assert.ok(definition, "column exists");
  const enumeration = definition.match(/^ENUM\(([^)]+)\)/i);
  if (enumeration) return "ENUM(" + enumeration[1].replace(/\s/g, "") + ")";
  const m = definition.match(/^(BIGINT|INT|TINYINT)(?:\(\d+\))?(\s+UNSIGNED)?\b/i);
  assert.ok(m, "FK column uses reviewed integer type: " + definition);
  return m[1].toUpperCase() + (m[2] ? " UNSIGNED" : " SIGNED");
};
function checkFk(child, columns, parent, refs, all, keys) {
  assert.ok(all[parent], "missing FK parent " + parent);
  assert.equal(columns.length, refs.length);
  for (let i = 0; i < refs.length; i++) {
    assert.equal(type(all[child].columns[columns[i]]), type(all[parent].columns[refs[i]]),
      child + "." + columns[i] + " -> " + parent + "." + refs[i]);
  }
  assert.ok(keys[parent].includes(refs.join(",")), "missing unique parent key " + parent + "(" + refs + ")");
}
test("schema-only SQL has no business DML, server selection or secrets", () => {
  assert.doesNotMatch(executable, /\b(?:CREATE|DROP)\s+DATABASE\b|\bUSE\s+\w+|\b(?:GRANT|REVOKE)\b|\b(?:CREATE|ALTER)\s+USER\b|\bSET\s+PASSWORD\b/i);
  assert.doesNotMatch(executable, /(?:^|[;\n])\s*(?:INSERT|REPLACE|UPDATE|DELETE|LOAD\s+DATA|TRUNCATE)\b/i);
  assert.doesNotMatch(executable, /\b(?:LOCK|UNLOCK)\s+TABLES\b|AUTO_INCREMENT\s*=\s*\d+|FOREIGN_KEY_CHECKS|DEFINER\s*=/i);
  assert.doesNotMatch(sql, /(?:mysql:\/\/|postgres:\/\/|railway\.app|rlwy\.net|BEGIN PRIVATE KEY|\$2[aby]\$\d{2}\$|eyJ[\w-]+\.[\w-]+\.)/);
  // Empty users schema retains password/reset column names, never credential values.
  assert.doesNotMatch(executable, /\b(?:password|token|secret)\s*=\s*['"]/i);
});
test("exact table allowlist and pre-FY6 boundary", () => {
  assert.deepEqual(Object.keys(parents).sort(), [...required, "plans", "organizations", "opening_balance_events"].sort());
  assert.equal(required.filter(t => parents[t]).length, 15);
  assert.equal(Object.keys(future).length, 12);
  for (const t of Object.keys(future)) assert.ok(!parents[t], t);
  assert.doesNotMatch(executable, /uq_fy6_|payroll|annual_carry|carry_forward/i);
  assert.doesNotMatch(executable, /ALTER TABLE products\b/i);
});
test("legacy CREATE TABLE extraction is byte-equivalent apart from line endings and counters", () => {
  const snapshot = tables(read("railway-backup-before-po-grn.sql"));
  for (const name of [...required.filter(t => !t.startsWith("financial_year")), "plans", "organizations"]) {
    const normalize = s => s.replace(/\r/g, "").replace(/ AUTO_INCREMENT=\d+/g, "");
    assert.equal(normalize(parents[name].ddl), normalize(snapshot[name].ddl), name);
  }
});
test("signed journal/branch IDs and nullable FY links are preserved", () => {
  for (const t of ["journal_entries", "journal_entry_details", "branches"]) {
    assert.equal(type(parents[t].columns.id), "INT SIGNED");
    assert.match(parents[t].columns.id, /NOT NULL AUTO_INCREMENT/i);
  }
  assert.equal(type(parents.branches.columns.company_id), "INT SIGNED");
  assert.equal(type(parents.financial_years.columns.id), "BIGINT UNSIGNED");
  for (const t of core) {
    assert.match(parents[t].columns.financial_year_id, /^BIGINT UNSIGNED NULL$/i);
    assert.doesNotMatch(parents[t].columns.financial_year_id, /NOT NULL/i);
    assert.match(executable, new RegExp("ALTER TABLE " + t + " ADD INDEX idx_" + t + "_company_fy"));
    assert.match(executable, new RegExp("ALTER TABLE " + t + " ADD CONSTRAINT fk_" + t + "_company_fy"));
  }
});
test("later schema DDL and final FY vocabulary are provenance backed", () => {
  for (const file of [
    "2026-08-10-purchase-orders-grn.sql", "2026-08-18-subscription-foundation.sql",
    "2026-08-24-sales-invoice-advanced-fields.sql", "2026-08-26-cash-credit-sales-invoice-foundation.sql",
    "2026-08-26-sales-invoice-payment-settlement-foundation.sql"
  ]) {
    const source = read("db/migrations/" + file);
    for (const m of source.matchAll(/'((?:ALTER TABLE|CREATE (?:UNIQUE )?INDEX) (?:[^']|'')*)'/g)) {
      const ddl = m[1].replace(/''/g, "'");
      if (!/\b(?:plans|invoices|payments|bills)\b/.test(ddl) || /source_purchase_order_id INT/.test(ddl)) continue;
      assert.ok(executable.includes(ddl + ";"), file + ": " + ddl);
    }
  }
  assert.match(executable, /ALTER TABLE payments DROP INDEX uq_payments_receipt_entry;/);
  assert.match(executable, /CREATE INDEX idx_payments_receipt_entry ON payments \(receipt_entry_id\);/);
  const foundation = clean(read("db/migrations/2026-09-05-financial-year-foundation.sql"))
    .replace("'SET_DEFAULT',", "'SET_DEFAULT',\n    'OPEN',").trim();
  assert.ok(executable.includes(foundation), "exact foundation with OPEN vocabulary");
  assert.ok(executable.includes(clean(read("db/migrations/2026-08-02-opening-balance-equity.sql")).trim()));
});
test("bootstrap FK dependency closure, integer contracts and referenced keys", () => {
  const keys = Object.fromEntries(Object.entries(parents).map(([k,v]) => [k,v.keys]));
  for (const [child, t] of Object.entries(parents)) {
    for (const fk of t.body.matchAll(/FOREIGN KEY\s*\(([^)]+)\)\s*REFERENCES\s+[\x60]?(\w+)[\x60]?\s*\(([^)]+)\)/gi))
      checkFk(child, names(fk[1]), fk[2], names(fk[3]), parents, keys);
  }
  for (const t of core) checkFk(t, ["financial_year_id","company_id"], "financial_years", ["id","company_id"], parents, keys);
});
test("all FY6 FK types and keys are compatible, including migration-owned prerequisite indexes", () => {
  const all = { ...parents, ...future };
  const keys = Object.fromEntries(Object.entries(all).map(([k,v]) => [k,[...v.keys]]));
  const added = [...migration.matchAll(/CALL fy6c1_ensure_identity_scope_index\(\s*'(\w+)',\s*'(\w+)',\s*'(\w+)'\s*\)/g)];
  assert.equal(added.length, 12);
  for (const [,table,index,scope] of added) {
    assert.ok(parents[table].columns[scope]);
    assert.ok(!executable.includes(index), "FY6 must own " + index);
    keys[table].push("id," + scope);
  }
  const covered = new Set();
  let count = 0;
  for (const [child,t] of Object.entries(future)) {
    for (const fk of t.body.matchAll(/FOREIGN KEY\s*\(([^)]+)\)\s*REFERENCES\s+(\w+)\s*\(([^)]+)\)/gi)) {
      checkFk(child, names(fk[1]), fk[2], names(fk[3]), all, keys);
      if (parents[fk[2]]) covered.add(fk[2]);
      count++;
    }
  }
  assert.deepEqual([...covered].sort(), required.filter(t => t !== "financial_year_events").sort());
  assert.ok(parents.journal_entries.keys.includes("company_id,source_type,source_id"));
  console.log("FY6 contract matrix: " + covered.size + "/14 READY; " + count + " FK definitions checked; 12 migration-owned prerequisite keys.");
});
test("balanced SQL and exact stored-program boundary (not a MySQL execution proof)", () => {
  const masked = executable.replace(/'(?:''|\\.|[^'])*'/g, "''").replace(/[\x60][^\x60]*[\x60]/g, "identifier");
  let depth = 0;
  for (const c of masked) {
    if (c === "(") depth++;
    if (c === ")") depth--;
    assert.ok(depth >= 0, "unexpected closing parenthesis");
  }
  assert.equal(depth, 0);
  assert.equal((executable.match(/^DELIMITER \$\$$/gm) || []).length, 1);
  assert.equal((executable.match(/^DELIMITER ;$/gm) || []).length, 1);
  assert.equal((executable.match(/^CREATE TRIGGER /gm) || []).length, 4);
  assert.equal((executable.match(/^END\$\$$/gm) || []).length, 4);
  assert.doesNotMatch(executable, /\b(?:PROCEDURE|PREPARE|EXECUTE|CALL)\b/i);
});
test("frozen FY6 migration and existing focused test remain unchanged", () => {
  for (const [p,sha] of [
    ["db/migrations/2026-09-12-financial-year-close-foundation.sql","3a9d42b5a08ea87317ba84b478e2a1adb202cf26c483075a7279790398446856"],
    ["tests/financialYearCloseFoundationMigration.test.js","da82f3e17d880f6c9ad70696c1eb9cdfff002a2cc4e986073118afbc031be5e0"]
  ]) assert.equal(crypto.createHash("sha256").update(fs.readFileSync(path.join(root,p))).digest("hex"), sha);
});
