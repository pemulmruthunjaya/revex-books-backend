class SchemaReadinessError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SchemaReadinessError";
    this.code = code;
    this.status = 503;
  }
}

const assertTableColumns = async ({ executor, table, columns, code }) => {
  const placeholders = columns.map(() => "?").join(", ");
  const [rows] = await executor.query(
    `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME IN (${placeholders})`,
    [table, ...columns]
  );
  const present = new Set(rows.map((row) => row.COLUMN_NAME));
  const missing = columns.filter((column) => !present.has(column));
  if (missing.length) {
    throw new SchemaReadinessError(
      code,
      "Required application schema is not ready"
    );
  }
  return true;
};

module.exports = { SchemaReadinessError, assertTableColumns };
