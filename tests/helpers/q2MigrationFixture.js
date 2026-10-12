"use strict";
const fs = require("node:fs"), path = require("node:path");
class FakeCore {
  constructor(owner) { this.owner = owner; this.threadId = 7; this.stream = { destroyed: false }; }
  query(sql, args, done) { this.owner.execute(sql, args).then(([rows, fields]) => done(null, rows, fields), done); }
  destroy() { this.stream.destroyed = true; this.owner.locked = false; this.owner.destroyed = true; }
}
class FakePromise {
  query(sql, args) { return this.connection.owner.execute(sql, args); }
}
class FakePoolConnection extends FakePromise {}
const filename = require.resolve("../../db/migrations/2026-10-12-operational-quantity-q2"), moduleFixture = { exports: {} };
new Function("module", "__dirname", "require", fs.readFileSync(filename, "utf8"))(moduleFixture, path.dirname(filename), name => {
  if (name === "mysql2") return { Connection: FakeCore };
  if (name === "mysql2/promise") return { PromiseConnection: FakePromise, PromisePoolConnection: FakePoolConnection };
  return require(name);
});
const runner = moduleFixture.exports;
const clone = x => JSON.parse(JSON.stringify(x));
class Q2Fixture extends FakePromise {
  constructor() {
    super(); this.connection = new FakeCore(this);
    this.types = ["int", "int"]; this.calls = []; this.ddl = []; this.locked = false; this.defaults = ["0", null];
    this.data = [[{ id: "1", value: null, note: "synthetic" }, { id: "2", value: "-2147483648", note: "unchanged" }, { id: "3", value: "2147483647", note: "edge" }], [{ id: "1", value: "0", note: "bill" }]];
    this.serverStatus = 2; this.warnings = 0; this.extraIndexes = []; this.extraFks = []; this.extraChecks = []; this.triggers = [];
  }
  columns(i) {
    const common = { IS_NULLABLE: "YES", COLUMN_DEFAULT: null, EXTRA: "", GENERATION_EXPRESSION: "", COLUMN_COMMENT: "", CHARACTER_SET_NAME: null, COLLATION_NAME: null, NUMERIC_PRECISION: 10, NUMERIC_SCALE: 0 };
    return [{ ...common, COLUMN_NAME: "id", ORDINAL_POSITION: 1, DATA_TYPE: "int", COLUMN_TYPE: "int", IS_NULLABLE: "NO", EXTRA: "auto_increment" },
      { ...common, COLUMN_NAME: runner.targets[i].column, ORDINAL_POSITION: 2, DATA_TYPE: this.types[i] === "int" ? "int" : "decimal", COLUMN_TYPE: this.types[i], COLUMN_DEFAULT: this.defaults[i], NUMERIC_PRECISION: this.types[i] === "int" ? 10 : 12, NUMERIC_SCALE: this.types[i] === "int" ? 0 : 2 },
      { ...common, COLUMN_NAME: "note", ORDINAL_POSITION: 3, DATA_TYPE: "varchar", COLUMN_TYPE: "varchar(30)", CHARACTER_SET_NAME: "utf8mb4", COLLATION_NAME: "utf8mb4_bin", NUMERIC_PRECISION: null, NUMERIC_SCALE: null }];
  }
  async execute(sql, args = []) {
    this.calls.push(sql); this.onQuery?.(sql, this);
    const i = args.length && typeof args[0] === "string" && runner.targets.some(t => t.table === args[0]) ? runner.targets.findIndex(t => t.table === args[0]) : sql.includes("`bill_items`") ? 1 : 0;
    const t = runner.targets[i];
    if (sql.includes("CONNECTION_ID()")) return [[{ connection_id: this.serverId || "7", db: "synthetic_q2" }]];
    if (sql === "DO 0") return [{ serverStatus: this.serverStatus }];
    if (sql === "SELECT DATABASE() AS db") return [[{ db: "synthetic_q2" }]];
    if (sql.startsWith("LOCK TABLES")) { this.locked = true; this.onLock?.(this); return [{ warningStatus: 0 }]; }
    if (sql === "UNLOCK TABLES") { this.locked = false; return [{}]; }
    if (sql.startsWith("ALTER")) {
      if (!this.locked) throw Error("unlocked DDL");
      if (this.failAt === this.ddl.length) throw Error("synthetic interruption");
      this.ddl.push(sql); this.types[i] = "decimal(12,2)"; if (i === 0) this.defaults[i] = "0.00";
      this.onDdl?.(this); return [{ warningStatus: this.warnings }];
    }
    if (sql.includes("information_schema.TABLES")) return [[{ TABLE_TYPE: "BASE TABLE", ENGINE: this.engine || "InnoDB", TABLE_COLLATION: "utf8mb4_bin", CREATE_OPTIONS: "" }]];
    if (sql.includes("information_schema.COLUMNS")) { const rows = this.columns(i); this.editColumns?.(rows, i); return [clone(rows)]; }
    if (sql.includes("information_schema.STATISTICS")) return [[{ INDEX_NAME: "PRIMARY", SEQ_IN_INDEX: 1, COLUMN_NAME: "id", NON_UNIQUE: 0, SUB_PART: null, INDEX_TYPE: "BTREE", IS_VISIBLE: "YES", EXPRESSION: null }, ...this.extraIndexes]];
    if (sql.includes("information_schema.KEY_COLUMN_USAGE")) return [clone(this.extraFks)];
    if (sql.includes("information_schema.TABLE_CONSTRAINTS")) return [clone(this.extraChecks)];
    if (sql.includes("information_schema.TRIGGERS")) return [clone(this.triggers)];
    if (sql.startsWith("SHOW CREATE")) return [[{ "Create Table": `CREATE TABLE \`${t.table}\` (\n  \`id\` int NOT NULL AUTO_INCREMENT,\n  \`${t.column}\` ${this.types[i]} DEFAULT ${this.defaults[i] === null ? "NULL" : `'${this.defaults[i]}'`},\n  \`note\` varchar(30) DEFAULT NULL,\n  PRIMARY KEY (\`id\`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin` }]];
    if (sql.startsWith("SELECT CAST(COUNT(*)")) return [[{ row_count: String(this.countOverride ?? this.data[i].length) }]];
    if (sql.includes(" WHERE id > ") && !sql.includes("id > CAST(? AS DECIMAL(20,0))")) throw Error("Inexact cursor comparison");
    if (sql.startsWith("SELECT CAST(id")) return [this.data[i].filter(r => !args.length || BigInt(r.id) > BigInt(args[0])).slice(0, 500).map(r => ({ cursor_id: r.id, c0: Buffer.from(r.id).toString("hex"), c1: r.value, c2: r.note === null ? null : Buffer.from(r.note).toString("hex") }))];
    throw Error("Unexpected fixture query");
  }
}
module.exports = { Q2Fixture, runner, FakeCore };
