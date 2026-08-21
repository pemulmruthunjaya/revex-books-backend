const bcrypt = require("bcryptjs");
const { signAuthToken } = require("../utils/jwtToken");

const defaultExecutor = () => require("../db/connection");

class PlatformAdminError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "PlatformAdminError";
    this.code = code;
    this.status = status;
  }
}

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

const createPlatformAdmin = async ({ name, email, password }, options = {}) => {
  const executor = options.executor || defaultExecutor();
  const normalizedName = String(name || "").trim();
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedName || !normalizedEmail || !normalizedEmail.includes("@")) {
    throw new PlatformAdminError("INVALID_PLATFORM_ADMIN", "A valid name and email are required");
  }
  if (String(password || "").length < 8) {
    throw new PlatformAdminError("INVALID_PLATFORM_ADMIN", "Password must be at least 8 characters");
  }

  const [existing] = await executor.query(
    "SELECT id FROM platform_admins WHERE email = ? LIMIT 1",
    [normalizedEmail]
  );
  if (existing.length) {
    throw new PlatformAdminError("PLATFORM_ADMIN_EXISTS", "A platform administrator already exists with this email", 409);
  }
  const passwordHash = await bcrypt.hash(String(password), 10);
  try {
    const [result] = await executor.query(
      `INSERT INTO platform_admins (name, email, password_hash, status)
       VALUES (?, ?, ?, 'active')`,
      [normalizedName, normalizedEmail, passwordHash]
    );
    return { id: Number(result.insertId), name: normalizedName, email: normalizedEmail, status: "active" };
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      throw new PlatformAdminError("PLATFORM_ADMIN_EXISTS", "A platform administrator already exists with this email", 409);
    }
    throw error;
  }
};

const authenticatePlatformAdmin = async ({ email, password }, options = {}) => {
  const executor = options.executor || defaultExecutor();
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail || !password) {
    throw new PlatformAdminError("INVALID_CREDENTIALS", "Invalid credentials", 401);
  }
  const [rows] = await executor.query(
    `SELECT id, name, email, password_hash, status
       FROM platform_admins WHERE email = ? LIMIT 1`,
    [normalizedEmail]
  );
  if (!rows.length || !(await bcrypt.compare(String(password), rows[0].password_hash))) {
    throw new PlatformAdminError("INVALID_CREDENTIALS", "Invalid credentials", 401);
  }
  if (rows[0].status !== "active") {
    throw new PlatformAdminError("PLATFORM_ADMIN_DISABLED", "Platform administrator is disabled", 403);
  }
  await executor.query("UPDATE platform_admins SET last_login_at = UTC_TIMESTAMP() WHERE id = ?", [rows[0].id]);
  const admin = { id: Number(rows[0].id), name: rows[0].name, email: rows[0].email, status: rows[0].status };
  const token = signAuthToken({
    sub: String(admin.id),
    actor_type: "platform_admin",
    role: "platform_admin",
  });
  return { token, admin };
};

module.exports = {
  PlatformAdminError,
  authenticatePlatformAdmin,
  createPlatformAdmin,
};
