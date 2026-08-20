const {
  SubscriptionServiceError,
  getEffectiveSubscription,
} = require("../services/subscriptionService");

const ACCESS_ERRORS = {
  COMPANY_INACTIVE: "This company is inactive",
  SUBSCRIPTION_NOT_PROVISIONED: "A subscription has not been provisioned for this company",
  TRIAL_EXPIRED: "Your trial has expired",
  PAID_PERIOD_EXPIRED: "Your paid subscription period has expired",
  SUBSCRIPTION_EXPIRED: "Your subscription has expired",
  SUBSCRIPTION_SUSPENDED: "Your subscription is suspended",
  SUBSCRIPTION_CANCELLED: "Your subscription is cancelled",
  SUBSCRIPTION_PAST_DUE: "Your subscription payment is past due",
  SUBSCRIPTION_STATE_INVALID: "Your subscription is not in a valid access state",
};

const KNOWN_SERVICE_ERROR_CODES = new Set([
  "COMPANY_INACTIVE",
  "COMPANY_NOT_FOUND",
  "SUBSCRIPTION_NOT_PROVISIONED",
]);

const commercialAccessResponse = (res, result) => {
  const reason = result?.access?.reason;
  const code = Object.hasOwn(ACCESS_ERRORS, reason)
    ? reason
    : "SUBSCRIPTION_STATE_INVALID";
  const body = {
    message: ACCESS_ERRORS[code],
    code,
    subscription_status: result?.subscription?.status || null,
    expires_at: result?.access?.expires_at || null,
  };
  return res.status(403).json(body);
};

const createRequireValidSubscription = ({
  getSubscription = getEffectiveSubscription,
  logger = console,
} = {}) => async (req, res, next) => {
  const companyId = Number(req.user?.company_id);
  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    logger.error("Subscription check failed: authenticated company context is missing");
    return res.status(500).json({
      message: "Unable to verify subscription access",
      code: "SUBSCRIPTION_CHECK_FAILED",
    });
  }

  try {
    const result = await getSubscription(companyId);
    req.subscription = result;
    if (result?.access?.valid === true) {
      return next();
    }
    return commercialAccessResponse(res, result);
  } catch (error) {
    if (error instanceof SubscriptionServiceError
      && KNOWN_SERVICE_ERROR_CODES.has(error.code)) {
      const reason = error.code === "COMPANY_NOT_FOUND"
        ? "SUBSCRIPTION_NOT_PROVISIONED"
        : error.code;
      return commercialAccessResponse(res, {
        subscription: null,
        access: { valid: false, reason, expires_at: null },
      });
    }

    logger.error(`Subscription check failed for company ${companyId}`);
    return res.status(500).json({
      message: "Unable to verify subscription access",
      code: "SUBSCRIPTION_CHECK_FAILED",
    });
  }
};

const requireValidSubscription = createRequireValidSubscription();

module.exports = {
  ACCESS_ERRORS,
  createRequireValidSubscription,
  requireValidSubscription,
};
