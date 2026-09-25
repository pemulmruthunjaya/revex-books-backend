"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { assertReportSchemaReady } = require("../services/reportSchemaService");

test("report GET modules contain no schema-changing SQL", () => {
  for (const file of ["accountingSummary.js", "reportController.js"]) {
    const source = fs.readFileSync(path.join(__dirname, "..", "controllers", file), "utf8");
    assert.doesNotMatch(source, /\b(?:CREATE|ALTER|DROP|TRUNCATE)\s+(?:TABLE|INDEX)\b/i, file);
  }
});

test("report schema readiness uses SELECT-only probes and fails closed", async () => {
  const calls = [];
  const executor = { query: async (sql) => { calls.push(sql); return [[], []]; } };
  await assertReportSchemaReady(executor, [{ table: "products", columns: ["id", "company_id"] }]);
  assert.deepEqual(calls, ["SELECT `id`,`company_id` FROM `products` LIMIT 0"]);

  await assert.rejects(
    assertReportSchemaReady({ query: async () => { throw new Error("missing table"); } }, [{ table: "products", columns: ["id"] }]),
    { code: "REPORT_SCHEMA_NOT_READY", status: 503 }
  );
});
