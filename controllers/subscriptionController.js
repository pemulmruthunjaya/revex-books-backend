const {
  SubscriptionServiceError,
  activateSubscriptionByPlanCode,
  getEffectiveSubscription,
} = require("../services/subscriptionService");

const normalizeSubscriptionStatus = (result) => ({
  company: result?.company ? {
    id: result.company.id,
    status: result.company.status,
  } : null,
  subscription: result?.subscription ? {
    status: result.subscription.status,
    billing_cycle: result.subscription.billing_cycle,
    trial_start_at: result.subscription.trial_start_at,
    trial_end_at: result.subscription.trial_end_at,
    subscription_start_at: result.subscription.subscription_start_at,
    current_period_start_at: result.subscription.current_period_start_at,
    current_period_end_at: result.subscription.current_period_end_at,
  } : null,
  plan: result?.plan ? {
    id: result.plan.id,
    code: result.plan.code,
    name: result.plan.name,
  } : null,
  access: {
    valid: result?.access?.valid === true,
    reason: result?.access?.reason || "SUBSCRIPTION_STATE_INVALID",
    expires_at: result?.access?.expires_at || null,
  },
});

const createGetSubscriptionStatus = ({
  getSubscription = getEffectiveSubscription,
  logger = console,
} = {}) => async (req, res) => {
  const companyId = Number(req.user?.company_id);
  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    return res.status(500).json({
      message: "Unable to determine authenticated company context",
      code: "SUBSCRIPTION_STATUS_FAILED",
    });
  }

  try {
    const result = await getSubscription(companyId);
    return res.status(200).json(normalizeSubscriptionStatus(result));
  } catch (error) {
    if (error instanceof SubscriptionServiceError && error.code === "COMPANY_NOT_FOUND") {
      return res.status(404).json({
        message: "Company not found",
        code: "COMPANY_NOT_FOUND",
      });
    }

    logger.error(`Subscription status lookup failed for company ${companyId}`);
    return res.status(500).json({
      message: "Unable to retrieve subscription status",
      code: "SUBSCRIPTION_STATUS_FAILED",
    });
  }
};

const getSubscriptionStatus = createGetSubscriptionStatus();

const MANUAL_BILLING_CYCLES = new Set(["monthly", "annual"]);

const activationErrorResponse = (error) => {
  if (!(error instanceof SubscriptionServiceError)) {
    return { status: 500, code: "SUBSCRIPTION_ACTIVATION_FAILED", message: "Unable to activate subscription" };
  }
  const clientErrors = new Set([
    "INVALID_BILLING_CYCLE",
    "INVALID_IDEMPOTENCY_KEY",
    "INVALID_PERIOD",
  ]);
  return {
    status: clientErrors.has(error.code) ? 400 : error.status,
    code: error.code,
    message: error.message,
  };
};

const createActivateSubscription = ({
  activate = activateSubscriptionByPlanCode,
  logger = console,
  resolveActor = () => ({
    type: "system",
    userId: null,
    reason: "Manual RevEx Books activation",
    metadata: { channel: "internal_admin" },
  }),
} = {}) => async (req, res) => {
  const companyId = Number(req.body?.company_id);
  const planCode = String(req.body?.plan_code || "").trim().toUpperCase();
  const billingCycle = String(req.body?.billing_cycle || "").trim().toLowerCase();
  const requestId = String(req.body?.request_id || "").trim();

  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    return res.status(400).json({ message: "A valid company_id is required", code: "INVALID_COMPANY_ID" });
  }
  if (!planCode) {
    return res.status(400).json({ message: "plan_code is required", code: "PLAN_NOT_FOUND" });
  }
  if (!MANUAL_BILLING_CYCLES.has(billingCycle)) {
    return res.status(400).json({
      message: "billing_cycle must be monthly or annual",
      code: "INVALID_BILLING_CYCLE",
    });
  }
  if (!requestId || requestId.length > 64) {
    return res.status(400).json({
      message: "request_id is required and must not exceed 64 characters",
      code: "INVALID_IDEMPOTENCY_KEY",
    });
  }

  try {
    const result = await activate({
      companyId,
      planCode,
      billingCycle,
      idempotencyKey: requestId,
      actor: resolveActor(req),
    });
    return res.status(200).json(normalizeSubscriptionStatus(result));
  } catch (error) {
    const response = activationErrorResponse(error);
    if (response.status === 500) logger.error(`Manual subscription activation failed for company ${companyId}`);
    return res.status(response.status).json({ message: response.message, code: response.code });
  }
};

const activateSubscription = createActivateSubscription();

module.exports = {
  activateSubscription,
  createActivateSubscription,
  createGetSubscriptionStatus,
  getSubscriptionStatus,
  normalizeSubscriptionStatus,
};
