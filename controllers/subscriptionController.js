const {
  SubscriptionServiceError,
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

module.exports = {
  createGetSubscriptionStatus,
  getSubscriptionStatus,
  normalizeSubscriptionStatus,
};
