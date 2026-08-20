const {
  createTrialCompany,
} = require("./subscriptionService");

class TrialProvisioningError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TrialProvisioningError";
    this.code = code;
  }
}

const configuredTrialPlanCode = (environment = process.env) => {
  const code = String(environment.DEFAULT_TRIAL_PLAN_CODE || "").trim();
  if (!code) {
    throw new TrialProvisioningError(
      "DEFAULT_TRIAL_PLAN_NOT_CONFIGURED",
      "Default trial plan is not configured"
    );
  }
  return code;
};

const provisionCompanyTrial = async ({
  companyId,
  actorUserId,
  source,
  connection,
  environment = process.env,
  createTrial = createTrialCompany,
} = {}) => {
  if (!connection) {
    throw new TrialProvisioningError(
      "TRIAL_TRANSACTION_REQUIRED",
      "Trial provisioning requires the company-creation transaction"
    );
  }

  const planCode = configuredTrialPlanCode(environment);
  const [plans] = await connection.query(
    `SELECT id, code
       FROM plans
      WHERE code = ? AND is_active = 1
      LIMIT 1
      FOR UPDATE`,
    [planCode]
  );
  if (!plans.length) {
    throw new TrialProvisioningError(
      "DEFAULT_TRIAL_PLAN_UNAVAILABLE",
      "Configured default trial plan is unavailable"
    );
  }

  return createTrial({
    companyId,
    planId: plans[0].id,
    actor: {
      type: "owner",
      userId: actorUserId,
      reason: "New company trial provisioned",
      metadata: { source },
    },
    idempotencyKey: `company-created-${companyId}`,
    connection,
  });
};

module.exports = {
  TrialProvisioningError,
  configuredTrialPlanCode,
  provisionCompanyTrial,
};
