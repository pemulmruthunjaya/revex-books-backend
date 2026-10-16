"use strict";
const fs = require("node:fs"), path = require("node:path"), { createHash } = require("node:crypto");
const SQL_SHA256 = "01896d23f7595d6df567462c1f136173cadb823640b66df4c6f57c7c15d3c59a";
const fail = () => { throw Object.assign(new Error("INTERNAL_PILOT_SCHEMA_INCOMPATIBLE"), { code: "INTERNAL_PILOT_SCHEMA_INCOMPATIBLE" }); };
function statements() {
  const sql = fs.readFileSync(path.join(__dirname, "../db/migrations/2026-10-14-internal-pilot-provenance.sql"), "utf8").replace(/\r\n/g, "\n");
  if (createHash("sha256").update(sql).digest("hex") !== SQL_SHA256) fail();
  return sql.split("-- @statement").map(s => s.replace(/^--[^\n]*\n/gm, "").trim().replace(/;$/, ""));
}
// Only this contract's verified literal introducers are accepted. Grouping is
// compared as an expression tree: removing parentheses would weaken OR/AND.
function expression(sql) {
  const tokens = [], lexer = /\s+|(?:_[a-zA-Z0-9]+)?'(?:''|[^'\\])*'|`[a-zA-Z_][\w]*`|[a-zA-Z_][\w]*|\d+|[()=<>]/gy;
  let offset = 0;
  sql = sql.replace(/\\'/g, "'");
  while (offset < sql.length) {
    lexer.lastIndex = offset; const m = lexer.exec(sql); if (!m) fail(); offset = lexer.lastIndex;
    if (/^\s+$/.test(m[0])) continue;
    let token = m[0];
    if (token.startsWith("_")) { const match = /^_(?:ascii|utf8mb4)('(PUBLIC_TRIAL_REQUEST|INTERNAL_PILOT)')$/.exec(token); if (!match) fail(); token = match[1]; }
    tokens.push(token.startsWith("`") ? token.slice(1, -1) : token);
  }
  let i = 0; const peek = () => tokens[i]?.toUpperCase(), precedence = { OR: 1, AND: 2, IS: 3, "=": 3, ">": 3 };
  function parse(min = 0) {
    let left; const token = tokens[i++];
    if (token === "(") { left = parse(); if (tokens[i++] !== ")") fail(); }
    else if (!token) fail();
    else if (peek() === "(") { i++; const arg = parse(); if (tokens[i++] !== ")") fail(); left = ["call", token.toLowerCase(), arg]; }
    else left = token.startsWith("'") ? token : token.toLowerCase();
    while (precedence[peek()] >= min) {
      const op = peek(), power = precedence[op]; i++;
      if (op === "IS") { const not = peek() === "NOT"; if (not) i++; if (peek() !== "NULL") fail(); i++; left = [not ? "is not null" : "is null", left]; }
      else left = [op, left, parse(power + 1)];
    }
    return left;
  }
  const tree = parse(); if (i !== tokens.length) fail(); return JSON.stringify(tree);
}
const extraColumns = Object.freeze({
  provenance: { type: "varchar(32)", nullable: false, defaultValue: "public_trial_request", extra: "", charset: "ascii", collation: "ascii_bin" },
  internal_key_hash: { type: "binary(32)", nullable: true, defaultValue: null, extra: "", charset: null, collation: null },
  internal_reason: { type: "varchar(500)", nullable: true, defaultValue: null, extra: "", charset: "utf8mb4", collation: "utf8mb4_bin" },
});
const checkName = "chk_trial_invitation_provenance";
const checkClause = () => statements()[0].split(`ADD CONSTRAINT ${checkName} CHECK `)[1];
const norm = s => s.replace(/`/g, "").replace(/\s+/g, " ").replace(/\s*([(),;])\s*/g, "$1").trim();
function verifyTriggers(rows, allowPartial = false) {
  const definitions = statements().slice(1).map(sql => {
    const match = /^CREATE TRIGGER (\w+) (BEFORE) (UPDATE|DELETE|INSERT) ON (\w+) FOR EACH ROW\s+([\s\S]+)$/.exec(sql);
    if (!match) fail(); return { name: match[1], timing: match[2], event: match[3], table: match[4], body: match[5] };
  });
  if (rows.some(r => !definitions.some(d => d.name === r.TRIGGER_NAME)) || new Set(rows.map(r => r.TRIGGER_NAME)).size !== rows.length) fail();
  for (const d of definitions) {
    const r = rows.find(r => r.TRIGGER_NAME === d.name);
    if (!r) { if (allowPartial) continue; fail(); }
    if (r.ACTION_TIMING !== d.timing || r.EVENT_MANIPULATION !== d.event || r.EVENT_OBJECT_TABLE !== d.table || norm(r.ACTION_STATEMENT) !== norm(d.body)) fail();
  }
  return definitions.filter(d => !rows.some(r => r.TRIGGER_NAME === d.name)).map(d => d.name);
}
module.exports = { SQL_SHA256, statements, expression, extraColumns, checkName, checkClause, verifyTriggers };
