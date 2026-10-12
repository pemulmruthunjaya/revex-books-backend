"use strict";
const fail = () => { throw Object.assign(new Error("Q2_MYSQL_ISOLATION_REQUIRED"), { code: "Q2_MYSQL_ISOLATION_REQUIRED" }); };
const privileges = Object.freeze(["ALTER", "CREATE", "DELETE", "DROP", "INDEX", "INSERT", "LOCK TABLES", "REFERENCES", "SELECT", "TRIGGER", "UPDATE"]);
function target(e) {
  if (e.Q2_MYSQL_PROOF !== "DISPOSABLE_LOOPBACK_ONLY" || e.Q2_MYSQL_HOST !== "127.0.0.1" || e.Q2_MYSQL_PORT !== "3407" ||
    !/^q2_proof_[a-f0-9]{32}$/.test(e.Q2_MYSQL_DATABASE || "") || !/^q2_test_[a-f0-9]{16}$/.test(e.Q2_MYSQL_USER || "") || typeof e.Q2_MYSQL_PASSWORD !== "string" || !e.Q2_MYSQL_PASSWORD) fail();
  return { host: "127.0.0.1", port: 3407, database: e.Q2_MYSQL_DATABASE, user: e.Q2_MYSQL_USER, password: e.Q2_MYSQL_PASSWORD,
    multipleStatements: false, dateStrings: true, supportBigNumbers: true, bigNumberStrings: true };
}
function identity(row, config) {
  if (!row || row.version !== "9.7.2" || Number(row.port) !== 3306 || row.db !== config.database || row.user !== `${config.user}@%`) fail();
}
function grants(rows, config) {
  const found = []; let usage = 0, scoped = 0;
  for (const row of rows) {
    const sql = Object.values(row)[0];
    const match = /^GRANT (.+) ON (.+) TO (.+)$/.exec(sql);
    if (!match || match[3] !== `\`${config.user}\`@\`%\``) fail();
    if (match[1] === "USAGE" && match[2] === "*.*") { usage++; continue; }
    // Exact escaped database grant; never accept wildcard underscore scopes.
    if (match[2] !== `\`${config.database.replace(/_/g, "\\_")}\`.*`) fail();
    found.push(...match[1].split(", ")); scoped++;
  }
  if (usage !== 1 || scoped !== 1 || JSON.stringify(found.sort()) !== JSON.stringify([...privileges].sort())) fail();
}
module.exports = { target, identity, grants, privileges };
