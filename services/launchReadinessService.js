const TRUE_VALUE = "true";
const CANONICAL_APP_URL = "https://revex-books-frontend.vercel.app";
const { graphConfigurationIssues } = require("./microsoftGraphEmailProvider");

class LaunchReadinessError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LaunchReadinessError";
    this.code = code;
    this.status = 503;
  }
}

const isLaunchMode = (environment = process.env) =>
  environment.NODE_ENV === "production" || environment.TRIAL_LAUNCH_MODE === TRUE_VALUE;

const requiredEmailVariables = Object.freeze([
  "EMAIL_PROVIDER",
  "MS_GRAPH_TENANT_ID",
  "MS_GRAPH_CLIENT_ID",
  "MS_GRAPH_CLIENT_SECRET",
  "MS_GRAPH_SENDER",
  "APP_URL",
]);

const validatePublicAppUrl = (value) => {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && !["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
};

const getLaunchConfigurationIssues = (environment = process.env) => {
  if (!isLaunchMode(environment)) return [];
  const issues = [];
  if (environment.SUBSCRIPTION_ENFORCEMENT_ENABLED !== TRUE_VALUE) {
    issues.push({ code: "SUBSCRIPTION_ENFORCEMENT_REQUIRED", variable: "SUBSCRIPTION_ENFORCEMENT_ENABLED" });
  }
  issues.push(...graphConfigurationIssues(environment));
  if (!String(environment.APP_URL || "").trim()) {
    issues.push({ code: "EMAIL_CONFIGURATION_REQUIRED", variable: "APP_URL" });
  } else if (!validatePublicAppUrl(environment.APP_URL) || String(environment.APP_URL).trim().replace(/\/+$/, "") !== CANONICAL_APP_URL) {
    issues.push({ code: "PUBLIC_APP_URL_REQUIRED", variable: "APP_URL" });
  }
  return issues;
};

const assertLaunchConfiguration = (environment = process.env) => {
  const issues = getLaunchConfigurationIssues(environment);
  if (issues.length) {
    throw new LaunchReadinessError(
      "TRIAL_LAUNCH_CONFIGURATION_INVALID",
      `Trial launch configuration is incomplete: ${issues.map((issue) => issue.variable).join(", ")}`
    );
  }
  return true;
};

module.exports = {
  LaunchReadinessError,
  CANONICAL_APP_URL,
  assertLaunchConfiguration,
  getLaunchConfigurationIssues,
  isLaunchMode,
  requiredEmailVariables,
  validatePublicAppUrl,
};
