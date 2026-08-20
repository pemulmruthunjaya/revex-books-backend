const cron = require("node-cron");
const { expireDueTrials } = require("../services/subscriptionService");

let scheduledTask = null;

const processDueTrialExpiries = async (options = {}) => {
  const summary = await expireDueTrials(options);
  console.log("Subscription expiry scheduler completed:", {
    found: summary.found,
    expired: summary.expired,
    skipped: summary.skipped,
    failed: summary.failed,
  });
  return summary;
};

const startSubscriptionExpiryScheduler = () => {
  if (process.env.SUBSCRIPTION_EXPIRY_SCHEDULER_ENABLED !== "true") {
    console.log("Subscription expiry scheduler is disabled");
    return null;
  }
  if (scheduledTask) return scheduledTask;

  const schedule = process.env.SUBSCRIPTION_EXPIRY_CRON || "*/15 * * * *";
  if (!cron.validate(schedule)) {
    console.error("Subscription expiry scheduler was not started: invalid cron expression");
    return null;
  }

  scheduledTask = cron.schedule(
    schedule,
    async () => {
      try {
        await processDueTrialExpiries();
      } catch (error) {
        console.error("Subscription expiry scheduler run failed:", error.message);
      }
    },
    { noOverlap: true }
  );

  console.log(`Subscription expiry scheduler started with cron: ${schedule}`);
  return scheduledTask;
};

module.exports = {
  processDueTrialExpiries,
  startSubscriptionExpiryScheduler,
};
