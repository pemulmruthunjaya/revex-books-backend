"use strict";
// Explicit-only resumable adapter for the frozen SQL. No connection, CLI,
// environment, startup hook, repair, or automatic retry. DDL is not transactional.
const fs = require("node:fs"), path = require("node:path"), { createHash } = require("node:crypto");
const SQL_SHA256 = "3909ecd9b111b3687e146ef9b69527689c06dd69cd31a7aa8986d5ce4a12826f";
const fail = code => { throw Object.assign(new Error(code), { code }); };
const literals = (s, transform) => {
  const values = [];
  const masked = s.replace(/'(?:''|[^'\\])*'/g, value => `__literal_${values.push(value) - 1}__`);
  return transform(masked).replace(/__literal_(\d+)__/g, (_, i) => values[Number(i)]);
};
const simple = s => literals(s, value => value.replace(/`/g, "").replace(/\bint\(\d+\)/gi, "int").replace(/\bDEFAULT NULL\b/gi, "NULL").replace(/\s+/g, " ").replace(/\s*([(),])\s*/g, "$1").trim().toLowerCase());
// SHOW CREATE may explicitly print an inherited column collation. Compare
// effective semantics, never just remove charset/collation attributes.
const charsets = Object.freeze({utf8mb4_unicode_ci:"utf8mb4",utf8mb4_0900_ai_ci:"utf8mb4",utf8mb4_bin:"utf8mb4",ascii_bin:"ascii"});
function charsetPair(charset, collation) {
  if (!charset || charsets[collation] !== charset) fail("ANNUAL_MIGRATION_CHARSET_CONFLICT");
  return {charset, collation};
}
function columnNorm(clause, defaults) {
  if (!/^`?\w+`?\s+(?:enum|char|varchar)\s*\(/i.test(clause)) return norm(clause);
  let charset, collation;
  const stripped = literals(clause, value => value.replace(/\s+CHARACTER SET\s+(\w+)/gi, (_, v) => {
    if (charset) fail("ANNUAL_MIGRATION_CHARSET_CONFLICT"); charset=v.toLowerCase(); return "";
  }).replace(/\s+COLLATE\s+(\w+)/gi, (_, v) => {
    if (collation) fail("ANNUAL_MIGRATION_CHARSET_CONFLICT"); collation=v.toLowerCase(); return "";
  }));
  collation ||= defaults.collation;
  charset ||= charsets[collation];
  const effective=charsetPair(charset,collation);
  return `${norm(stripped)} charset=${effective.charset} collate=${effective.collation}`;
}
// MySQL adds redundant grouping to SHOW CREATE CHECK expressions. Compare an
// expression tree, not substring fragments or a parentheses-stripped formula.
function expression(sql) {
  const tokens = [];
  const lexer = /\s+|(?:_[a-zA-Z0-9]+)?'(?:''|[^'\\])*'|`[a-zA-Z_][\w]*`|<>|>=|<=|!=|[a-zA-Z_][\w]*|\d+|[()+,=<>-]/gy;
  let offset = 0;
  while (offset < sql.length) {
    lexer.lastIndex = offset;
    const match = lexer.exec(sql);
    if (!match) fail("ANNUAL_MIGRATION_CHECK_UNSUPPORTED");
    offset = lexer.lastIndex; let token = match[0];
    if (/^\s+$/.test(token)) continue;
    if (token.startsWith("_")) {
      // Only the verified MySQL utf8mb4 rendering of this frozen contract's
      // ASCII enum literals is equivalent. Never strip arbitrary introducers,
      // COLLATE clauses, escapes, or change a literal's case/content.
      const literal = /^_utf8mb4('(?:ANNUAL_CARRY_FORWARD|ORIGINAL|CUSTOMER|VENDOR|DEBIT|CREDIT)')$/i.exec(token);
      if (!literal) fail("ANNUAL_MIGRATION_CHECK_UNSUPPORTED");
      token = literal[1];
    }
    tokens.push(token.startsWith("`") ? token.slice(1, -1) : token);
  }
  let i=0; const peek=()=>tokens[i]?.toUpperCase();
  const precedence={OR:1,AND:2,IS:3,"=":3,"<>":3,"!=":3,">":3,"<":3,">=":3,"<=":3,"+":4,"-":4};
  function parse(min=0) {
    let left; const token=tokens[i++];
    if(token==="("){left=parse();if(tokens[i++]!==")")fail("ANNUAL_MIGRATION_CHECK_UNSUPPORTED");}
    else if(!token)fail("ANNUAL_MIGRATION_CHECK_UNSUPPORTED");
    else if(peek()==="("){i++;const arg=parse();if(tokens[i++]!==")")fail("ANNUAL_MIGRATION_CHECK_UNSUPPORTED");left=["call",token.toLowerCase(),arg];}
    else left=token.startsWith("'")?token:token.toLowerCase();
    while(precedence[peek()]>=min){const op=peek(),power=precedence[op];i++;if(op==="IS"){const not=peek()==="NOT";if(not)i++;if(peek()!=="NULL")fail("ANNUAL_MIGRATION_CHECK_UNSUPPORTED");i++;left=[not?"is not null":"is null",left];}else left=[op,left,parse(power+1)];}
    return left;
  }
  const tree=parse();if(i!==tokens.length)fail("ANNUAL_MIGRATION_CHECK_UNSUPPORTED");return JSON.stringify(tree);
}
const norm = s => { const check=/^(CONSTRAINT\s+`?\w+`?\s+CHECK)\s*([\s\S]+)$/i.exec(s.trim());return check?simple(check[1])+expression(check[2]):simple(s); };
// Frozen baseline definitions from the prerequisite FY-close foundation. All
// OLD/NEW references are discovered from the SHA-pinned trigger bodies below;
// a newly introduced reference without an exact contract fails closed.
const triggerColumns = Object.freeze({
  company_id: "INT NOT NULL", party_type: "ENUM('CUSTOMER','VENDOR') NOT NULL",
  customer_id: "INT NULL", vendor_id: "INT NULL",
  entry_kind: "ENUM('ORIGINAL','REVERSAL') NOT NULL DEFAULT 'ORIGINAL'",
  reversal_of_opening_item_id: "BIGINT UNSIGNED NULL", reference: "VARCHAR(120) NOT NULL",
  effective_date: "DATE NOT NULL", due_date: "DATE NULL", original_amount: "DECIMAL(15,2) NOT NULL",
  direction: "ENUM('DEBIT','CREDIT') NOT NULL", financial_year_id: "BIGINT UNSIGNED NOT NULL",
  migration_batch_reference: "VARCHAR(120) NULL", opening_journal_entry_id: "INT NULL",
  source_identity: "VARCHAR(160) NOT NULL", created_by: "INT NOT NULL",
});
function verifyTriggerColumns(objects, tables, defaults) {
  for (const trigger of objects.filter(o => o.kind === "trigger")) {
    const columns = new Set([...trigger.body.matchAll(/\b(?:OLD|NEW)\.(\w+)/gi)].map(m => m[1]));
    for (const column of columns) {
      const owned = objects.find(o => o.table === trigger.table && o.name === column && ["column", "modify"].includes(o.kind));
      const expected = owned?.clause || (trigger.table === "subledger_opening_items" && triggerColumns[column] && `${column} ${triggerColumns[column]}`);
      const actual = tables.get(trigger.table)?.find(c => identity(c) === column);
      if (!expected || !actual) fail("ANNUAL_MIGRATION_TRIGGER_PREREQUISITE_MISSING");
      if (columnNorm(actual, defaults.get(trigger.table)) !== columnNorm(expected, defaults.get(trigger.table))) fail("ANNUAL_MIGRATION_TRIGGER_PREREQUISITE_INCOMPATIBLE");
    }
  }
}
function split(s) {
  const parts = []; let depth = 0, quote = false, start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "'") { if (quote && s[i + 1] === "'") { i++; continue; } quote = !quote; }
    if (!quote) { if (s[i] === "(") depth++; if (s[i] === ")") depth--; if (!depth && s[i] === ",") { parts.push(s.slice(start, i).trim()); start = i + 1; } }
  }
  parts.push(s.slice(start).trim()); return parts;
}
function identity(clause) {
  const s = clause.replace(/`/g, "");
  const match = /^(UNIQUE KEY|KEY|CONSTRAINT)\s+(\w+)/i.exec(s);
  // MySQL may create an FK-support index with the same name as its constraint.
  // They occupy distinct namespaces; an index must never stand in for an FK.
  return match ? `${match[1].toUpperCase()==="CONSTRAINT"?"constraint":"index"}:${match[2]}` : /^PRIMARY KEY/i.test(s) ? "PRIMARY" : /^\w+/.exec(s)?.[0];
}
function tableParts(sql) {
  const begin = sql.indexOf("("); let depth = 0, quote = false;
  for (let i = begin; i < sql.length; i++) {
    if (sql[i] === "'") quote = !quote;
    if (!quote) { if (sql[i] === "(") depth++; if (sql[i] === ")" && --depth === 0) return split(sql.slice(begin + 1, i)); }
  }
  fail("ANNUAL_MIGRATION_FORMAT_INVALID");
}
function manifest() {
  const raw = fs.readFileSync(path.join(__dirname, "2026-10-04-annual-subledger-carry-forward.sql"), "utf8").replace(/\r\n/g, "\n");
  if (createHash("sha256").update(raw).digest("hex") !== SQL_SHA256) fail("ANNUAL_MIGRATION_HASH_MISMATCH");
  const sql = raw.replace(/^--.*$/gm, ""), objects = [];
  for (const m of sql.matchAll(/CALL annual_cf_add_column\('([^']+)','([^']+)'\)/g)) objects.push({ table: "subledger_opening_items", name: m[1], clause: `${m[1]} ${m[2]}`, kind: "column" });
  for (const m of sql.split("DELIMITER ;")[1].matchAll(/ALTER TABLE (\w+)\s+([\s\S]*?);/g)) for (const clause of split(m[2])) {
    const modify = clause.startsWith("MODIFY COLUMN ");
    const body = clause.replace(/^(ADD |MODIFY COLUMN )/, "");
    objects.push({ table: m[1], name: identity(body), clause: body, kind: modify ? "modify" : "clause" });
  }
  for (const m of sql.matchAll(/CREATE TABLE (\w+)\s*\([\s\S]*?\) ENGINE=InnoDB;/g)) objects.push({ table: m[1], kind: "table", sql: m[0], clauses: tableParts(m[0]) });
  for (const m of sql.matchAll(/CREATE TRIGGER (\w+) BEFORE (UPDATE|DELETE) ON (\w+) FOR EACH ROW\s*([\s\S]*?)\$\$/g)) objects.push({ name: m[1], event: m[2], table: m[3], kind: "trigger", body: m[4].trim(), sql: m[0].slice(0, -2) });
  if (objects.length < 25) fail("ANNUAL_MIGRATION_FORMAT_INVALID");
  return objects;
}
async function plan(cx) {
  const objects = manifest(), tables = new Map(), defaults = new Map(), actions = [];
  const [schemas] = await cx.query("SELECT DEFAULT_CHARACTER_SET_NAME charset,DEFAULT_COLLATION_NAME collation FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=DATABASE()");
  if (schemas.length !== 1) fail("ANNUAL_MIGRATION_CHARSET_CONFLICT");
  const databaseDefaults=charsetPair(schemas[0].charset,schemas[0].collation);
  const [inventory] = await cx.query("SELECT TABLE_NAME,ENGINE,TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()");
  const [triggers] = await cx.query("SELECT TRIGGER_NAME,EVENT_OBJECT_TABLE,EVENT_MANIPULATION,ACTION_TIMING,ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()");
  // Read all tables before planning any DDL, including FK prerequisites.
  const names = new Set(objects.map(o => o.table));
  for (const o of objects) for (const m of (o.sql || o.clause || "").matchAll(/REFERENCES (\w+)/g)) names.add(m[1]);
  for (const name of names) {
    const present = inventory.find(t => t.TABLE_NAME === name);
    if (!present) { if (!objects.some(o => o.kind === "table" && o.table === name)) fail("ANNUAL_MIGRATION_PREREQUISITE_MISSING"); tables.set(name, null); defaults.set(name,databaseDefaults); continue; }
    if (present.ENGINE !== "InnoDB" || present.TABLE_TYPE !== "BASE TABLE") fail("ANNUAL_MIGRATION_SCHEMA_CONFLICT");
    const [rows] = await cx.query(`SHOW CREATE TABLE \`${name}\``);
    const ddl=rows[0]["Create Table"];
    const rendered=/\)\s*ENGINE=InnoDB\b[^\n]*\bDEFAULT CHARSET=(\w+)\s+COLLATE=(\w+)/i.exec(ddl);
    if (!rendered) fail("ANNUAL_MIGRATION_CHARSET_CONFLICT");
    const tableDefaults=charsetPair(rendered[1],rendered[2]);
    // The prerequisite foundation explicitly specifies this table's collation.
    // New annual tables inherit the selected database defaults in the frozen SQL.
    const required=name==="subledger_opening_items"?charsetPair("utf8mb4","utf8mb4_unicode_ci"):
      objects.some(o=>o.kind==="table"&&o.table===name)?databaseDefaults:tableDefaults;
    if (tableDefaults.charset!==required.charset || tableDefaults.collation!==required.collation) fail("ANNUAL_MIGRATION_CHARSET_CONFLICT");
    defaults.set(name,tableDefaults);
    tables.set(name, tableParts(ddl));
  }
  for (const o of objects) {
    if (o.kind === "trigger") {
      const t = triggers.find(t => t.TRIGGER_NAME === o.name);
      if (!t) actions.push(o.sql);
      else if (t.EVENT_OBJECT_TABLE !== o.table || t.EVENT_MANIPULATION !== o.event || t.ACTION_TIMING !== "BEFORE" || norm(t.ACTION_STATEMENT) !== norm(o.body)) fail("ANNUAL_MIGRATION_SCHEMA_CONFLICT");
      continue;
    }
    const clauses = tables.get(o.table);
    if (o.kind === "table") {
      if (!clauses) { actions.push(o.sql); tables.set(o.table, [...o.clauses]); }
      else for (const clause of o.clauses) {
        const actual = clauses.find(c => identity(c) === identity(clause));
        if (!actual || columnNorm(actual,defaults.get(o.table)) !== columnNorm(clause,defaults.get(o.table))) fail("ANNUAL_MIGRATION_SCHEMA_CONFLICT");
      }
      if (clauses?.some(c => !/^KEY\s/i.test(c) && !o.clauses.some(e => identity(e) === identity(c)))) fail("ANNUAL_MIGRATION_SCHEMA_CONFLICT");
      continue;
    }
    const actual = clauses.find(c => identity(c) === o.name);
    if (actual && columnNorm(actual,defaults.get(o.table)) === columnNorm(o.clause,defaults.get(o.table))) continue;
    if (o.kind === "modify") {
      if (!actual || columnNorm(actual,defaults.get(o.table)) !== columnNorm("origin ENUM('ONBOARDING','HISTORICAL_MIGRATION') NOT NULL",defaults.get(o.table))) fail("ANNUAL_MIGRATION_SCHEMA_CONFLICT");
      actions.push(`ALTER TABLE ${o.table} MODIFY COLUMN ${o.clause}`);
      clauses.splice(clauses.indexOf(actual), 1, o.clause);
    } else {
      if (actual) fail("ANNUAL_MIGRATION_SCHEMA_CONFLICT");
      actions.push(`ALTER TABLE ${o.table} ADD ${o.clause}`); clauses.push(o.clause);
    }
  }
  verifyTriggerColumns(objects, tables, defaults);
  // Validate FK columns, exact types and unique target keys in the complete
  // prospective schema. Do not discover a missing prerequisite after DDL.
  for (const [name, clauses] of tables) for (const rawClause of clauses || []) {
    const clause=rawClause.replace(/`/g, "");
    if (!/CONSTRAINT fk_annual_/i.test(clause)) continue;
    const match = /FOREIGN KEY\s*\(([^)]+)\)\s*REFERENCES\s+(\w+)\s*\(([^)]+)\)/i.exec(clause);
    if (!match) fail("ANNUAL_MIGRATION_SCHEMA_CONFLICT");
    const source = split(match[1]), target = split(match[3]), refs = tables.get(match[2]);
    if (!refs || source.length !== target.length) fail("ANNUAL_MIGRATION_PREREQUISITE_MISSING");
    const type = (list, field) => { const c = list.find(c => identity(c) === field.replace(/`/g, "")); return c && norm(c).match(/^\w+ (\w+(?:\([^)]*\))?(?: unsigned)?)/)?.[1]; };
    if (source.some((field, i) => !type(clauses, field) || type(clauses, field) !== type(refs, target[i]))) fail("ANNUAL_MIGRATION_SCHEMA_CONFLICT");
    if (!refs.some(c => /^(PRIMARY KEY|UNIQUE KEY)/i.test(c) && norm(c.slice(c.indexOf("("))) === norm(`(${target.join(",")})`))) fail("ANNUAL_MIGRATION_PREREQUISITE_MISSING");
  }
  return actions;
}
async function migrate(cx, { confirmation } = {}) {
  if (confirmation !== "APPLY_ANNUAL_CARRY_FORWARD_V1") fail("ANNUAL_EXPLICIT_MIGRATION_REQUIRED");
  const actions = await plan(cx);
  for (const sql of actions) await cx.query(sql); // no retry on uncertainty
  if ((await plan(cx)).length) fail("ANNUAL_MIGRATION_INCOMPLETE");
  return { applied: actions.length, sha256: SQL_SHA256 };
}
module.exports = { SQL_SHA256, manifest, plan, migrate, split, tableParts, norm, triggerColumns };
