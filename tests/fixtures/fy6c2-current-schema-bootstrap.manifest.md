# FY-6C-2R2 schema-only bootstrap provenance

Prepared 2026-09-13. Review evidence only, not authoritative application migration history or production attestation. Source HEAD/origin/main: `3cbfa1a477c0e2bc3510cdcf998bdcfff18edcca`. No production inspection or database execution.

## Boundary and reconstruction method

Extract only the listed legacy CREATE TABLE statements from tracked `railway-backup-before-po-grn.sql`, stripping table-level AUTO_INCREMENT counters and normalizing line endings. Preserve column AUTO_INCREMENT, defaults, collations, nullability, constraints and indexes. Apply only independently understandable schema effects of subsequent tracked migrations. The snapshot is the base contract, not runtime-schema.sql. This is an empty-schema, one-shot fixture; it is not rerunnable after partial execution.

15 required tables plus plans/organizations FK support and opening_balance_events (explicitly requested opening-equity foundation): 18 tables. invoice_items/bill_items, ledger_entries/expenses, membership, payroll, inventory movements and subscriptions are not referenced parents and are excluded. opening_balance_events is included solely to satisfy the explicit opening-equity reconciliation requirement, not because FY6 references it.

The users password/reset column *definitions* are preserved; no users, passwords, hashes, tokens or other credential values are copied. All business DML, seeds, backfills, database selection, dump locks and environment settings are excluded. Trigger event clauses and SELECT FOR UPDATE are schema protection definitions, not business UPDATE statements. No minimal metadata rows are needed.

The untracked August 29 invitation/session-security migration is not part of the gated HEAD. Its proposed changes are not assumed applied and it remains untouched. This reconstruction asserts the repository-backed expected prerequisite subset, not the unobserved live schema.

## Legacy object provenance

All locations below refer to `railway-backup-before-po-grn.sql` at the gated HEAD.

| Table | CREATE line | Base contract / reason |
|---|---:|---|
| accounts | 25 | Signed INT PK; preserve all snapshot keys/types/defaults; required FY6 parent. |
| bills | 242 | Signed INT PK; preserve all snapshot keys/types/defaults; required FY6 parent. |
| branches | 280 | Signed INT PK/company; unique(company_id,code); FY6 branch scope. |
| companies | 355 | Signed INT PK; preserve all snapshot keys/types/defaults; required FY6 parent. |
| customers | 527 | Signed INT PK; preserve all snapshot keys/types/defaults; required FY6 parent. |
| invoices | 808 | Signed INT PK; preserve all snapshot keys/types/defaults; required FY6 parent. |
| journal_entries | 856 | Signed INT PK/company; signed BIGINT source_id; existing uq_journal_source; FY6 journal links. |
| journal_entry_details | 895 | Signed INT PK/journal/account FKs; FY6 line provenance. |
| organizations | 996 | Signed INT PK; parent of users, references plans. |
| payments | 1023 | Signed INT PK; preserve all snapshot keys/types/defaults; required FY6 parent. |
| plans | 1410 | Signed INT PK; parent of companies/organizations. |
| products | 1524 | Signed INT PK; preserve all snapshot keys/types/defaults; required FY6 parent. |
| users | 1976 | Signed INT PK; preserve all snapshot keys/types/defaults; required FY6 parent. |
| vendor_payments | 2052 | Signed INT PK; preserve all snapshot keys/types/defaults; required FY6 parent. |
| vendors | 2090 | Signed INT PK; preserve all snapshot keys/types/defaults; required FY6 parent. |

## Chronological migration review

Every tracked db/migrations SQL file was inspected. Earlier schema already represented by the snapshot is not replayed. Decisions:

- `db/migrations/2026-07-10-company-isolation.sql`: Company columns/indexes reflected in snapshot; exclude tenant backfill and NOT NULL conversion replay.
- `db/migrations/2026-07-27-petty-cash.sql`: Petty cash tables only; outside parent closure.
- `db/migrations/2026-07-28-recurring-invoices.sql`: Recurring invoice tables only; outside parent closure.
- `db/migrations/2026-07-29-invoice-customization.sql`: Invoice settings/custom fields only; outside parent closure.
- `db/migrations/2026-07-29-payment-entry-vendor.sql`: Journal vendor column already in snapshot. Earlier optional company/vendor index is absent in later snapshot; retain snapshot index contract, do not invent retrospective application.
- `db/migrations/2026-07-29-receipt-entries.sql`: Payments receipt ID/unique index already in snapshot; later August 28 changes uniqueness. Receipt tables are not FK parents of payments.
- `db/migrations/2026-08-01-vendor-payment-workflow.sql`: Vendor workflow, bill amounts and journal source identity already reflected; no status/balance recomputation.
- `db/migrations/2026-08-02-multi-company-branches.sql`: Real branches foundation at lines 29-53 matches snapshot signed INT identities and company/code key. Memberships are child tables, omitted. No memberships/head-office rows.
- `db/migrations/2026-08-02-opening-balance-equity.sql`: Opening balance events lines 2-20 included under explicit task requirement; INT journal FK retained; no balances/events seeded.
- `db/migrations/2026-08-09-barcode-module.sql`: Barcode child tables only; products already has barcode in snapshot.
- `db/migrations/2026-08-10-purchase-orders-grn.sql`: Bills GRN ID/stock_posted and PO/GRN indexes included; PO ID already exists. No FK to purchase orders/GRNs, so those tables excluded.
- `db/migrations/2026-08-12-grn-bill-item-link.sql`: bill_items GRN-item link only; not a parent dependency, omitted.
- `db/migrations/2026-08-18-subscription-foundation.sql`: Plans nullable code, catalogue limits/flags/metadata/timestamps and unique code included. Code backfill and subscriptions/events omitted; empty plans permits unique code without backfill.
- `db/migrations/2026-08-21-platform-admin-foundation.sql`: Platform-admin tables only; outside parent closure.
- `db/migrations/2026-08-24-sales-invoice-advanced-fields.sql`: Invoice header discount fields included; item columns/settings excluded.
- `db/migrations/2026-08-26-cash-credit-sales-invoice-foundation.sql`: Invoice cash/credit fields, checks and index included. No classification backfill.
- `db/migrations/2026-08-26-sales-invoice-payment-settlement-foundation.sql`: Invoice request identity/payment_status, checks/key and payment method widening included. No settlement/status backfill.
- `db/migrations/2026-08-28-customer-receipt-multi-invoice-allocation.sql`: Payments receipt uniqueness removed, nonunique index retained; allocation child table omitted.
- `db/migrations/2026-09-01-demo-requests.sql`: Demo requests only; outside parent closure.
- `db/migrations/2026-09-05-core-accounting-financial-year-links.sql`: Five included core tables gain nullable BIGINT UNSIGNED FY links and composite FK/index. ledger_entries/expenses omitted as neither are FK parents. No helper procedure/backfill.
- `db/migrations/2026-09-05-financial-year-foundation.sql`: Both FY tables and four overlap/append-only triggers included exactly; no FY rows. Apply before core links despite filename sort.
- `db/migrations/2026-09-09-financial-year-lifecycle-open-event.sql`: OPEN added to event_type; folded into CREATE definition.
- `db/migrations/2026-09-11-report-read-schema-foundation.sql`: Products optional columns all already exist with matching declared types/defaults. Add-if-missing effects are no-ops; no stock rewrite. Unrelated report tables omitted.

## Later DDL object provenance

These statements are copied from the source SQL string literal with doubled quotes decoded; guards and business DML are not copied. Each retained column/index/check statement is listed explicitly.

| Source location | Schema-only effect |
|---|---|
| db/migrations/2026-08-10-purchase-orders-grn.sql:79 | `ALTER TABLE bills ADD COLUMN source_grn_id BIGINT UNSIGNED NULL, ADD COLUMN stock_posted TINYINT(1) NOT NULL DEFAULT 1;` |
| db/migrations/2026-08-10-purchase-orders-grn.sql:83 | `CREATE INDEX idx_bills_company_po ON bills(company_id, source_purchase_order_id);` |
| db/migrations/2026-08-10-purchase-orders-grn.sql:87 | `CREATE INDEX idx_bills_company_grn ON bills(company_id, source_grn_id);` |
| db/migrations/2026-08-18-subscription-foundation.sql:22 | `ALTER TABLE plans ADD COLUMN code VARCHAR(50) NULL AFTER id;` |
| db/migrations/2026-08-18-subscription-foundation.sql:35 | `ALTER TABLE plans ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1 AFTER price;` |
| db/migrations/2026-08-18-subscription-foundation.sql:48 | `ALTER TABLE plans ADD COLUMN is_public TINYINT(1) NOT NULL DEFAULT 1 AFTER is_active;` |
| db/migrations/2026-08-18-subscription-foundation.sql:61 | `ALTER TABLE plans ADD COLUMN default_trial_days INT UNSIGNED NOT NULL DEFAULT 14 AFTER is_public;` |
| db/migrations/2026-08-18-subscription-foundation.sql:74 | `ALTER TABLE plans ADD COLUMN max_users INT UNSIGNED NULL AFTER default_trial_days;` |
| db/migrations/2026-08-18-subscription-foundation.sql:87 | `ALTER TABLE plans ADD COLUMN max_staff INT UNSIGNED NULL AFTER max_users;` |
| db/migrations/2026-08-18-subscription-foundation.sql:100 | `ALTER TABLE plans ADD COLUMN max_branches INT UNSIGNED NULL AFTER max_staff;` |
| db/migrations/2026-08-18-subscription-foundation.sql:113 | `ALTER TABLE plans ADD COLUMN sort_order INT NOT NULL DEFAULT 0 AFTER max_branches;` |
| db/migrations/2026-08-18-subscription-foundation.sql:126 | `ALTER TABLE plans ADD COLUMN metadata JSON NULL AFTER integrations;` |
| db/migrations/2026-08-18-subscription-foundation.sql:139 | `ALTER TABLE plans ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER metadata;` |
| db/migrations/2026-08-18-subscription-foundation.sql:152 | `ALTER TABLE plans ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;` |
| db/migrations/2026-08-18-subscription-foundation.sql:215 | `CREATE UNIQUE INDEX uq_plans_code ON plans(code);` |
| db/migrations/2026-08-24-sales-invoice-advanced-fields.sql:74 | `ALTER TABLE invoices ADD COLUMN overall_discount_type VARCHAR(10) NULL;` |
| db/migrations/2026-08-24-sales-invoice-advanced-fields.sql:81 | `ALTER TABLE invoices ADD COLUMN overall_discount_value DECIMAL(12,2) NOT NULL DEFAULT 0;` |
| db/migrations/2026-08-24-sales-invoice-advanced-fields.sql:88 | `ALTER TABLE invoices ADD COLUMN overall_discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0;` |
| db/migrations/2026-08-24-sales-invoice-advanced-fields.sql:95 | `ALTER TABLE invoices ADD COLUMN additional_discount_type VARCHAR(10) NULL;` |
| db/migrations/2026-08-24-sales-invoice-advanced-fields.sql:102 | `ALTER TABLE invoices ADD COLUMN additional_discount_value DECIMAL(12,2) NOT NULL DEFAULT 0;` |
| db/migrations/2026-08-24-sales-invoice-advanced-fields.sql:109 | `ALTER TABLE invoices ADD COLUMN additional_discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0;` |
| db/migrations/2026-08-24-sales-invoice-advanced-fields.sql:116 | `ALTER TABLE invoices ADD COLUMN round_off_amount DECIMAL(12,2) NOT NULL DEFAULT 0;` |
| db/migrations/2026-08-26-cash-credit-sales-invoice-foundation.sql:15 | `ALTER TABLE invoices ADD COLUMN invoice_type VARCHAR(10) NULL AFTER invoice_date;` |
| db/migrations/2026-08-26-cash-credit-sales-invoice-foundation.sql:25 | `ALTER TABLE invoices ADD COLUMN cash_customer_name VARCHAR(255) NULL AFTER customer_phone;` |
| db/migrations/2026-08-26-cash-credit-sales-invoice-foundation.sql:35 | `ALTER TABLE invoices ADD COLUMN cash_customer_mobile VARCHAR(50) NULL AFTER cash_customer_name;` |
| db/migrations/2026-08-26-cash-credit-sales-invoice-foundation.sql:45 | `ALTER TABLE invoices ADD COLUMN credit_days INT UNSIGNED NULL AFTER due_date;` |
| db/migrations/2026-08-26-cash-credit-sales-invoice-foundation.sql:55 | `ALTER TABLE invoices ADD COLUMN shipping_address TEXT NULL AFTER cash_customer_mobile;` |
| db/migrations/2026-08-26-cash-credit-sales-invoice-foundation.sql:68 | `ALTER TABLE invoices ADD CONSTRAINT chk_invoices_invoice_type CHECK (invoice_type IS NULL OR invoice_type IN ('CASH', 'CREDIT'));` |
| db/migrations/2026-08-26-cash-credit-sales-invoice-foundation.sql:81 | `ALTER TABLE invoices ADD CONSTRAINT chk_invoices_credit_days CHECK (credit_days IS NULL OR credit_days BETWEEN 0 AND 3650);` |
| db/migrations/2026-08-26-cash-credit-sales-invoice-foundation.sql:101 | `ALTER TABLE invoices ADD INDEX idx_invoices_company_type_date (company_id, invoice_type, invoice_date);` |
| db/migrations/2026-08-26-sales-invoice-payment-settlement-foundation.sql:25 | `ALTER TABLE invoices ADD COLUMN request_id VARCHAR(80) NULL AFTER id;` |
| db/migrations/2026-08-26-sales-invoice-payment-settlement-foundation.sql:49 | `ALTER TABLE invoices ADD UNIQUE INDEX uq_invoices_company_request (company_id, request_id);` |
| db/migrations/2026-08-26-sales-invoice-payment-settlement-foundation.sql:63 | `ALTER TABLE invoices ADD COLUMN payment_status VARCHAR(12) NULL AFTER status;` |
| db/migrations/2026-08-26-sales-invoice-payment-settlement-foundation.sql:77 | `ALTER TABLE invoices ADD CONSTRAINT chk_invoices_payment_status CHECK (payment_status IS NULL OR payment_status IN ('UNPAID', 'PARTIAL', 'PAID'));` |
| db/migrations/2026-08-26-sales-invoice-payment-settlement-foundation.sql:116 | `ALTER TABLE payments MODIFY COLUMN payment_method VARCHAR(40) NOT NULL;` |

| 2026-08-28-customer-receipt-multi-invoice-allocation.sql:11-33 | Drop uq_payments_receipt_entry; create nonunique idx_payments_receipt_entry(receipt_entry_id). |
| 2026-08-02-opening-balance-equity.sql:2-20 | opening_balance_events CREATE; journal_entry_id INT nullable FK; event sequence/journal unique keys. |
| 2026-09-05-financial-year-foundation.sql:4-35 | financial_years CREATE, BIGINT UNSIGNED PK, signed company/actor, unique(id,company_id), generated one-default key, date checks. |
| 2026-09-05-financial-year-foundation.sql:37-68 | financial_year_events CREATE; scoped FY FK, actor FK, indexes. |
| 2026-09-05-financial-year-foundation.sql:72-145 | Four exact overlap/append-only triggers; company-row locking preserved. |
| 2026-09-09-financial-year-lifecycle-open-event.sql:4-17 | Final event enum includes OPEN, folded into CREATE. |
| 2026-09-05-core-accounting-financial-year-links.sql:30-67 | invoices: financial_year_id BIGINT UNSIGNED NULL; idx_invoices_company_fy(company_id,financial_year_id); fk_invoices_company_fy(financial_year_id,company_id) -> financial_years(id,company_id). |
| 2026-09-05-core-accounting-financial-year-links.sql:30-67 | payments: financial_year_id BIGINT UNSIGNED NULL; idx_payments_company_fy(company_id,financial_year_id); fk_payments_company_fy(financial_year_id,company_id) -> financial_years(id,company_id). |
| 2026-09-05-core-accounting-financial-year-links.sql:30-67 | bills: financial_year_id BIGINT UNSIGNED NULL; idx_bills_company_fy(company_id,financial_year_id); fk_bills_company_fy(financial_year_id,company_id) -> financial_years(id,company_id). |
| 2026-09-05-core-accounting-financial-year-links.sql:30-67 | vendor_payments: financial_year_id BIGINT UNSIGNED NULL; idx_vendor_payments_company_fy(company_id,financial_year_id); fk_vendor_payments_company_fy(financial_year_id,company_id) -> financial_years(id,company_id). |
| 2026-09-05-core-accounting-financial-year-links.sql:30-67 | journal_entries: financial_year_id BIGINT UNSIGNED NULL; idx_journal_entries_company_fy(company_id,financial_year_id); fk_journal_entries_company_fy(financial_year_id,company_id) -> financial_years(id,company_id). |

## Parent / FY6 compatibility matrix

READY means static type/signedness/key compatibility, not executed MySQL validation. All 59 FY6 FK definitions are compared, including internal FY6 parents. The 12 prerequisite keys below are deliberately absent until FY6's ensure_identity_scope_index calls add them. No prerequisite-key name collision exists. Existing uq_journal_source(company_id,source_type,source_id) is retained.

| Parent | Identity / scope types | Referenced unique key availability | Result |
|---|---|---|---|
| companies | INT signed | PK(id), existing | READY |
| users | id/company_id INT signed (legacy nullability preserved) | (id,company_id), added by FY6 uq_fy6_users_id_company | READY |
| accounts | id/company_id INT signed (legacy nullability preserved) | (id,company_id), added by FY6 uq_fy6_accounts_id_company | READY |
| branches | id/company_id INT signed (legacy nullability preserved) | (id,company_id), added by FY6 uq_fy6_branches_id_company | READY |
| customers | id/company_id INT signed (legacy nullability preserved) | (id,company_id), added by FY6 uq_fy6_customers_id_company | READY |
| vendors | id/company_id INT signed (legacy nullability preserved) | (id,company_id), added by FY6 uq_fy6_vendors_id_company | READY |
| products | id/company_id INT signed (legacy nullability preserved) | (id,company_id), added by FY6 uq_fy6_products_id_company | READY |
| invoices | id/company_id INT signed (legacy nullability preserved) | (id,company_id), added by FY6 uq_fy6_invoices_id_company | READY |
| payments | id/company_id INT signed (legacy nullability preserved) | (id,company_id), added by FY6 uq_fy6_payments_id_company | READY |
| bills | id/company_id INT signed (legacy nullability preserved) | (id,company_id), added by FY6 uq_fy6_bills_id_company | READY |
| vendor_payments | id/company_id INT signed (legacy nullability preserved) | (id,company_id), added by FY6 uq_fy6_vendor_payments_id_company | READY |
| journal_entries | id/company_id INT signed (legacy nullability preserved) | (id,company_id), added by FY6 uq_fy6_journal_entries_id_company | READY |
| journal_entry_details | id/journal_entry_id INT signed | (id,journal_entry_id), added by FY6 uq_fy6_journal_details_id_journal | READY |
| financial_years | id BIGINT UNSIGNED / company_id INT signed | (id,company_id), existing uq_financial_years_id_company | READY |

financial_year_events is required foundation evidence but is not a future FY6 FK parent. Its FY and actor references pass bootstrap dependency checks. The legacy vendor_payments.journal_entry_id is signed BIGINT without an FK; it is not the FY6 reversal journal FK and is not widened/narrowed.

## Validation and limitations

R2 results: bootstrap static test 9/9 PASS; frozen FY6 focused test 8/8 PASS. Relevant regressions financialYearService, financialYearLifecycle and financialYearTransactionAssignment: 30/30 PASS; accountingSummary/control-account regression PASS. Regression modules ran with an in-memory loader guard replacing db/connection and mysql2 imports with throwing stubs: zero DB access attempts. No runtime/test file was changed to install that guard. Lifecycle/accounting activity in these tests uses mocks only.

Static test reads SQL only (Node built-ins); no driver, application boot or SQL executor. It validates exact base extraction, source-backed later DDL, the table allowlist, forbidden operations, all parent types/keys, nullable FY links, four exact source triggers, delimiter/parenthesis structure and frozen FY6 hashes. These checks are not a complete MySQL parser or live-schema proof.

FY6 migration remains SHA256 3a9d42b5a08ea87317ba84b478e2a1adb202cf26c483075a7279790398446856.
Existing focused test remains SHA256 da82f3e17d880f6c9ad70696c1eb9cdfff002a2cc4e986073118afbc031be5e0.

## Exact gated R3 execution plan (not executed in R2)

1. Obtain separate explicit R3 authorization. Recheck HEAD/origin, tracked cleanliness, 22 unrelated paths/digest, both frozen hashes, and the three approved R2 artifact hashes.
2. Identify a disposable local-only MySQL 8 server supporting utf8mb4_0900_ai_ci, enforced CHECKs and CREATE TRIGGER IF NOT EXISTS (8.0.29+ or a separately validated compatible 8.x version). Pin host to loopback; reject inherited application/production configuration. Verify server identity/version and a unique, expressly approved empty disposable database name before any schema write. Never restore the full dump or read application secrets.
3. Create only that approved disposable database using separately authorized local credentials. Record identity. Supply its name externally to the MySQL client; do not add USE/CREATE DATABASE to this fixture.
4. Apply the approved bootstrap once with a delimiter-aware MySQL client, without --force and without disabling FK checks. Stop at any error; do not retry a partially applied fixture.
5. Inspect information_schema for all 18 tables, FK types/keys, four triggers, FY nullability and zero rows in every table. Verify all 12 FY6 tables and 12 FY6 prerequisite indexes are absent.
6. Apply the hash-verified frozen FY6 migration once. Stop on any error without source repair or automatic retry.
7. Verify 12 additive tables, 12 newly added prerequisite indexes, all FY6 FKs/checks/triggers, immutable definitions, and unchanged legacy column contracts; all 30 tables must remain empty. Compare pre/post schema and ensure no payroll FY or product stock changes.
8. Only if separately authorized in R3, rerun FY6 to test intended idempotence and/or perform synthetic constraint probes in this disposable database. Do not treat rollback as undoing DDL. No business rows from production.
9. Record results and exact target identity. Cleanup/drop only the expressly authorized disposable database after revalidating its identity; otherwise retain it and report. No production, commits, pushes, deploys, runtime changes or next-phase implementation.

Decision: A. SCHEMA-ONLY BOOTSTRAP REVIEWED — READY FOR DISPOSABLE MYSQL EXECUTION, subject to separate R3 approval and all execution gates above. No concrete parent type/key mismatch found. MySQL syntax/server-version/execution behavior remains unproven until R3.
