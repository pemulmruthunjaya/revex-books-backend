const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const mysql = require("mysql2/promise");

const PREFIX = "revex_fy_test_";
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

const validateTestTarget = ({ host, database }) => {
  if (!host || !database) throw new Error("Explicit test host and database are required");
  if (!LOCAL_HOSTS.has(host)) throw new Error("Test MySQL host must be local");
  if (database === "railway" || !database.startsWith(PREFIX)) {
    throw new Error(`Test database must start with ${PREFIX}`);
  }
  return { host, database };
};

const adminSql = (sql) => {
  const result = spawnSync("mysql", ["--login-path=revex-dryrun", "--host=127.0.0.1", "--port=3306", "--protocol=TCP"], {
    input: sql, encoding: "utf8", windowsHide: true,
  });
  if (result.status !== 0) throw new Error(result.stderr || `mysql exited ${result.status}`);
};

const createHarness = async () => {
  const database = `${PREFIX}${Date.now()}_${process.pid}`;
  const host = "127.0.0.1";
  validateTestTarget({ host, database });
  const user = `revex_fy_${process.pid}_${Date.now()}`.slice(0, 32);
  const password = crypto.randomBytes(24).toString("base64url");
  adminSql(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER '${user}'@'127.0.0.1' IDENTIFIED BY '${password}';
GRANT ALL PRIVILEGES ON \`${database}\`.* TO '${user}'@'127.0.0.1';`);
  const pool = mysql.createPool({ host, user, password, database, waitForConnections: true, connectionLimit: 4, multipleStatements: true });
  let closed = false;
  return {
    host, database, pool,
    async apply(sql) { await pool.query(sql); },
    adminApply(sql) { adminSql(`USE \`${database}\`;\n${sql}`); },
    async close() {
      if (closed) return;
      closed = true;
      await pool.end();
      adminSql(`DROP DATABASE IF EXISTS \`${database}\`; DROP USER IF EXISTS '${user}'@'127.0.0.1';`);
    },
  };
};

const routeSharedDbToPool = (sharedDb, pool) => {
  const originals = {};
  for (const method of ["query", "execute", "getConnection"]) {
    originals[method] = sharedDb[method];
    sharedDb[method] = pool[method].bind(pool);
  }
  return () => Object.assign(sharedDb, originals);
};

module.exports = { PREFIX, LOCAL_HOSTS, validateTestTarget, createHarness, routeSharedDbToPool };
