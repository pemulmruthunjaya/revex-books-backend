"use strict";
const roleRow = (company = 9, fy = 15, overrides = {}) => ({
  fy_id: fy, fy_company_id: company, fy_start: "2026-04-01", fy_end: "2027-03-31",
  assignment_id: 1, role_company_id: company, role: "ACCOUNTS_RECEIVABLE",
  effective_to_financial_year_id: null, from_company_id: company, from_date: "2026-04-01", to_company_id: null, to_date: null,
  id: 32, account_company_id: company, account_code: "1300", account_name: "Accounts Receivable", account_type: "ASSET", status: 1, inventory_role: 0,
  ...overrides,
});
const isRoleQuery = sql => sql.includes("r.id assignment_id");
module.exports = { roleRow, isRoleQuery };
