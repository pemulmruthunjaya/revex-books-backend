const { createActivateSubscription } = require("./subscriptionController");

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

module.exports = {
  activatePlatformSubscription,
  createPlatformSubscriptionActivation,
  resolvePlatformActor,
};
