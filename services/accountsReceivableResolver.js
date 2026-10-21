"use strict";

// Caller owns the transaction. No account creation, code/name fallback or cache.
const fail = code => { throw Object.assign(new Error(code), { code, status: 409 }); };
const id = value => {
  const text = String(value ?? "");
  if (!/^[1-9]\d*$/.test(text) || BigInt(text) > 18446744073709551615n) fail("AR_ROLE_SCOPE_INVALID");
  return text;
};
async function resolveAccountsReceivable(connection, company, financialYear) {
  const companyId = id(company), fyId = id(financialYear);
  let rows;
  try {
    [rows] = await connection.query(`SELECT
      f.id fy_id,f.company_id fy_company_id,DATE_FORMAT(f.start_date,'%Y-%m-%d') fy_start,DATE_FORMAT(f.end_date,'%Y-%m-%d') fy_end,
      r.id assignment_id,r.company_id role_company_id,r.role,r.effective_to_financial_year_id,
      sf.company_id from_company_id,DATE_FORMAT(sf.start_date,'%Y-%m-%d') from_date,
      tf.company_id to_company_id,DATE_FORMAT(tf.end_date,'%Y-%m-%d') to_date,
      a.id,a.company_id account_company_id,a.account_code,a.account_name,a.account_type,a.status,
      EXISTS(SELECT 1 FROM iv_operations o WHERE o.company_id=f.company_id AND o.action='GL_ROLE'
        AND JSON_UNQUOTE(JSON_EXTRACT(o.result,'$.role'))='INVENTORY'
        AND JSON_UNQUOTE(JSON_EXTRACT(o.result,'$.account_id'))=CAST(a.id AS CHAR)) inventory_role
      FROM financial_years f
      LEFT JOIN system_account_role_assignments r ON r.company_id=f.company_id AND r.role='ACCOUNTS_RECEIVABLE'
      LEFT JOIN financial_years sf ON sf.id=r.effective_from_financial_year_id
      LEFT JOIN financial_years tf ON tf.id=r.effective_to_financial_year_id
      LEFT JOIN accounts a ON a.id=r.account_id
      WHERE f.company_id=? AND f.id=? ORDER BY r.id FOR SHARE`, [companyId, fyId]);
  } catch { fail("AR_ROLE_SCHEMA_NOT_READY"); }
  const date = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!Array.isArray(rows) || !rows.length) fail("AR_ROLE_SCOPE_INVALID");
  const effective = [];
  for (const row of rows) {
    if (String(row.fy_id) !== fyId || String(row.fy_company_id) !== companyId || !date(row.fy_start) || !date(row.fy_end) || row.fy_start > row.fy_end) fail("AR_ROLE_SCOPE_INVALID");
    if (row.assignment_id === null) continue;
    if (String(row.role_company_id) !== companyId || row.role !== "ACCOUNTS_RECEIVABLE" || String(row.from_company_id) !== companyId || !date(row.from_date) ||
        (row.effective_to_financial_year_id !== null && (String(row.to_company_id) !== companyId || !date(row.to_date) || row.to_date < row.from_date))) fail("AR_ROLE_MAPPING_INVALID");
    const overlaps = row.from_date <= row.fy_end && (row.effective_to_financial_year_id === null || row.to_date >= row.fy_start);
    if (overlaps && (row.from_date > row.fy_start || (row.effective_to_financial_year_id !== null && row.to_date < row.fy_end))) fail("AR_ROLE_MAPPING_INVALID");
    if (overlaps) effective.push(row);
  }
  if (effective.length !== 1) fail(effective.length ? "AR_ROLE_MAPPING_AMBIGUOUS" : "AR_ROLE_MAPPING_REQUIRED");
  const account = effective[0];
  if (!account.id || String(account.account_company_id) !== companyId || String(account.status) !== "1" || account.account_type !== "ASSET" || String(account.inventory_role) !== "0") fail("AR_ROLE_ACCOUNT_INCOMPATIBLE");
  return { id: account.id, account_code: account.account_code, account_name: account.account_name, account_type: account.account_type };
}
module.exports = { resolveAccountsReceivable };
