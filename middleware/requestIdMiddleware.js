const crypto = require("crypto");

module.exports = (req, res, next) => {
  const incoming = String(req.get("x-request-id") || "").trim();
  req.requestId = /^[A-Za-z0-9._:-]{1,100}$/.test(incoming)
    ? incoming
    : crypto.randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  next();
};
