const test = require("node:test");

const enabled = process.env.ANNUAL_SUBLEDGER_TEST_ENABLED === "1";
test("guarded annual subledger schema is installed on the explicitly supplied isolated MySQL database", { skip: !enabled }, async () => {
  const raw = process.env.ANNUAL_SUBLEDGER_TEST_DATABASE_URL;
  if (!raw) throw new Error("ANNUAL_SUBLEDGER_TEST_DATABASE_URL is required when the explicit guard is enabled");
  const url = new URL(raw);
  if (!/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(url.hostname) || Number(url.port || 3306) === 3306) {
    throw new Error("Annual subledger integration tests require a non-default loopback MySQL port");
  }
  const mysql = require("mysql2/promise");
  const connection = await mysql.createConnection(raw);
  try {
    const [identity] = await connection.query("SELECT VERSION() version, DATABASE() database_name, @@port internal_port");
    if (!/^9\./.test(identity[0].version) || !identity[0].database_name || Number(identity[0].internal_port) !== 3306) {
      throw new Error("Isolated MySQL identity did not match the required guarded test target");
    }
    const readiness = await require("../services/annualSubledgerReadinessService").inspectAnnualSchema(connection);
    if (!readiness.ready) throw new Error(`Annual subledger schema is incomplete: ${readiness.blockers.map(x => x.code).join(",")}`);
  } finally {
    await connection.end();
  }
});
