const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const db = require("../db/connection");
const { provisionCompanyOwner } = require("./companyOwnerProvisioningService");
const { sendTrialActivation } = require("./emailService");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const DELIVERY_IN_PROGRESS_MINUTES = 15;
const enabled = (environment = process.env) => environment.TRIAL_REQUEST_APPROVAL_ENABLED === "true";
const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");
const intentHash = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
class InvitationError extends Error { constructor(code, status = 409) { super(code); this.name = "InvitationError"; this.code = code; this.status = status; } }
const requireEnabled = (environment) => { if (!enabled(environment)) throw new InvitationError("TRIAL_APPROVAL_UNAVAILABLE", 503); };
const operationKey = (value) => { if (typeof value !== "string" || !UUID.test(value)) throw new InvitationError("INVALID_IDEMPOTENCY_KEY", 400); return value; };
const requestIdentity = (value) => { const id = Number(value); if (!Number.isSafeInteger(id) || id <= 0) throw new InvitationError("TRIAL_REQUEST_NOT_FOUND", 404); return id; };
const affectedOne = (result, code) => { if (result.affectedRows !== 1) throw new InvitationError(code); };
const tokenState = async ({ connection, randomBytes, trialEnd }) => {
  const token = randomBytes(32).toString("base64url");
  const [clock] = await connection.query("SELECT UTC_TIMESTAMP(6) generated_at,LEAST(DATE_ADD(UTC_TIMESTAMP(6),INTERVAL 24 HOUR),?) expires_at", [trialEnd]);
  if (clock.length !== 1 || !clock[0].generated_at || !clock[0].expires_at || new Date(clock[0].expires_at) <= new Date(clock[0].generated_at)) throw new InvitationError("TRIAL_INVITATION_INELIGIBLE");
  return { token, tokenHash: hashToken(token), generated: clock[0].generated_at, expires: clock[0].expires_at };
};
const mapMutationError = (error) => {
  if (error instanceof InvitationError) return error;
  if (error?.code === "ER_DUP_ENTRY") return new InvitationError("TRIAL_PROVISIONING_CONFLICT", 409);
  if (["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(error?.code)) return new InvitationError("TRIAL_OPERATION_CONFLICT", 409);
  return error;
};
const deliveryStatus = (delivery, error) => {
  if (error) return ["unknown", "TRIAL_INVITATION_DELIVERY_UNKNOWN"];
  if (delivery?.sent) return ["accepted", null];
  if (["MS_GRAPH_TIMEOUT", "MS_GRAPH_NETWORK_ERROR", "MS_GRAPH_EMAIL_FAILED"].includes(delivery?.code)) return ["unknown", "TRIAL_INVITATION_DELIVERY_UNKNOWN"];
  return ["failed", "TRIAL_INVITATION_DELIVERY_FAILED"];
};
const normalizeDeliveryRead = (row) => {
  const copy = { ...row };
  if (copy.delivery_internal_status !== "in_flight") copy.delivery_status = copy.delivery_internal_status || null;
  else {
    const age = new Date(copy.server_now).getTime() - new Date(copy.delivery_operation_created_at).getTime();
    copy.delivery_status = Number.isFinite(age) && age >= 0 && age <= DELIVERY_IN_PROGRESS_MINUTES * 60 * 1000 ? "in_progress" : "unknown";
  }
  delete copy.delivery_internal_status; delete copy.delivery_operation_created_at; return copy;
};

const approveTrialRequest = async ({ requestId, expectedVersion, idempotencyKey, admin }, options = {}) => {
  const environment = options.environment || process.env; requireEnabled(environment);
  const executor = options.executor || db, randomBytes = options.randomBytes || crypto.randomBytes, provision = options.provision || provisionCompanyOwner, send = options.send || sendTrialActivation;
  requestId = requestIdentity(requestId);
  const key = operationKey(idempotencyKey), connection = await executor.getConnection();
  let invitation, rawToken;
  try {
    await connection.beginTransaction();
    const intent = intentHash({ operation: "approve", requestId: Number(requestId), expectedVersion: Number(expectedVersion) });
    const [prior] = await connection.query("SELECT HEX(intent_hash) intent_hash,status,operation_type FROM trial_invitation_operations WHERE idempotency_key=? FOR UPDATE", [key]);
    if (prior.length) { if (String(prior[0].intent_hash).toLowerCase() !== intent) throw new InvitationError("IDEMPOTENCY_CONFLICT"); throw new InvitationError("TRIAL_REQUEST_ALREADY_PROCESSED"); }
    const [rows] = await connection.query("SELECT * FROM trial_requests WHERE id=? FOR UPDATE", [requestId]);
    if (!rows.length) throw new InvitationError("TRIAL_REQUEST_NOT_FOUND", 404);
    const request = rows[0];
    if (request.status !== "pending" || Number(request.version) !== Number(expectedVersion)) throw new InvitationError("TRIAL_REQUEST_VERSION_CONFLICT");
    const provisioned = await provision({ connection, request, adminId: admin.id, approvalKey: key, randomBytes });
    const state = await tokenState({ connection, randomBytes, trialEnd: provisioned.subscription.trial_end_at }); rawToken = state.token;
    const [inv] = await connection.query(
      `INSERT INTO trial_invitations (trial_request_id,company_id,owner_user_id,approved_by_platform_admin_id,approval_idempotency_key,approval_intent_hash,status,token_hash,token_generation,token_generated_at,token_expires_at,trial_start_at,trial_end_at,approved_at,last_sent_at)
       VALUES (?,?,?,?,?,UNHEX(?),'pending_activation',UNHEX(?),1,?,?,?,?,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))`,
      [request.id, provisioned.companyId, provisioned.ownerId, admin.id, key, intent, state.tokenHash, state.generated, state.expires, provisioned.subscription.trial_start_at, provisioned.subscription.trial_end_at]
    );
    await connection.query("INSERT INTO trial_invitation_operations (trial_invitation_id,operation_type,idempotency_key,intent_hash,token_generation,actor_type,platform_admin_id,status) VALUES (?,'approve',?,UNHEX(?),1,'platform_admin',?,'in_flight')", [inv.insertId, key, intent, admin.id]);
    const [updated] = await connection.query("UPDATE trial_requests SET status='approved',approved_by_platform_admin_id=?,approved_at=UTC_TIMESTAMP(6),version=version+1 WHERE id=? AND status='pending' AND version=?", [admin.id, request.id, expectedVersion]); affectedOne(updated, "TRIAL_REQUEST_VERSION_CONFLICT");
    await connection.commit();
    invitation = { id: inv.insertId, email: request.email, name: request.full_name, trialEnd: provisioned.subscription.trial_end_at };
  } catch (error) { await connection.rollback(); throw mapMutationError(error); } finally { connection.release(); }
  let delivery, sendError; try { delivery = await send({ name: invitation.name, email: invitation.email, token: rawToken, trialExpiresAt: invitation.trialEnd }, { environment }); } catch (error) { sendError = error; }
  rawToken = null;
  const [status, code] = deliveryStatus(delivery, sendError);
  try { const [recorded] = await executor.query("UPDATE trial_invitation_operations SET status=?,error_code=?,completed_at=UTC_TIMESTAMP(6) WHERE trial_invitation_id=? AND operation_type='approve' AND idempotency_key=? AND status='in_flight'", [status, code, invitation.id, key]); affectedOne(recorded, "TRIAL_INVITATION_DELIVERY_UNKNOWN"); }
  catch { throw new InvitationError("TRIAL_INVITATION_DELIVERY_UNKNOWN", 503); }
  return { request_status: "approved", provisioning_status: "completed", delivery_status: status, activation_status: "pending_activation", subscription_status: "trialing", allowed_actions: ["resend"], server_now: new Date().toISOString() };
};

const resendTrialInvitation = async ({ requestId, expectedVersion, idempotencyKey, admin }, options = {}) => {
  const environment = options.environment || process.env; requireEnabled(environment);
  const executor = options.executor || db, randomBytes = options.randomBytes || crypto.randomBytes, send = options.send || sendTrialActivation;
  requestId = requestIdentity(requestId);
  const key = operationKey(idempotencyKey), connection = await executor.getConnection(); let state, invitation;
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(`SELECT i.*,r.email,r.full_name,r.version request_version,s.status subscription_status,s.trial_end_at,u.activation_required,u.is_active user_active,c.status AS company_status FROM trial_invitations i JOIN trial_requests r ON r.id=i.trial_request_id JOIN users u ON u.id=i.owner_user_id JOIN companies c ON c.id=i.company_id JOIN company_subscriptions s ON s.company_id=i.company_id WHERE r.id=? FOR UPDATE`, [requestId]);
    if (!rows.length) throw new InvitationError("TRIAL_REQUEST_NOT_FOUND", 404); invitation = rows[0];
    if (Number(invitation.request_version) !== Number(expectedVersion)) throw new InvitationError("TRIAL_REQUEST_VERSION_CONFLICT");
    if (invitation.status !== "pending_activation" || Number(invitation.activation_required) !== 1 || Number(invitation.user_active) !== 1 || String(invitation.company_status || "").toLowerCase() !== "active" || invitation.subscription_status !== "trialing") throw new InvitationError("TRIAL_INVITATION_INELIGIBLE");
    const [clock] = await connection.query("SELECT UTC_TIMESTAMP(6) now_at, DATE_ADD(last_sent_at,INTERVAL 10 MINUTE) cooldown_until FROM trial_invitations WHERE id=?", [invitation.id]);
    if (new Date(invitation.trial_end_at) <= new Date(clock[0].now_at)) throw new InvitationError("TRIAL_INVITATION_INELIGIBLE");
    if (clock[0].cooldown_until && new Date(clock[0].now_at) < new Date(clock[0].cooldown_until)) throw new InvitationError("TRIAL_INVITATION_COOLDOWN", 429);
    const intent = intentHash({ operation: "resend", requestId: Number(requestId), expectedVersion: Number(expectedVersion) });
    const [prior] = await connection.query("SELECT HEX(intent_hash) intent_hash,operation_type FROM trial_invitation_operations WHERE idempotency_key=? FOR UPDATE", [key]);
    if (prior.length) { if (String(prior[0].intent_hash).toLowerCase() !== intent) throw new InvitationError("IDEMPOTENCY_CONFLICT"); throw new InvitationError("TRIAL_INVITATION_OPERATION_REPLAY"); }
    state = await tokenState({ connection, randomBytes, trialEnd: invitation.trial_end_at });
    const generation = Number(invitation.token_generation) + 1;
    const [updated] = await connection.query("UPDATE trial_invitations SET token_hash=UNHEX(?),token_generation=?,token_generated_at=?,token_expires_at=?,last_sent_at=UTC_TIMESTAMP(6),version=version+1 WHERE id=? AND version=? AND status='pending_activation'", [state.tokenHash, generation, state.generated, state.expires, invitation.id, invitation.version]); affectedOne(updated, "TRIAL_INVITATION_VERSION_CONFLICT");
    await connection.query("INSERT INTO trial_invitation_operations (trial_invitation_id,operation_type,idempotency_key,intent_hash,token_generation,actor_type,platform_admin_id,status) VALUES (?,'resend',?,UNHEX(?),?,'platform_admin',?,'in_flight')", [invitation.id, key, intent, generation, admin.id]);
    await connection.commit(); invitation.token_generation = generation;
  } catch (error) { await connection.rollback(); throw mapMutationError(error); } finally { connection.release(); }
  let delivery, sendError; try { delivery = await send({ name: invitation.full_name, email: invitation.email, token: state.token, trialExpiresAt: invitation.trial_end_at }, { environment }); } catch (error) { sendError = error; }
  state.token = null; const [status, code] = deliveryStatus(delivery, sendError);
  try { const [recorded] = await executor.query("UPDATE trial_invitation_operations SET status=?,error_code=?,completed_at=UTC_TIMESTAMP(6) WHERE trial_invitation_id=? AND operation_type='resend' AND idempotency_key=? AND status='in_flight'", [status, code, invitation.id, key]); affectedOne(recorded, "TRIAL_INVITATION_DELIVERY_UNKNOWN"); }
  catch { throw new InvitationError("TRIAL_INVITATION_DELIVERY_UNKNOWN", 503); }
  return { request_status: "approved", provisioning_status: "completed", delivery_status: status, activation_status: "pending_activation", subscription_status: "trialing", allowed_actions: ["resend"], server_now: new Date().toISOString() };
};

const activateAccount = async (input, options = {}) => {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some((key) => !["token", "password"].includes(key))
    || Buffer.byteLength(JSON.stringify(input), "utf8") > 1024) throw new InvitationError("ACTIVATION_INVALID", 400);
  const { token: value, password: secret } = input;
  if (typeof value !== "string" || typeof secret !== "string" || !TOKEN.test(value) || Array.from(secret).length < 8 || Buffer.byteLength(secret, "utf8") > 72) throw new InvitationError("ACTIVATION_INVALID", 400);
  const executor = options.executor || db, hash = options.hash || bcrypt.hash, connection = await executor.getConnection();
  try {
    await connection.beginTransaction();
    const tokenHash = hashToken(value);
    const [rows] = await connection.query(`SELECT i.*,u.activation_required,u.is_active user_active,c.status AS company_status,s.status subscription_status,s.trial_end_at,UTC_TIMESTAMP(6) server_now FROM trial_invitations i JOIN users u ON u.id=i.owner_user_id JOIN companies c ON c.id=i.company_id JOIN company_subscriptions s ON s.company_id=i.company_id WHERE i.token_hash=UNHEX(?) FOR UPDATE`, [tokenHash]);
    if (!rows.length) throw new InvitationError("ACTIVATION_INVALID", 400); const invitation = rows[0];
    const serverNow = new Date(invitation.server_now);
    if (invitation.status !== "pending_activation" || Number(invitation.activation_required) !== 1 || Number(invitation.user_active) !== 1 || String(invitation.company_status || "").toLowerCase() !== "active" || invitation.subscription_status !== "trialing" || new Date(invitation.token_expires_at) <= serverNow || new Date(invitation.trial_end_at) <= serverNow) throw new InvitationError("ACTIVATION_INVALID", 400);
    const passwordHash = await hash(secret, 10);
    const [userUpdate] = await connection.query("UPDATE users SET password=?,activation_required=0,activated_at=UTC_TIMESTAMP(6),password_changed_at=UTC_TIMESTAMP(6),must_change_password=0,password_reset_token_hash=NULL,password_reset_expires_at=NULL WHERE id=? AND activation_required=1", [passwordHash, invitation.owner_user_id]); affectedOne(userUpdate, "ACTIVATION_INVALID");
    const [invUpdate] = await connection.query("UPDATE trial_invitations SET status='activated',activated_at=UTC_TIMESTAMP(6),token_hash=NULL,version=version+1 WHERE id=? AND token_hash=UNHEX(?) AND status='pending_activation'", [invitation.id, tokenHash]); affectedOne(invUpdate, "ACTIVATION_INVALID");
    await connection.query("INSERT INTO trial_invitation_operations (trial_invitation_id,operation_type,intent_hash,token_generation,actor_type,status,completed_at) VALUES (?,'activate',UNHEX(?),?, 'customer','completed',UTC_TIMESTAMP(6))", [invitation.id, intentHash({ operation: "activate", invitationId: invitation.id, generation: invitation.token_generation }), invitation.token_generation]);
    await connection.commit(); return { code: "ACCOUNT_ACTIVATED" };
  } catch (error) { await connection.rollback(); if (error instanceof InvitationError) throw error; throw new InvitationError("ACTIVATION_INVALID", 400); } finally { connection.release(); }
};

const READ_SELECT = `SELECT r.id,r.public_reference,r.full_name,r.company_name,r.email,r.mobile,r.city,r.country,r.business_type,r.note,r.privacy_policy_version,r.consented_at,r.status,r.version,r.created_at,r.updated_at,r.approved_at,
  i.company_id,i.owner_user_id,i.status activation_status,i.token_generated_at,i.token_expires_at,i.trial_start_at,i.trial_end_at,i.last_sent_at,
  s.status subscription_status,
  o.status delivery_internal_status,o.created_at delivery_operation_created_at,UTC_TIMESTAMP(6) server_now
  FROM trial_requests r
  LEFT JOIN trial_invitations i ON i.trial_request_id=r.id
  LEFT JOIN company_subscriptions s ON s.company_id=i.company_id
  LEFT JOIN trial_invitation_operations o ON o.id=(SELECT MAX(latest.id) FROM trial_invitation_operations latest WHERE latest.trial_invitation_id=i.id AND latest.operation_type IN ('approve','resend'))`;

const pageLimit = (value) => {
  if (value === undefined) return DEFAULT_PAGE_SIZE;
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new InvitationError("INVALID_PAGINATION", 400);
  const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_PAGE_SIZE) throw new InvitationError("INVALID_PAGINATION", 400); return parsed;
};
const cursorMac = (payload, secret) => crypto.createHmac("sha256", secret).update(payload).digest("base64url");
const encodeCursor = (row, secret) => {
  const createdAt = new Date(row.created_at); if (!Number.isSafeInteger(Number(row.id)) || Number(row.id) <= 0 || Number.isNaN(createdAt.getTime())) throw new InvitationError("INVALID_PAGINATION", 400);
  const payload = Buffer.from(JSON.stringify([createdAt.toISOString(), Number(row.id)])).toString("base64url");
  return `${payload}.${cursorMac(payload, secret)}`;
};
const decodeCursor = (value, secret) => {
  if (typeof value !== "string" || value.length > 256 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) throw new InvitationError("INVALID_PAGINATION", 400);
  const [payload, mac] = value.split("."); const expected = cursorMac(payload, secret);
  const a = Buffer.from(mac), b = Buffer.from(expected); if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new InvitationError("INVALID_PAGINATION", 400);
  let parsed; try { parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { throw new InvitationError("INVALID_PAGINATION", 400); }
  if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[0] !== "string" || !Number.isSafeInteger(parsed[1]) || parsed[1] <= 0) throw new InvitationError("INVALID_PAGINATION", 400);
  const date = new Date(parsed[0]); if (Number.isNaN(date.getTime()) || date.toISOString() !== parsed[0]) throw new InvitationError("INVALID_PAGINATION", 400);
  return { createdAt: parsed[0], id: parsed[1] };
};
const listTrialRequests = async ({ limit: rawLimit, cursor: rawCursor } = {}, { executor = db, cursorSecret = process.env.JWT_SECRET } = {}) => {
  const limit = pageLimit(rawLimit); if (typeof cursorSecret !== "string" || cursorSecret.length < 32) throw new InvitationError("TRIAL_OPERATION_UNAVAILABLE", 503);
  const cursor = rawCursor === undefined ? null : decodeCursor(rawCursor, cursorSecret);
  const where = cursor ? " WHERE (r.created_at<? OR (r.created_at=? AND r.id<?))" : "";
  const params = cursor ? [cursor.createdAt, cursor.createdAt, cursor.id, limit + 1] : [limit + 1];
  const [rows] = await executor.query(`${READ_SELECT}${where} ORDER BY r.created_at DESC,r.id DESC LIMIT ?`, params);
  const hasMore = rows.length > limit; const data = rows.slice(0, limit).map(normalizeDeliveryRead);
  return { data, nextCursor: hasMore ? encodeCursor(data[data.length - 1], cursorSecret) : null };
};
const getTrialRequest = async (id, { executor = db } = {}) => {
  const [rows] = await executor.query(`${READ_SELECT} WHERE r.id=?`, [id]);
  if (!rows.length) throw new InvitationError("TRIAL_REQUEST_NOT_FOUND", 404); return normalizeDeliveryRead(rows[0]);
};

module.exports = { DEFAULT_PAGE_SIZE, DELIVERY_IN_PROGRESS_MINUTES, InvitationError, MAX_PAGE_SIZE, activateAccount, approveTrialRequest, decodeCursor, enabled, encodeCursor, getTrialRequest, hashToken, listTrialRequests, normalizeDeliveryRead, pageLimit, resendTrialInvitation, tokenState };
