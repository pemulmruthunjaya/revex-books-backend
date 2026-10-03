const crypto = require("crypto");
const db = require("../db/connection");

const POLICY_VERSION = "2026-09-29";
const BUSINESS_TYPES = new Set(["retail", "wholesale_distribution", "manufacturing", "services", "it_software", "professional_services", "construction", "ecommerce", "other"]);
const FIELDS = new Set(["full_name", "company_name", "email", "mobile", "city", "country", "business_type", "note", "privacy_communications_consent", "privacy_policy_version", "website"]);
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const MAX_REFERENCE_ATTEMPTS = 3;

class TrialRequestError extends Error {
  constructor(code, status = 400) { super(code); this.name = "TrialRequestError"; this.code = code; this.status = status; }
}
const digest = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const text = (value) => String(value ?? "").trim();
const validText = (value, min, max) => value.length >= min && value.length <= max && !CONTROL.test(value);
const normalize = (body) => {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !FIELDS.has(key))) throw new TrialRequestError("TRIAL_REQUEST_INVALID");
  for (const key of ["full_name", "company_name", "email", "mobile", "city", "country", "business_type", "privacy_policy_version"]) if (typeof body[key] !== "string") throw new TrialRequestError("TRIAL_REQUEST_INVALID");
  if ((body.note !== undefined && typeof body.note !== "string") || (body.website !== undefined && typeof body.website !== "string")) throw new TrialRequestError("TRIAL_REQUEST_INVALID");
  const data = {
    full_name: text(body.full_name), company_name: text(body.company_name), email: text(body.email).toLowerCase(),
    mobile: text(body.mobile).replace(/[\s-]/g, ""), city: text(body.city), country: text(body.country).toUpperCase(),
    business_type: text(body.business_type), note: text(body.note), privacy_policy_version: text(body.privacy_policy_version),
  };
  if (!validText(data.full_name, 2, 100) || !validText(data.company_name, 2, 150)
    || !validText(data.email, 3, 254) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)
    || !/^\+[1-9]\d{7,14}$/.test(data.mobile) || !validText(data.city, 1, 100)
    || data.country !== "IN" || !BUSINESS_TYPES.has(data.business_type)
    || data.note.length > 500 || CONTROL.test(data.note)
    || body.privacy_communications_consent !== true || data.privacy_policy_version !== POLICY_VERSION
    || text(body.website) !== "") throw new TrialRequestError("TRIAL_REQUEST_INVALID");
  return data;
};
const intentHash = (data) => digest(JSON.stringify(Object.keys(data).sort().map((key) => [key, data[key]])));
const publicReference = (randomBytes = crypto.randomBytes) => randomBytes(18).toString("base64url");

const reserveRateCapacity = async (connection, clientIpHash) => {
  // Capture one authoritative UTC bucket, even if a lock wait crosses a boundary.
  const [clock] = await connection.query("SELECT FLOOR(TIMESTAMPDIFF(SECOND,'1970-01-01',UTC_TIMESTAMP(6))/900) bucket_number");
  const bucket = clock[0]?.bucket_number;
  if (clock.length !== 1 || !Number.isSafeInteger(Number(bucket)) || Number(bucket) < 0) throw new TrialRequestError("TRIAL_REQUEST_UNAVAILABLE", 503);
  await connection.query(
    `INSERT INTO trial_request_rate_buckets
       (client_ip_hash,bucket_number,request_count)
     VALUES (UNHEX(?),?,0)
     ON DUPLICATE KEY UPDATE client_ip_hash=VALUES(client_ip_hash)`,
    [clientIpHash, bucket]
  );
  const [buckets] = await connection.query(
    `SELECT request_count
       FROM trial_request_rate_buckets
      WHERE client_ip_hash=UNHEX(?)
        AND bucket_number=?
      FOR UPDATE`,
    [clientIpHash, bucket]
  );
  if (buckets.length !== 1 || Number(buckets[0].request_count) >= 5) {
    throw new TrialRequestError("TRIAL_REQUEST_RATE_LIMITED", 429);
  }
  const [incremented] = await connection.query(
    `UPDATE trial_request_rate_buckets
        SET request_count=request_count+1
      WHERE client_ip_hash=UNHEX(?)
        AND bucket_number=?
        AND request_count<5`,
    [clientIpHash, bucket]
  );
  if (incremented.affectedRows !== 1) throw new TrialRequestError("TRIAL_REQUEST_RATE_LIMITED", 429);
};

const persistTrialRequest = async ({ connection, data, clientIpHash, randomBytes }) => {
  for (let attempt = 0; attempt < MAX_REFERENCE_ATTEMPTS; attempt += 1) {
    const reference = publicReference(randomBytes);
    try {
      const [result] = await connection.query(
      `INSERT INTO trial_requests
         (public_reference,full_name,company_name,email,mobile,city,country,business_type,note,privacy_communications_consent,privacy_policy_version,consented_at,client_ip_hash,status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(6),UNHEX(?),'pending')`,
      [reference, data.full_name, data.company_name, data.email, data.mobile, data.city, data.country, data.business_type, data.note || null, 1, data.privacy_policy_version, clientIpHash]
      );
      if (result.affectedRows !== 1) throw new TrialRequestError("TRIAL_REQUEST_UNAVAILABLE", 503);
      return { requestId: result.insertId, status: "accepted" };
    } catch (error) {
      if (error.code !== "ER_DUP_ENTRY") throw error;
      // Current reads resolve the three actual unique constraints, including
      // database collation semantics. Do not infer a constraint from driver text.
      const [contacts] = await connection.query("SELECT id FROM trial_requests WHERE email=? OR mobile=? ORDER BY id LIMIT 2 FOR UPDATE", [data.email, data.mobile]);
      if (contacts.length) return { requestId: contacts[0].id, status: "suppressed" };
      const [collision] = await connection.query("SELECT id FROM trial_requests WHERE public_reference=? FOR UPDATE", [reference]);
      if (collision.length !== 1) throw new TrialRequestError("TRIAL_REQUEST_UNAVAILABLE", 503);
    }
  }
  throw new TrialRequestError("TRIAL_REQUEST_UNAVAILABLE", 503);
};

const submitTrialRequest = async ({ body, gateway }, { executor = db, randomBytes = crypto.randomBytes } = {}) => {
  const data = normalize(body);
  if (!gateway || !UUID.test(gateway.idempotencyKey) || !HEX64.test(gateway.clientIpHash)) throw new TrialRequestError("TRIAL_REQUEST_INVALID");
  const intent = intentHash(data);
  const winner = async () => {
    for (let read = 0; read < 3; read += 1) {
      let rows;
      try { [rows] = await executor.query("SELECT HEX(intent_hash) intent_hash,result_code,response_reference,status FROM trial_request_submissions WHERE idempotency_key=? LIMIT 1", [gateway.idempotencyKey]); }
      catch { throw new TrialRequestError("TRIAL_REQUEST_UNAVAILABLE", 503); }
      if (!rows.length) continue;
      const row = rows[0];
      if (!["accepted", "suppressed"].includes(row.status) || row.result_code !== "TRIAL_REQUEST_RECEIVED" || !/^[A-Za-z0-9_-]{24}$/.test(row.response_reference)) throw new TrialRequestError("TRIAL_REQUEST_UNAVAILABLE", 503);
      if (String(row.intent_hash).toLowerCase() !== intent) throw new TrialRequestError("TRIAL_REQUEST_IDEMPOTENCY_CONFLICT", 409);
      return { code: row.result_code, request_reference: row.response_reference };
    }
    return null;
  };
  let connection, responseReference;
  // Only reservation/reference generation may repeat. No quota or intake work
  // occurs until ownership succeeds; an owned transaction is never replayed.
  for (let attempt = 0; attempt < MAX_REFERENCE_ATTEMPTS; attempt += 1) {
    responseReference = publicReference(randomBytes);
    connection = await executor.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        `INSERT INTO trial_request_submissions
           (idempotency_key,intent_hash,response_reference,trial_request_id,client_ip_hash,result_code,status)
         VALUES (?,UNHEX(?),?,NULL,UNHEX(?),?,'in_flight')`,
        [gateway.idempotencyKey, intent, responseReference, gateway.clientIpHash, "TRIAL_REQUEST_RECEIVED"]
      );
      break;
    } catch (error) {
      let rolledBack = false;
      try { await connection.rollback(); rolledBack = true; } catch { throw new TrialRequestError("TRIAL_REQUEST_UNAVAILABLE", 503); }
      finally {
        if (!rolledBack && typeof connection.destroy === "function") connection.destroy();
        else connection.release();
        connection = null;
      }
      if (!["ER_DUP_ENTRY", "ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(error.code)) throw new TrialRequestError("TRIAL_REQUEST_UNAVAILABLE", 503);
      const replay = await winner();
      if (replay) return replay;
      if (error.code !== "ER_DUP_ENTRY") throw new TrialRequestError("TRIAL_REQUEST_UNAVAILABLE", 503);
      const [collision] = await executor.query("SELECT id FROM trial_request_submissions WHERE response_reference=? LIMIT 1", [responseReference]);
      if (collision.length !== 1) throw new TrialRequestError("TRIAL_REQUEST_UNAVAILABLE", 503);
    }
  }
  if (!connection) throw new TrialRequestError("TRIAL_REQUEST_UNAVAILABLE", 503);
  let commitStarted = false;
  try {
    await reserveRateCapacity(connection, gateway.clientIpHash);
    const persisted = await persistTrialRequest({ connection, data, clientIpHash: gateway.clientIpHash, randomBytes });
    const [completed] = await connection.query(
      "UPDATE trial_request_submissions SET trial_request_id=?,status=? WHERE idempotency_key=? AND status='in_flight'",
      [persisted.requestId, persisted.status, gateway.idempotencyKey]
    );
    if (completed.affectedRows !== 1) throw new TrialRequestError("TRIAL_REQUEST_UNAVAILABLE", 503);
    commitStarted = true;
    await connection.commit();
    return { code: "TRIAL_REQUEST_RECEIVED", request_reference: responseReference };
  } catch (error) {
    let rolledBack = false;
    if (!commitStarted) { try { await connection.rollback(); rolledBack = true; } catch { /* Discard an uncertain transaction. */ } }
    // Release before acquiring a connection for bounded, read-only resolution.
    if (!rolledBack && typeof connection.destroy === "function") connection.destroy();
    else connection.release();
    connection = null;
    if (!commitStarted && !rolledBack) throw new TrialRequestError("TRIAL_REQUEST_UNAVAILABLE", 503);
    if (commitStarted || ["ER_DUP_ENTRY", "ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(error.code)) {
      const replay = await winner();
      if (replay) return replay;
      throw new TrialRequestError("TRIAL_REQUEST_UNAVAILABLE", 503);
    }
    throw error instanceof TrialRequestError ? error : new TrialRequestError("TRIAL_REQUEST_UNAVAILABLE", 503);
  } finally { if (connection) connection.release(); }
};

module.exports = {
  BUSINESS_TYPES, FIELDS, MAX_REFERENCE_ATTEMPTS, POLICY_VERSION, TrialRequestError,
  intentHash, normalize, persistTrialRequest, reserveRateCapacity, submitTrialRequest,
};
