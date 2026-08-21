const express = require("express");
const { authRateLimiter } = require("../middleware/securityMiddleware");
const platformAuthMiddleware = require("../middleware/platformAuthMiddleware");
const { platformLogin } = require("../controllers/platformAuthController");
const { activatePlatformSubscription } = require("../controllers/platformSubscriptionController");

const router = express.Router();

router.post("/auth/login", authRateLimiter, platformLogin);
router.post("/subscriptions/activate", platformAuthMiddleware, activatePlatformSubscription);

module.exports = router;
