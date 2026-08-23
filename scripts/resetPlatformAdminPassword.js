const bcrypt = require("bcryptjs");
const {
  BootstrapPromptError,
  argument,
  createBootstrapDatabase,
  passwordFromStdin,
} = require("./createPlatformAdmin");

const APPROVED_EMAIL = "revex@test.com";

class PlatformPasswordResetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PlatformPasswordResetError";
    this.code = code;
  }
}

const resetPlatformAdminPassword = async ({ email, password, executor }) => {
  const connection = typeof executor.getConnection === "function" ? await executor.getConnection() : executor;
  let transactionStarted = false;
  try {
    if (typeof connection.beginTransaction === "function") {
      await connection.beginTransaction();
      transactionStarted = true;
    }
    const [rows] = await connection.query(
      `SELECT id, name, email, status, last_login_at, password_hash
       FROM platform_admins WHERE email = ? FOR UPDATE`,
      [email]
    );
    if (rows.length !== 1) {
      throw new PlatformPasswordResetError("ADMIN_NOT_FOUND", "Approved platform administrator was not found");
    }
    const before = rows[0];
    const newHash = await bcrypt.hash(password, 10);
    if (newHash === before.password_hash) {
      throw new PlatformPasswordResetError("HASH_UNCHANGED", "New password hash did not change");
    }
    const [result] = await connection.query(
      "UPDATE platform_admins SET password_hash = ? WHERE id = ? AND email = ?",
      [newHash, before.id, email]
    );
    if (result.affectedRows !== 1) {
      throw new PlatformPasswordResetError("UPDATE_FAILED", "Password update did not affect exactly one administrator");
    }
    const [afterRows] = await connection.query(
      `SELECT id, name, email, status, last_login_at, password_hash
       FROM platform_admins WHERE id = ?`,
      [before.id]
    );
    const after = afterRows[0];
    const protectedFields = ["id", "name", "email", "status", "last_login_at"];
    if (!after || protectedFields.some((field) => String(after[field] ?? "") !== String(before[field] ?? ""))) {
      throw new PlatformPasswordResetError("IDENTITY_CHANGED", "Protected administrator fields changed; transaction rolled back");
    }
    if (after.password_hash === before.password_hash || !(await bcrypt.compare(password, after.password_hash))) {
      throw new PlatformPasswordResetError("VERIFICATION_FAILED", "New password verification failed; transaction rolled back");
    }
    if (transactionStarted) await connection.commit();
    return { id: before.id, email: before.email };
  } catch (error) {
    if (transactionStarted) await connection.rollback();
    throw error;
  } finally {
    if (connection !== executor && typeof connection.release === "function") connection.release();
  }
};

const safeFailureMessage = (error) => {
  const safeCodes = new Set(["INVALID_ARGUMENTS", "PASSWORD_ARGUMENT_FORBIDDEN", "PASSWORD_STDIN_REQUIRES_PIPE", "PASSWORD_STDIN_FAILED", "PASSWORD_INPUT_TOO_LONG", "EMAIL_NOT_APPROVED", "EMPTY_PASSWORD", "PASSWORD_TOO_SHORT", "ADMIN_NOT_FOUND", "HASH_UNCHANGED", "UPDATE_FAILED", "IDENTITY_CHANGED", "VERIFICATION_FAILED"]);
  if (safeCodes.has(error?.code) || error instanceof BootstrapPromptError) return error.message;
  return "Unable to reset the platform administrator password. Verify the bootstrap database configuration.";
};

const run = async ({ argv = process.argv.slice(2), input = process.stdin, output = console, environment = process.env, createDatabase = createBootstrapDatabase, reset = resetPlatformAdminPassword } = {}) => {
  if (argv.some((value) => value === "--password" || value.startsWith("--password=") || value.startsWith("--password-stdin="))) {
    throw new PlatformPasswordResetError("PASSWORD_ARGUMENT_FORBIDDEN", "Passwords must be supplied only through --password-stdin");
  }
  const email = argument(argv, "email").toLowerCase();
  if (!email || !argv.includes("--password-stdin")) {
    throw new PlatformPasswordResetError("INVALID_ARGUMENTS", "Usage: node scripts/resetPlatformAdminPassword.js --email revex@test.com --password-stdin");
  }
  if (email !== APPROVED_EMAIL) throw new PlatformPasswordResetError("EMAIL_NOT_APPROVED", "Email is not approved for platform password reset");
  const password = await passwordFromStdin({ input });
  if (!password) throw new PlatformPasswordResetError("EMPTY_PASSWORD", "Password cannot be empty");
  if (password.length < 8) throw new PlatformPasswordResetError("PASSWORD_TOO_SHORT", "Password must be at least 8 characters");
  let db;
  try {
    db = createDatabase(environment);
    const admin = await reset({ email, password, executor: db });
    output.log(`Password reset successfully for platform administrator ${admin.email}`);
    return admin;
  } finally {
    if (db && typeof db.end === "function") await db.end();
  }
};

const main = async (options = {}) => {
  const output = options.output || console;
  try { await run({ ...options, output }); return 0; }
  catch (error) { output.error(safeFailureMessage(error)); return 1; }
};

if (require.main === module) main().then((code) => { process.exitCode = code; });

module.exports = { APPROVED_EMAIL, PlatformPasswordResetError, main, resetPlatformAdminPassword, run, safeFailureMessage };
