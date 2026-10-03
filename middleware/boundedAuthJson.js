const express = require("express");

const AUTH_JSON_LIMIT = "4kb";
const parseJson = express.json({ limit: AUTH_JSON_LIMIT, strict: true, type: "application/json" });
const boundedAuthJson = (req, res, next) => {
  if (!req.is("application/json")) return res.status(400).set("Cache-Control", "no-store").json({ code: "AUTH_REQUEST_INVALID" });
  return parseJson(req, res, (error) => {
    if (error) return next(error);
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) return res.status(400).set("Cache-Control", "no-store").json({ code: "AUTH_REQUEST_INVALID" });
    return next();
  });
};
const boundedAuthJsonError = (error, _req, res, next) => {
  if (!error) return next();
  if (["entity.too.large", "entity.parse.failed", "encoding.unsupported", "charset.unsupported"].includes(error.type) || error instanceof SyntaxError) {
    return res.status(400).set("Cache-Control", "no-store").json({ code: "AUTH_REQUEST_INVALID" });
  }
  return res.status(400).set("Cache-Control", "no-store").json({ code: "AUTH_REQUEST_INVALID" });
};

module.exports = { AUTH_JSON_LIMIT, boundedAuthJson, boundedAuthJsonError };
