const SAFE_DATABASE = /^revex_tr1b_test_[a-z0-9_]+$/;

const assertSafeTr1bMysqlTarget = (raw) => {
  if (typeof raw !== "string" || !raw) throw new Error("TR1B_TEST_DATABASE_URL_REQUIRED");
  let target; try { target = new URL(raw); } catch { throw new Error("TR1B_TEST_DATABASE_URL_INVALID"); }
  const database = target.pathname.replace(/^\//, ""); const host = target.hostname.toLowerCase(); const port = Number(target.port || 3306);
  if (target.protocol !== "mysql:" || !["127.0.0.1", "localhost"].includes(host)) throw new Error("TR1B_TEST_DATABASE_MUST_BE_LOOPBACK");
  if (port === 3306 || !Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("TR1B_TEST_DATABASE_PORT_FORBIDDEN");
  if (!SAFE_DATABASE.test(database) || database.length > 64 || target.search || target.hash || /railway|production/i.test(`${host}/${database}`)) throw new Error("TR1B_TEST_DATABASE_NAME_FORBIDDEN");
  return Object.freeze({ host, port, database });
};

module.exports = { SAFE_DATABASE, assertSafeTr1bMysqlTarget };
