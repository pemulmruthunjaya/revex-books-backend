const TRUE_VALUE = "true";

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
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "SMTP_FROM",
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
  for (const variable of requiredEmailVariables) {
    if (!String(environment[variable] || "").trim()) {
      issues.push({ code: "EMAIL_CONFIGURATION_REQUIRED", variable });
    }
  }
  if (environment.APP_URL && !validatePublicAppUrl(environment.APP_URL)) {
    issues.push({ code: "PUBLIC_APP_URL_REQUIRED", variable: "APP_URL" });
  }
  const port = Number(environment.SMTP_PORT);
  if (environment.SMTP_PORT && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    issues.push({ code: "SMTP_PORT_INVALID", variable: "SMTP_PORT" });
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
  assertLaunchConfiguration,
  getLaunchConfigurationIssues,
  isLaunchMode,
  requiredEmailVariables,
  validatePublicAppUrl,
};
