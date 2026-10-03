const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");

const {
  register,
  login,
  staffLogin,
  forgotPassword,
  resetPassword,
  changePassword,
} = require("../controllers/authController");
const { createTrialInvitationController } = require("../controllers/trialInvitationController");
const trialInvitations = createTrialInvitationController();

router.post("/register", register);
router.post("/login", login);          // OWNER login
router.post("/staff/login", staffLogin); // STAFF login
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post("/activate-account", trialInvitations.activate);
router.post("/change-password", authMiddleware, changePassword);

module.exports = router;
