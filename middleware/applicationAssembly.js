const express = require("express");
const { boundedAuthJson, boundedAuthJsonError } = require("./boundedAuthJson");

// Import-inert shared production assembly. Callers supply routers and boundaries;
// importing this module never loads the database, starts jobs, or opens a socket.
const assembleApplicationBoundary = (app, {
  publicTrialRequestRoutes, authRoutes, platformAuthRoutes,
  apiRateLimiter, authRateLimiter, auditLogMiddleware,
  environment = process.env,
}) => {
  app.use("/api/public", publicTrialRequestRoutes);
  app.use("/api/auth", boundedAuthJson, boundedAuthJsonError, apiRateLimiter, auditLogMiddleware, authRateLimiter, authRoutes);
  app.use("/api/platform/auth", platformAuthRoutes);
  app.use("/api/platform/trial-requests", (req, res, next) => req.method === "POST" ? boundedAuthJson(req, res, next) : next(), boundedAuthJsonError);
  app.use(express.json({ limit: environment.JSON_BODY_LIMIT || "25mb" }));
  app.use(express.urlencoded({ extended: true, limit: environment.JSON_BODY_LIMIT || "25mb" }));
  app.use("/api", apiRateLimiter);
  app.use("/api", auditLogMiddleware);
  return app;
};

module.exports = { assembleApplicationBoundary };
