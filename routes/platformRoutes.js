const express = require("express");
const platformAuthMiddleware = require("../middleware/platformAuthMiddleware");
const { activatePlatformSubscription, lifecycleActions } = require("../controllers/platformSubscriptionController");
const platformPortal = require("../controllers/platformPortalController");
const { createTrialInvitationController } = require("../controllers/trialInvitationController");
const trialInvitations = createTrialInvitationController();

const router = express.Router();

router.get("/trial-requests", platformAuthMiddleware, trialInvitations.list);
router.get("/trial-requests/:requestId", platformAuthMiddleware, trialInvitations.get);
router.post("/trial-requests/:requestId/approve", platformAuthMiddleware, trialInvitations.approve);
router.post("/trial-requests/:requestId/resend", platformAuthMiddleware, trialInvitations.resend);
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
