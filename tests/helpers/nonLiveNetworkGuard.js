"use strict";
// Test-runner preload only. Keep accidental database/service calls out of the
// non-live suite; local ephemeral HTTP contract servers remain supported.
const net = require("node:net");
const original = net.Socket.prototype.connect;
const databasePorts = new Set([3306, 3307, 3407, 5432, 6379, 1433, 27017]);
net.Socket.prototype.connect = function guardedConnect(...args) {
  let target = args[0];
  if (Array.isArray(target)) target = target[0];
  const options = target && typeof target === "object" ? target : { port: target, host: typeof args[1] === "string" ? args[1] : "localhost" };
  const port = Number(options.port), host = options.host || options.hostname || "localhost";
  if (!["localhost", "127.0.0.1", "::1"].includes(host) || !Number.isInteger(port) || port < 1 || port > 65535 || databasePorts.has(port)) {
    throw Object.assign(new Error("NON_LIVE_NETWORK_BLOCKED"), { code: "NON_LIVE_NETWORK_BLOCKED" });
  }
  return original.apply(this, args);
};
