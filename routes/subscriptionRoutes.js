const express = require("express");
const authMiddleware = require("../middleware/authMiddleware");
const {
  getSubscriptionStatus,
} = require("../controllers/subscriptionController");

const router = express.Router();

router.get("/status", authMiddleware, getSubscriptionStatus);

module.exports = router;
