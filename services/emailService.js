const nodemailer = require("nodemailer");

const smtpConfigured = () =>
  Boolean(
    process.env.SMTP_HOST &&
      process.env.SMTP_PORT &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASSWORD &&
      process.env.SMTP_FROM
  );

const getTransport = () =>
  nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  });

const sendMail = async ({ to, subject, text, html }) => {
  if (!smtpConfigured()) {
    return { sent: false, reason: "not_configured" };
  }

  try {
    await getTransport().sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject,
      text,
      html,
    });
    return { sent: true };
  } catch (error) {
    console.error("Email delivery failed:", error.message);
    return { sent: false, reason: "delivery_failed" };
  }
};

const appUrl = () =>
  String(process.env.APP_URL || "http://localhost:5173").replace(/\/+$/, "");

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

module.exports = {
  smtpConfigured,
  sendStaffInvitation,
  sendPasswordReset,
};
