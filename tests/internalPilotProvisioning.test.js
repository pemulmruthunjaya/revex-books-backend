const test = require("node:test"), assert = require("node:assert/strict"), crypto = require("node:crypto");
const { Fixture, installPhysicalMock, identity } = require("./helpers/internalPilotFixture");
installPhysicalMock();
const commit = "a".repeat(40);
const realRandomBytes = crypto.randomBytes;
let randomCalls = 0;
crypto.randomBytes = size => { randomCalls++; return Buffer.alloc(size, 37); }; // synthetic tokens only
test.after(() => { crypto.randomBytes = realRandomBytes; });
process.env.RAILWAY_GIT_COMMIT_SHA = commit; process.env.APP_URL = "https://revex-books-frontend.vercel.app";
let file, reserveFailure, writeFailure;
require.cache[require.resolve("../utils/internalPilotActivationFile")] = { exports: { async reserve() {
  if (reserveFailure) throw Object.assign(new Error("sensitive"), { code: "PILOT_OUTPUT_UNAVAILABLE" });
  file = { url: null, removed: false, async write(url) { this.url = url; if (writeFailure) throw Error("SENSITIVE_FAULT"); }, async cleanup() { this.url = null; this.removed = true; } }; return file;
} } };
// The real reviewed company-owner service is used; only the independent
// subscription unit is replaced, with transaction-visible synthetic writes.
require.cache[require.resolve("../services/subscriptionService")] = { exports: { async createTrialCompany(input) {
  assert.equal(input.trialDays, 14); assert.equal(input.expectedPlanContract.code, "PLAN_2");
  await input.connection.query("INSERT INTO company_subscriptions (company_id) VALUES (?)", [input.companyId]);
  return { subscription: { trial_start_at: "2026-10-14T00:00:00.000Z", trial_end_at: "2026-10-28T00:00:00.000Z" } };
} } };
const runner = require("../scripts/provision-internal-pilot");
const input = () => ({ confirmation: runner.CONFIRMATION, mode: "INTERNAL_PILOT_NO_EMAIL", transactionOwnership: "EXCLUSIVE_IDLE_CONNECTION", companyName: "RevEx FY Pilot", ownerName: "RevEx Pilot Owner", ownerEmail: "pilot.owner@revexbooks.com", planCode: "PLAN_2", trialDays: 14, expectedCommit: commit, platformAdminId: 7, idempotencyKey: crypto.randomUUID(), reason: "Approved isolated pilot", city: "Pune", businessType: "services", outputFile: require("node:path").resolve("synthetic-private-activation.txt"), identity });
class Pilot extends Fixture {
  constructor() { super(); this.ready(); this.rows = []; this.saved = []; this.prior = []; this.writes = 0; this.adminStatus = "active"; }
  async dispatch(sql, args = []) {
    if (sql.includes("information_schema") || sql.startsWith("SELECT 1 FROM `") || sql.startsWith("SELECT CAST(CONNECTION_ID()") || sql.startsWith("SELECT DATABASE()") || sql === "DO 0") return super.dispatch(sql, args);
    this.calls.push({ sql, args });
    if (sql.includes("GET_LOCK")) return [[{ acquired: 1 }]];
    if (sql.includes("RELEASE_LOCK")) return [[{ released: 1 }]];
    if (sql === "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE") return [{}];
    if (sql === "START TRANSACTION") { this.inTransaction = true; this.saved = [...this.rows]; return [{}]; }
    if (sql === "ROLLBACK") { this.rows = [...this.saved]; this.inTransaction = false; return [{}]; }
    if (sql === "COMMIT") { this.inTransaction = false; if (this.uncertainCommit) throw Error("sensitive uncertain result"); return [{}]; }
    if (sql.includes("FROM platform_admins")) return [[{ id: 7, status: this.adminStatus }]];
    if (sql.includes("WHERE internal_key_hash")) return [this.prior];
    if (sql.includes("FROM plans")) return [[{ id: 2, name: "Pro", code: "PLAN_2", default_trial_days: 14, is_active: 1 }]];
    if (sql.startsWith("SELECT UTC_TIMESTAMP(6)")) return [[{ generated_at: "2026-10-14T00:00:00.000Z", expires_at: "2026-10-15T00:00:00.000Z", trial_seconds: 1209600 }]];
    if (sql.startsWith("SELECT id FROM")) return [this.conflict ? [{ id: 99 }] : []];
    if (sql.startsWith("INSERT")) {
      this.writes++; if (this.writes === this.failWrite) throw Error("sensitive SQL fault");
      this.rows.push({ sql, args }); return [{ affectedRows: 1, insertId: this.rows.length }];
    }
    throw Error("UNHANDLED_PILOT_QUERY");
  }
}
test.beforeEach(() => { file = null; reserveFailure = false; writeFailure = false; randomCalls = 0; });
test("atomic no-email pilot uses reviewed company owner service, hash-only invitation and private file sink", async () => {
  const cx = new Pilot(), result = await runner.provision(cx, input());
  assert.equal(result.delivery, "NOT_ATTEMPTED"); assert.equal(cx.calls.filter(c => c.sql === "COMMIT").length, 1);
  for (const name of ["companies", "users", "user_company_memberships", "company_subscriptions", "trial_invitations"]) assert.equal(cx.rows.filter(r => r.sql.startsWith(`INSERT INTO ${name} `)).length, 1);
  assert.equal(cx.rows.some(r => /trial_requests|trial_invitation_operations/.test(r.sql)), false);
  const token = file.url.split("#token=")[1], invitation = cx.rows.find(r => r.sql.startsWith("INSERT INTO trial_invitations"));
  assert.match(invitation.sql, /NULL,'INTERNAL_PILOT'/); assert.equal(invitation.args[5], crypto.createHash("sha256").update(token).digest("hex"));
  assert.equal(JSON.stringify(cx.calls).includes(token), false); assert.equal(JSON.stringify(result).includes(token), false);
  assert.equal(require.cache[require.resolve("../services/emailService")], undefined);
  assert.equal(require.cache[require.resolve("../services/microsoftGraphEmailProvider")], undefined);
});
test("every business-write failure rolls back all rows and removes partial output", async () => {
  for (let n = 1; n <= 9; n++) {
    const cx = new Pilot(); cx.failWrite = n; await assert.rejects(runner.provision(cx, input()), { code: "PILOT_PROVISIONING_FAILED" });
    assert.deepEqual(cx.rows, []); assert.equal(file.removed, true); assert.equal(cx.calls.some(c => c.sql === "COMMIT"), false);
  }
});
test("same intent retry returns existing result without new writes or output/token; conflict fails", async () => {
  const cx = new Pilot(), request = input(); cx.prior = [{ id: 9, company_id: 1, owner_user_id: 2, intent_hash: runner.validate(request).intentHash.toUpperCase(), provenance: "INTERNAL_PILOT", last_sent_at: null }];
  const result = await runner.provision(cx, request); assert.equal(result.code, "INTERNAL_PILOT_ALREADY_PROVISIONED"); assert.equal(file, null); assert.equal(cx.writes, 0);
  await assert.rejects(runner.provision(cx, { ...request, reason: "Changed reason" }), { code: "PILOT_IDEMPOTENCY_CONFLICT" }); assert.equal(cx.writes, 0);
});
test("duplicate or partial records, inactive admin and existing file reject before business writes", async () => {
  for (const mode of ["duplicate", "admin", "file"]) {
    const cx = new Pilot(); cx.conflict = mode === "duplicate"; if (mode === "admin") cx.adminStatus = "disabled"; reserveFailure = mode === "file";
    await assert.rejects(runner.provision(cx, input())); assert.equal(cx.writes, 0);
  }
});
test("file-write and uncertain commit failures are sanitized, not retried, and remove output", async () => {
  for (const mode of ["file", "commit"]) {
    const cx = new Pilot(); writeFailure = mode === "file"; cx.uncertainCommit = mode === "commit";
    await assert.rejects(runner.provision(cx, input()), e => e.code === (mode === "file" ? "PILOT_PROVISIONING_FAILED" : "PILOT_COMMIT_UNCERTAIN_DO_NOT_RETRY_AUTOMATICALLY") && !e.message.includes("sensitive"));
    assert.equal(file.removed, true); assert.equal(cx.calls.filter(c => c.sql === "COMMIT").length, mode === "commit" ? 1 : 0);
  }
});
test("explicit authorization/runtime/target guards reject before any database access", async () => {
  for (const patch of [{ confirmation: "yes" }, { mode: "public" }, { ownerEmail: "other@example.test" }, { platformAdminId: 0 }, { trialDays: 15 }, { planCode: "PLAN_1" }, { expectedCommit: "b".repeat(40) }, { send: () => {} }, { reason: " " }, { transactionOwnership: "SHARED" }]) {
    const cx = new Pilot(); await assert.rejects(runner.provision(cx, { ...input(), ...patch })); assert.equal(cx.calls.length, 0);
  }
});
test("runner is not referenced by any production HTTP/startup route", () => {
  const fs = require("node:fs"), path = require("node:path");
  for (const dir of ["routes", "controllers", "middleware"]) for (const name of fs.readdirSync(path.join(__dirname, "..", dir)).filter(n => n.endsWith(".js"))) assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "..", dir, name), "utf8"), /provision-internal-pilot/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, "../index.js"), "utf8"), /provision-internal-pilot/);
});
test("every participating table requires InnoDB before writes or output reservation", async () => {
  const { INTERNAL_PROVISIONING_TABLES } = require("../services/trialInvitationReadinessService");
  for (const name of INTERNAL_PROVISIONING_TABLES) for (const defect of ["MyISAM", "missing", "view"]) {
    const cx = new Pilot(); cx.mutateEngines = rows => {
      const i = rows.findIndex(r => r.TABLE_NAME === name);
      if (defect === "missing") rows.splice(i, 1); else if (defect === "view") rows[i].TABLE_TYPE = "VIEW"; else rows[i].ENGINE = defect;
    };
    await assert.rejects(runner.provision(cx, input()), { code: "PILOT_TRANSACTIONAL_STORAGE_REQUIRED" });
    assert.equal(cx.writes, 0); assert.equal(file, null); assert.equal(cx.calls.some(c => c.sql === "START TRANSACTION"), false);
  }
});
test("engine validation is repeated with metadata pinned inside the owned transaction", async () => {
  const cx = new Pilot(); cx.mutateEngines = rows => { if (cx.inTransaction) rows.find(r => r.TABLE_NAME === "subscription_events").ENGINE = "MyISAM"; };
  await assert.rejects(runner.provision(cx, input())); assert.equal(cx.writes, 0); assert.equal(file, null);
  assert.ok(cx.calls.some(c => c.sql === "SELECT 1 FROM `subscription_events` LIMIT 0"));
  assert.ok(cx.calls.some(c => c.sql === "ROLLBACK"));
});
test("each cross-schema FK and non-enforced CHECK fails readiness with zero business writes", async () => {
  const { FOREIGN_KEY_CONTRACT, CHECK_CONTRACT } = require("../services/trialInvitationReadinessService");
  for (const [, name] of FOREIGN_KEY_CONTRACT) {
    const cx = new Pilot(); cx.mutateFK = rows => { rows.find(r => r.CONSTRAINT_NAME === name).REFERENCED_TABLE_SCHEMA = "other_database"; };
    await assert.rejects(runner.provision(cx, input()), { code: "TR1B_SCHEMA_NOT_READY" }); assert.equal(cx.writes, 0); assert.equal(file, null);
  }
  for (const name of [...Object.keys(CHECK_CONTRACT), "chk_trial_invitation_provenance"]) for (const value of ["NO", undefined]) {
    const cx = new Pilot(); cx.mutateChecks = rows => { rows.find(r => r.CONSTRAINT_NAME === name).ENFORCED = value; };
    await assert.rejects(runner.provision(cx, input()), { code: "TR1B_SCHEMA_NOT_READY" }); assert.equal(cx.writes, 0); assert.equal(file, null);
  }
});

const readiness = require("../services/trialInvitationReadinessService");
const schema = require("../services/internalPilotSchemaContract");
function assertLockedZeroWriteFailure(cx) {
  assert.equal(cx.writes, 0); assert.deepEqual(cx.rows, []);
  for (const table of readiness.INTERNAL_PROVISIONING_TABLES) {
    assert.equal(cx.calls.some(c => new RegExp(`^(INSERT INTO|UPDATE|DELETE FROM) ${table}\\b`).test(c.sql)), false, table);
  }
  assert.equal(cx.calls.some(c => /^(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|COMMIT)\b/.test(c.sql)), false);
  assert.equal(file, null); assert.equal(randomCalls, 0);
  assert.equal(cx.inTransaction, false);
  assert.equal(cx.calls.filter(c => c.sql === "ROLLBACK").length, 1);
  assert.equal(cx.calls.filter(c => c.sql.includes("RELEASE_LOCK")).length, 1);
  const locks = cx.calls.filter(c => c.sql.startsWith("SELECT 1 FROM `")).map(c => c.sql.split("`")[1]);
  assert.deepEqual(locks, readiness.INTERNAL_PROVISIONING_TABLES);
}

test("post-initial-readiness CHECK enforcement changes reject under locks without rows, token or file", async () => {
  for (const name of [...Object.keys(readiness.CHECK_CONTRACT), schema.checkName]) {
    const cx = new Pilot(); let initial = 0, locked = 0;
    cx.mutateChecks = rows => { if (cx.inTransaction) { locked++; rows.find(r => r.CONSTRAINT_NAME === name).ENFORCED = "NO"; } else initial++; };
    await assert.rejects(runner.provision(cx, input()), { code: "PILOT_PROVISIONING_FAILED" });
    assert.equal(initial, 1); assert.equal(locked, 1); assertLockedZeroWriteFailure(cx);
  }
});

test("post-initial-readiness FK schema changes reject under locks without rows, token or file", async () => {
  for (const [, name] of readiness.FOREIGN_KEY_CONTRACT) {
    const cx = new Pilot(); let initial = 0, locked = 0;
    cx.mutateFK = rows => { if (cx.inTransaction) { locked++; rows.find(r => r.CONSTRAINT_NAME === name).REFERENCED_TABLE_SCHEMA = "other_database"; } else initial++; };
    await assert.rejects(runner.provision(cx, input()), { code: "PILOT_PROVISIONING_FAILED" });
    assert.equal(initial, 1); assert.equal(locked, 1); assertLockedZeroWriteFailure(cx);
  }
});

test("every trigger removed after initial readiness rejects under locks without rows, token or file", async () => {
  for (const statement of schema.statements().slice(1)) {
    const name = /^CREATE TRIGGER (\w+)/.exec(statement)[1];
    const cx = new Pilot(); let initial = 0, locked = 0;
    cx.onQuery = sql => {
      if (!sql.includes("information_schema.TRIGGERS")) return;
      if (cx.inTransaction) { locked++; cx.triggerNames = cx.triggerNames.filter(n => n !== name); } else initial++;
    };
    await assert.rejects(runner.provision(cx, input()), { code: "PILOT_PROVISIONING_FAILED" });
    assert.equal(initial, 1); assert.equal(locked, 1); assertLockedZeroWriteFailure(cx);
  }
});

test("all metadata locks precede complete locked readiness and business work in deterministic order", async () => {
  const cx = new Pilot(); await runner.provision(cx, input());
  const calls = cx.calls.map(c => c.sql), start = calls.indexOf("START TRANSACTION");
  const lockedCalls = calls.slice(start + 1), locks = lockedCalls.filter(s => s.startsWith("SELECT 1 FROM `"));
  assert.deepEqual(locks, readiness.INTERNAL_PROVISIONING_TABLES.map(t => `SELECT 1 FROM \`${t}\` LIMIT 0`));
  for (const table of Object.keys(readiness.COLUMN_CONTRACT)) assert.ok(readiness.INTERNAL_PROVISIONING_TABLES.includes(table));
  for (const fk of readiness.FOREIGN_KEY_CONTRACT) assert.ok(readiness.INTERNAL_PROVISIONING_TABLES.includes(fk[3]));
  const lastLock = lockedCalls.lastIndexOf(locks.at(-1));
  for (const probe of ["information_schema.COLUMNS", "information_schema.STATISTICS", "REFERENTIAL_CONSTRAINTS", "CHECK_CONSTRAINTS", "information_schema.TRIGGERS"]) {
    const index = lockedCalls.findIndex(s => s.includes(probe));
    assert.ok(index > lastLock, probe);
    assert.ok(index < lockedCalls.findIndex(s => s.startsWith("INSERT")), probe);
  }
  assert.equal(calls.filter(s => s.includes("information_schema.TRIGGERS")).length, 2);
  assert.ok(calls.indexOf("COMMIT") < calls.findIndex(s => s.includes("RELEASE_LOCK")));
});

test("metadata acquisition deadlock stops once, rolls back and releases advisory lock before writes", async () => {
  const cx = new Pilot(); let attempts = 0;
  cx.onQuery = sql => { if (sql === "SELECT 1 FROM `users` LIMIT 0") { attempts++; throw Object.assign(Error("synthetic deadlock"), { code: "ER_LOCK_DEADLOCK" }); } };
  await assert.rejects(runner.provision(cx, input()), { code: "PILOT_PROVISIONING_FAILED" });
  assert.equal(attempts, 1); assertLockedZeroWriteFailure(cx);
});
