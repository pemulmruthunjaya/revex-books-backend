"use strict";
// No CLI or environment-driven execution. Explicit programmatic invocation by
// an operator, never imported by HTTP/startup code. No email dependency/sink.
const crypto = require("node:crypto"), path = require("node:path"), { execFileSync } = require("node:child_process");
const { pin, identity } = require("../utils/pinnedMysqlConnection");
const { reserve } = require("../utils/internalPilotActivationFile");
const { assertTrialInvitationReadiness, assertInternalProvisioningStorage } = require("../services/trialInvitationReadinessService");
const CONFIRMATION = "PROVISION_REVEX_INTERNAL_PILOT_WITHOUT_EMAIL_V1";
const APP_URL = "https://revex-books-frontend.vercel.app";
const fail = code => { throw Object.assign(new Error(code), { code }); };
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
function validate(input) {
  if (!input || input.confirmation !== CONFIRMATION || input.mode !== "INTERNAL_PILOT_NO_EMAIL" || input.transactionOwnership !== "EXCLUSIVE_IDLE_CONNECTION" ||
      input.companyName !== "RevEx FY Pilot" || input.ownerName !== "RevEx Pilot Owner" || input.ownerEmail !== "pilot.owner@revexbooks.com" || input.planCode !== "PLAN_2" || input.trialDays !== 14 ||
      !/^[0-9a-f]{40}$/.test(input.expectedCommit || "") || !Number.isSafeInteger(input.platformAdminId) || input.platformAdminId <= 0 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.idempotencyKey || "") ||
      typeof input.reason !== "string" || input.reason !== input.reason.trim() || !input.reason.length || input.reason.length > 500 || /[\x00-\x1f\x7f]/.test(input.reason) ||
      typeof input.city !== "string" || !input.city.trim() || input.city !== input.city.trim() || input.city.length > 100 || /[\x00-\x1f\x7f]/.test(input.city) ||
      !["retail", "wholesale_distribution", "manufacturing", "services", "it_software", "professional_services", "construction", "ecommerce", "other"].includes(input.businessType)) fail("PILOT_AUTHORIZATION_INVALID");
  const allowed = new Set(["confirmation", "mode", "transactionOwnership", "companyName", "ownerName", "ownerEmail", "planCode", "trialDays", "expectedCommit", "platformAdminId", "idempotencyKey", "reason", "city", "businessType", "outputFile", "identity"]);
  if (Object.keys(input).some(k => !allowed.has(k)) || typeof input.outputFile !== "string" || !path.isAbsolute(input.outputFile)) fail("PILOT_AUTHORIZATION_INVALID");
  const intent = Object.fromEntries(["companyName", "ownerName", "ownerEmail", "planCode", "trialDays", "expectedCommit", "platformAdminId", "reason", "city", "businessType"].map(k => [k, input[k]]));
  return { keyHash: hash(input.idempotencyKey), intentHash: hash(JSON.stringify(intent)) };
}
function runtimeCommit() {
  if (process.env.RAILWAY_GIT_COMMIT_SHA) return process.env.RAILWAY_GIT_COMMIT_SHA;
  try {
    const options = { cwd: path.join(__dirname, ".."), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] };
    const owned = ["scripts/provision-internal-pilot.js", "utils/pinnedMysqlConnection.js", "utils/internalPilotActivationFile.js", "services/internalPilotSchemaContract.js", "services/trialInvitationReadinessService.js", "services/companyOwnerProvisioningService.js", "services/subscriptionService.js", "db/migrations/2026-10-14-internal-pilot-provenance.sql"];
    execFileSync("git", ["ls-files", "--error-unmatch", "--", ...owned], options);
    execFileSync("git", ["diff", "--quiet", "HEAD", "--", ...owned], options);
    return execFileSync("git", ["rev-parse", "HEAD"], options).trim();
  }
  catch { fail("PILOT_RUNTIME_COMMIT_UNVERIFIED"); }
}
async function provision(connection, input) {
  const intent = validate(input);
  if (runtimeCommit() !== input.expectedCommit || process.env.APP_URL !== APP_URL) fail("PILOT_RUNTIME_CONTRACT_MISMATCH");
  const cx = pin(connection); await identity(cx, input.identity);
  await assertTrialInvitationReadiness({ executor: cx, schemaOnly: true, requireInternal: true });
  let locked = false, transaction = false, committing = false, output;
  try {
    locked = true; // uncertain acquisition also requires same-socket cleanup
    const [locks] = await cx.query("SELECT GET_LOCK('revex_internal_pilot_v1',0) acquired");
    if (locks.length !== 1 || Number(locks[0].acquired) !== 1) { locked = false; fail("PILOT_OPERATION_BUSY"); }
    await cx.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    transaction = true; await cx.query("START TRANSACTION");
    await assertInternalProvisioningStorage({ executor: cx, pinMetadata: true });
    // Revalidate after acquiring every metadata lock: the fail-fast probe above
    // cannot certify schema that changed before this owned transaction began.
    // No file reservation, random token or business write precedes this check.
    await assertTrialInvitationReadiness({ executor: cx, schemaOnly: true, requireInternal: true });
    const [admin] = await cx.query("SELECT id,status FROM platform_admins WHERE id=? FOR UPDATE", [input.platformAdminId]);
    if (admin.length !== 1 || admin[0].status !== "active") fail("PILOT_ADMIN_REQUIRED");
    const [prior] = await cx.query("SELECT id,company_id,owner_user_id,HEX(approval_intent_hash) intent_hash,trial_start_at,trial_end_at,provenance,last_sent_at FROM trial_invitations WHERE internal_key_hash=UNHEX(?) FOR UPDATE", [intent.keyHash]);
    if (prior.length) {
      if (prior.length !== 1 || prior[0].intent_hash.toLowerCase() !== intent.intentHash || prior[0].provenance !== "INTERNAL_PILOT" || prior[0].last_sent_at !== null) fail("PILOT_IDEMPOTENCY_CONFLICT");
      await cx.query("ROLLBACK"); transaction = false;
      return { code: "INTERNAL_PILOT_ALREADY_PROVISIONED", invitationId: prior[0].id, companyId: prior[0].company_id, ownerId: prior[0].owner_user_id, trialStart: prior[0].trial_start_at, trialEnd: prior[0].trial_end_at, delivery: "NOT_ATTEMPTED", activationFileCreated: false };
    }
    for (const [sql, args] of [
      ["SELECT id FROM companies WHERE name=? OR email=? FOR UPDATE", [input.companyName, input.ownerEmail]],
      ["SELECT id FROM users WHERE email=? FOR UPDATE", [input.ownerEmail]],
      ["SELECT id FROM trial_requests WHERE company_name=? OR email=? FOR UPDATE", [input.companyName, input.ownerEmail]],
      ["SELECT id FROM trial_invitations WHERE approval_idempotency_key=? FOR UPDATE", [input.idempotencyKey]],
    ]) { const [rows] = await cx.query(sql, args); if (rows.length) fail("PILOT_EXISTING_OR_PARTIAL_PROVISIONING"); }
    // Lock the plan before writes; reuse the reviewed subscription contract.
    const [plans] = await cx.query("SELECT id,name,code,default_trial_days,is_active FROM plans WHERE code='PLAN_2' FOR UPDATE");
    if (plans.length !== 1 || plans[0].name !== "Pro" || Number(plans[0].default_trial_days) !== 14 || Number(plans[0].is_active) !== 1) fail("PILOT_PLAN_CONTRACT_INVALID");
    output = await reserve(input.outputFile);
    const { provisionCompanyOwner } = require("../services/companyOwnerProvisioningService");
    const created = await provisionCompanyOwner({ connection: cx, request: { company_name: input.companyName, full_name: input.ownerName, email: input.ownerEmail, city: input.city, business_type: input.businessType }, adminId: input.platformAdminId, approvalKey: input.idempotencyKey });
    const [clock] = await cx.query("SELECT UTC_TIMESTAMP(6) generated_at,LEAST(DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 24 HOUR),?) expires_at,TIMESTAMPDIFF(SECOND,?,?) trial_seconds", [created.subscription.trial_end_at, created.subscription.trial_start_at, created.subscription.trial_end_at]);
    if (clock.length !== 1 || Number(clock[0].trial_seconds) !== 14 * 86400 || !clock[0].generated_at || !clock[0].expires_at || new Date(clock[0].expires_at) <= new Date(clock[0].generated_at)) fail("PILOT_TRIAL_CONTRACT_INVALID");
    let token = crypto.randomBytes(32).toString("base64url");
    try {
      const [invitation] = await cx.query("INSERT INTO trial_invitations (trial_request_id,company_id,owner_user_id,approved_by_platform_admin_id,approval_idempotency_key,approval_intent_hash,status,token_hash,token_generation,token_generated_at,token_expires_at,trial_start_at,trial_end_at,approved_at,last_sent_at,provenance,internal_key_hash,internal_reason) VALUES (NULL,?,?,?,?,UNHEX(?),'pending_activation',UNHEX(?),1,?,?,?,?,UTC_TIMESTAMP(6),NULL,'INTERNAL_PILOT',UNHEX(?),?)", [created.companyId, created.ownerId, input.platformAdminId, input.idempotencyKey, intent.intentHash, hash(token), clock[0].generated_at, clock[0].expires_at, created.subscription.trial_start_at, created.subscription.trial_end_at, intent.keyHash, input.reason]);
      if (invitation.affectedRows !== 1) fail("PILOT_INVITATION_INSERT_FAILED");
      await output.write(`${APP_URL}/activate-account#token=${token}`);
      token = null;
      committing = true; await cx.query("COMMIT"); transaction = false;
      return { code: "INTERNAL_PILOT_PROVISIONED", companyId: created.companyId, ownerId: created.ownerId, invitationId: invitation.insertId, trialStart: created.subscription.trial_start_at, trialEnd: created.subscription.trial_end_at, delivery: "NOT_ATTEMPTED", activationFileCreated: true, outputFile: input.outputFile };
    } finally { token = null; }
  } catch (error) {
    let cleanupFailed = false;
    if (transaction) { try { await cx.cleanup("ROLLBACK"); } catch { cleanupFailed = true; } }
    if (output) { try { await output.cleanup(); } catch { cleanupFailed = true; } }
    if (cleanupFailed) fail("PILOT_CLEANUP_FAILED_REQUIRES_INSPECTION");
    if (committing) fail("PILOT_COMMIT_UNCERTAIN_DO_NOT_RETRY_AUTOMATICALLY");
    const safe = new Set(["PILOT_OPERATION_BUSY", "PILOT_ADMIN_REQUIRED", "PILOT_IDEMPOTENCY_CONFLICT", "PILOT_EXISTING_OR_PARTIAL_PROVISIONING", "PILOT_PLAN_CONTRACT_INVALID", "PILOT_PRIVATE_POSIX_FILE_REQUIRED", "PILOT_PRIVATE_DIRECTORY_REQUIRED", "PILOT_OUTPUT_UNAVAILABLE"]);
    fail(safe.has(error.code) ? error.code : "PILOT_PROVISIONING_FAILED");
  } finally {
    if (locked) { try { const [released] = await cx.query("SELECT RELEASE_LOCK('revex_internal_pilot_v1') released"); if (released.length !== 1 || Number(released[0].released) !== 1) throw new Error(); } catch { cx.destroy(); fail("PILOT_LOCK_RELEASE_UNCERTAIN"); } }
  }
}
module.exports = { CONFIRMATION, provision, validate };
