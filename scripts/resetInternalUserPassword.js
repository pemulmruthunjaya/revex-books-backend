const bcrypt = require("bcryptjs");
const {
  BootstrapPromptError,
  argument,
  createBootstrapDatabase,
  passwordFromStdin,
} = require("./createPlatformAdmin");

const APPROVED_EMAILS = new Set([
  "qa.owner@revexbooks.com",
  "demo.owner@revexbooks.com",
  "demo.staff@revexbooks.com",
]);

class InternalPasswordResetError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "InternalPasswordResetError";
    this.code = code;
  }
}

const safeFailureMessage = (error) => {
  const safeCodes = new Set([
    "INVALID_ARGUMENTS",
    "PASSWORD_ARGUMENT_FORBIDDEN",
    "PASSWORD_STDIN_REQUIRES_PIPE",
    "PASSWORD_STDIN_FAILED",
    "PASSWORD_INPUT_TOO_LONG",
    "EMPTY_PASSWORD",
    "PASSWORD_TOO_SHORT",
    "EMAIL_NOT_APPROVED",
    "USER_NOT_FOUND",
    "USER_NOT_UNIQUE",
    "PASSWORD_UPDATE_FAILED",
    "IDENTITY_CHANGED",
    "PASSWORD_VERIFICATION_FAILED",
  ]);
  if (safeCodes.has(error?.code)) return error.message;
  if (error instanceof BootstrapPromptError) return error.message;
  return "Unable to reset the internal user password. Verify the bootstrap database configuration.";
};

const resetPassword = async ({ email, password, executor }) => {
  const connection = typeof executor.getConnection === "function"
    ? await executor.getConnection()
    : executor;
  let transactionStarted = false;
  try {
    if (typeof connection.beginTransaction === "function") {
      await connection.beginTransaction();
      transactionStarted = true;
    }
    const [rows] = await connection.query(
      `SELECT id, email, name, role, access_role, company_id, organization_id, password
       FROM users WHERE email = ? FOR UPDATE`,
      [email]
    );
    if (!rows.length) throw new InternalPasswordResetError("USER_NOT_FOUND", "Approved internal user was not found");
    if (rows.length !== 1) throw new InternalPasswordResetError("USER_NOT_UNIQUE", "Approved internal user is not unique");

    const before = rows[0];
    const passwordHash = await bcrypt.hash(password, 10);
    const [result] = await connection.query(
      "UPDATE users SET password = ? WHERE id = ? AND email = ?",
      [passwordHash, before.id, email]
    );
    if (result.affectedRows !== 1) {
      throw new InternalPasswordResetError("PASSWORD_UPDATE_FAILED", "Password update did not affect exactly one user");
    }

    const [afterRows] = await connection.query(
      `SELECT id, email, name, role, access_role, company_id, organization_id, password
       FROM users WHERE id = ?`,
      [before.id]
    );
    const after = afterRows[0];
    const identityFields = ["id", "email", "name", "role", "access_role", "company_id", "organization_id"];
    if (!after || identityFields.some((field) => after[field] !== before[field])) {
      throw new InternalPasswordResetError("IDENTITY_CHANGED", "Protected user identity fields changed; transaction rolled back");
    }
    if (after.password === before.password || !(await bcrypt.compare(password, after.password))) {
      throw new InternalPasswordResetError("PASSWORD_VERIFICATION_FAILED", "New password hash verification failed; transaction rolled back");
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

const run = async ({
  argv = process.argv.slice(2),
  input = process.stdin,
  output = console,
  environment = process.env,
  createDatabase = createBootstrapDatabase,
  reset = resetPassword,
} = {}) => {
  if (argv.some((value) => value === "--password" || value.startsWith("--password=") || value.startsWith("--password-stdin="))) {
    throw new InternalPasswordResetError("PASSWORD_ARGUMENT_FORBIDDEN", "Passwords must be supplied only through --password-stdin");
  }
  const email = argument(argv, "email").toLowerCase();
  if (!email || !argv.includes("--password-stdin")) {
    throw new InternalPasswordResetError("INVALID_ARGUMENTS", "Usage: node scripts/resetInternalUserPassword.js --email <approved-email> --password-stdin");
  }
  if (!APPROVED_EMAILS.has(email)) {
    throw new InternalPasswordResetError("EMAIL_NOT_APPROVED", "Email is not approved for internal password reset");
  }
  const password = await passwordFromStdin({ input });
  if (!password) throw new InternalPasswordResetError("EMPTY_PASSWORD", "Password cannot be empty");
  if (password.length < 8) throw new InternalPasswordResetError("PASSWORD_TOO_SHORT", "Password must be at least 8 characters");

  let db;
  try {
    db = createDatabase(environment);
    const result = await reset({ email, password, executor: db });
    output.log(`Password reset successfully for approved internal user ${result.email}`);
    return result;
  } finally {
    if (db && typeof db.end === "function") await db.end();
  }
};

const main = async (options = {}) => {
  const output = options.output || console;
  try {
    await run({ ...options, output });
    return 0;
  } catch (error) {
    output.error(safeFailureMessage(error));
    return 1;
  }
};

if (require.main === module) main().then((code) => { process.exitCode = code; });

module.exports = { APPROVED_EMAILS, InternalPasswordResetError, main, resetPassword, run, safeFailureMessage };
