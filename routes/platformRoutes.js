const express = require("express");
const { authRateLimiter } = require("../middleware/securityMiddleware");
const platformAuthMiddleware = require("../middleware/platformAuthMiddleware");
const { platformLogin } = require("../controllers/platformAuthController");
const { activatePlatformSubscription, lifecycleActions } = require("../controllers/platformSubscriptionController");
const platformPortal = require("../controllers/platformPortalController");

const router = express.Router();

router.post("/auth/login", authRateLimiter, platformLogin);
router.post("/subscriptions/activate", platformAuthMiddleware, activatePlatformSubscription);
router.post("/subscriptions/:companyId/renew", platformAuthMiddleware, lifecycleActions.renew);
router.post("/subscriptions/:companyId/change-plan", platformAuthMiddleware, lifecycleActions["change-plan"]);
router.post("/subscriptions/:companyId/extend-trial", platformAuthMiddleware, lifecycleActions["extend-trial"]);
router.post("/subscriptions/:companyId/suspend", platformAuthMiddleware, lifecycleActions.suspend);
router.post("/subscriptions/:companyId/reactivate", platformAuthMiddleware, lifecycleActions.reactivate);
router.get("/dashboard", platformAuthMiddleware, platformPortal.dashboard);
router.get("/companies", platformAuthMiddleware, platformPortal.companies);
router.get("/companies/:companyId", platformAuthMiddleware, platformPortal.companyDetail);
router.get("/subscriptions", platformAuthMiddleware, platformPortal.subscriptions);
router.get("/plans", platformAuthMiddleware, platformPortal.plans);

module.exports = router;
