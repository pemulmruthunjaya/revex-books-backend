"use strict";
const { COLUMN_CONTRACT, INDEX_CONTRACT, FOREIGN_KEY_CONTRACT, CHECK_CONTRACT, INTERNAL_PROVISIONING_TABLES } = require("../../services/trialInvitationReadinessService");
const contract = require("../../services/internalPilotSchemaContract");
class Fixture {
  constructor() { this.applied = false; this.triggerNames = []; this.calls = []; this.data = [{ id: "9007199254740993", value: "preserved" }]; this.locked = false; this.destroyed = false; this.serverId = "7"; this.inTransaction = false; this.connection = new Core(this); }
  columns() {
    const definitions = { ...COLUMN_CONTRACT, trial_invitations: { ...COLUMN_CONTRACT.trial_invitations } };
    if (this.applied) {
      definitions.trial_invitations.trial_request_id = { ...definitions.trial_invitations.trial_request_id, nullable: true };
      definitions.trial_invitations.last_sent_at = { ...definitions.trial_invitations.last_sent_at, nullable: true };
      Object.assign(definitions.trial_invitations, contract.extraColumns);
    }
    const rows = Object.entries(definitions).flatMap(([TABLE_NAME, defs]) => Object.entries(defs).map(([COLUMN_NAME, c], i) => ({ TABLE_NAME, COLUMN_NAME, ORDINAL_POSITION: i + 1, COLUMN_TYPE: c.type, IS_NULLABLE: c.nullable ? "YES" : "NO", COLUMN_DEFAULT: c.defaultValue, EXTRA: c.extra, CHARACTER_SET_NAME: c.charset, COLLATION_NAME: c.collation, GENERATION_EXPRESSION: "", COLUMN_COMMENT: "" })));
    if (this.applied) rows.find(r => r.TABLE_NAME === "trial_invitations" && r.COLUMN_NAME === "provenance").COLUMN_DEFAULT = "PUBLIC_TRIAL_REQUEST";
    if (this.mutateColumns) this.mutateColumns(rows); return rows;
  }
  triggers() {
    return contract.statements().slice(1).map(s => { const m = /^CREATE TRIGGER (\w+) (BEFORE) (UPDATE|INSERT|DELETE) ON (\w+) FOR EACH ROW\s+([\s\S]+)$/.exec(s); return { TRIGGER_NAME: m[1], ACTION_TIMING: m[2], EVENT_MANIPULATION: m[3], EVENT_OBJECT_TABLE: m[4], ACTION_STATEMENT: m[5] }; }).filter(t => this.triggerNames.includes(t.TRIGGER_NAME));
  }
  ready() { this.applied = true; this.triggerNames = contract.statements().slice(1).map(s => /^CREATE TRIGGER (\w+)/.exec(s)[1]); }
  async dispatch(sql, args = []) {
    this.calls.push({ sql, args }); if (this.onQuery) await this.onQuery(sql, args, this);
    if (sql.startsWith("SELECT CAST(CONNECTION_ID()")) return [[{ connection_id: this.serverId, db: "revex_tr1b_test_pilot" }]];
    if (sql.startsWith("SELECT DATABASE() db")) return [[{ db: "revex_tr1b_test_pilot", hostname: "synthetic", version: "9.7.2", port: 3306 }]];
    if (sql === "DO 0") return [{ serverStatus: this.inTransaction ? 3 : 2 }];
    if (sql === "SHOW WARNINGS LIMIT 32") return [this.warningRows || []];
    if (sql.startsWith("SELECT 1 FROM `")) return [[]];
    if (sql.includes("information_schema.TABLES")) {
      if (sql.startsWith("SELECT TABLE_NAME,TABLE_TYPE,ENGINE FROM")) {
        const rows = INTERNAL_PROVISIONING_TABLES.map(TABLE_NAME => ({ TABLE_NAME, TABLE_TYPE: "BASE TABLE", ENGINE: "InnoDB" }));
        if (this.mutateEngines) this.mutateEngines(rows); return [rows];
      }
      if (sql.includes("t.COLUMN") || sql.includes("companies")) return [[{ TABLE_NAME: "companies", TABLE_TYPE: "BASE TABLE", COLUMN_NAME: "status", COLUMN_TYPE: "enum('active','inactive')", IS_NULLABLE: "YES", COLUMN_DEFAULT: "active", EXTRA: "" }]];
      return [["trial_invitation_operations", "trial_invitations"].map(TABLE_NAME => ({ TABLE_NAME, TABLE_TYPE: "BASE TABLE", ENGINE: "InnoDB", TABLE_COLLATION: "utf8mb4_unicode_ci", CREATE_OPTIONS: "" }))];
    }
    if (sql.includes("information_schema.COLUMNS")) return [sql.includes("TABLE_NAME='trial_invitations'") ? this.columns().filter(c => c.TABLE_NAME === "trial_invitations").map(({ TABLE_NAME, ...c }) => c) : this.columns()];
    if (sql.includes("information_schema.STATISTICS")) {
      const defs = [...INDEX_CONTRACT]; if (this.applied) defs.push(["trial_invitations", "uq_trial_invitation_internal_key", false, ["internal_key_hash"]]);
      return [defs.flatMap(([TABLE_NAME, INDEX_NAME, n, names]) => names.map((COLUMN_NAME, i) => ({ TABLE_NAME, INDEX_NAME, NON_UNIQUE: Number(n), SEQ_IN_INDEX: i + 1, COLUMN_NAME, SUB_PART: null })))];
    }
    if (sql.includes("REFERENTIAL_CONSTRAINTS")) {
      const rows = FOREIGN_KEY_CONTRACT.map(([TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME]) => ({ TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME, REFERENCED_TABLE_SCHEMA: "revex_tr1b_test_pilot", EXPECTED_SCHEMA: "revex_tr1b_test_pilot", UPDATE_RULE: "RESTRICT", DELETE_RULE: "RESTRICT" }));
      if (this.mutateFK) this.mutateFK(rows); return [rows];
    }
    if (sql.includes("CHECK_CONSTRAINTS")) {
      const rows = [...Object.entries(CHECK_CONTRACT).map(([CONSTRAINT_NAME, CHECK_CLAUSE]) => ({ CONSTRAINT_NAME, CHECK_CLAUSE, ENFORCED: "YES" })), ...(this.applied ? [{ TABLE_NAME: "trial_invitations", CONSTRAINT_NAME: contract.checkName, CHECK_CLAUSE: contract.checkClause(), ENFORCED: "YES" }] : [])];
      if (this.mutateChecks) this.mutateChecks(rows); return [rows];
    }
    if (sql.includes("information_schema.TABLE_CONSTRAINTS")) return [Object.keys(CHECK_CONTRACT).filter(n => n.startsWith("chk_trial_invitation")).concat(this.applied ? [contract.checkName] : []).sort().map(CONSTRAINT_NAME => ({ CONSTRAINT_NAME, ENFORCED: "YES" }))];
    if (sql.includes("information_schema.TRIGGERS")) return [this.triggers()];
    if (sql.includes("information_schema.KEY_COLUMN_USAGE")) return [[]];
    if (sql.includes("invalid_count")) return [[{ invalid_count: "0" }]];
    if (sql.includes("row_count")) return [[{ row_count: this.countOverride || String(this.data.length) }]];
    if (sql.includes("cursor_id")) {
      const names = [...this.columns().filter(c => c.TABLE_NAME === "trial_invitations" && !Object.hasOwn(contract.extraColumns, c.COLUMN_NAME)).map(c => c.COLUMN_NAME), ...Object.keys(contract.extraColumns)];
      return [this.data.filter(r => !args.length || BigInt(r.id) > BigInt(args[0])).slice(0, 500).map(r => ({ cursor_id: r.id, ...Object.fromEntries(names.map((n, i) => [`c${i}`, n === "internal_key_hash" || n === "internal_reason" ? null : Buffer.from(n === "provenance" ? "PUBLIC_TRIAL_REQUEST" : i === 0 ? r.id : r.value).toString("hex").toUpperCase()])) }))];
    }
    if (sql.startsWith("LOCK TABLES")) { this.locked = true; return [{}]; }
    if (sql === "UNLOCK TABLES") { this.locked = false; return [{}]; }
    if (sql.startsWith("ALTER TABLE")) { this.applied = true; return [{ warningStatus: 0 }]; }
    if (sql.startsWith("CREATE TRIGGER")) { this.triggerNames.push(/^CREATE TRIGGER (\w+)/.exec(sql)[1]); return [{ warningStatus: this.warningRows?.length || 0 }]; }
    throw Error("UNHANDLED_FIXTURE_QUERY");
  }
  query(sql, args) { return this.dispatch(sql, args); }
}
class Core {
  constructor(fixture) { this.fixture = fixture; this.threadId = 7; this.stream = { destroyed: false }; this.config = { host: "127.0.0.1", port: 3407 }; }
  query(sql, args, callback) { this.fixture.dispatch(sql, args).then(([rows]) => callback(null, rows, []), callback); }
  destroy() { this.stream.destroyed = true; this.fixture.destroyed = true; this.fixture.locked = false; }
}
function installPhysicalMock() {
  require.cache[require.resolve("mysql2/promise")] = { exports: { PromiseConnection: Fixture, PromisePoolConnection: class {} } };
  require.cache[require.resolve("mysql2")] = { exports: { Connection: Core } };
}
const identity = { host: "127.0.0.1", port: 3407, database: "revex_tr1b_test_pilot", hostname: "synthetic", version: "9.7.2", serverPort: 3306 };
module.exports = { Fixture, installPhysicalMock, identity };
