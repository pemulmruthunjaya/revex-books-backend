class ReportSchemaNotReadyError extends Error {
  constructor(cause) {
    super("Required report schema is not ready; apply the repository migrations before serving this report");
    this.name = "ReportSchemaNotReadyError";
    this.code = "REPORT_SCHEMA_NOT_READY";
    this.status = 503;
    this.cause = cause;
  }
}

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/;

const quoteIdentifier = (value) => {
  if (!IDENTIFIER.test(value)) throw new TypeError("Invalid report schema identifier");
  return `\`${value}\``;
};

const assertReportSchemaReady = async (executor, requirements) => {
  try {
    for (const { table, columns } of requirements) {
      const selection = columns.map(quoteIdentifier).join(",");
      await executor.query(
        `SELECT ${selection} FROM ${quoteIdentifier(table)} LIMIT 0`
      );
    }
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new ReportSchemaNotReadyError(error);
  }
};

module.exports = { ReportSchemaNotReadyError, assertReportSchemaReady };
