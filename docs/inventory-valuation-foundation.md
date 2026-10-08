# Immutable inventory valuation prerequisite — local review draft

## Independent-audit corrections

Partial GRN finalization consumes each claimed document-component source share
once. The unbilled remainder prorates only the unclaimed provisional basis;
component revisions retain root identity, including discounts and capitalized tax.
Cost-only edits resolve the latest stock/cost replacement and retain its current
acquisition source without changing physical stock.

Readiness reconciles active bill quantities, purchase/tax amounts, dates and GRN
references, plus posted GRN quantities and status, against immutable evidence.
The complete sorted operational rows participate in the snapshot fingerprint.
Database guards independently enforce BILL_LINK/COST quantity equality and
OPENING source/basis identity. Guarded malformed-insert cases first prove an
otherwise-valid insert, then assert the specific intended SQL error and rollback.

Frozen SQL SHA-256: `00a89a4d94e1d56b1bf4640dce4fa542ce2467d6541e1d1ea598adf1cc9529af`.
The import-inert runner contains the matching frozen compatibility contract.

## Review and rollout boundary

This phase supplies independently reviewable persistence, evidence preparation,
and narrowly scoped bill/GRN integration. It does not connect the FY-close engine.
The existing FY-close paths are unchanged. Return mutation endpoints remain
disabled. Sales, transfers, challans and other unintegrated historical movement
paths remain readiness blockers; costs are never reconstructed from prices.

`GL_COGS_RECONCILIATION_NOT_IMPLEMENTED` is always returned by readiness.
`valuation_ready` is a separate valuation-only diagnostic, never authorization
to close a financial year.

Guarded MySQL proofs have been authored, not executed. Database compatibility,
trigger execution and actual lock behavior still require a separately authorized
isolated MySQL proof and independent review. Do not deploy this draft or run its
migration merely because the mocked regressions pass.

## Evidence workflow and authorization

The evidence router is mounted at `/valuation` within the existing bill and
goods-receipt routers. Existing authentication/module permissions apply, plus
the corresponding bills/purchase-orders create permission. Company and actor
identity come only from authentication. Mutation bodies have explicit allowlists.

POST operations:

- `acquisition`: immutable source document/line, permanent UUID and reference.
- `component`: document/component identity, complete recipient acquisition UUIDs,
  explicit allocation basis, weights, authoritative total and supporting reference.
- `cost`: provisional/final cost revision with optional predecessor UUID.
- `submit`, `approve`, `reject`: deliberate immutable review records.
- `opening`: consumes an explicitly prepared, final, separately approved opening.
- `correction`, `approve-correction`: explicit direct-stock bill correction
  proposal and owner decision.

GET `history/:product_id` and `readiness` are read-only. Approval, rejection
and correction approval require an active owner, checked again in the service.
The opening-cost preparer must not approve their own opening.

No operation silently creates an opening, cost or approval while posting.
Clients lacking approved evidence receive a fixed fail-closed error. This backend
API is the supported preparation path; an evidence-management frontend is not
part of this prerequisite.

## Fixed-point contract

The valuation engine uses Q6 integer quantities and integer minor currency units.
Operational quantities must be exactly Q2-representable. Inputs are canonical
unsigned decimal strings, optionally up to six fractional places with only zeros
after the second. Whole nonnegative safe JSON integers remain accepted; fractional
JSON numbers are rejected because their original decimal spelling is lost.

The shared operational maximum is 99,999,999.99 (DECIMAL(10,2)).
`INVENTORY_QUANTITY_PRECISION_UNSUPPORTED` rejects precision, notation, signs,
malformation and overflow before evidence/business DML or DDL. Original evidence
spelling is preserved; operational SQL receives exact two-decimal strings.
Q2 multiplied by 10,000 must equal Q6. No truncation or MySQL coercion is used.

Bill extension, tax calculation, partial coverage and stock deltas use fixed-point
arithmetic. Currency uses deterministic half-up rounding; tax split retains the
exact total. Aggregate document overflow is rejected. Replay also bounds aggregate
quantity/value, disallows negative stock/value and zero-quantity residual value,
and consumes the exact remaining value on full depletion.

Six-decimal operational columns are a separately reviewed future enhancement.
This migration never widens existing quantity columns.

## Immutable storage and locking

Four additive tables:

- `iv_operations`: completed operation key, request fingerprint, actor, action
  and original result; append-only. No incomplete operation is committed.
- `iv_product_locks`: explicit tenant/product coordination.
- `iv_date_sequences`: transaction-owned company/product/date sequence.
- `iv_records`: permanent acquisitions, component versions, cost revisions,
  submission/review, opening/receipt/issues, reversal/replacement, bill links,
  stock corrections and deterministic replay evidence.

Global UUID uniqueness, tenant/product composite FKs, derived source identity,
one-successor uniqueness and typed mandatory-reference triggers protect lineage.
Triggers verify company/product/actor identity, approval role, source lines,
component recipients, bill-line ownership, exact event identity and OPEN FY.
Master identity/delete guards and append-only record/operation triggers prevent
reassignment or destructive history rewriting. Existing objects must match the
full schema contract, including columns/order/defaults, indexes/options, FKs,
constraints, trigger bodies and operational Q2 prerequisites.

Every service mutation requires an existing transaction. Company lock precedes
product and date locks, serializing even document-wide multi-product allocations.
Authenticated actor/product/FY reads are locked. Controllers own commit/rollback.
Bill, stock, physical inventory, valuation, counters and completed request evidence
therefore commit or roll back together. No service connects or commits implicitly.

## Components, costs and corrections

Every component has an authoritative document/component identity and root UUID.
All recipient sources and weights are frozen together. Sorted cumulative half-up
allocation conserves the authoritative total exactly. Costs reference the exact
component version/share, with explicit tax recoverability and supporting references.
Duplicate components, stale versions, conflicting identities and repeated partial-
bill component consumption are rejected.

A correction appends COMPONENT_REVISION referencing the root and predecessor,
with a reversal snapshot of the old allocation and a complete replacement.
No prior allocation or revision is edited. Readiness requires current effective
costs/bill links to reconcile with current component versions.

Cost evidence explicitly supplies purchase minor units, tax classifications,
landed costs/discounts, quantity and final total. Final UNKNOWN tax classification
is forbidden. Product purchase price, selling price and current stock do not
supply historical cost.

## GRNs and supplier bills

GRNs are created as drafts. Prepare and approve provisional/final evidence
against their real line IDs before explicit posting. Posting validates every
accepted line, opening, source/date/quantity, stock capacity and approval before
the first write. Unknown/unapproved cost cannot post stock.

Bills require ordered `valuation_lines` matching each item:
`{acquisition_id, revision_id, source_grn_item_id?, correction_id?}`.
Final supplier-document evidence must match bill quantity, purchase base and tax.
Acquisition UUIDs survive visible bill-item deletion/recreation via immutable
BILL_LINK successor records.

Partial GRN bills finalize only their explicit quantity. Remaining stock keeps
the approved provisional unit basis; later bills consume only remaining quantity.
A reduction restores just that portion to provisional/unbilled coverage.
GRN-backed bill edits do not change physical stock.

A direct-stock quantity/source correction requires a separate owner-approved
STOCK_CORRECTION and unchanged product scope. The replacement source has the
same original effective date. History/stock must reconcile before correction.
The correction appends STOCK_REVERSAL/STOCK_REPLACEMENT and a successor BILL_LINK,
applies one exact physical delta, and appends replay; original receipts remain.
Affected dates must all be OPEN. Missing, stale, unapproved or historical-unlinked
corrections are rejected. Ordinary cost-only edits leave physical stock unchanged.
Draft/unposted bills remain editable without pretending to have posted evidence.
Valued bills cannot be destructively deleted.

## Idempotency and replay

Evidence operations require an idempotency key. Bill/GRN requests accept
Idempotency-Key (or body idempotency_key); legacy requests without one receive a
deterministic key from action/resource/body. Callers should use an explicit key
for distinct intentional operations. A completed matching request returns its
original result before rebuilding predecessor state, including after an uncertain
commit. Changed payload/actor/action with a reused key is a conflict. No automatic
retry occurs, and a failed transaction leaves no completed operation record.

Replay order is effective date, integer sequence, then UUID. Applied revisions
and immutable bill coverage determine cost, not arbitrary unposted revisions.
Backdated changes replay subsequent movements only when every affected period
is OPEN. Linked opening corrections retain the original anchor/evidence.
Internal return arithmetic uses exact original movement/line and remaining
reversible quantity/value; HTTP return mutations stay disabled.

## Readiness

A dedicated connection starts REPEATABLE READ with a consistent READ ONLY
snapshot, then rolls back on every path. Company-wide orphan/unsupported-history
checks run independently of surviving product masters. Ordered records, physical
stock/opening, legacy movement coverage, current bills and sequence counters
contribute to deterministic fingerprints.

Readiness rejects missing/incompatible schema, precision mismatches, rejected or
provisional/unapplied revision heads, stale/unapplied component allocation,
orphan links, missing receipt history, duplicates/gaps/counter mismatches and
unsupported sales/return/challan history, even when quantities net to zero.
Query, parsing, fingerprint or snapshot-release errors fail closed.
Overall readiness always remains GL/COGS-blocked.

## Versioned migration roles

`2026-10-05-immutable-inventory-valuation.sql` is the versioned SQL artifact.
It uses IV_OBJECT boundaries for the guarded runner; do not pass it to SOURCE.
The companion JavaScript runner embeds a frozen compatibility verifier, verifies
the SQL SHA-256 and manifest, and executes only statements from the verified SQL.
It does not import mutable application schema/math, load environment files, or
run on import, startup, npm scripts or deployment.

A complete compatible rerun emits no DDL. Existing incompatible or interrupted
partial objects are rejected before repair; DDL is not rollbackable. No business
backfill or cost inference exists.

Only after separate explicit authorization, the isolated proof command is:
`node db/migrations/2026-10-05-immutable-inventory-valuation.js --apply-isolated-proof iv_proof_<32-lowercase-hex>`.
The CLI is restricted to 127.0.0.1:3307 and existing IV_MYSQL_PROOF_USER /
IV_MYSQL_PROOF_PASSWORD configuration. It verifies server port. There is no
production CLI, automatic migration hook or automatic database creation.

## Tests and preservation

Focused executable tests cover arithmetic/precision, immutable components,
approval workflow, partial/full finalization, stock/source correction, rollback,
retry/conflict behavior, readiness failures and SQL/runner identity. Existing
bill/GRN success fixtures use actual service-created approved evidence, with
separate zero-write missing/unapproved evidence tests.

The guarded MySQL suite contains real disposable-schema DDL, transactions,
concurrent requests, lock timeout, rollback, replay, malformed SQL inserts,
ownership/global UUID protections, immutable history and schema incompatibility
checks. It must not run without separate authorization. Its explicit guards
require DISPOSABLE_LOOPBACK_ONLY and port 3307; only its newly created randomly
named proof database is removed.

No existing FY-close path, historical migration, package/lockfile, startup
configuration or unrelated FY artifact is part of this change. No production
access, external requests, migration execution, installation, staging, commit,
push, deployment or email is authorized by this local prerequisite.
