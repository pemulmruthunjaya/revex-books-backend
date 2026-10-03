const express = require("express");
const { boundedAuthJson, boundedAuthJsonError } = require("../middleware/boundedAuthJson");
const { validPlatformCredentials } = require("../services/platformAdminService");

const createPlatformAuthRoutes = ({ login, authenticate, apiRateLimiter, authRateLimiter, auditLogMiddleware }) => {
  const router = express.Router();
  router.use((req, res, next) => ["GET", "HEAD"].includes(req.method) ? next() : boundedAuthJson(req, res, next), boundedAuthJsonError);
  router.use(apiRateLimiter, auditLogMiddleware);
  router.post("/login", authRateLimiter, (req, res, next) => {
    if (!validPlatformCredentials(req.body?.email, req.body?.password)) return res.status(401).json({ code: "INVALID_CREDENTIALS", message: "Invalid credentials" });
    return next();
  }, login);
  router.get("/me", authenticate, (req, res) => res.json({
    id: req.platformAdmin.id, name: req.platformAdmin.name,
    email: req.platformAdmin.email, actor_type: "platform_admin",
  }));
  return router;
};

module.exports = { createPlatformAuthRoutes };
