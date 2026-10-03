const service = require("../services/trialInvitationService");

const shape = (row, serverNow = new Date().toISOString()) => ({
  id: Number(row.id), request_reference: row.public_reference, full_name: row.full_name,
  company_name: row.company_name, email: row.email, mobile: row.mobile, city: row.city,
  country: row.country, business_type: row.business_type, note: row.note ?? undefined,
  privacy_policy_version: row.privacy_policy_version, request_status: row.status,
  provisioning_status: row.company_id ? "completed" : "not_started",
  delivery_status: row.delivery_status || (row.company_id ? "unknown" : "not_started"),
  activation_status: row.activation_status || "not_started",
  subscription_status: row.subscription_status || (row.company_id ? "unknown" : "not_started"),
  version: Number(row.version), allowed_actions: row.status === "pending" ? ["approve"] : row.activation_status === "pending_activation" ? ["resend"] : [],
  server_now: serverNow, timestamps_utc: {
    created_at: row.created_at, updated_at: row.updated_at, consented_at: row.consented_at,
    approved_at: row.approved_at, token_generated_at: row.token_generated_at,
    token_expires_at: row.token_expires_at, trial_start_at: row.trial_start_at,
    trial_end_at: row.trial_end_at, last_sent_at: row.last_sent_at,
  },
});
const sendError = (res, error) => res.status(error instanceof service.InvitationError ? error.status : 503).json({ code: error instanceof service.InvitationError ? error.code : "TRIAL_OPERATION_UNAVAILABLE" });
const mutationInput = (req) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)
    || Object.keys(req.body).some((key) => key !== "expected_version")
    || typeof req.body.expected_version !== "number" || !Number.isSafeInteger(req.body.expected_version) || req.body.expected_version <= 0) {
    throw new service.InvitationError("TRIAL_REQUEST_INVALID", 400);
  }
  return req.body.expected_version;
};
const createTrialInvitationController = (dependencies = {}) => ({
  me: async (req, res) => res.json({ id: req.platformAdmin.id, name: req.platformAdmin.name, email: req.platformAdmin.email, actor_type: "platform_admin" }),
  list: async (req, res) => { try { const page = await service.listTrialRequests({ limit: req.query.limit, cursor: req.query.cursor }, dependencies); res.json({ server_now: new Date().toISOString(), data: page.data.map((row) => shape(row)), next_cursor: page.nextCursor }); } catch (error) { sendError(res, error); } },
  get: async (req, res) => { try { res.json({ data: shape(await service.getTrialRequest(req.params.requestId, dependencies)) }); } catch (error) { sendError(res, error); } },
  approve: async (req, res) => { try { res.json(await service.approveTrialRequest({ requestId: req.params.requestId, expectedVersion: mutationInput(req), idempotencyKey: req.headers["idempotency-key"], admin: req.platformAdmin }, dependencies)); } catch (error) { sendError(res, error); } },
  resend: async (req, res) => { try { res.json(await service.resendTrialInvitation({ requestId: req.params.requestId, expectedVersion: mutationInput(req), idempotencyKey: req.headers["idempotency-key"], admin: req.platformAdmin }, dependencies)); } catch (error) { sendError(res, error); } },
  activate: async (req, res) => { try { res.json(await service.activateAccount(req.body || {}, dependencies)); } catch (error) { sendError(res, error); } },
});
module.exports = { createTrialInvitationController, mutationInput, shape };
