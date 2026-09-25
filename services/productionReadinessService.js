const fs = require("fs");
const path = require("path");

const db = require("../db/connection");
const { getJwtSecret } = require("../utils/jwtToken");
const { getLaunchConfigurationIssues } = require("./launchReadinessService");
const { assertTableColumns } = require("./schemaReadinessService");

const backendRoot = path.resolve(__dirname, "..");

const splitCsv = (value) =>
  String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const checkJwtSecret = () => {
  try {
    getJwtSecret();
    return {
      ok: true,
      required: true,
      message: "JWT secret is configured strongly",
    };
  } catch (error) {
    return {
      ok: false,
      required: true,
      message: error.message,
    };
  }
};

const checkCors = () => {
  const origins = splitCsv(process.env.CORS_ORIGINS || "http://localhost:5173");
  const hasWildcard = origins.includes("*");
  const hasLocalOnly =
    origins.length === 1 && origins[0].includes("localhost");

  return {
    ok: origins.length > 0 && !hasWildcard,
    required: true,
    warning: process.env.NODE_ENV === "production" && hasLocalOnly,
    message: hasWildcard
      ? "CORS must not allow every origin"
      : `${origins.length} allowed origin${origins.length === 1 ? "" : "s"} configured`,
  };
};

const checkDatabase = async () => {
  try {
    const [rows] = await db.query("SELECT 1 AS ok");
    return {
      ok: rows?.[0]?.ok === 1,
      required: true,
      message: "Database connection is working",
    };
  } catch (error) {
    return {
      ok: false,
      required: true,
      message: "Database connection failed",
      code: error.code || error.errno || null,
    };
  }
};

const checkTrialSchema = async () => {
  try {
    await Promise.all([
      assertTableColumns({ executor: db, table: "users", columns: ["access_role", "permissions", "is_active", "last_login_at", "must_change_password", "password_reset_token_hash", "password_reset_expires_at", "password_changed_at"], code: "USER_ACCESS_SCHEMA_NOT_READY" }),
      assertTableColumns({ executor: db, table: "products", columns: ["mrp", "sku", "barcode", "hsn", "category", "batch_no", "manufactured_date", "expiry_date", "unit", "gst", "purchase_price", "opening_stock", "reorder_level", "status"], code: "PRODUCT_SCHEMA_NOT_READY" }),
      assertTableColumns({ executor: db, table: "audit_logs", columns: ["id", "company_id", "user_id", "user_name", "user_role", "access_role", "module_key", "action", "method", "path", "resource_id", "status_code", "ip_address", "user_agent", "details", "created_at"], code: "AUDIT_LOG_SCHEMA_NOT_READY" }),
    ]);
    return { ok: true, required: true, message: "Trial runtime schema is ready" };
  } catch (error) {
    return { ok: false, required: true, message: "Trial runtime schema is not ready", code: error.code || "TRIAL_SCHEMA_NOT_READY" };
  }
};

const fileExists = (relativePath) =>
  fs.existsSync(path.join(backendRoot, relativePath));

const checkFile = (label, relativePath, required = true) => ({
  ok: fileExists(relativePath),
  required,
  message: `${label} ${fileExists(relativePath) ? "found" : "missing"}`,
});

const buildProductionReadinessReport = async () => {
  const nodeEnv = process.env.NODE_ENV || "development";
  const launchIssues = getLaunchConfigurationIssues({ ...process.env, NODE_ENV: "production" });
  const checks = {
    server: {
      ok: true,
      required: true,
      message: "API server process is running",
    },
    database: await checkDatabase(),
    trialSchema: await checkTrialSchema(),
    jwtSecret: checkJwtSecret(),
    trialLaunchConfiguration: {
      ok: launchIssues.length === 0,
      required: true,
      message: launchIssues.length
        ? `Missing or invalid launch variables: ${launchIssues.map((issue) => issue.variable).join(", ")}`
        : "Subscription enforcement, SMTP, and public application URL are configured",
    },
    cors: checkCors(),
    jsonBodyLimit: {
      ok: Boolean(process.env.JSON_BODY_LIMIT || "25mb"),
      required: false,
      message: `JSON body limit set to ${process.env.JSON_BODY_LIMIT || "25mb"}`,
    },
    backupRoutes: checkFile("Backup routes", "routes/backupRoutes.js"),
    backupController: checkFile("Backup controller", "controllers/backupController.js"),
    reportsRoutes: checkFile("Reports routes", "routes/reportRoutes.js"),
    reportsController: checkFile("Reports controller", "controllers/reportController.js"),
    payrollRoutes: checkFile("Payroll routes", "routes/payrollRoutes.js"),
    inventoryRoutes: checkFile("Product and inventory routes", "routes/productRoutes.js"),
    accountingReports: checkFile(
      "Accounting reports",
      "routes/trialBalanceRoutes.js"
    ),
    environment: {
      ok: nodeEnv === "production",
      required: false,
      warning: nodeEnv !== "production",
      message:
        nodeEnv === "production"
          ? "Production mode is enabled"
          : `Running in ${nodeEnv} mode`,
    },
  };

  const failedRequired = Object.values(checks).filter(
    (check) => check.required && !check.ok
  );
  const warnings = Object.entries(checks)
    .filter(([, check]) => check.warning)
    .map(([name, check]) => ({ name, message: check.message }));

  return {
    success: failedRequired.length === 0,
    status: failedRequired.length === 0 ? "ok" : "needs_attention",
    checkedAt: new Date().toISOString(),
    environment: nodeEnv,
    uptimeSeconds: Math.round(process.uptime()),
    checks,
    summary: {
      requiredChecks: Object.values(checks).filter((check) => check.required)
        .length,
      failedRequired: failedRequired.length,
      warnings: warnings.length,
    },
    warnings,
  };
};

module.exports = {
  buildProductionReadinessReport,
};
