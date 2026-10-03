const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const { createTrialCompany } = require("./subscriptionService");

const provisionCompanyOwner = async ({ connection, request, adminId, approvalKey, randomBytes = crypto.randomBytes, hash = bcrypt.hash, createTrial = createTrialCompany }) => {
  const [plans] = await connection.query("SELECT id,code,name,default_trial_days FROM plans WHERE code='PLAN_2' AND is_active=1");
  if (plans.length !== 1 || plans[0].name !== "Pro" || Number(plans[0].default_trial_days) !== 14) {
    const error = new Error("PLAN_2_CONTRACT_INVALID"); error.code = "PLAN_2_CONTRACT_INVALID"; throw error;
  }
  const [conflicts] = await connection.query("SELECT id FROM users WHERE email=? LIMIT 1 FOR UPDATE", [request.email]);
  if (conflicts.length) { const error = new Error("OWNER_EMAIL_CONFLICT"); error.code = "OWNER_EMAIL_CONFLICT"; throw error; }
  const [companyConflicts] = await connection.query("SELECT id FROM companies WHERE email=? LIMIT 1 FOR UPDATE", [request.email]);
  if (companyConflicts.length) { const error = new Error("OWNER_EMAIL_CONFLICT"); error.code = "OWNER_EMAIL_CONFLICT"; throw error; }
  const placeholder = randomBytes(48).toString("base64url");
  const passwordHash = await hash(placeholder, 10);
  const [company] = await connection.query("INSERT INTO companies (name,email,plan_id) VALUES (?,?,?)", [request.company_name, request.email, plans[0].id]);
  const companyId = company.insertId;
  const [owner] = await connection.query(
    "INSERT INTO users (name,email,password,company_id,role,access_role,is_active,must_change_password,activation_required) VALUES (?,?,?,?,'owner','owner',1,0,1)",
    [request.full_name, request.email, passwordHash, companyId]
  );
  const ownerId = owner.insertId;
  await connection.query("INSERT INTO user_company_memberships (user_id,company_id,membership_role,is_default,is_active) VALUES (?,?,'owner',1,1)", [ownerId, companyId]);
  const [branch] = await connection.query("INSERT INTO branches (company_id,name,code,branch_type,is_head_office,is_active,created_by) VALUES (?,'Head Office','HO','HEAD_OFFICE',1,1,?)", [companyId, ownerId]);
  await connection.query("INSERT INTO user_branch_memberships (user_id,company_id,branch_id,is_default,is_active) VALUES (?,?,?,1,1)", [ownerId, companyId, branch.insertId]);
  await connection.query("INSERT INTO business_profiles (company_id,name,email) VALUES (?,?,?)", [companyId, request.company_name, request.email]);
  await connection.query("INSERT INTO company_business_settings (company_id,industry_type,city) VALUES (?,?,?)", [companyId, request.business_type, request.city]);
  const { subscription } = await createTrial({ companyId, planId: plans[0].id, trialDays: 14, expectedPlanContract: { code: "PLAN_2", name: "Pro", defaultTrialDays: 14 }, actor: { type: "platform_admin", userId: null, reason: "Approved trial request", metadata: { platform_admin_id: adminId } }, idempotencyKey: approvalKey, connection });
  return { companyId, ownerId, branchId: branch.insertId, subscription };
};

module.exports = { provisionCompanyOwner };
