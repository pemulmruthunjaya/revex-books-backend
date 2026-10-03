const crypto = require("crypto");

const PATH = "/api/public/trial-requests";
const MAX_BODY_BYTES = 16 * 1024;
const MAX_SKEW_MS = 5 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const UTC_MILLISECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const TRIAL_BODY_FIELD_ORDER = Object.freeze([
  "full_name", "company_name", "email", "mobile", "city", "country",
  "business_type", "note", "privacy_communications_consent",
  "privacy_policy_version", "website",
]);

// Signing contract (UTF-8, no trailing newline): POST, the fixed PATH, an
// RFC-3339 UTC timestamp, canonical UUID idempotency key, SHA-256 of the exact
// body bytes, and the gateway-produced client-IP SHA-256, joined by "\n".
// X-RevEx-Signature is lowercase hexadecimal HMAC-SHA256. The gateway secret
// is canonical base64url for at least 32 bytes. The body must be UTF-8 JSON
// serialized with JSON.stringify and TRIAL_BODY_FIELD_ORDER, omitting only
// fields that are absent. No insignificant whitespace or alternate escaping is
// accepted, so the website gateway and backend authenticate one representation.

const enabled = (environment = process.env) => environment.TRIAL_REQUEST_INTAKE_ENABLED === "true";
const unavailable = (res) => res.status(503).set("Cache-Control", "no-store").json({ code: "TRIAL_REQUEST_UNAVAILABLE" });
const invalid = (res) => res.status(400).set("Cache-Control", "no-store").json({ code: "TRIAL_REQUEST_INVALID" });
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const canonical = ({ timestamp, idempotencyKey, bodySha256, clientIpHash }) =>
  ["POST", PATH, timestamp, idempotencyKey, bodySha256, clientIpHash].join("\n");

const gatewaySecret = (value) => {
  const encoded = typeof value === "string" ? value : "";
  if (!BASE64URL.test(encoded)) return null;
  const decoded = Buffer.from(encoded, "base64url");
  if (decoded.length < 32 || decoded.toString("base64url") !== encoded) return null;
  return decoded;
};

const canonicalizeTrialRequestBody = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  if (keys.some((key) => !TRIAL_BODY_FIELD_ORDER.includes(key))) return null;
  const ordered = {};
  for (const key of TRIAL_BODY_FIELD_ORDER) if (Object.hasOwn(value, key)) ordered[key] = value[key];
  return JSON.stringify(ordered);
};

const safeEqualHex = (actual, expected) => {
  if (!HEX64.test(actual) || !HEX64.test(expected)) return false;
  return crypto.timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
};

const configurationIssues = (environment = process.env) => {
  if (!enabled(environment)) return [];
  const issues = [];
  if (!gatewaySecret(environment.TRIAL_REQUEST_GATEWAY_SECRET)) issues.push("TRIAL_REQUEST_GATEWAY_SECRET");
  if (String(environment.TRIAL_REQUEST_ALLOWED_ORIGIN || "") !== "https://revexbooks.com") issues.push("TRIAL_REQUEST_ALLOWED_ORIGIN");
  return issues;
};

const createTrialRequestGatewayAuth = ({ environment = process.env, clock = () => Date.now() } = {}) =>
  (req, res, next) => {
    if (!enabled(environment) || configurationIssues(environment).length) return unavailable(res);
    if (req.method !== "POST" || req.path !== "/trial-requests") return invalid(res);
    if (String(req.headers.origin || "") !== environment.TRIAL_REQUEST_ALLOWED_ORIGIN) return invalid(res);
    if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers["content-type"] || ""))) return invalid(res);
    if (!Buffer.isBuffer(req.body) || req.body.length === 0 || req.body.length > MAX_BODY_BYTES) return invalid(res);

    const timestamp = String(req.headers["x-revex-timestamp"] || "");
    const idempotencyKey = String(req.headers["idempotency-key"] || "");
    const bodySha = String(req.headers["x-revex-body-sha256"] || "");
    const clientIpHash = String(req.headers["x-revex-client-ip-hash"] || "");
    const signature = String(req.headers["x-revex-signature"] || "");
    const parsedTime = Date.parse(timestamp);
    if (!UUID.test(idempotencyKey) || !HEX64.test(bodySha) || !HEX64.test(clientIpHash)
      || !HEX64.test(signature) || !UTC_MILLISECONDS.test(timestamp)
      || !Number.isFinite(parsedTime) || new Date(parsedTime).toISOString() !== timestamp
      || Math.abs(clock() - parsedTime) > MAX_SKEW_MS) return invalid(res);
    if (!safeEqualHex(bodySha, sha256(req.body))) return invalid(res);
    const expected = crypto.createHmac("sha256", gatewaySecret(environment.TRIAL_REQUEST_GATEWAY_SECRET))
      .update(canonical({ timestamp, idempotencyKey, bodySha256: bodySha, clientIpHash }))
      .digest("hex");
    if (!safeEqualHex(signature, expected)) return invalid(res);
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(req.body);
      const parsed = JSON.parse(text);
      const serialized = canonicalizeTrialRequestBody(parsed);
      if (serialized === null || serialized !== text) throw new Error("NON_CANONICAL_BODY");
      req.body = parsed;
      req.trialGateway = Object.freeze({ idempotencyKey, bodySha256: bodySha, clientIpHash });
      return next();
    } catch {
      req.body = undefined;
      return invalid(res);
    }
  };

module.exports = {
  MAX_BODY_BYTES,
  PATH,
  canonical,
  canonicalizeTrialRequestBody,
  configurationIssues,
  createTrialRequestGatewayAuth,
  enabled,
  gatewaySecret,
  safeEqualHex,
  sha256,
  TRIAL_BODY_FIELD_ORDER,
};
