const {
  CANONICAL_APP_URL,
  isLaunchMode,
  validatePublicAppUrl,
} = require("./launchReadinessService");
const {
  createMicrosoftGraphProvider,
  graphConfigurationIssues,
} = require("./microsoftGraphEmailProvider");

let graphProvider;

const sendMail = async (message, options = {}) => {
  const environment = options.environment || process.env;
  if (graphConfigurationIssues(environment).length) {
    return { sent: false, reason: "not_configured" };
  }
  if (options.provider) return options.provider.sendMail(message);
  if (!graphProvider) {
    graphProvider = createMicrosoftGraphProvider({ environment });
  }
  return graphProvider.sendMail(message);
};

const appUrl = (environment = process.env) => {
  const configured = String(environment.APP_URL || "").trim().replace(/\/+$/, "");
  if (isLaunchMode(environment) && (
    !validatePublicAppUrl(configured) || configured !== CANONICAL_APP_URL
  )) {
    const error = new Error("Public application URL is not configured");
    error.code = "PUBLIC_APP_URL_REQUIRED";
    error.status = 503;
    throw error;
  }
  return configured || "http://localhost:5173";
};

const sendStaffInvitation = ({ name, email, temporaryPassword }) =>
  sendMail({
    to: email,
    subject: "Your RevEx Books staff account",
    text: `Hello ${name},\n\nYour RevEx Books account is ready.\nApp: ${appUrl()}\nEmail: ${email}\nTemporary password: ${temporaryPassword}\n\nYou must choose a new password when you first sign in.`,
    html: `<p>Hello ${name},</p><p>Your RevEx Books account is ready.</p><p><strong>App:</strong> <a href="${appUrl()}">${appUrl()}</a><br><strong>Email:</strong> ${email}<br><strong>Temporary password:</strong> ${temporaryPassword}</p><p>You must choose a new password when you first sign in.</p>`,
  });

const sendPasswordReset = ({ name, email, token }) => {
  const resetUrl = `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  return sendMail({
    to: email,
    subject: "Reset your RevEx Books password",
    text: `Hello ${name},\n\nReset your password using this link (valid for 30 minutes):\n${resetUrl}\n\nIf you did not request this, ignore this email.`,
    html: `<p>Hello ${name},</p><p><a href="${resetUrl}">Reset your password</a>. This link is valid for 30 minutes and can be used once.</p><p>If you did not request this, ignore this email.</p>`,
  });
};

const sendTrialActivation = ({ name, email, token, trialExpiresAt }, options = {}) => {
  const expiry = new Date(trialExpiresAt);
  if (Number.isNaN(expiry.getTime())) {
    const error = new Error("Trial invitation expiry is invalid");
    error.code = "TRIAL_INVITATION_EXPIRY_INVALID";
    throw error;
  }
  const activationUrl = `${appUrl(options.environment)}/activate-account#token=${token}`;
  return sendMail({
    to: email,
    replyTo: "support@revexbooks.com",
    subject: "Activate your RevEx Books Pro trial",
    text: `Hello ${name},\n\nYour 14-day RevEx Books Pro trial is ready.\nUsername: ${email}\nTrial expires: ${expiry.toISOString()}\nSet your password: ${activationUrl}\n\nThis link can be used once and expires within 24 hours.`,
  }, options);
};

module.exports = {
  appUrl,
  sendMail,
  sendStaffInvitation,
  sendPasswordReset,
  sendTrialActivation,
};
