const db = require("../db/connection");
const { verifyAuthToken } = require("../utils/jwtToken");
const {
  ensureUserAccessColumns,
  parsePermissions,
} = require("../services/userAccessService");
const {
  assertBranchAccess,
  assertCompanyAccess,
} = require("../services/companyContextService");

module.exports = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ message: "No token provided" });
    }

    const [scheme, token] = authHeader.split(" ");

    if (scheme !== "Bearer" || !token) {
      return res.status(401).json({ message: "Invalid token format" });
    }

    const decoded = verifyAuthToken(token);

    await ensureUserAccessColumns();

    const [users] = await db.query(
      `SELECT id, name, email, role, access_role, permissions, is_active, company_id,
              must_change_password, password_changed_at, activation_required
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [decoded.user_id]
    );

    if (!users.length) {
      return res.status(401).json({ message: "User no longer exists" });
    }

    const user = users[0];

    await assertCompanyAccess(user.id, decoded.company_id);
    if (decoded.branch_id) {
      await assertBranchAccess({
        userId: user.id,
        companyId: decoded.company_id,
        branchId: decoded.branch_id,
        role: user.role,
      });
    }

    if (Number(user.is_active) !== 1 || Number(user.activation_required) === 1) {
      return res.status(403).json({ message: "This account is unavailable", code: "ACCOUNT_UNAVAILABLE" });
    }

    req.user = {
      ...decoded,
      name: user.name,
      email: user.email,
      role: user.role,
      company_id: Number(decoded.company_id),
      branch_id: decoded.branch_id ? Number(decoded.branch_id) : null,
      access_role: user.role === "owner" ? "owner" : user.access_role || "sales",
      permissions: parsePermissions(
        user.permissions,
        user.role === "owner" ? "owner" : user.access_role || "sales"
      ),
      is_active: Number(user.is_active),
      must_change_password: Number(user.must_change_password) === 1,
      password_changed_at: user.password_changed_at,
    };

    if (
      req.user.must_change_password &&
      !req.originalUrl.endsWith("/api/auth/change-password")
    ) {
      return res.status(403).json({
        message: "You must change your temporary password before continuing",
        code: "PASSWORD_CHANGE_REQUIRED",
      });
    }

    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Session expired. Please login again." });
    }

    if (error.name !== "JsonWebTokenError") console.error("AUTH_MIDDLEWARE_FAILURE", { request_id: req.requestId || null });

    return res.status(401).json({ message: "Unauthorized" });
  }
};
