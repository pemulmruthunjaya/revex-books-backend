const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const annual = require("../services/annualSubledgerService");
const readiness = require("../services/annualSubledgerReadinessService");
const { buildPreview } = require("../services/financialYearCloseService");

test("annual money parsing is fixed-point and rejects excess precision", () => {
  assert.equal(annual.minor("0.10") + annual.minor("0.20"), 30n);
  assert.equal(annual.money(annual.minor("9999999999999.99")), "9999999999999.99");
  assert.throws(() => annual.minor("1.001"), { code: "ANNUAL_INVALID_AMOUNT" });
});

test("manual selection is unique, positive, and exactly totals the requested payment", () => {
  const rows = annual.normalizeSelection({ amount: "15.30", opening_allocations: [
    { opening_item_id: 9, amount: "10.10", expected_remaining: "20.00" },
    { opening_item_id: 3, amount: "5.20", expected_remaining: "9.00" },
  ] });
  assert.deepEqual(rows.map((row) => row.id), [3, 9]);
  assert.throws(() => annual.normalizeSelection({ amount: "1.00", opening_allocations: [
    { opening_item_id: 1, amount: "1.00", expected_remaining: "2.00" },
    { opening_item_id: 1, amount: "0.00", expected_remaining: "2.00" },
  ] }), { code: "ANNUAL_INVALID_SELECTION" });
  assert.throws(() => annual.normalizeSelection({ amount: "1.01", opening_allocations: [
    { opening_item_id: 1, amount: "1.00", expected_remaining: "2.00" },
  ] }), { code: "ANNUAL_ALLOCATION_TOTAL_MISMATCH" });
  assert.throws(() => annual.normalizeSelection({ amount: "1.00", bill_id: 2, opening_allocations: [
    { opening_item_id: 1, amount: "1.00", expected_remaining: "2.00" },
  ] }), { code: "ANNUAL_MIXED_SELECTION" });
});

test("settlement scope, current residual, idempotent replay and affected-row checks fail closed", async () => {
  const item = { company_id: 4, financial_year_id: 12, party_type: "CUSTOMER", customer_id: 30, origin: "ANNUAL_CARRY_FORWARD", entry_kind: "ORIGINAL" };
  annual.assertOpeningItemScope(item, { companyId: 4, fyId: 12, partyId: 30, partyType: "CUSTOMER" });
  for (const [changed, scope] of [
    [{ company_id: 5 }, { companyId: 4, fyId: 12, partyId: 30, partyType: "CUSTOMER" }],
    [{ customer_id: 31 }, { companyId: 4, fyId: 12, partyId: 30, partyType: "CUSTOMER" }],
    [{ financial_year_id: 13 }, { companyId: 4, fyId: 12, partyId: 30, partyType: "CUSTOMER" }],
    [{ origin: "ONBOARDING" }, { companyId: 4, fyId: 12, partyId: 30, partyType: "CUSTOMER" }],
  ]) assert.throws(() => annual.assertOpeningItemScope({ ...item, ...changed }, scope), { code: "ANNUAL_ITEM_SCOPE_MISMATCH" });
  const selected = { amount: "60.00", expectedRemaining: "60.00" };
  annual.assertExpectedBalance("60.00", selected);
  assert.throws(() => annual.assertExpectedBalance("59.00", selected), { code: "ANNUAL_STALE_BALANCE" });
  assert.throws(() => annual.assertExpectedBalance("50.00", { amount: "51.00", expectedRemaining: "50.00" }), { code: "ANNUAL_OVER_ALLOCATION" });
  annual.assertReplayMatches([{ request_fingerprint: "f" }], [{}], "f");
  assert.throws(() => annual.assertReplayMatches([{ request_fingerprint: "other" }], [{}], "f"), { code: "ANNUAL_IDEMPOTENCY_CONFLICT" });
  await assert.rejects(annual.write({ async query() { return [{ affectedRows: 0 }]; } }, "UPDATE x", [], 1), { code: "ANNUAL_WRITE_CONFLICT" });
});

test("remaining balance is derived from immutable allocations plus reversal evidence", async () => {
  let sql;
  const result = await annual.remaining({ async query(statement) { sql = statement; return [[{ allocated: "35.00", reversed: "5.00" }]]; } },
    { id: 9, company_id: 4, original_amount: "100.00" }, "2027-03-31");
  assert.equal(result, "70.00");
  assert.match(sql, /annual_subledger_allocation_reversals/);
  assert.match(sql, /settlement_date<=\?/);
});

test("scope lock takes the tenant row before membership and exact open business year", async () => {
  const calls = [];
  const value = await annual.lockScope({ async query(sql) {
    calls.push(sql);
    if (sql.includes("FROM companies")) return [[{ id: 4 }]];
    if (sql.includes("user_company_memberships")) return [[{ membership_role: "staff" }]];
    return [[{ id: 12, status: "OPEN" }]];
  } }, 4, 13, "2027-02-28");
  assert.equal(value, 12);
  assert.match(calls[0], /FOR UPDATE/);
  assert.match(calls[1], /is_active=1/);
  assert.match(calls[2], /company_id=\?.*FOR UPDATE/);
  await assert.rejects(annual.lockScope({ async query(sql) { return sql.includes("FROM companies") ? [[{ id: 4 }]] : sql.includes("user_company_memberships") ? [[{ membership_role: "staff" }]] : [[{ id: 12, status: "CLOSED" }]]; } }, 4, 13, "2027-02-28"), { code: "ANNUAL_OPEN_FY_REQUIRED" });
});

test("uncertain transaction commit disposes its connection and does not retry writes", async () => {
  let writes = 0, destroyed = 0, released = 0;
  const connection = { beginTransaction: async () => {}, query: async () => { writes++; return [[], []]; }, commit: async () => { throw new Error("commit unknown"); },
    rollback: async () => {}, destroy: () => { destroyed++; }, release: () => { released++; } };
  await assert.rejects(annual.transaction({ async getConnection() { return connection; } }, async cx => { await cx.query("INSERT"); return true; }), { code: "ANNUAL_COMMIT_UNCERTAIN" });
  assert.equal(writes, 1);
  assert.equal(destroyed, 1);
  assert.equal(released, 0);
});

test("readiness rejects absent or incomplete annual schema without issuing writes", async () => {
  const statements = [];
  const result = await readiness.inspectAnnualSchema({ async query(sql) { statements.push(sql); return [[]]; } });
  assert.equal(result.ready, false);
  assert.ok(result.blockers.length);
  assert.ok(statements.every((sql) => /^(SELECT|SHOW)/i.test(sql.trim())));
});

const schemaMetadata = () => {
  const tables = ["subledger_opening_items", "financial_year_close_runs", "annual_subledger_allocations", "annual_subledger_allocation_reversals"]
    .map(TABLE_NAME => ({ TABLE_NAME, ENGINE: "InnoDB", TABLE_TYPE: "BASE TABLE" }));
  const cs = Object.entries(readiness.columns).flatMap(([TABLE_NAME, fields]) => Object.entries(fields).map(([COLUMN_NAME, [COLUMN_TYPE, IS_NULLABLE]]) => ({ TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE })));
  const ks = Object.entries(readiness.foreignKeys).flatMap(([CONSTRAINT_NAME, [TABLE_NAME, fields, REFERENCED_TABLE_NAME, refs]]) => fields.split(",").map((COLUMN_NAME, index) => ({ TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME: refs.split(",")[index], ORDINAL_POSITION: index + 1 })));
  const rs = Object.keys(readiness.foreignKeys).map(CONSTRAINT_NAME => ({ CONSTRAINT_NAME, DELETE_RULE: "RESTRICT", UPDATE_RULE: "RESTRICT" }));
  const ix = Object.entries(readiness.indexes).flatMap(([INDEX_NAME, [TABLE_NAME, fields]]) => fields.split(",").map((COLUMN_NAME, index) => ({ INDEX_NAME, TABLE_NAME, COLUMN_NAME, NON_UNIQUE: 0, SEQ_IN_INDEX: index + 1 })));
  Object.entries(readiness.foreignKeys).forEach(([, [, , TABLE_NAME, refs]], index) => {
    const INDEX_NAME = `test_fk_target_${index}`;
    refs.split(",").forEach((COLUMN_NAME, ordinal) => ix.push({ TABLE_NAME, INDEX_NAME, COLUMN_NAME, NON_UNIQUE: 0, SEQ_IN_INDEX: ordinal + 1 }));
  });
  const ts = Object.entries(readiness.triggers).map(([TRIGGER_NAME, [EVENT_OBJECT_TABLE, EVENT_MANIPULATION, ...bodies]]) => ({
    TRIGGER_NAME, EVENT_OBJECT_TABLE, EVENT_MANIPULATION, ACTION_TIMING: "BEFORE", ACTION_STATEMENT: bodies.join(" "),
  }));
  const ch = readiness.checks.map(CONSTRAINT_NAME => ({ CONSTRAINT_NAME, ENFORCED: "YES" }));
  const clauses = readiness.checks.map(CONSTRAINT_NAME => ({ CONSTRAINT_NAME, CHECK_CLAUSE: readiness.checkFragments[CONSTRAINT_NAME].join(" AND ") }));
  return { tables, cs, ks, rs, ix, ts, ch, clauses };
};

test("readiness accepts exact annual contracts and rejects incompatible columns, keys, checks, and triggers", async () => {
  const metadata = schemaMetadata();
  const executor = async () => ({ async query(sql) {
    if (sql.includes("information_schema.TABLES")) return [metadata.tables];
    if (sql.includes("information_schema.COLUMNS")) return [metadata.cs];
    if (sql.includes("information_schema.KEY_COLUMN_USAGE")) return [metadata.ks];
    if (sql.includes("information_schema.REFERENTIAL_CONSTRAINTS")) return [metadata.rs];
    if (sql.includes("information_schema.STATISTICS")) return [metadata.ix];
    if (sql.includes("information_schema.TRIGGERS")) return [metadata.ts];
    if (sql.includes("information_schema.TABLE_CONSTRAINTS")) return [metadata.ch];
    if (sql.includes("information_schema.CHECK_CONSTRAINTS")) return [metadata.clauses];
    throw new Error("unexpected schema query");
  } });
  assert.equal((await readiness.inspectAnnualSchema(await executor())).ready, true);
  metadata.cs.find(row => row.TABLE_NAME === "annual_subledger_allocations" && row.COLUMN_NAME === "amount").COLUMN_TYPE = "double";
  assert.equal((await readiness.inspectAnnualSchema(await executor())).ready, false);
});

test("annual migration establishes additive provenance, fixed-point constraints, and immutable evidence", () => {
  const sql = fs.readFileSync(path.join(__dirname, "../db/migrations/2026-10-04-annual-subledger-carry-forward.sql"), "utf8");
  for (const fragment of ["ANNUAL_CARRY_FORWARD", "original_invoice_id", "original_bill_id", "original_opening_item_id",
    "original_financial_year_id", "predecessor_opening_item_id", "close_run_id", "carry_source_financial_year_id",
    "annual_subledger_allocations", "annual_subledger_allocation_reversals", "DECIMAL(15,2)",
    "uq_annual_invoice_destination", "uq_annual_bill_destination", "chk_annual_allocation_amount",
    "trg_annual_opening_no_delete", "trg_annual_allocations_no_update", "trg_annual_allocations_no_delete", "trg_annual_reversals_no_update",
    "trg_annual_reversals_no_delete"]) assert.ok(sql.includes(fragment), `missing migration contract ${fragment}`);
  assert.match(sql, /REFERENCES invoices\(id,company_id,financial_year_id\)/);
  assert.match(sql, /REFERENCES bills\(id,company_id,financial_year_id\)/);
});

const previewInput = (destinationStatus = "OPEN") => ({
  source: { id: 10, status: "RECONCILIATION", start_date: "2026-04-01", end_date: "2027-03-31" },
  years: [
    { id: 10, start_date: "2026-04-01", end_date: "2027-03-31", status: "RECONCILIATION" },
    { id: 11, start_date: "2027-04-01", end_date: "2028-03-31", status: destinationStatus },
  ],
  accounts: [
    { id: 1, account_type: "ASSET", status: 1 }, { id: 2, account_type: "ASSET", status: 1 },
    { id: 3, account_type: "LIABILITY", status: 1 }, { id: 4, account_type: "EQUITY", status: 1 },
    { id: 5, account_type: "EQUITY", status: 1 }, { id: 6, account_type: "INCOME", status: 1 },
  ],
  roles: ["CASH", "ACCOUNTS_RECEIVABLE", "ACCOUNTS_PAYABLE", "RETAINED_EARNINGS", "OPENING_BALANCE_EQUITY"].map((role, i) => ({
    role, account_id: i + 1, from_date: "2026-04-01", to_date: null,
  })),
  journals: [
    { id: 1, financial_year_id: 10, journal_date: "2026-04-05", status: 1, total_debit: "100.00", total_credit: "100.00" },
    { id: 2, financial_year_id: 10, journal_date: "2027-02-05", status: 1, total_debit: "40.00", total_credit: "40.00" },
  ],
  details: [
    { journal_entry_id: 1, account_id: 2, debit: "100.00", credit: "0.00" },
    { journal_entry_id: 1, account_id: 6, debit: "0.00", credit: "100.00" },
    { journal_entry_id: 2, account_id: 1, debit: "40.00", credit: "0.00" },
    { journal_entry_id: 2, account_id: 2, debit: "0.00", credit: "40.00" },
  ],
  invoices: [{ id: 50, financial_year_id: 10, total_amount: "100.00", allocated_amount: "40.00", status: "Posted", party_id: 70, reference: "INV-50", business_date: "2026-04-05" }],
  bills: [], openings: [], products: [], movements: [], records: [], fingerprint_inputs: {},
  inventory_gl: { ready: true, blockers: [], inventory: [], fingerprint: require("../services/inventoryValuationMath").fingerprint([]) },
});

test("reviewed close preview carries only exact residual into one adjacent open FY", () => {
  const result = buildPreview(previewInput());
  assert.equal(result.ready, true, JSON.stringify(result.blockers));
  assert.equal(result.subledger.length, 1);
  assert.equal(result.subledger[0].amount, "60.00");
  assert.equal(result.subledger[0].original_invoice_id, 50);
  assert.equal(result.destination_id, 11);
  const blocked = buildPreview(previewInput("DRAFT"));
  assert.equal(blocked.ready, false);
  assert.ok(blocked.blockers.some((row) => row.code === "FY_DESTINATION_STATUS_INCOMPATIBLE"));
});

test("close preview requires persisted GL reconciliation, including zero-stock years", () => {
  const input = previewInput();
  delete input.inventory_gl;
  let result = buildPreview(input);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.some(row => row.code === "GL_COGS_RECONCILIATION_NOT_IMPLEMENTED"));
  input.inventory_gl = { ready: false, blockers: ["IV_GL_PROVISIONAL_GRNI_UNRESOLVED"], inventory: [], fingerprint: "a".repeat(64) };
  result = buildPreview(input);
  assert.equal(result.ready, false);
  assert.ok(result.blockers.some(row => row.code === "IV_GL_PROVISIONAL_GRNI_UNRESOLVED"));
  input.inventory_gl = { ready: true, blockers: [], inventory: [], fingerprint: "a".repeat(64), account_roles: { ACCOUNTS_PAYABLE: "999" } };
  assert.ok(buildPreview(input).blockers.some(row => row.code === "FY_GL_AP_ROLE_MISMATCH"));
});

test("multi-year carry preserves root origin and predecessor while carrying only the residual", () => {
  const input = previewInput();
  input.journals = [{ id: 3, financial_year_id: 10, journal_date: "2027-02-01", status: 1, total_debit: "60.00", total_credit: "60.00" }];
  input.details = [
    { journal_entry_id: 3, account_id: 2, debit: "60.00", credit: "0.00" },
    { journal_entry_id: 3, account_id: 6, debit: "0.00", credit: "60.00" },
  ];
  input.invoices = [];
  input.openings = [{ id: 90, party_type: "CUSTOMER", customer_id: 70, vendor_id: null, origin: "ANNUAL_CARRY_FORWARD", entry_kind: "ORIGINAL",
    financial_year_id: 10, original_financial_year_id: 8, original_invoice_id: 50, original_bill_id: null, original_opening_item_id: null,
    predecessor_opening_item_id: 80, original_amount: "80.00", remaining_amount: "60.00", direction: "DEBIT", reference: "INV-50",
    effective_date: "2026-04-01", due_date: null }];
  const result = buildPreview(input);
  assert.equal(result.ready, true, JSON.stringify(result.blockers));
  assert.deepEqual(result.subledger.map(({ amount, original_invoice_id, original_financial_year_id, original_opening_item_id, predecessor_opening_item_id }) =>
    ({ amount, original_invoice_id, original_financial_year_id, original_opening_item_id, predecessor_opening_item_id })), [
    { amount: "60.00", original_invoice_id: 50, original_financial_year_id: 8, original_opening_item_id: null, predecessor_opening_item_id: 90 },
  ]);
});
