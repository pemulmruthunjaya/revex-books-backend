const db = require("../db/connection");

const STATUSES = Object.freeze({
  DRAFT: "DRAFT",
  SUBMITTED: "SUBMITTED",
  MANAGER_APPROVED: "MANAGER_APPROVED",
  ACCOUNTS_APPROVED: "ACCOUNTS_APPROVED",
  POSTED: "POSTED",
  REJECTED: "REJECTED",
});

const ACTIONS = Object.freeze([
  "create",
  "edit_own",
  "submit",
  "approve",
  "reject",
  "post",
  "view_all",
]);

let schemaReady = false;

const ensurePettyCashSchema = async () => {
  if (schemaReady) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS petty_cash_settings (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      company_id BIGINT UNSIGNED NOT NULL,
      fund_name VARCHAR(120) NOT NULL DEFAULT 'Main Petty Cash',
      opening_balance DECIMAL(15,2) NOT NULL DEFAULT 0,
      current_balance DECIMAL(15,2) NOT NULL DEFAULT 0,
      imprest_limit DECIMAL(15,2) NOT NULL DEFAULT 0,
      manager_approval_limit DECIMAL(15,2) NOT NULL DEFAULT 0,
      currency_code VARCHAR(10) NOT NULL DEFAULT 'INR',
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_petty_cash_settings_company (company_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS petty_cash_user_permissions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      company_id BIGINT UNSIGNED NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      can_create TINYINT(1) NOT NULL DEFAULT 0,
      can_edit_own TINYINT(1) NOT NULL DEFAULT 0,
      can_submit TINYINT(1) NOT NULL DEFAULT 0,
      can_approve TINYINT(1) NOT NULL DEFAULT 0,
      can_reject TINYINT(1) NOT NULL DEFAULT 0,
      can_post TINYINT(1) NOT NULL DEFAULT 0,
      can_view_all TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_petty_cash_permission_user (company_id, user_id),
      KEY idx_petty_cash_permission_company (company_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS petty_cash_transactions (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      company_id BIGINT UNSIGNED NOT NULL,
      transaction_no VARCHAR(40) NOT NULL,
      transaction_type ENUM('EXPENSE','REPLENISHMENT') NOT NULL,
      transaction_date DATE NOT NULL,
      category VARCHAR(100) NULL,
      payee VARCHAR(160) NULL,
      description VARCHAR(500) NOT NULL,
      amount DECIMAL(15,2) NOT NULL,
      payment_method VARCHAR(50) NULL,
      reference_no VARCHAR(100) NULL,
      status ENUM('DRAFT','SUBMITTED','MANAGER_APPROVED','ACCOUNTS_APPROVED','POSTED','REJECTED') NOT NULL DEFAULT 'DRAFT',
      created_by BIGINT UNSIGNED NOT NULL,
      submitted_by BIGINT UNSIGNED NULL,
      submitted_at DATETIME NULL,
      manager_approved_by BIGINT UNSIGNED NULL,
      manager_approved_at DATETIME NULL,
      accounts_approved_by BIGINT UNSIGNED NULL,
      accounts_approved_at DATETIME NULL,
      posted_by BIGINT UNSIGNED NULL,
      posted_at DATETIME NULL,
      rejected_by BIGINT UNSIGNED NULL,
      rejected_at DATETIME NULL,
      rejection_reason VARCHAR(500) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_petty_cash_transaction_no (company_id, transaction_no),
      KEY idx_petty_cash_company_status (company_id, status),
      KEY idx_petty_cash_company_date (company_id, transaction_date),
      KEY idx_petty_cash_creator (company_id, created_by)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS petty_cash_attachments (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      company_id BIGINT UNSIGNED NOT NULL,
      transaction_id BIGINT UNSIGNED NOT NULL,
      original_name VARCHAR(255) NOT NULL,
      mime_type VARCHAR(100) NOT NULL,
      size_bytes INT UNSIGNED NOT NULL,
      file_data LONGBLOB NOT NULL,
      uploaded_by BIGINT UNSIGNED NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_petty_cash_attachment_transaction (company_id, transaction_id),
      CONSTRAINT fk_petty_cash_attachment_transaction
        FOREIGN KEY (transaction_id) REFERENCES petty_cash_transactions(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS petty_cash_workflow_history (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      company_id BIGINT UNSIGNED NOT NULL,
      transaction_id BIGINT UNSIGNED NOT NULL,
      action VARCHAR(40) NOT NULL,
      from_status VARCHAR(40) NULL,
      to_status VARCHAR(40) NOT NULL,
      comments VARCHAR(500) NULL,
      action_by BIGINT UNSIGNED NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_petty_cash_history_transaction (company_id, transaction_id),
      CONSTRAINT fk_petty_cash_history_transaction
        FOREIGN KEY (transaction_id) REFERENCES petty_cash_transactions(id)
        ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  schemaReady = true;
};

const fullPermissions = () =>
  ACTIONS.reduce((result, action) => ({ ...result, [action]: true }), {});

const getUserPermissions = async (user) => {
  if (user.role === "owner") return fullPermissions();

  const [rows] = await db.query(
    `SELECT can_create, can_edit_own, can_submit, can_approve,
            can_reject, can_post, can_view_all
     FROM petty_cash_user_permissions
     WHERE company_id = ? AND user_id = ?
     LIMIT 1`,
    [user.company_id, user.user_id]
  );

  if (rows.length) {
    return ACTIONS.reduce((result, action) => {
      result[action] = Number(rows[0][`can_${action}`]) === 1;
      return result;
    }, {});
  }

  const accounting = user.permissions?.accounting || {};
  return {
    create: Boolean(accounting.create),
    edit_own: Boolean(accounting.edit),
    submit: Boolean(accounting.create || accounting.edit),
    approve: user.access_role === "accountant" && Boolean(accounting.edit),
    reject: user.access_role === "accountant" && Boolean(accounting.edit),
    post: user.access_role === "accountant" && Boolean(accounting.create),
    view_all: Boolean(accounting.view),
  };
};

const requirePermission = (action) => async (req, res, next) => {
  try {
    if (!["GET", "HEAD", "OPTIONS"].includes(String(req.method || "").toUpperCase())) {
      await ensurePettyCashSchema();
    }
    const permissions = await getUserPermissions(req.user);
    req.pettyCashPermissions = permissions;
    if (!permissions[action]) {
      return res.status(403).json({
        success: false,
        message: `Petty Cash permission required: ${action.replace("_", " ")}`,
      });
    }
    next();
  } catch (error) {
    next(error);
  }
};

const addWorkflowHistory = async (
  connection,
  { companyId, transactionId, action, fromStatus, toStatus, comments, userId }
) => {
  await connection.query(
    `INSERT INTO petty_cash_workflow_history
       (company_id, transaction_id, action, from_status, to_status, comments, action_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [companyId, transactionId, action, fromStatus, toStatus, comments || null, userId]
  );
};

const nextTransactionNumber = async (connection, companyId, type) => {
  const prefix = type === "REPLENISHMENT" ? "PCR" : "PCE";
  const year = new Date().getFullYear();
  const [rows] = await connection.query(
    `SELECT COUNT(*) AS count
     FROM petty_cash_transactions
     WHERE company_id = ? AND transaction_type = ? AND YEAR(created_at) = ?`,
    [companyId, type, year]
  );
  return `${prefix}-${year}-${String(Number(rows[0].count) + 1).padStart(5, "0")}`;
};

module.exports = {
  ACTIONS,
  STATUSES,
  addWorkflowHistory,
  ensurePettyCashSchema,
  getUserPermissions,
  nextTransactionNumber,
  requirePermission,
};
