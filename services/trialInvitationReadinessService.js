const { SchemaReadinessError } = require("./schemaReadinessService");
const { configurationIssues } = require("../middleware/trialRequestGatewayAuth");

const c = (type, nullable, defaultValue = null, extra = "", charset = null, collation = null) =>
  Object.freeze({ type, nullable, defaultValue, extra, charset, collation });

const COLUMN_CONTRACT = Object.freeze({
  users: Object.freeze({ activation_required: c("tinyint(1)", false, "0"), activated_at: c("datetime(6)", true) }),
  trial_requests: Object.freeze({
    id: c("bigint unsigned", false, null, "auto_increment"), public_reference: c("varchar(32)", false, null, "", "ascii", "ascii_bin"),
    full_name: c("varchar(100)", false, null, "", "utf8mb4", "utf8mb4_unicode_ci"), company_name: c("varchar(150)", false, null, "", "utf8mb4", "utf8mb4_unicode_ci"),
    email: c("varchar(254)", false, null, "", "utf8mb4", "utf8mb4_unicode_ci"), mobile: c("varchar(16)", false, null, "", "utf8mb4", "utf8mb4_unicode_ci"),
    city: c("varchar(100)", false, null, "", "utf8mb4", "utf8mb4_unicode_ci"), country: c("char(2)", false, null, "", "utf8mb4", "utf8mb4_unicode_ci"),
    business_type: c("varchar(40)", false, null, "", "utf8mb4", "utf8mb4_unicode_ci"), note: c("varchar(500)", true, null, "", "utf8mb4", "utf8mb4_unicode_ci"),
    privacy_communications_consent: c("tinyint(1)", false), privacy_policy_version: c("varchar(40)", false, null, "", "utf8mb4", "utf8mb4_unicode_ci"),
    consented_at: c("datetime(6)", false), client_ip_hash: c("binary(32)", false), status: c("varchar(30)", false, "pending", "", "utf8mb4", "utf8mb4_unicode_ci"),
    version: c("int unsigned", false, "1"), approved_by_platform_admin_id: c("bigint unsigned", true), approved_at: c("datetime(6)", true),
    created_at: c("datetime(6)", false, "current_timestamp(6)", "default_generated"), updated_at: c("datetime(6)", false, "current_timestamp(6)", "default_generated on update current_timestamp(6)"),
  }),
  trial_request_submissions: Object.freeze({
    id: c("bigint unsigned", false, null, "auto_increment"), idempotency_key: c("char(36)", false, null, "", "ascii", "ascii_bin"),
    intent_hash: c("binary(32)", false), response_reference: c("varchar(32)", false, null, "", "ascii", "ascii_bin"), trial_request_id: c("bigint unsigned", true),
    client_ip_hash: c("binary(32)", false), result_code: c("varchar(50)", false, null, "", "utf8mb4", "utf8mb4_unicode_ci"),
    status: c("varchar(20)", false, null, "", "utf8mb4", "utf8mb4_unicode_ci"), created_at: c("datetime(6)", false, "current_timestamp(6)", "default_generated"),
    updated_at: c("datetime(6)", false, "current_timestamp(6)", "default_generated on update current_timestamp(6)"),
  }),
  trial_request_rate_buckets: Object.freeze({
    client_ip_hash: c("binary(32)", false), bucket_number: c("bigint unsigned", false), request_count: c("tinyint unsigned", false, "0"),
    created_at: c("datetime(6)", false, "current_timestamp(6)", "default_generated"), updated_at: c("datetime(6)", false, "current_timestamp(6)", "default_generated on update current_timestamp(6)"),
  }),
  trial_invitations: Object.freeze({
    id: c("bigint unsigned", false, null, "auto_increment"), trial_request_id: c("bigint unsigned", false), company_id: c("int", false), owner_user_id: c("int", false),
    approved_by_platform_admin_id: c("bigint unsigned", false), approval_idempotency_key: c("char(36)", false, null, "", "ascii", "ascii_bin"), approval_intent_hash: c("binary(32)", false),
    status: c("varchar(30)", false, null, "", "utf8mb4", "utf8mb4_unicode_ci"), token_hash: c("binary(32)", true), token_generation: c("int unsigned", false, "1"),
    token_generated_at: c("datetime(6)", false), token_expires_at: c("datetime(6)", false), trial_start_at: c("datetime(6)", false), trial_end_at: c("datetime(6)", false),
    approved_at: c("datetime(6)", false), activated_at: c("datetime(6)", true), revoked_at: c("datetime(6)", true), last_sent_at: c("datetime(6)", false), version: c("int unsigned", false, "1"),
    created_at: c("datetime(6)", false, "current_timestamp(6)", "default_generated"), updated_at: c("datetime(6)", false, "current_timestamp(6)", "default_generated on update current_timestamp(6)"),
  }),
  trial_invitation_operations: Object.freeze({
    id: c("bigint unsigned", false, null, "auto_increment"), trial_invitation_id: c("bigint unsigned", false), operation_type: c("varchar(20)", false, null, "", "utf8mb4", "utf8mb4_unicode_ci"),
    idempotency_key: c("char(36)", true, null, "", "ascii", "ascii_bin"), intent_hash: c("binary(32)", false), token_generation: c("int unsigned", false),
    actor_type: c("varchar(30)", false, null, "", "utf8mb4", "utf8mb4_unicode_ci"), platform_admin_id: c("bigint unsigned", true), status: c("varchar(20)", false, null, "", "utf8mb4", "utf8mb4_unicode_ci"),
    error_code: c("varchar(60)", true, null, "", "utf8mb4", "utf8mb4_unicode_ci"), created_at: c("datetime(6)", false, "current_timestamp(6)", "default_generated"), completed_at: c("datetime(6)", true),
    updated_at: c("datetime(6)", false, "current_timestamp(6)", "default_generated on update current_timestamp(6)"),
  }),
});

const INDEX_CONTRACT = Object.freeze([
  ["trial_request_submissions", "uq_trial_request_submission_response", false, ["response_reference"]],
  ["trial_requests", "PRIMARY", false, ["id"]], ["trial_requests", "uq_trial_requests_reference", false, ["public_reference"]], ["trial_requests", "uq_trial_requests_email", false, ["email"]], ["trial_requests", "uq_trial_requests_mobile", false, ["mobile"]], ["trial_requests", "idx_trial_requests_status_created", true, ["status", "created_at"]],
  ["trial_requests", "fk_trial_requests_approver", true, ["approved_by_platform_admin_id"]],
  ["trial_request_submissions", "PRIMARY", false, ["id"]], ["trial_request_submissions", "uq_trial_request_submission_key", false, ["idempotency_key"]], ["trial_request_submissions", "idx_trial_request_submission_ip_time", true, ["client_ip_hash", "created_at"]], ["trial_request_submissions", "idx_trial_request_submission_request", true, ["trial_request_id"]],
  ["trial_request_rate_buckets", "PRIMARY", false, ["client_ip_hash", "bucket_number"]],
  ["trial_invitations", "PRIMARY", false, ["id"]], ["trial_invitations", "uq_trial_invitation_request", false, ["trial_request_id"]], ["trial_invitations", "uq_trial_invitation_company", false, ["company_id"]], ["trial_invitations", "uq_trial_invitation_owner", false, ["owner_user_id"]], ["trial_invitations", "uq_trial_invitation_approval_key", false, ["approval_idempotency_key"]], ["trial_invitations", "uq_trial_invitation_token_hash", false, ["token_hash"]],
  ["trial_invitations", "fk_trial_invitation_approver", true, ["approved_by_platform_admin_id"]],
  ["trial_invitation_operations", "PRIMARY", false, ["id"]], ["trial_invitation_operations", "uq_trial_invitation_operation_key", false, ["idempotency_key"]], ["trial_invitation_operations", "idx_trial_invitation_operations_invitation", true, ["trial_invitation_id", "created_at"]],
  ["trial_invitation_operations", "fk_trial_invitation_operation_admin", true, ["platform_admin_id"]],
]);

const FOREIGN_KEY_CONTRACT = Object.freeze([
  ["trial_requests", "fk_trial_requests_approver", "approved_by_platform_admin_id", "platform_admins", "id"], ["trial_request_submissions", "fk_trial_request_submission_request", "trial_request_id", "trial_requests", "id"],
  ["trial_invitations", "fk_trial_invitation_request", "trial_request_id", "trial_requests", "id"], ["trial_invitations", "fk_trial_invitation_company", "company_id", "companies", "id"], ["trial_invitations", "fk_trial_invitation_owner", "owner_user_id", "users", "id"], ["trial_invitations", "fk_trial_invitation_approver", "approved_by_platform_admin_id", "platform_admins", "id"],
  ["trial_invitation_operations", "fk_trial_invitation_operation_invitation", "trial_invitation_id", "trial_invitations", "id"], ["trial_invitation_operations", "fk_trial_invitation_operation_admin", "platform_admin_id", "platform_admins", "id"],
]);

const CHECK_CONTRACT = Object.freeze({
  chk_trial_requests_status: "status in ('pending','approved','suppressed')", chk_trial_requests_consent: "privacy_communications_consent = 1",
  chk_trial_request_submission_status: "status in ('in_flight','accepted','suppressed')", chk_trial_request_rate_count: "request_count <= 5",
  chk_trial_invitation_status: "status in ('pending_activation','activated','revoked')", chk_trial_invitation_expiry: "token_expires_at <= trial_end_at and token_expires_at > token_generated_at",
  chk_trial_invitation_operation_type: "operation_type in ('approve','resend','activate')", chk_trial_invitation_operation_status: "status in ('in_flight','accepted','failed','unknown','completed')",
});

const fail = () => { throw new SchemaReadinessError("TR1B_SCHEMA_NOT_READY", "Required application schema is not ready"); };
const normalized = (value) => value === null || value === undefined ? null : String(value).toLowerCase();
const normalizedClause = (value) => typeof value === "string" ? value.replace(/\\'/g, "'").toLowerCase().replace(/_utf8mb4/g, "").replace(/[`()\s]/g, "") : null;

const assertTrialInvitationReadiness = async ({ executor, environment = process.env } = {}) => {
  // Existing company schema is a prerequisite, separate from the five new tables.
  const [companyStatus] = await executor.query("SELECT t.TABLE_NAME,t.TABLE_TYPE,c.COLUMN_NAME,c.COLUMN_TYPE,c.IS_NULLABLE,c.COLUMN_DEFAULT,c.EXTRA FROM information_schema.TABLES t JOIN information_schema.COLUMNS c ON c.TABLE_SCHEMA=t.TABLE_SCHEMA AND c.TABLE_NAME=t.TABLE_NAME WHERE t.TABLE_SCHEMA=DATABASE() AND t.TABLE_NAME='companies' AND c.COLUMN_NAME='status'");
  const company = companyStatus[0];
  if (companyStatus.length !== 1 || company.TABLE_NAME !== "companies" || company.TABLE_TYPE !== "BASE TABLE" || company.COLUMN_NAME !== "status"
    || company.COLUMN_TYPE !== "enum('active','inactive')" || company.IS_NULLABLE !== "YES" || company.COLUMN_DEFAULT !== "active" || company.EXTRA !== "") fail();

  const tables = Object.keys(COLUMN_CONTRACT);
  const [columns] = await executor.query(`SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,CHARACTER_SET_NAME,COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${tables.map(() => "?").join(",")})`, tables);
  const actualColumns = new Map(columns.map((row) => [`${row.TABLE_NAME}.${row.COLUMN_NAME}`, row]));
  for (const [table, definitions] of Object.entries(COLUMN_CONTRACT)) for (const [name, expected] of Object.entries(definitions)) {
    const row = actualColumns.get(`${table}.${name}`); if (!row) fail();
    if (normalized(row.COLUMN_TYPE) !== expected.type || (row.IS_NULLABLE === "YES") !== expected.nullable || normalized(row.COLUMN_DEFAULT) !== expected.defaultValue || normalized(row.EXTRA) !== expected.extra || normalized(row.CHARACTER_SET_NAME) !== expected.charset || normalized(row.COLLATION_NAME) !== expected.collation) fail();
  }
  for (const table of tables.filter((name) => name !== "users")) if (columns.filter((row) => row.TABLE_NAME === table).length !== Object.keys(COLUMN_CONTRACT[table]).length) fail();

  const scopedTables = tables.slice(1);
  const [indexes] = await executor.query(`SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,SUB_PART FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (${scopedTables.map(() => "?").join(",")}) ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX`, scopedTables);
  for (const [table, name, nonUnique, names] of INDEX_CONTRACT) {
    const rows = indexes.filter((row) => row.TABLE_NAME === table && row.INDEX_NAME === name);
    if (rows.length !== names.length || rows.some((row, index) => Number(row.NON_UNIQUE) !== Number(nonUnique) || Number(row.SEQ_IN_INDEX) !== index + 1 || row.COLUMN_NAME !== names[index] || row.SUB_PART !== null)) fail();
  }
  const scopedIndexKeys = new Set(INDEX_CONTRACT.map(([table, name]) => `${table}.${name}`));
  if (new Set(indexes.map((row) => `${row.TABLE_NAME}.${row.INDEX_NAME}`)).size !== scopedIndexKeys.size || indexes.some((row) => !scopedIndexKeys.has(`${row.TABLE_NAME}.${row.INDEX_NAME}`))) fail();

  const [foreignKeys] = await executor.query("SELECT k.TABLE_NAME,k.CONSTRAINT_NAME,k.COLUMN_NAME,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.UPDATE_RULE,r.DELETE_RULE FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND r.TABLE_NAME=k.TABLE_NAME WHERE k.CONSTRAINT_SCHEMA=DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL");
  const scopedForeignKeys = foreignKeys.filter((row) => scopedTables.includes(row.TABLE_NAME)); if (scopedForeignKeys.length !== FOREIGN_KEY_CONTRACT.length) fail();
  for (const expected of FOREIGN_KEY_CONTRACT) if (!scopedForeignKeys.some((row) => expected.every((value, index) => value === [row.TABLE_NAME, row.CONSTRAINT_NAME, row.COLUMN_NAME, row.REFERENCED_TABLE_NAME, row.REFERENCED_COLUMN_NAME][index]) && row.UPDATE_RULE === "RESTRICT" && row.DELETE_RULE === "RESTRICT")) fail();

  const [checks] = await executor.query("SELECT tc.TABLE_NAME,c.CONSTRAINT_NAME,c.CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS c JOIN information_schema.TABLE_CONSTRAINTS tc ON tc.CONSTRAINT_SCHEMA=c.CONSTRAINT_SCHEMA AND tc.CONSTRAINT_NAME=c.CONSTRAINT_NAME WHERE c.CONSTRAINT_SCHEMA=DATABASE() AND tc.TABLE_NAME IN ('trial_requests','trial_request_submissions','trial_request_rate_buckets','trial_invitations','trial_invitation_operations')");
  if (checks.length !== Object.keys(CHECK_CONTRACT).length) fail();
  for (const [name, clause] of Object.entries(CHECK_CONTRACT)) { const row = checks.find((item) => item.CONSTRAINT_NAME === name); if (!row || normalizedClause(row.CHECK_CLAUSE) !== normalizedClause(clause)) fail(); }
  if (configurationIssues(environment).length) throw new SchemaReadinessError("TR1B_GATEWAY_CONFIGURATION_INVALID", "Required trial request gateway configuration is not ready");
  return true;
};

module.exports = { CHECK_CONTRACT, COLUMN_CONTRACT, FOREIGN_KEY_CONTRACT, INDEX_CONTRACT, assertTrialInvitationReadiness };
