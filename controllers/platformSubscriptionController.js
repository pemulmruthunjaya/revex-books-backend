const { createActivateSubscription } = require("./subscriptionController");
const {
  SubscriptionServiceError,
  changeSubscriptionPlan,
  extendSubscriptionTrial,
  reactivateSubscription,
  renewSubscription,
  suspendSubscription,
} = require("../services/subscriptionService");

const resolvePlatformActor = (req) => ({
    type: "platform_admin",
    userId: null,
    reason: "Manual RevEx Books activation",
    metadata: {
      channel: "platform_admin_api",
      platform_admin_id: req.platformAdmin.id,
      platform_admin_email: req.platformAdmin.email,
    },
  });

const createPlatformSubscriptionActivation = ({ activate } = {}) =>
  createActivateSubscription({ activate, resolveActor: resolvePlatformActor });

const activatePlatformSubscription = createPlatformSubscriptionActivation();

const ACTIONS = {
  renew: { service: renewSubscription, body: (body) => ({ planId: body.plan_id, billingCycle: body.billing_cycle }) },
  "change-plan": { service: changeSubscriptionPlan, body: (body) => ({ planId: body.plan_id }) },
  "extend-trial": { service: extendSubscriptionTrial, body: (body) => ({ extensionDays: body.extension_days }) },
  suspend: { service: suspendSubscription, body: (body) => ({ reason: body.reason }) },
  reactivate: { service: reactivateSubscription, body: () => ({}) },
};

const createPlatformLifecycleAction = ({ action, service = ACTIONS[action]?.service, logger = console } = {}) => async (req, res) => {
  const companyId = Number(req.params.companyId);
  const requestId = String(req.body?.request_id || "").trim();
  if (!Number.isSafeInteger(companyId) || companyId <= 0) return res.status(400).json({ message: "A valid company ID is required", code: "INVALID_COMPANY_ID" });
  if (!requestId || requestId.length > 64) return res.status(400).json({ message: "request_id is required and must not exceed 64 characters", code: "INVALID_IDEMPOTENCY_KEY" });
  try {
    const result = await service({ companyId, ...ACTIONS[action].body(req.body || {}), actor: resolvePlatformActor(req), idempotencyKey: requestId });
    return res.status(200).json({ message: `Subscription ${action} completed`, company: result.company, subscription: result.subscription, plan: result.plan, access: result.access });
  } catch (error) {
    if (error instanceof SubscriptionServiceError) return res.status(error.status || 409).json({ message: error.message, code: error.code });
    logger.error(`Platform subscription ${action} failed for company ${companyId}`);
    return res.status(500).json({ message: "Unable to update subscription", code: "PLATFORM_SUBSCRIPTION_ACTION_FAILED" });
  }
};

const lifecycleActions = Object.fromEntries(Object.keys(ACTIONS).map((action) => [action, createPlatformLifecycleAction({ action })]));

module.exports = {
  activatePlatformSubscription,
  createPlatformSubscriptionActivation,
  createPlatformLifecycleAction,
  lifecycleActions,
  resolvePlatformActor,
};
