"use strict";
// Never return/log the duplicate value or raw driver message. Key names alone
// distinguish a tenant conflict from a legacy deployment prerequisite.
function accountConstraintError(error) {
  if (error?.code !== "ER_DUP_ENTRY") return error;
  const key = /for key ['`]([^'`]+)['`]\s*$/.exec(error.sqlMessage || error.message || "")?.[1]?.split(".").pop();
  const contracts = {
    uq_accounts_company_code: [409, "ACCOUNT_CODE_ALREADY_EXISTS", "Account code already exists in this company"],
    account_code: [503, "ACCOUNT_CODE_SCHEMA_NOT_READY", "Tenant-scoped account codes require a schema update"],
    uq_opening_event_sequence: [409, "OPENING_EVENT_CONFLICT", "Opening balance event conflicts with existing history"],
    uq_opening_event_journal: [409, "OPENING_EVENT_CONFLICT", "Opening balance event conflicts with existing history"],
  };
  const [status, code, message] = Object.hasOwn(contracts, key) ? contracts[key] : [500, "ACCOUNT_UNIQUE_CONSTRAINT_FAILED", "Account uniqueness validation failed"];
  return Object.assign(new Error(message), { status, code });
}
module.exports = { accountConstraintError };
