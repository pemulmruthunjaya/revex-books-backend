"use strict";
const privileges = Object.freeze(["ALTER", "CREATE", "DELETE", "DROP", "INDEX", "INSERT", "LOCK TABLES", "REFERENCES", "SELECT", "TRIGGER", "UPDATE"]);
const fail = () => { throw new Error("ACCOUNT_MYSQL_ISOLATION_REQUIRED"); };
function target(e) {
  if (e.ACCOUNT_MYSQL_PROOF !== "DISPOSABLE_LOOPBACK_ONLY" || e.ACCOUNT_MYSQL_HOST !== "127.0.0.1" || e.ACCOUNT_MYSQL_PORT !== "3407" ||
    !/^account_proof_[a-f0-9]{32}$/.test(e.ACCOUNT_MYSQL_DATABASE || "") || !/^account_test_[a-f0-9]{16}$/.test(e.ACCOUNT_MYSQL_USER || "") || !/^[a-f0-9]{64}$/.test(e.ACCOUNT_MYSQL_PASSWORD || "")) fail();
  return { host: e.ACCOUNT_MYSQL_HOST, port: 3407, database: e.ACCOUNT_MYSQL_DATABASE, user: e.ACCOUNT_MYSQL_USER, password: e.ACCOUNT_MYSQL_PASSWORD, dateStrings: true, supportBigNumbers: true, bigNumberStrings: true, multipleStatements: false };
}
function identity(row, config) {
  if (row.version !== "9.7.2" || Number(row.port) !== 3306 || row.db !== config.database || row.user !== `${config.user}@%`) fail();
}
function grants(rows, config) {
  let usage = 0, scoped = 0;
  for (const row of rows) {
    const match = /^GRANT (.+) ON (.+) TO (.+)$/.exec(Object.values(row)[0]);
    if (!match || match[3] !== `\`${config.user}\`@\`%\``) fail();
    if (match[1] === "USAGE" && match[2] === "*.*") { usage++; continue; }
    if (match[2] !== `\`${config.database.replace(/_/g, "\\_")}\`.*` || JSON.stringify(match[1].split(", ").sort()) !== JSON.stringify([...privileges].sort())) fail();
    scoped++;
  }
  if (usage !== 1 || scoped !== 1) fail();
}
module.exports = { privileges, target, identity, grants };
