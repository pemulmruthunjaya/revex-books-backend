const express = require("express");
const { authRateLimiter } = require("../middleware/securityMiddleware");
const platformAuthMiddleware = require("../middleware/platformAuthMiddleware");
const { platformLogin } = require("../controllers/platformAuthController");
const { activatePlatformSubscription } = require("../controllers/platformSubscriptionController");
const platformPortal = require("../controllers/platformPortalController");

const router = express.Router();

router.post("/auth/login", authRateLimiter, platformLogin);
router.post("/subscriptions/activate", platformAuthMiddleware, activatePlatformSubscription);
router.get("/dashboard", platformAuthMiddleware, platformPortal.dashboard);
router.get("/companies", platformAuthMiddleware, platformPortal.companies);
router.get("/companies/:companyId", platformAuthMiddleware, platformPortal.companyDetail);
router.get("/subscriptions", platformAuthMiddleware, platformPortal.subscriptions);

module.exports = router;
