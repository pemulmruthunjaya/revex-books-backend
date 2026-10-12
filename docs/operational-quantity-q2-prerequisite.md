# Q2 operational quantity prerequisite (local review only)

This is a separate additive **type-widening prerequisite**, not a backfill or a
valuation/cost repair. No automatic startup, migration discovery, connection,
environment loading or CLI execution is provided. Existing migration artifacts
remain immutable. No production execution is authorized by implementation.

## Frozen contract and execution

`db/migrations/2026-10-12-operational-quantity-q2.sql` is the versioned DDL contract.
Its canonical LF SHA-256 is
`7d603879628055eddbd106f848b848cd9aaa52ad1f156bdc5a6f5031dd5a0b34`.
Never execute this SQL standalone. The matching `.js` adapter verifies the hash
and exact two statements before inspecting or executing anything. Importing it
does nothing. A separately authorized operator supplies a **dedicated, idle,
autocommit mysql2 connection**, never a pool or application transaction, and calls
`migrate(connection, { confirmation: 'APPLY_OPERATIONAL_QUANTITY_Q2_V1', dedicatedConnection: true })`.
The operator must close the connection on success/failure (including uncertain
network results). Schedule maintenance: write locks block customer traffic.
The runner rejects pools, pooled leases and forwarding executors. It validates
mysql2 physical connection identity, captures its driver/socket, and verifies
CONNECTION_ID/database and unchanged transport before commands. Cleanup uses
that original transport; failed cleanup destroys it rather than releasing a
possibly locked connection for reuse.

Only `products.stock` and `bill_items.quantity` become `DECIMAL(12,2)`.
Accepted sources are signed `INT` (including equivalent display-width rendering)
or exact already-applied `DECIMAL(12,2)`, both nullable; stock default is zero,
bill quantity default is NULL. Any other nullability/default/type is a conflict,
not permission to normalize it. Negative historical quantities and NULLs are
preserved, not interpreted or repaired. Range is ±9,999,999,999.99. Values are
read as text and checked using BigInt; nonzero fractional digits beyond Q2 or
range overflow fail without rounding/coercion. The application's existing
smaller DECIMAL(10,2)-based operational cap remains unchanged.

Both schemas and all values are preflighted **before any DDL**. InnoDB base
tables, stable single-column integer primary keys, owned column attributes,
indexes, inbound/outbound FK dependencies, checks, triggers and complete SHOW
CREATE definitions are inspected. Unsupported quantity indexes/FKs/checks,
generated/functional/invisible columns, partitions and nondefault table options
fail closed. Unrelated schema clauses are retained and fingerprinted exactly;
only verified owned type/default rendering is normalized. This is deliberately
not a generic schema repair tool.

The runner locks **both tables WRITE**, repeats the full preflight under locks,
then alters only missing columns. Explicit MySQL LOCK TABLES locks survive ALTER
implicit commits; no BEGIN/COMMIT is issued. Any DDL warning is a failure. All
columns of every row are fingerprinted in primary-key order using binary hex
representations; owned numeric values use canonical signed Q2 units so INT and
DECIMAL rendering compare equally. Counts, complete row fingerprints, unrelated
schema and exact target definitions must match postflight before locks release.
No row contents are returned or logged. Hashes are preservation evidence, not a
backup. Do not log driver errors with sensitive row content.
Pagination compares the textual cursor with an explicit DECIMAL(20,0) cast,
including signed/unsigned BIGINT IDs above 2^53. Every scan reconciles its row
count against independent COUNT(*) reads before and after pagination.

Fresh, already-applied and either compatible partial state are supported. DDL
cannot be rolled back. On failure/disconnection stop; **no automatic retry or
reverse ALTER**. Review evidence and separately authorize resumption. A resumed
invocation proves its current values are unchanged, not that an earlier external
change never occurred; retain prior verification evidence and backup. Do not
narrow populated Q2 columns back to INT for rollback.

## Application compatibility audit

- `controllers/invoiceController.js`: mysql2 DECIMAL values are strings. Corrected
  the creation-path stock comparison from possible string lexicographic ordering
  to the existing exact Q2 parser. Targeted executable controller tests cover
  `10.00` versus `2.00`, the converse and fractional quantities.
- `controllers/billController.js`, `controllers/goodsReceiptController.js`:
  existing quantity validation, partial billing and corrections use canonical
  fixed-point quantities; stock arithmetic is performed in SQL. No integer-only
  quantity parsing found; no changes necessary.
- `services/inventoryValuation*`, `services/inventoryGl*`: existing fixed-point
  parsing/readiness accept DECIMAL text and retain Q2-to-Q6 reconciliation.
- `routes/productRoutes.js`, `services/productStockSafety.js`: new stock remains
  zero-only; direct stock edits remain prohibited. Display/comparison conversion
  is not integer truncation and update SQL does not write either stock column.
- Reporting uses SQL aggregates or numeric display conversion; no integer-only
  quantity assumption requiring changes found. Unsupported outbound flows and
  returns retain existing containment. No policy/cost inference was introduced.

## Validation and rollout

Mocked tests cover both partial states, pre-DDL conflicts/races, boundaries,
pagination, exact values/counts, warnings, interrupted resumption and preservation
failures. Guarded MySQL tests are **authored but not executed**. They require
separate authorization, official MySQL 9.7.2, loopback host port 3407/internal
3306, fresh preallocated `q2_proof_<32 hex>` database and `q2_test_<16 hex>` nonroot
user. The wrapper (not this test) must grant exactly the database-only privileges
listed in `tests/helpers/q2MysqlGuard.js`, including LOCK TABLES. No global grant
or wildcard database scope is accepted. Credentials remain process-scoped.
The suite proves actual ALTER preservation and lock exclusion after each ALTER,
and interrupted/resumed DDL. Preserve stopped disposable evidence for review.

Safe rollout order after independent review and isolated MySQL proof: backup and
fresh preflight → separately authorize Q2 prerequisite → verify unchanged data
and schema → valuation migration → annual carry-forward migration → GL protection
→ read-only readiness review → separately approved deployment/roles/cutover.
The prior production compatibility report does not authorize any of these writes.
