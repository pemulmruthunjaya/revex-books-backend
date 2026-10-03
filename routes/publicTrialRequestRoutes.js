const express = require("express");
const { configurationIssues, createTrialRequestGatewayAuth, enabled, MAX_BODY_BYTES } = require("../middleware/trialRequestGatewayAuth");
const { createTrialRequestController } = require("../controllers/trialRequestController");

const createPublicTrialRequestRoutes = (options = {}) => {
  const router = express.Router();
  const environment = options.environment || process.env;
  const availability = (_req, res, next) => !enabled(environment) || configurationIssues(environment).length
    ? res.status(503).set("Cache-Control", "no-store").json({ code: "TRIAL_REQUEST_UNAVAILABLE" })
    : next();
  router.post("/trial-requests", availability, express.raw({ type: "application/json", limit: MAX_BODY_BYTES }), createTrialRequestGatewayAuth(options), createTrialRequestController(options));
  router.use((error, _req, res, _next) => {
    const status = error?.type === "entity.too.large" ? 400 : 503;
    return res.status(status).set("Cache-Control", "no-store").json({ code: status === 400 ? "TRIAL_REQUEST_INVALID" : "TRIAL_REQUEST_UNAVAILABLE" });
  });
  return router;
};
module.exports = createPublicTrialRequestRoutes();
module.exports.createPublicTrialRequestRoutes = createPublicTrialRequestRoutes;
