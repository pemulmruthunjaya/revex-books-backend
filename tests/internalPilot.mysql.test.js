"use strict";
// Authored only. Never included in non-live runs; separate authorization and a
// preallocated empty disposable database/non-SUPER user are mandatory.
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), fsp = require("node:fs/promises"), path = require("node:path"), os = require("node:os"), crypto = require("node:crypto");
const { assertSafeTr1bMysqlTarget } = require("./helpers/tr1bMysqlTestGuard");
const { requiredCase } = require("./helpers/requiredMysqlCase");
const raw = process.env.INTERNAL_PILOT_TEST_DATABASE_URL;
const target = assertSafeTr1bMysqlTarget(raw);
assert.equal(process.env.INTERNAL_PILOT_MYSQL_AUTHORIZATION, "RUN_ISOLATED_INTERNAL_PILOT_MYSQL_ONCE");
assert.equal(target.host, "127.0.0.1"); assert.equal(target.port, 3407);
assert.match(target.database, /^revex_tr1b_test_internal_[a-z0-9_]+$/);
assert.notEqual(process.platform, "win32", "Native POSIX owner-only output required");
// Services must use the explicitly supplied disposable connection, never the
// application pool or any ambient database configuration.
require.cache[require.resolve("../db/connection")] = { exports: {
  query() { throw new Error("ISOLATED_CONNECTION_REQUIRED"); },
  getConnection() { throw new Error("ISOLATED_CONNECTION_REQUIRED"); },
} };
const mysql = require("mysql2/promise"), migration = require("../db/migrations/2026-10-14-internal-pilot-provenance"), contract = require("../services/internalPilotSchemaContract"), runner = require("../scripts/provision-internal-pilot");
const sqlFile = name => fs.readFileSync(path.join(__dirname, "../db/migrations", name), "utf8");
const { INTERNAL_PROVISIONING_TABLES } = require("../services/trialInvitationReadinessService");
const WRITTEN_TABLES = ["companies", "users", "user_company_memberships", "branches", "user_branch_memberships", "business_profiles", "company_business_settings", "company_subscriptions", "subscription_periods", "subscription_events", "trial_invitations"];
const sqlError = (code, errno, constraint) => error => error.code === code && error.errno === errno && (!constraint || String(error.sqlMessage).includes(constraint));
test("guarded MySQL: preservation, resumption, provenance constraints, atomic pilot and idempotency", async t => {
  const url = new URL(raw);
  const cx = await mysql.createConnection({ ...target, user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), multipleStatements: false, timezone: "Z", supportBigNumbers: true, bigNumberStrings: true });
  let privateDir;
  try {
    const snapshot = async () => {
      const result = {};
      for (const table of INTERNAL_PROVISIONING_TABLES) {
        const [[count]] = await cx.query(`SELECT CAST(COUNT(*) AS CHAR) n FROM \`${table}\``);
        const order = table === "trial_request_rate_buckets" ? "client_ip_hash,bucket_number" : "id";
        const [rows] = await cx.query(`SELECT * FROM \`${table}\` ORDER BY ${order}`);
        assert.equal(String(rows.length), count.n);
        result[table] = { count: count.n, hash: crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex") };
      }
      return result; // Never include row contents in assertion diagnostics.
    };
    const [[server]] = await cx.query("SELECT DATABASE() db,@@hostname hostname,@@version version,@@port port,CURRENT_USER() user,@@log_bin_trust_function_creators trust_setting");
    assert.equal(server.db, target.database); assert.equal(server.version, "9.7.2"); assert.equal(Number(server.port), 3306); assert.equal(Number(server.trust_setting), 1); assert.doesNotMatch(server.user, /^root@/i);
    const [grants] = await cx.query("SHOW GRANTS"); const granted = new Set();
    for (const row of grants) {
      const grant = Object.values(row)[0]; if (/^GRANT USAGE ON \*\.\* TO /.test(grant)) continue;
      const match = /^GRANT ([A-Z ,]+) ON `([^`]+)`\.\* TO [^\n]+$/.exec(grant);
      assert.ok(match && match[2] === target.database && !grant.includes("WITH GRANT OPTION"), "Only exact database-scoped grants allowed");
      for (const p of match[1].split(", ")) granted.add(p);
    }
    assert.deepEqual([...granted].sort(), ["SELECT", "INSERT", "UPDATE", "DELETE", "CREATE", "ALTER", "INDEX", "REFERENCES", "TRIGGER", "LOCK TABLES"].sort());
    const [tables] = await cx.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()"); assert.equal(tables.length, 0);
    const scaffold = [
      "CREATE TABLE plans (id INT PRIMARY KEY,code VARCHAR(50),name VARCHAR(100),price DECIMAL(12,2),is_active TINYINT DEFAULT 1,default_trial_days INT DEFAULT 14,max_users INT,max_staff INT)",
      "CREATE TABLE companies (id INT AUTO_INCREMENT PRIMARY KEY,name VARCHAR(150),email VARCHAR(254) UNIQUE,plan_id INT,status ENUM('active','inactive') DEFAULT 'active')",
      "CREATE TABLE users (id INT AUTO_INCREMENT PRIMARY KEY,name VARCHAR(100),email VARCHAR(254) UNIQUE,password VARCHAR(255),company_id INT,role VARCHAR(30),access_role VARCHAR(30),is_active TINYINT DEFAULT 1,must_change_password TINYINT DEFAULT 0,password_changed_at DATETIME(6),password_reset_token_hash BINARY(32),password_reset_expires_at DATETIME(6))",
      "CREATE TABLE platform_admins (id BIGINT UNSIGNED PRIMARY KEY,status VARCHAR(20) NOT NULL)",
      "CREATE TABLE user_company_memberships (id INT AUTO_INCREMENT PRIMARY KEY,user_id INT,company_id INT,membership_role VARCHAR(30),is_default TINYINT,is_active TINYINT,UNIQUE(user_id,company_id))",
      "CREATE TABLE branches (id INT AUTO_INCREMENT PRIMARY KEY,company_id INT,name VARCHAR(100),code VARCHAR(30),branch_type VARCHAR(30),is_head_office TINYINT,is_active TINYINT,created_by INT)",
      "CREATE TABLE user_branch_memberships (id INT AUTO_INCREMENT PRIMARY KEY,user_id INT,company_id INT,branch_id INT,is_default TINYINT,is_active TINYINT)",
      "CREATE TABLE business_profiles (id INT AUTO_INCREMENT PRIMARY KEY,company_id INT UNIQUE,name VARCHAR(150),email VARCHAR(254))",
      "CREATE TABLE company_business_settings (id INT AUTO_INCREMENT PRIMARY KEY,company_id INT UNIQUE,industry_type VARCHAR(40),city VARCHAR(100))",
    ];
    for (const ddl of scaffold) await cx.query(ddl + " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
    for (const name of ["company_subscriptions", "subscription_periods", "subscription_events"]) {
      const ddl = sqlFile("2026-08-18-subscription-foundation.sql").match(new RegExp(`CREATE TABLE IF NOT EXISTS ${name} \\([\\s\\S]*?ENGINE=InnoDB[^;]*;`)); assert.ok(ddl); await cx.query(ddl[0]);
    }
    for (const statement of sqlFile("2026-09-29-trial-request-invitation-activation.sql").replace(/^--[^\n]*\n/gm, "").split(";").map(s => s.trim()).filter(Boolean)) await cx.query(statement);
    await cx.query("INSERT INTO plans VALUES (2,'PLAN_2','Pro',100,1,14,10,10)"); await cx.query("INSERT INTO platform_admins VALUES (7,'active')");
    await cx.query("INSERT INTO companies (id,name,email) VALUES (1,'Synthetic existing','synthetic@example.test')");
    await cx.query("INSERT INTO users (id,name,email,password,company_id) VALUES (1,'Synthetic','synthetic@example.test','not-a-login',1)");
    await cx.query("INSERT INTO trial_requests (id,public_reference,full_name,company_name,email,mobile,city,country,business_type,privacy_communications_consent,privacy_policy_version,consented_at,client_ip_hash) VALUES (1,'synthetic','Synthetic','Synthetic existing','synthetic@example.test','+919000000000','Pune','IN','services',1,'synthetic-fixture',UTC_TIMESTAMP(6),UNHEX(SHA2('synthetic',256)))");
    await cx.query("INSERT INTO trial_invitations (id,trial_request_id,company_id,owner_user_id,approved_by_platform_admin_id,approval_idempotency_key,approval_intent_hash,status,token_hash,token_generated_at,token_expires_at,trial_start_at,trial_end_at,approved_at,last_sent_at) VALUES (9007199254740993,1,1,1,7,?,UNHEX(SHA2('synthetic',256)),'pending_activation',UNHEX(SHA2('synthetic-token',256)),UTC_TIMESTAMP(6),DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 1 DAY),UTC_TIMESTAMP(6),DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 14 DAY),UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))", [crypto.randomUUID()]);
    const expectedIdentity = { ...target, hostname: server.hostname, version: "9.7.2", serverPort: 3306 };
    const opts = { identity: expectedIdentity, confirmation: migration.CONFIRMATION, transactionOwnership: "EXCLUSIVE_IDLE_CONNECTION" };
    if (!await requiredCase(t, "fresh and already-applied preserve exact values", async () => {
      const [[bytes]] = await cx.query("SELECT CAST('Case' AS BINARY) <=> CAST('case' AS BINARY) case_equal, CAST('x' AS BINARY) <=> CAST('x ' AS BINARY) space_equal, CAST(NULL AS BINARY) <=> CAST(NULL AS BINARY) null_equal, CAST(NULL AS BINARY) <=> CAST('' AS BINARY) null_empty_equal");
      assert.deepEqual([bytes.case_equal, bytes.space_equal, bytes.null_equal, bytes.null_empty_equal], ['0', '0', '1', '0']);
      const before = await migration.inspect(cx); assert.equal(before.classification, "MIGRATION_REQUIRED");
      const result = await migration.migrate(cx, opts); assert.deepEqual(result.snapshot, before.snapshot);
      assert.equal((await migration.migrate(cx, opts)).before, "ALREADY_APPLIED");
      const [[legacy]] = await cx.query("SELECT provenance,trial_request_id,last_sent_at,internal_key_hash,internal_reason FROM trial_invitations WHERE id=9007199254740993");
      assert.equal(legacy.provenance, "PUBLIC_TRIAL_REQUEST"); assert.notEqual(legacy.last_sent_at, null); assert.equal(legacy.internal_key_hash, null);
    })) return;
    if (!await requiredCase(t, "incompatible timestamp type/default rejected; compatible trigger interruption resumes", async () => {
      await cx.query("ALTER TABLE trial_invitations MODIFY last_sent_at DATETIME NULL");
      await assert.rejects(migration.migrate(cx, opts));
      await cx.query("ALTER TABLE trial_invitations MODIFY last_sent_at DATETIME(6) NULL DEFAULT CURRENT_TIMESTAMP(6)");
      await assert.rejects(migration.migrate(cx, opts));
      await cx.query("ALTER TABLE trial_invitations MODIFY last_sent_at DATETIME(6) NULL");
      const trigger = /^CREATE TRIGGER (\w+)/.exec(contract.statements()[4])[1]; await cx.query(`DROP TRIGGER ${trigger}`);
      assert.equal((await migration.inspect(cx)).classification, "COMPATIBLE_PARTIAL"); assert.equal((await migration.migrate(cx, opts)).after, "ALREADY_APPLIED");
    })) return;
    privateDir = await fsp.mkdtemp(path.join(os.tmpdir(), "internal-pilot-proof-")); await fsp.chmod(privateDir, 0o700);
    process.env.APP_URL = "https://revex-books-frontend.vercel.app";
    const expectedCommit = require("node:child_process").execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); process.env.RAILWAY_GIT_COMMIT_SHA = expectedCommit;
    const request = { confirmation: runner.CONFIRMATION, mode: "INTERNAL_PILOT_NO_EMAIL", transactionOwnership: "EXCLUSIVE_IDLE_CONNECTION", companyName: "RevEx FY Pilot", ownerName: "RevEx Pilot Owner", ownerEmail: "pilot.owner@revexbooks.com", planCode: "PLAN_2", trialDays: 14, platformAdminId: 7, reason: "Synthetic isolated proof", city: "Pune", businessType: "services", expectedCommit, identity: expectedIdentity, idempotencyKey: crypto.randomUUID(), outputFile: path.join(privateDir, "activation.txt") };
    if (!await requiredCase(t, "real constraint failure rolls back; then explicit distinct success and retry create one pilot", async () => {
      const before = await snapshot();
      for (const [table, clause] of [["company_business_settings", "city <> 'Pune'"], ["subscription_events", "event_type <> 'trial_created'"]]) {
        await cx.query(`ALTER TABLE ${table} ADD CONSTRAINT synthetic_pilot_failure CHECK (${clause})`);
        await assert.rejects(runner.provision(cx, request), { code: "PILOT_PROVISIONING_FAILED" });
        assert.deepEqual(await snapshot(), before, `All participating rows must roll back at ${table}`);
        await assert.rejects(fsp.stat(request.outputFile), { code: "ENOENT" });
        await cx.query(`ALTER TABLE ${table} DROP CHECK synthetic_pilot_failure`);
      }
      // Fail after the invitation INSERT: every written table now has pending
      // rows. Exercise real transaction rollback and real private-file cleanup.
      const originalOpen = fsp.open;
      let syncFailures = 0;
      fsp.open = async (...args) => {
        const handle = await originalOpen(...args);
        if (args[0] === request.outputFile) handle.sync = async () => { syncFailures++; throw new Error("synthetic output sync failure"); };
        return handle;
      };
      try { await assert.rejects(runner.provision(cx, request), { code: "PILOT_PROVISIONING_FAILED" }); }
      finally { fsp.open = originalOpen; }
      assert.equal(syncFailures, 1);
      assert.deepEqual(await snapshot(), before);
      await assert.rejects(fsp.stat(request.outputFile), { code: "ENOENT" });
      const result = await runner.provision(cx, request); assert.equal(result.delivery, "NOT_ATTEMPTED");
      const committed = await snapshot();
      for (const table of INTERNAL_PROVISIONING_TABLES) {
        assert.equal(BigInt(committed[table].count) - BigInt(before[table].count), WRITTEN_TABLES.includes(table) ? 1n : 0n, table);
        if (!WRITTEN_TABLES.includes(table)) assert.deepEqual(committed[table], before[table]);
      }
      const outputHash = crypto.createHash("sha256").update(await fsp.readFile(request.outputFile)).digest("hex");
      const retry = await runner.provision(cx, request); assert.equal(retry.companyId, result.companyId); assert.equal(retry.activationFileCreated, false);
      assert.deepEqual(await snapshot(), committed);
      assert.equal(crypto.createHash("sha256").update(await fsp.readFile(request.outputFile)).digest("hex"), outputHash);
      await assert.rejects(runner.provision(cx, { ...request, reason: "conflict" }), { code: "PILOT_IDEMPOTENCY_CONFLICT" });
      assert.deepEqual(await snapshot(), committed);
      await assert.rejects(runner.provision(cx, { ...request, idempotencyKey: crypto.randomUUID() }), { code: "PILOT_EXISTING_OR_PARTIAL_PROVISIONING" });
      assert.deepEqual(await snapshot(), committed);
      const [[inv]] = await cx.query("SELECT *,TIMESTAMPDIFF(SECOND,trial_start_at,trial_end_at) seconds FROM trial_invitations WHERE company_id=?", [result.companyId]);
      assert.equal(inv.trial_request_id, null); assert.equal(inv.last_sent_at, null); assert.equal(Number(inv.seconds), 1209600);
      assert.equal(Number((await cx.query("SELECT COUNT(*) n FROM trial_invitation_operations WHERE trial_invitation_id=?", [inv.id]))[0][0].n), 0);
      const urlText = (await fsp.readFile(request.outputFile, "utf8")).trim(), token = urlText.split("#token=")[1];
      assert.deepEqual(inv.token_hash, crypto.createHash("sha256").update(token).digest()); assert.equal((await fsp.stat(request.outputFile)).mode & 0o777, 0o600);
      await assert.rejects(cx.query("UPDATE trial_invitations SET internal_reason='changed' WHERE id=?", [inv.id]), sqlError("ER_SIGNAL_EXCEPTION", 1644, "INVITATION_PROVENANCE_IMMUTABLE"));
      await assert.rejects(cx.query("UPDATE trial_invitations SET provenance='PUBLIC_TRIAL_REQUEST',trial_request_id=1,last_sent_at=UTC_TIMESTAMP(6),internal_key_hash=NULL,internal_reason=NULL WHERE id=?", [inv.id]), sqlError("ER_SIGNAL_EXCEPTION", 1644, "INVITATION_PROVENANCE_IMMUTABLE"));
      await assert.rejects(cx.query("INSERT INTO trial_invitation_operations (trial_invitation_id,operation_type,intent_hash,token_generation,actor_type,platform_admin_id,status) VALUES (?,'approve',UNHEX(SHA2('fixture',256)),1,'platform_admin',7,'in_flight')", [inv.id]), sqlError("ER_SIGNAL_EXCEPTION", 1644, "INTERNAL_PILOT_NO_DELIVERY"));
      assert.deepEqual(await snapshot(), committed);
    })) return;
    if (!await requiredCase(t, "isolated valid INSERT shapes independently prove each FK and provenance CHECK", async () => {
      const [company] = await cx.query("INSERT INTO companies (name,email) VALUES ('Constraint fixture','constraints@example.test')");
      const [owner] = await cx.query("INSERT INTO users (name,email,password,company_id) VALUES ('Constraint fixture','constraints@example.test','not-a-login',?)", [company.insertId]);
      const [publicRequest] = await cx.query("INSERT INTO trial_requests (public_reference,full_name,company_name,email,mobile,city,country,business_type,privacy_communications_consent,privacy_policy_version,consented_at,client_ip_hash) VALUES ('constraint-fixture','Constraint fixture','Constraint fixture','constraints@example.test','+919000000001','Pune','IN','services',1,'synthetic-fixture',UTC_TIMESTAMP(6),UNHEX(SHA2('synthetic',256)))");
      const before = await snapshot();
      const insert = async patch => {
        const values = { request: null, company: company.insertId, owner: owner.insertId, admin: 7, provenance: "INTERNAL_PILOT", key: crypto.randomBytes(32), reason: "Synthetic constraint fixture", sent: null, ...patch };
        return cx.query("INSERT INTO trial_invitations (trial_request_id,company_id,owner_user_id,approved_by_platform_admin_id,approval_idempotency_key,approval_intent_hash,status,token_hash,token_generated_at,token_expires_at,trial_start_at,trial_end_at,approved_at,last_sent_at,provenance,internal_key_hash,internal_reason) VALUES (?,?,?,?,?,UNHEX(SHA2('fixture',256)),'pending_activation',NULL,UTC_TIMESTAMP(6),DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 1 DAY),UTC_TIMESTAMP(6),DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 14 DAY),UTC_TIMESTAMP(6),?,?,?,?)", [values.request, values.company, values.owner, values.admin, crypto.randomUUID(), values.sent, values.provenance, values.key, values.reason]);
      };
      // Prove the base shapes really succeed; rollback keeps uniqueness slots
      // empty so every negative case fails for its intended constraint only.
      const publicShape = { provenance: "PUBLIC_TRIAL_REQUEST", request: publicRequest.insertId, key: null, reason: null, sent: new Date() };
      for (const shape of [{}, publicShape]) { await cx.beginTransaction(); try { await insert(shape); } finally { await cx.rollback(); } }
      for (const [patch, constraint] of [
        [{ company: 2147483647 }, "fk_trial_invitation_company"], [{ owner: 2147483647 }, "fk_trial_invitation_owner"],
        [{ admin: 2147483647 }, "fk_trial_invitation_approver"], [{ ...publicShape, request: 2147483647 }, "fk_trial_invitation_request"],
      ]) { await assert.rejects(insert(patch), sqlError("ER_NO_REFERENCED_ROW_2", 1452, constraint)); assert.deepEqual(await snapshot(), before); }
      for (const patch of [
        { key: null }, { reason: null }, { reason: "   " }, { request: publicRequest.insertId }, { sent: new Date() }, { provenance: "UNKNOWN" },
        { ...publicShape, request: null }, { ...publicShape, sent: null }, { ...publicShape, key: Buffer.alloc(32, 9) }, { ...publicShape, reason: "not permitted" },
      ]) { await assert.rejects(insert(patch), sqlError("ER_CHECK_CONSTRAINT_VIOLATED", 3819, "chk_trial_invitation_provenance")); assert.deepEqual(await snapshot(), before); }
      const [[pilot]] = await cx.query("SELECT internal_key_hash FROM trial_invitations WHERE provenance='INTERNAL_PILOT'");
      await assert.rejects(insert({ key: pilot.internal_key_hash }), sqlError("ER_DUP_ENTRY", 1062, "uq_trial_invitation_internal_key"));
      assert.deepEqual(await snapshot(), before);
    })) return;
    if (!await requiredCase(t, "public approval, cooldown, resend and single-use activation still work after migration", async () => {
      const { approveTrialRequest, resendTrialInvitation, activateAccount } = require("../services/trialInvitationService");
      const [pending] = await cx.query("INSERT INTO trial_requests (public_reference,full_name,company_name,email,mobile,city,country,business_type,privacy_communications_consent,privacy_policy_version,consented_at,client_ip_hash) VALUES ('public-regression','Synthetic Public','Synthetic Public','public@example.test','+919000000002','Pune','IN','services',1,'synthetic-fixture',UTC_TIMESTAMP(6),UNHEX(SHA2('synthetic',256)))");
      const [[pilotBefore]] = await cx.query("SELECT HEX(token_hash) token_hash,last_sent_at FROM trial_invitations WHERE provenance='INTERNAL_PILOT'");
      // Adapter wraps only connection ownership; every transaction/query is real.
      const executor = { query: (...args) => cx.query(...args), async getConnection() { return { query: (...args) => cx.query(...args), beginTransaction: () => cx.beginTransaction(), commit: () => cx.commit(), rollback: () => cx.rollback(), release() {} }; } };
      const deliveries = []; const environment = { TRIAL_REQUEST_APPROVAL_ENABLED: "true" };
      const send = async payload => { deliveries.push({ token: payload.token }); return { sent: true }; }; // public flow only, never Graph
      const approved = await approveTrialRequest({ requestId: pending.insertId, expectedVersion: 1, idempotencyKey: crypto.randomUUID(), admin: { id: 7 } }, { executor, environment, send, randomBytes: size => Buffer.alloc(size, 11) });
      assert.equal(approved.delivery_status, "accepted"); assert.equal(deliveries.length, 1);
      const [[inv]] = await cx.query("SELECT * FROM trial_invitations WHERE trial_request_id=?", [pending.insertId]);
      assert.equal(inv.provenance, "PUBLIC_TRIAL_REQUEST"); assert.notEqual(inv.last_sent_at, null); assert.equal(inv.internal_key_hash, null); assert.equal(inv.internal_reason, null);
      const resend = { requestId: pending.insertId, expectedVersion: 2, idempotencyKey: crypto.randomUUID(), admin: { id: 7 } };
      await assert.rejects(resendTrialInvitation(resend, { executor, environment, send }), { code: "TRIAL_INVITATION_COOLDOWN" }); assert.equal(deliveries.length, 1);
      await cx.query("UPDATE trial_invitations SET last_sent_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 11 MINUTE) WHERE id=?", [inv.id]);
      assert.equal((await resendTrialInvitation(resend, { executor, environment, send, randomBytes: size => Buffer.alloc(size, 12) })).delivery_status, "accepted");
      assert.equal(deliveries.length, 2);
      await assert.rejects(activateAccount({ token: deliveries[0].token, password: "Synthetic-only-passphrase" }, { executor }), { code: "ACTIVATION_INVALID" });
      assert.deepEqual(await activateAccount({ token: deliveries[1].token, password: "Synthetic-only-passphrase" }, { executor }), { code: "ACCOUNT_ACTIVATED" });
      await assert.rejects(activateAccount({ token: deliveries[1].token, password: "Synthetic-only-passphrase" }, { executor }), { code: "ACTIVATION_INVALID" });
      deliveries.length = 0;
      const [[activated]] = await cx.query("SELECT status,token_hash FROM trial_invitations WHERE id=?", [inv.id]); assert.equal(activated.status, "activated"); assert.equal(activated.token_hash, null);
      const [operations] = await cx.query("SELECT operation_type,status FROM trial_invitation_operations WHERE trial_invitation_id=? ORDER BY id", [inv.id]);
      assert.deepEqual(operations.map(r => [r.operation_type, r.status]), [["approve", "accepted"], ["resend", "accepted"], ["activate", "completed"]]);
      const [[pilotAfter]] = await cx.query("SELECT HEX(token_hash) token_hash,last_sent_at FROM trial_invitations WHERE provenance='INTERNAL_PILOT'"); assert.deepEqual(pilotAfter, pilotBefore);
    })) return;
  } finally {
    await cx.end();
    if (privateDir) { const output = path.join(privateDir, "activation.txt"); try { await fsp.unlink(output); } catch (e) { if (e.code !== "ENOENT") throw e; } await fsp.rmdir(privateDir); }
  }
});
