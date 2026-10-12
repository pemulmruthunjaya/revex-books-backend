"use strict";
// Import-inert wrapper boundary. Never imported by the database test child.
const PRIVILEGES = Object.freeze(["ALTER", "CREATE", "DELETE", "DROP", "INDEX", "INSERT", "REFERENCES", "SELECT", "TRIGGER", "UPDATE"]);
function provisionSql(database, user, password) {
  if (!/^(?:iv_proof_|annual_migration_proof_|annual_gl_proof_)[a-f0-9]{32}$/.test(database || "") ||
      !/^iv_test_[a-f0-9]{16}$/.test(user || "") || !/^[a-f0-9]{64}$/.test(password || ""))
    throw new Error("IV_ISOLATION_MISMATCH");
  // Escape grant-pattern underscores: privileges belong to this exact database.
  const scope = database.replace(/_/g, "\\_");
  return `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;\n` +
    `CREATE USER '${user}'@'%' IDENTIFIED BY '${password}';\n` +
    `GRANT ${PRIVILEGES.join(",")} ON \`${scope}\`.* TO '${user}'@'%';`;
}
module.exports = { PRIVILEGES, provisionSql };
