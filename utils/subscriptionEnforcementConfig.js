const isSubscriptionEnforcementEnabled = (environment = process.env) =>
  environment.SUBSCRIPTION_ENFORCEMENT_ENABLED === "true";

module.exports = {
  isSubscriptionEnforcementEnabled,
};
