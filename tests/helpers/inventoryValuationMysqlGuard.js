"use strict";

// Pure, import-inert identity checks. No environment loading or connections.
const fail = () => { throw Object.assign(new Error("IV_ISOLATION_MISMATCH"), { code: "IV_ISOLATION_MISMATCH" }); };
function target(env, database) {
  if (env.IV_MYSQL_PROOF !== "DISPOSABLE_LOOPBACK_ONLY" ||
      env.IV_MYSQL_PROOF_HOST !== "127.0.0.1" || env.IV_MYSQL_PROOF_PORT !== "3407" ||
      typeof database !== "string" || !/^iv_proof_[a-f0-9]{32}$/.test(database) ||
      typeof env.IV_MYSQL_PROOF_USER !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(env.IV_MYSQL_PROOF_USER) ||
      env.IV_MYSQL_PROOF_USER.toLowerCase() === "root" ||
      typeof env.IV_MYSQL_PROOF_PASSWORD !== "string" || !env.IV_MYSQL_PROOF_PASSWORD.length) fail();
  return { host: "127.0.0.1", port: 3407, user: env.IV_MYSQL_PROOF_USER,
    password: env.IV_MYSQL_PROOF_PASSWORD, dateStrings: true, supportBigNumbers: true,
    bigNumberStrings: true, multipleStatements: false };
}
function server(identity) {
  if (!identity || ![3306, "3306"].includes(identity.port) || identity.version !== "9.7.2") fail();
}
module.exports = { target, server };
