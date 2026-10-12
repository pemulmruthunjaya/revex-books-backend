"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), guard = require("./helpers/q2MysqlGuard");
const env = { Q2_MYSQL_PROOF: "DISPOSABLE_LOOPBACK_ONLY", Q2_MYSQL_HOST: "127.0.0.1", Q2_MYSQL_PORT: "3407", Q2_MYSQL_DATABASE: `q2_proof_${"a".repeat(32)}`, Q2_MYSQL_USER: `q2_test_${"b".repeat(16)}`, Q2_MYSQL_PASSWORD: "synthetic-only" };
const config = guard.target(env), who = `\`${config.user}\`@\`%\``;
const valid = () => [{ grant: `GRANT USAGE ON *.* TO ${who}` }, { grant: `GRANT ${guard.privileges.join(", ")} ON \`${config.database.replace(/_/g, "\\_")}\`.* TO ${who}` }];
test("Q2 disposable guard pins both ports, exact MySQL identity, database and non-SUPER grants", () => {
  guard.identity({ version: "9.7.2", port: 3306, db: config.database, user: `${config.user}@%` }, config); guard.grants(valid(), config);
  for (const [field, values] of Object.entries({ Q2_MYSQL_HOST: ["localhost", "mysql.railway.internal", "127.0.0.1?x", "127.0.0.1#x"], Q2_MYSQL_PORT: ["3306", "3307", "3407?x"], Q2_MYSQL_DATABASE: ["railway", "q2_proof_a", config.database + "#x"], Q2_MYSQL_USER: ["root"], Q2_MYSQL_PROOF: [undefined], Q2_MYSQL_PASSWORD: [""] })) for (const value of values) assert.throws(() => guard.target({ ...env, [field]: value }), { code: "Q2_MYSQL_ISOLATION_REQUIRED" });
  for (const changed of [{ version: "9.7.1" }, { port: 3407 }, { user: "root@localhost" }, { db: "railway" }]) assert.throws(() => guard.identity({ version: "9.7.2", port: 3306, db: config.database, user: `${config.user}@%`, ...changed }, config));
});
test("Q2 guard rejects missing, excessive, wildcard or foreign grants", () => {
  for (const mutate of [r => r[1].grant = r[1].grant.replace("LOCK TABLES, ", ""), r => r[1].grant = r[1].grant.replace("SELECT", "SUPER, SELECT"), r => r[1].grant += " WITH GRANT OPTION", r => r[1].grant = r[1].grant.replace(/\\_/g, "_"), r => r.push({ grant: `GRANT SELECT ON *.* TO ${who}` }), r => r.pop()]) { const rows = valid(); mutate(rows); assert.throws(() => guard.grants(rows, config), { code: "Q2_MYSQL_ISOLATION_REQUIRED" }); }
});
