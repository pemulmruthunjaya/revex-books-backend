const db = require("../db/connection");
const {
  assertBranchAccess,
  assertCompanyAccess,
  issueContextToken,
  listBranchesForUser,
  listCompaniesForUser,
} = require("../services/companyContextService");

const asJson = (value, fallback) => {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
};

const getUser = async (userId) => {
  const [rows] = await db.query(
    `SELECT id, role, access_role, permissions, must_change_password
       FROM users WHERE id = ? LIMIT 1`,
    [userId]
  );
  return rows[0];
};

const buildBusinessContextResponse = ({ authenticatedUser, companies, branches }) => ({
  companies,
  branches,
  current_company_id: authenticatedUser.company_id,
  current_branch_id: authenticatedUser.branch_id || null,
  consolidated: !authenticatedUser.branch_id,
  user: {
    id: authenticatedUser.user_id || authenticatedUser.id || null,
    name: authenticatedUser.name || null,
    email: authenticatedUser.email || null,
    role: authenticatedUser.role || null,
    access_role: authenticatedUser.access_role || null,
  },
});

exports.getBusinessProfile = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT bp.*, c.name AS company_name, c.email AS company_email,
              s.business_types, s.industry_type, s.registration_type,
              s.state, s.city, s.pincode, s.pan_number, s.gst_registered,
              s.e_invoicing_enabled, s.tds_enabled, s.tcs_enabled,
              s.signature, s.additional_details
         FROM companies c
         LEFT JOIN business_profiles bp ON bp.company_id = c.id
         LEFT JOIN company_business_settings s ON s.company_id = c.id
        WHERE c.id = ? LIMIT 1`,
      [req.user.company_id]
    );
    const profile = rows[0] || {};
    profile.business_types = asJson(profile.business_types, []);
    profile.additional_details = asJson(profile.additional_details, []);
    return res.json(profile);
  } catch (error) {
    console.error("Get business profile error:", error);
    return res.status(500).json({ message: "Failed to fetch business profile" });
  }
};

exports.saveBusinessProfile = async (req, res) => {
  const connection = await db.getConnection();
  try {
    if (req.user.role !== "owner") {
      return res.status(403).json({ message: "Only an owner can change business settings" });
    }

    const companyId = req.user.company_id;
    const body = req.body || {};
    const name = String(body.name || body.company_name || "").trim();
    if (!name) return res.status(400).json({ message: "Business name is required" });
    if (body.gst_registered && !String(body.gstin || "").trim()) {
      return res.status(400).json({ message: "GSTIN is required for a GST-registered business" });
    }

    await connection.beginTransaction();
    await connection.query("UPDATE companies SET name = ?, email = ? WHERE id = ?", [
      name, body.email || null, companyId,
    ]);

    const [existing] = await connection.query(
      "SELECT id FROM business_profiles WHERE company_id = ? LIMIT 1", [companyId]
    );
    const profileValues = [
      name, body.gstin || null, body.address || null, body.phone || null,
      body.email || null, body.logo || null,
    ];
    if (existing.length) {
      await connection.query(
        `UPDATE business_profiles
            SET name = ?, gstin = ?, address = ?, phone = ?, email = ?, logo = ?
          WHERE company_id = ?`,
        [...profileValues, companyId]
      );
    } else {
      await connection.query(
        `INSERT INTO business_profiles
          (company_id, name, gstin, address, phone, email, logo)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [companyId, ...profileValues]
      );
    }

    await connection.query(
      `INSERT INTO company_business_settings
        (company_id, business_types, industry_type, registration_type, state, city,
         pincode, pan_number, gst_registered, e_invoicing_enabled, tds_enabled,
         tcs_enabled, signature, additional_details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         business_types = VALUES(business_types), industry_type = VALUES(industry_type),
         registration_type = VALUES(registration_type), state = VALUES(state),
         city = VALUES(city), pincode = VALUES(pincode), pan_number = VALUES(pan_number),
         gst_registered = VALUES(gst_registered),
         e_invoicing_enabled = VALUES(e_invoicing_enabled),
         tds_enabled = VALUES(tds_enabled), tcs_enabled = VALUES(tcs_enabled),
         signature = VALUES(signature), additional_details = VALUES(additional_details)`,
      [
        companyId, JSON.stringify(body.business_types || []), body.industry_type || null,
        body.registration_type || null, body.state || null, body.city || null,
        body.pincode || null, body.pan_number || null, body.gst_registered ? 1 : 0,
        body.e_invoicing_enabled ? 1 : 0, body.tds_enabled ? 1 : 0,
        body.tcs_enabled ? 1 : 0, body.signature || null,
        JSON.stringify(body.additional_details || []),
      ]
    );
    await connection.commit();
    return res.json({ message: "Business settings saved successfully" });
  } catch (error) {
    await connection.rollback();
    console.error("Save business profile error:", error);
    return res.status(500).json({ message: "Failed to save business settings" });
  } finally {
    connection.release();
  }
};

exports.getContext = async (req, res) => {
  try {
    const companies = await listCompaniesForUser(req.user.user_id);
    const branches = await listBranchesForUser({
      userId: req.user.user_id,
      companyId: req.user.company_id,
      role: req.user.role,
    });
    return res.json(buildBusinessContextResponse({
      authenticatedUser: req.user,
      companies,
      branches,
    }));
  } catch (error) {
    console.error("Business context error:", error);
    return res.status(500).json({ message: "Failed to load business context" });
  }
};

exports.buildBusinessContextResponse = buildBusinessContextResponse;

exports.createBusiness = async (req, res) => {
  const connection = await db.getConnection();
  try {
    if (req.user.role !== "owner") {
      return res.status(403).json({ message: "Only an owner can create a business" });
    }
    const name = String(req.body.name || "").trim();
    if (!name) return res.status(400).json({ message: "Business name is required" });

    await connection.beginTransaction();
    const [companyResult] = await connection.query(
      "INSERT INTO companies (name, email) VALUES (?, ?)",
      [name, req.body.email || req.user.email || null]
    );
    const companyId = companyResult.insertId;
    await connection.query(
      `INSERT INTO user_company_memberships
        (user_id, company_id, membership_role, is_default, is_active)
       VALUES (?, ?, 'owner', 0, 1)`,
      [req.user.user_id, companyId]
    );
    const [branchResult] = await connection.query(
      `INSERT INTO branches
        (company_id, name, code, branch_type, is_head_office, is_active, created_by)
       VALUES (?, 'Head Office', 'HO', 'HEAD_OFFICE', 1, 1, ?)`,
      [companyId, req.user.user_id]
    );
    await connection.query(
      `INSERT INTO user_branch_memberships
        (user_id, company_id, branch_id, is_default, is_active)
       VALUES (?, ?, ?, 1, 1)`,
      [req.user.user_id, companyId, branchResult.insertId]
    );
    await connection.query(
      `INSERT INTO business_profiles (company_id, name, email)
       VALUES (?, ?, ?)`,
      [companyId, name, req.body.email || req.user.email || null]
    );
    await connection.query(
      "INSERT INTO company_business_settings (company_id) VALUES (?)", [companyId]
    );
    await connection.commit();

    const user = await getUser(req.user.user_id);
    const token = issueContextToken(user, companyId, branchResult.insertId);
    return res.status(201).json({
      message: "Business created successfully", company_id: companyId,
      branch_id: branchResult.insertId, token,
    });
  } catch (error) {
    await connection.rollback();
    console.error("Create business error:", error);
    return res.status(500).json({ message: "Failed to create business" });
  } finally {
    connection.release();
  }
};

exports.switchCompany = async (req, res) => {
  try {
    const companyId = Number(req.body.company_id);
    await assertCompanyAccess(req.user.user_id, companyId);
    const user = await getUser(req.user.user_id);
    const branches = await listBranchesForUser({
      userId: user.id, companyId, role: user.role,
    });
    const defaultBranch = branches.find((branch) => Number(branch.is_default) === 1)
      || branches.find((branch) => Number(branch.is_head_office) === 1)
      || branches[0];
    const token = issueContextToken(user, companyId, defaultBranch?.id || null);
    return res.json({ token, company_id: companyId, branch_id: defaultBranch?.id || null });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || "Switch failed" });
  }
};

exports.switchBranch = async (req, res) => {
  try {
    const branchId = req.body.branch_id ? Number(req.body.branch_id) : null;
    if (!branchId && req.user.role !== "owner") {
      return res.status(403).json({ message: "Staff must select an assigned branch" });
    }
    if (branchId) {
      await assertBranchAccess({
        userId: req.user.user_id, companyId: req.user.company_id,
        branchId, role: req.user.role,
      });
    }
    const user = await getUser(req.user.user_id);
    const token = issueContextToken(user, req.user.company_id, branchId);
    return res.json({ token, company_id: req.user.company_id, branch_id: branchId });
  } catch (error) {
    return res.status(error.status || 500).json({ message: error.message || "Switch failed" });
  }
};

exports.createBranch = async (req, res) => {
  try {
    if (req.user.role !== "owner") {
      return res.status(403).json({ message: "Only an owner can create branches" });
    }
    const name = String(req.body.name || "").trim();
    const code = String(req.body.code || "").trim().toUpperCase();
    if (!name || !code) return res.status(400).json({ message: "Branch name and code are required" });
    const [result] = await db.query(
      `INSERT INTO branches
        (company_id, name, code, branch_type, phone, email, address, city, state,
         pincode, gstin, is_head_office, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?)`,
      [req.user.company_id, name, code, req.body.branch_type || "BRANCH",
       req.body.phone || null, req.body.email || null, req.body.address || null,
       req.body.city || null, req.body.state || null, req.body.pincode || null,
       req.body.gstin || null, req.user.user_id]
    );
    return res.status(201).json({ message: "Branch created", id: result.insertId });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "This branch code already exists" });
    }
    console.error("Create branch error:", error);
    return res.status(500).json({ message: "Failed to create branch" });
  }
};

exports.updateBranch = async (req, res) => {
  try {
    if (req.user.role !== "owner") return res.status(403).json({ message: "Owner access required" });
    const branchId = Number(req.params.id);
    const [result] = await db.query(
      `UPDATE branches SET name = ?, code = ?, branch_type = ?, phone = ?, email = ?,
              address = ?, city = ?, state = ?, pincode = ?, gstin = ?, is_active = ?
        WHERE id = ? AND company_id = ? AND is_head_office = 0`,
      [req.body.name, String(req.body.code || "").toUpperCase(), req.body.branch_type || "BRANCH",
       req.body.phone || null, req.body.email || null, req.body.address || null,
       req.body.city || null, req.body.state || null, req.body.pincode || null,
       req.body.gstin || null, req.body.is_active === false ? 0 : 1,
       branchId, req.user.company_id]
    );
    if (!result.affectedRows) return res.status(404).json({ message: "Branch not found or is the protected Head Office" });
    return res.json({ message: "Branch updated" });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update branch" });
  }
};
