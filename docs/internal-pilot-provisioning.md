# Internal pilot provisioning (explicit operator capability)

No HTTP endpoint, email invocation, automatic migration, CLI auto-execution or
startup hook is added. Nothing in this phase has been executed against MySQL.

## Deployment prerequisites

Review the frozen `2026-10-14-internal-pilot-provenance.sql` and its SHA-pinned
runner together. Do not replay or edit the historical TR-1B migration. The new
runner changes the invitation definition in one atomic ALTER, then installs four
guards. MySQL DDL cannot be rolled back. On failure, stop and inspect; a separately
authorized invocation can resume only an exactly compatible partial state. Never
automatically retry. Keep invitation writes quiescent during an authorized schema
change. Existing public values and consent requirements are not rewritten.

The migration requires an exclusive idle **physical** mysql2 connection, exact
host/client port/database/server hostname/version/internal-port expectations,
`EXCLUSIVE_IDLE_CONNECTION` ownership and `APPLY_INTERNAL_PILOT_PROVENANCE_V1`.
It checks schema, counts and all original invitation values under table locks,
with independent paginated-count reconciliation. Production-compatible does not
mean production-authorized: this implementation does not open a connection.

## Provisioning

An operator must explicitly call `scripts/provision-internal-pilot.js`'s exported
`provision(connection, input)` using a dedicated idle physical connection.
No connection settings or secrets are read/downloaded by this runner.

Required input fields: `confirmation=PROVISION_REVEX_INTERNAL_PILOT_WITHOUT_EMAIL_V1`,
`mode=INTERNAL_PILOT_NO_EMAIL`, `transactionOwnership=EXCLUSIVE_IDLE_CONNECTION`,
`expectedCommit`, exact `identity` (as above), `companyName=RevEx FY Pilot`,
`ownerName=RevEx Pilot Owner`, `ownerEmail=pilot.owner@revexbooks.com`,
`planCode=PLAN_2`, `trialDays=14`, an active `platformAdminId`, a fresh UUIDv4
`idempotencyKey`, nonempty `reason`, explicit `city` and `businessType`, and an
absolute `outputFile`. The canonical APP_URL must already be configured. Runtime
commit comes from the deployment commit environment or local Git HEAD.

Use a private native POSIX directory owned by the current user (mode 0700), e.g.
within WSL's Linux filesystem. Windows/NTFS chmod semantics are rejected rather
than misrepresented as owner-only protection. The output is exclusively created
0600, without following a symlink, fsynced before COMMIT, and removed on failure.
Do not copy it into logs, HTTP responses or repository files. The URL contains a
24-hour (trial-expiry-bounded) activation token in its fragment. The customer
sets their password through the existing activation flow; no session is issued
by provisioning.

The reviewed owner/subscription services remain authoritative. No public request,
consent, IP hash or delivery-operation record is invented. The approval actor is
a real active platform administrator. The invitation stores only the token hash;
its immutable origin/key hash/reason/approval identity are database protected.
Internal invitations remain non-delivery invitations (`last_sent_at=NULL`);
public approval/resend behavior remains unchanged. Activation operations remain
permitted and consume the existing token through the existing activation service.

## Failure and retry

One transaction owns all business inserts. A serialization lock guards internal
provisioning; genuine conflicts and partial prior records fail before business
writes. Identical retry returns only existing identifiers/dates, not a new token
or URL. Changed intent fails. On uncertain COMMIT, stop: do not automatically
retry. A separately authorized identical retry can discover the committed result,
but cannot recover the original raw token. If output was removed/lost, token
reissue requires a separately reviewed workflow, not an automatic email or resend.
Filesystem/DB atomicity is not claimed: file creation precedes COMMIT; process
crash recovery requires operator inspection of both outcomes. Normal handled
failures remove the exact output and rollback when possible. Cleanup uncertainty
is always a failure, never reported as provisioning success.
