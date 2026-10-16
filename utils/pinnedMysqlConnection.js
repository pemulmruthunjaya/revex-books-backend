"use strict";
// Import-inert; pins the actual mysql2 socket, not a forwarding executor/pool.
const fail = code => { throw Object.assign(new Error(code), { code }); };
function pin(connection) {
  const { PromiseConnection, PromisePoolConnection } = require("mysql2/promise");
  const { Connection } = require("mysql2");
  const core = Object.getOwnPropertyDescriptor(connection || {}, "connection")?.value;
  if (!(connection instanceof PromiseConnection) || connection instanceof PromisePoolConnection || connection.query !== PromiseConnection.prototype.query ||
      !(core instanceof Connection) || core._pool || core.query !== Connection.prototype.query || !Number.isSafeInteger(core.threadId) || core.threadId <= 0 || !core.stream) fail("PILOT_PINNED_CONNECTION_REQUIRED");
  const stream = core.stream, thread = core.threadId, query = Connection.prototype.query;
  let database;
  const unchanged = () => {
    if (connection.connection !== core || core.stream !== stream || stream.destroyed || core.threadId !== thread || core.query !== query || connection.query !== PromiseConnection.prototype.query) {
      Connection.prototype.destroy.call(core); fail("PILOT_CONNECTION_CHANGED");
    }
  };
  const raw = (sql, args = []) => new Promise((resolve, reject) => query.call(core, sql, args, (error, rows, fields) => error ? reject(error) : resolve([rows, fields])));
  async function verify() {
    unchanged();
    const [rows] = await raw("SELECT CAST(CONNECTION_ID() AS CHAR) AS connection_id,DATABASE() AS db");
    unchanged();
    if (rows.length !== 1 || rows[0].connection_id !== String(thread) || !rows[0].db || (database && rows[0].db !== database)) fail("PILOT_CONNECTION_CHANGED");
    database = rows[0].db;
  }
  const destroy = () => Connection.prototype.destroy.call(core);
  return {
    async query(sql, args) { await verify(); const result = await raw(sql, args); unchanged(); return result; },
    async queryWithWarnings(sql, args) {
      await verify();
      const result = await raw(sql, args); unchanged();
      let warningCodes = [];
      if (Number.isInteger(result[0]?.warningStatus) && result[0].warningStatus > 0) {
        // Capture immediately: an intervening identity SELECT would replace
        // the statement's diagnostic area. Never return warning messages.
        try {
          const [warnings] = await raw("SHOW WARNINGS LIMIT 32");
          warningCodes = [...new Set(warnings.map(w => w.Code).filter(n => Number.isInteger(n) && n >= 1000 && n <= 65535))];
        } catch { /* The nonzero warning count still forces a fail-closed stop. */ }
        unchanged();
      }
      return [result[0], warningCodes];
    },
    async cleanup(sql) { try { await verify(); await raw(sql); unchanged(); } catch { destroy(); fail("PILOT_CLEANUP_FAILED"); } },
    destroy,
    host: core.config.host,
    port: Number(core.config.port),
  };
}
async function identity(cx, expected) {
  if (!expected || Object.keys(expected).sort().join(",") !== "database,host,hostname,port,serverPort,version" ||
      !/^[a-zA-Z0-9_.-]+$/.test(expected.host || "") || !/^[a-zA-Z0-9_.-]+$/.test(expected.hostname || "") ||
      !/^[a-zA-Z0-9_]+$/.test(expected.database || "") || expected.version !== "9.7.2" || expected.serverPort !== 3306 ||
      !Number.isInteger(expected.port) || expected.port < 1 || expected.port > 65535 || cx.host !== expected.host || cx.port !== expected.port) fail("PILOT_IDENTITY_MISMATCH");
  const [rows] = await cx.query("SELECT DATABASE() db,@@hostname hostname,@@version version,@@port port");
  if (rows.length !== 1 || rows[0].db !== expected.database || rows[0].hostname !== expected.hostname || rows[0].version !== expected.version || Number(rows[0].port) !== expected.serverPort) fail("PILOT_IDENTITY_MISMATCH");
  const [status] = await cx.query("DO 0");
  if (!Number.isInteger(status.serverStatus) || (status.serverStatus & 1) || !(status.serverStatus & 2)) fail("PILOT_IDLE_CONNECTION_REQUIRED");
}
module.exports = { pin, identity };
