const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { COLUMN_CONTRACT, INDEX_CONTRACT, FOREIGN_KEY_CONTRACT, CHECK_CONTRACT, assertTrialInvitationReadiness } = require('../services/trialInvitationReadinessService');
const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'db/migrations/2026-09-29-trial-request-invitation-activation.sql'), 'utf8');
const readiness = fs.readFileSync(path.join(root, 'services/trialInvitationReadinessService.js'), 'utf8');
const normalizeJs = vm.runInNewContext(readiness.match(/const normalizedClause = ([^\n]+);/)[1]);

// Interpret the actual SQL expression with only the functions it uses. This
// exercises the migration source without a database or a duplicate normalizer.
function sqlExpression(text, clause) {
  let position = 0;
  function parse() {
    while (/\s/.test(text[position] || '') && position < text.length) position++;
    if (text[position] === "'") {
      position++; let value = '';
      while (position < text.length) {
        const ch = text[position++];
        if (ch === "'") { if (text[position] === "'") { value += "'"; position++; } else return value; }
        else value += ch;
      }
      throw new Error('Unterminated SQL string');
    }
    const token = text.slice(position).match(/^(?:[A-Z_]+|\d+)/i);
    assert.ok(token, 'Unsupported SQL normalizer token'); position += token[0].length;
    if (/^\d+$/.test(token[0])) return Number(token[0]);
    if (token[0] === 'CHECK_CLAUSE') return typeof clause === 'string' ? clause : null;
    assert.equal(text[position++], '('); const args = [];
    for (;;) { args.push(parse()); if (text[position] === ',') { position++; continue; } assert.equal(text[position++], ')'); break; }
    if (args.some(value => value === null)) return null;
    switch (token[0]) {
      case 'CHAR': return String.fromCharCode(...args);
      case 'CONCAT': return args.join('');
      case 'REPLACE': return args[0].split(args[1]).join(args[2]);
      case 'LOWER': return args[0].toLowerCase();
      default: throw new Error('Unsupported SQL function');
    }
  }
  return parse();
}
const expressions = [...migration.matchAll(/LOWER\(REPLACE[^\n]+/g)].map(match => match[0]);
assert.equal(expressions.length, 8);
const ordinary = {
  chk_trial_requests_status: "(`status` in (_utf8mb4'pending',_utf8mb4'approved',_utf8mb4'suppressed'))",
  chk_trial_requests_consent: '(`privacy_communications_consent` = 1)',
  chk_trial_request_submission_status: "(`status` in (_utf8mb4'in_flight',_utf8mb4'accepted',_utf8mb4'suppressed'))",
  chk_trial_request_rate_count: '(`request_count` <= 5)',
  chk_trial_invitation_status: "(`status` in (_utf8mb4'pending_activation',_utf8mb4'activated',_utf8mb4'revoked'))",
  chk_trial_invitation_expiry: '((`token_expires_at` <= `trial_end_at`) and (`token_expires_at` > `token_generated_at`))',
  chk_trial_invitation_operation_type: "(`operation_type` in (_utf8mb4'approve',_utf8mb4'resend',_utf8mb4'activate'))",
  chk_trial_invitation_operation_status: "(`status` in (_utf8mb4'in_flight',_utf8mb4'accepted',_utf8mb4'failed',_utf8mb4'unknown',_utf8mb4'completed'))",
};
// The five string clauses reproduce the captured MySQL 9.4 delimiter format.
const escaped = Object.fromEntries(Object.entries(ordinary).map(([name, clause]) => [name, clause.replace(/'/g, "\\'")]));
function executor(clauses) {
  return { async query(sql) {
    assert.match(sql, /^SELECT /);
    if (sql.includes('information_schema.TABLES')) return [[{ TABLE_NAME: "companies", TABLE_TYPE: "BASE TABLE", COLUMN_NAME: "status", COLUMN_TYPE: "enum('active','inactive')", IS_NULLABLE: "YES", COLUMN_DEFAULT: "active", EXTRA: "" }]];
    if (sql.includes('information_schema.COLUMNS')) return [Object.entries(COLUMN_CONTRACT).flatMap(([TABLE_NAME, columns]) => Object.entries(columns).map(([COLUMN_NAME, c]) => ({ TABLE_NAME, COLUMN_NAME, COLUMN_TYPE: c.type, IS_NULLABLE: c.nullable ? 'YES' : 'NO', COLUMN_DEFAULT: c.defaultValue, EXTRA: c.extra, CHARACTER_SET_NAME: c.charset, COLLATION_NAME: c.collation })))];
    if (sql.includes('information_schema.STATISTICS')) return [INDEX_CONTRACT.flatMap(([TABLE_NAME, INDEX_NAME, nonUnique, names]) => names.map((COLUMN_NAME, i) => ({ TABLE_NAME, INDEX_NAME, NON_UNIQUE: Number(nonUnique), SEQ_IN_INDEX: i + 1, COLUMN_NAME, SUB_PART: null })))];
    if (sql.includes('REFERENTIAL_CONSTRAINTS')) return [FOREIGN_KEY_CONTRACT.map(([TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME]) => ({ TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME, UPDATE_RULE: 'RESTRICT', DELETE_RULE: 'RESTRICT' }))];
    if (sql.includes('CHECK_CONSTRAINTS')) return [Object.entries(clauses).map(([CONSTRAINT_NAME, CHECK_CLAUSE]) => ({ CONSTRAINT_NAME, CHECK_CLAUSE }))];
    throw new Error('Unexpected probe');
  } };
}
const options = clauses => ({ executor: executor(clauses), environment: { TRIAL_REQUEST_INTAKE_ENABLED: 'false' } });
const names = Object.keys(CHECK_CONTRACT);
for (const [i, name] of names.entries()) {
  for (const [format, clause] of [['ordinary', ordinary[name]], ['captured MySQL 9.4', escaped[name]], ['mixed formatting', ` ( ${ordinary[name].replace("'", "\\'").toUpperCase().replace(/_UTF8MB4/g, '_utf8mb4')} ) `]]) {
    test(`${name}: ${format} matches in SQL and readiness`, async () => {
      const expected = normalizeJs(CHECK_CONTRACT[name]);
      assert.equal(sqlExpression(expressions[i], clause), expected);
      assert.equal(normalizeJs(clause), expected);
      await assertTrialInvitationReadiness(options({ ...ordinary, [name]: clause }));
    });
  }
}
const negatives = [
  ['changed status', names[0], ordinary[names[0]].replace('pending', 'unexpected')],
  ['removed status', names[0], ordinary[names[0]].replace(",_utf8mb4'suppressed'", '')],
  ['added status', names[0], ordinary[names[0]].replace("'suppressed'", "'suppressed',_utf8mb4'unauthorized'")],
  ['NOT IN', names[0], ordinary[names[0]].replace(' in ', ' not in ')],
  ['inequality', names[1], ordinary[names[1]].replace(' = ', ' <> ')],
  ['different column', names[1], ordinary[names[1]].replace('privacy_communications_consent', 'other_column')],
  ['OR instead of AND', names[5], ordinary[names[5]].replace(' and ', ' or ')],
  ['malformed double backslash', names[0], ordinary[names[0]].replace("'pending'", "\\\\'pending'")],
  ['missing quote', names[0], ordinary[names[0]].replace("'pending'", "pending'")],
  ['null', names[0], null],
  ['number', names[0], 123],
  ['object', names[0], { toString: () => ordinary[names[0]] }],
  ['unrelated literal backslash', names[0], ordinary[names[0]].replace('pending', 'pen\\ding')],
];
for (const [label, name, clause] of negatives) test(`reject ${label} in SQL and readiness`, async () => {
  const i = names.indexOf(name), expected = normalizeJs(CHECK_CONTRACT[name]);
  assert.notEqual(sqlExpression(expressions[i], clause), expected);
  assert.notEqual(normalizeJs(clause), expected);
  await assert.rejects(assertTrialInvitationReadiness(options({ ...ordinary, [name]: clause })), { code: 'TR1B_SCHEMA_NOT_READY' });
});
test('all eight mixed ordinary/escaped clauses pass together', async () => {
  await assertTrialInvitationReadiness(options(Object.fromEntries(names.map((name, i) => [name, i % 2 ? ordinary[name] : escaped[name]]))));
});
