# Tenant-scoped Chart of Accounts codes

## Diagnosis and boundary

The checked-in legacy schema (`tests/fixtures/fy6c2-current-schema-bootstrap.sql`
and `tests/fixtures/runtime-schema.sql`) defines `UNIQUE account_code(account_code)`.
That is global, despite account/controller and opening-ledger lookups using
`company_id`. The account controller formerly mapped *every* MySQL duplicate to
the same account-code-or-opening-event message. For zero opening balances,
`recordOpeningBalanceEvent` returns before any query: opening events cannot cause
that zero-opening failure. This establishes the local schema defect and explains
the reported cross-tenant collision; no live schema was accessed to independently
confirm which production rows own 2000/2001. Production preflight is mandatory.

The new unique key is `uq_accounts_company_code(company_id,account_code)`.
Inactive accounts still reserve their codes within their tenant. Collation,
nullable code semantics, column defaults, accounts, balances and events are not
changed. No random codes, renumbering, repair or historical backfill is performed.

The opening-event sequence remains unique on
`(company_id,entity_type,entity_id,sequence_no)`; its journal link remains unique
on the globally identified `journal_entry_id`. These are not defective and are
not altered. Create remains one transaction for account, event and journal.
There is no new account-request idempotency protocol: retrying a successful coded
create rejects the same-company duplicate without posting again. Retrying an
identical opening update posts no delta. Null-code creates remain distinct,
matching the existing contract. No event keys or previously persisted values are
rewritten.

## Explicit rollout (not executed automatically)

1. Review the new SQL/runner and isolated proof. Obtain fresh backup and separate
   production authorization. Keep account writes quiescent for preflight/DDL.
2. Supply an idle, owned physical mysql2 PromiseConnection to `inspect` (read-only)
   and to `migrate` (explicit write). Pools/forwarders are rejected by `migrate`.
   Require `confirmation=APPLY_ACCOUNT_CODE_TENANT_SCOPE_V1`,
   `transactionOwnership=EXCLUSIVE_IDLE_CONNECTION`, and exact `identity` fields
   `host,port,database,hostname,version,serverPort`. The shared identity guard
   requires MySQL 9.7.2, internal port 3306, and verifies the actual socket.
3. Require `MIGRATION_REQUIRED`, `ALREADY_APPLIED`, or `COMPATIBLE_PARTIAL` (both
   exact old and new keys exist). Unknown/missing/wrong/prefix/invisible/expression
   indexes, nullable tenant identity, duplicate tenant codes, invalid IDs, and
   foreign-key dependencies on the changed code index reject before DDL. Functional
   indexes and generated-column aliases are rejected rather than guessing whether
   an alternate key would retain global uniqueness.
4. The SHA-pinned SQL swaps the indexes in one atomic ALTER; compatible partial
   state only removes the old key. Exclusive table locks cover locked revalidation,
   DDL, complete bytewise paginated snapshots with independent counts, full
   unaffected-schema fingerprints (including next auto-increment value, table
   comment/row format and trigger order) and cleanup. Existing triggers/FKs are
   preserved.
5. On any warning, disconnect or uncertain result, **do not retry automatically**.
   DDL is not transactionally rolled back; inspect using a new separately approved
   session. The atomic ALTER leaves either old or new index state; compatible
   partial state is explicitly supported. Cleanup failure is a hard failure.
6. Verify same-company rejection, cross-company code reuse and health, then deploy
   the controller error refinement. Before migration, legacy-key conflicts report
   `ACCOUNT_CODE_SCHEMA_NOT_READY`; scoped code conflicts report
   `ACCOUNT_CODE_ALREADY_EXISTS`, and opening events report `OPENING_EVENT_CONFLICT`.
   Unknown constraints return a sanitized internal error, never guessed success.

Do not recreate the global unique key as rollback: cross-company duplicate codes
are legitimate after rollout. Stop account writes and diagnose; do not delete or
renumber tenant data. The migration does not run during imports, startup or tests
unless explicitly invoked on the isolated fixture.
