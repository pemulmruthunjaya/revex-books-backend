# Company 9 FY pilot activation

Local implementation only. No deployment, migration, production activation or
global gate change is implied. `scripts/activate-fy-pilot.js` is import-inert,
programmatic only and unreachable from HTTP routes/startup. It never opens a
connection, creates accounts, sends email or executes DDL.

Call `activate(ownedPhysicalMysql2Connection, input)` with exactly:

- `confirmation: ACTIVATE_COMPANY_9_FY_PILOT_V1`
- `transactionOwnership: EXCLUSIVE_IDLE_CONNECTION`
- a unique UUID-v4 `idempotencyKey`
- explicit `identity` (host, port, database, hostname, version `9.7.2`, serverPort).

Do not use a pool, forwarding executor or a connection already in a transaction.
No credentials appear in the input/result. The caller owns connection closure.
Execution requires separate authorization and reviewed runtime source.

The fixed contract is Company 9, RevEx FY Pilot, native active owner 19 with
active owner membership; FY2026-27, 2026-04-01 through 2027-03-31, OPEN/default.
All eight specified accounts must already exist, active and zero-opening. AP
must be code 2000, not a randomly selected alternative. The runner rejects any
extra/missing account, prior mapping/cutover or business history.

The history guard permits only validated provisioning/setup evidence, under
the same transaction locks: one Company 9 business profile with the approved
name/email and provisioning timestamp `2026-10-16 06:23:21`; one PLAN_2 Pro
14-day trial subscription (`trialing`) and its single linked `active` trial
period from `2026-10-16 06:23:21` to `2026-10-30 06:23:21` (database UTC values).
No additional/overlapping periods or duplicate/conflicting profiles are allowed.

Exactly eleven owner-19 Company-9 successful POST audit records are required:
one FY creation (201), one OPEN transition (200), one default selection (200),
and eight account creations (201). Paths, module/action, resource references,
FY request body and distinct account codes/names/types/zero opening amounts
must corroborate the approved masters. Audit payloads are never logged or
returned. Unknown routes, other actors, failed requests, missing/duplicate
actions and operational audit history fail closed. This is not an audit-table
exemption. All other operational and unknown tenant tables remain blocked.
The complete setup rows are included in before/after preservation checks.

Five immutable inventory role events cover 2026-10-17 onward. Four annual roles
cover FY2026-27 onward (no end FY). AP is shared; the eight resolved account IDs
are otherwise distinct. Zero products produces an empty cutover opening list
and no journal or fabricated valuation opening evidence.

## Atomicity and retry

All actions use one pinned connection and SERIALIZABLE transaction. The company
lock precedes tenant locks, matching valuation operations. Metadata locks are
acquired in table-name order and full readiness repeats under those locks.
All existing tables must be InnoDB base tables. Unknown tenant-bearing tables
with rows reject activation. This intentionally favors fail-closed behavior.
Schema probes can take read locks across other tenants; use a controlled window.

The single commit includes five GL roles, four annual roles, one zero cutover,
and one immutable `FY_PILOT_ACTIVATION` receipt in `iv_operations`. Receipt and
child events are postflight-verified before commit. Identical retry verifies
the exact persisted result without writing. A new key, partial state or changed
pilot prerequisites rejects; do not repair or overwrite history. After an
uncertain commit, inspect independently: never retry automatically.

Failures roll back all role/event writes. Cleanup failure destroys the pinned
connection and requires inspection. Existing accounts, FY statuses/defaults,
memberships and balances are never updated.

## Validation

Non-live tests cover real GL operation orchestration with mocked SQL, zero-write
guards, partial-write rollback, retry conflicts, schema races and commit
uncertainty. Role-schema tests exercise native MySQL metadata representations.
`tests/fyPilotActivation.mysql.test.js` is separately guarded and authored only.
Its disposable database must be prepared explicitly with all reviewed schemas
and the synthetic eight-account pilot fixture; it never installs migrations.
It checks actual rollback, concurrent identical requests, persisted retries,
baseline preservation and no opening journals. Only loopback 3407, exact MySQL
9.7.2 and exact database-scoped SELECT/INSERT/UPDATE/DELETE/TRIGGER privileges are
allowed (TRIGGER is required to inspect trigger metadata, not to execute DDL).
Never execute it against a shared or production database.
