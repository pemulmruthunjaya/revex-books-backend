const db = require("../db/connection");
const {
  rejectClientFinancialYear,
  requireFinancialYearForPosting,
} = require("../services/financialYearService");
const {
  ACTIONS,
  STATUSES,
  addWorkflowHistory,
  ensurePettyCashSchema,
  getUserPermissions,
  nextTransactionNumber,
} = require("../services/pettyCashService");

const clean = (value, max = 500) => {
  const text = String(value || "").trim();
  return text ? text.slice(0, max) : null;
};

const parseAmount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
};

const sendKnownError = (error, res, next) => {
  if (!error.status) return next(error);
  return res.status(error.status).json({
    success: false,
    code: error.code,
    message: error.message,
  });
};

const serializeTransaction = (row) => ({
  ...row,
  amount: Number(row.amount || 0),
  attachment_count: Number(row.attachment_count || 0),
});

const canViewTransaction = (row, req) =>
  req.user.role === "owner" ||
  req.pettyCashPermissions?.view_all ||
  Number(row.created_by) === Number(req.user.user_id);

const findTransaction = async (id, companyId, connection = db, { forUpdate = false } = {}) => {
  const [rows] = await connection.query(
    `SELECT t.*, u.name AS created_by_name,
            (SELECT COUNT(*) FROM petty_cash_attachments a
             WHERE a.transaction_id = t.id AND a.company_id = t.company_id) AS attachment_count
     FROM petty_cash_transactions t
     LEFT JOIN users u ON u.id = t.created_by AND u.company_id = t.company_id
     WHERE t.id = ? AND t.company_id = ?
     LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`,
    [id, companyId]
  );
  return rows[0] || null;
};

const saveAttachments = async (connection, transactionId, req) => {
  for (const file of req.files || []) {
    await connection.query(
      `INSERT INTO petty_cash_attachments
         (company_id, transaction_id, original_name, mime_type, size_bytes, file_data, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.company_id,
        transactionId,
        file.originalname.slice(0, 255),
        file.mimetype,
        file.size,
        file.buffer,
        req.user.user_id,
      ]
    );
  }
};

exports.getPermissions = async (req, res, next) => {
  try {
    await ensurePettyCashSchema();
    res.json({ success: true, permissions: await getUserPermissions(req.user) });
  } catch (error) {
    next(error);
  }
};

exports.getDashboard = async (req, res, next) => {
  try {
    await ensurePettyCashSchema();
    const permissions = await getUserPermissions(req.user);
    req.pettyCashPermissions = permissions;
    const scope = permissions.view_all ? "" : "AND created_by = ?";
    const params = permissions.view_all
      ? [req.user.company_id]
      : [req.user.company_id, req.user.user_id];

    const [[settings], [summary], [recent], [categories]] = await Promise.all([
      db.query(
        `SELECT fund_name, opening_balance, current_balance, imprest_limit, currency_code
         FROM petty_cash_settings WHERE company_id = ? LIMIT 1`,
        [req.user.company_id]
      ),
      db.query(
        `SELECT
           COUNT(*) AS total_transactions,
           COALESCE(SUM(CASE WHEN transaction_type='EXPENSE' AND status='POSTED' THEN amount ELSE 0 END),0) AS posted_expenses,
           COALESCE(SUM(CASE WHEN transaction_type='REPLENISHMENT' AND status='POSTED' THEN amount ELSE 0 END),0) AS posted_replenishments,
           SUM(CASE WHEN status IN ('SUBMITTED','MANAGER_APPROVED','ACCOUNTS_APPROVED') THEN 1 ELSE 0 END) AS pending_approvals,
           SUM(CASE WHEN status='DRAFT' THEN 1 ELSE 0 END) AS drafts
         FROM petty_cash_transactions
         WHERE company_id = ? ${scope}`,
        params
      ),
      db.query(
        `SELECT id, transaction_no, transaction_type, transaction_date, category,
                description, amount, status, created_by
         FROM petty_cash_transactions
         WHERE company_id = ? ${scope}
         ORDER BY created_at DESC LIMIT 8`,
        params
      ),
      db.query(
        `SELECT COALESCE(category,'Uncategorized') AS category, SUM(amount) AS total
         FROM petty_cash_transactions
         WHERE company_id = ? AND transaction_type='EXPENSE' AND status='POSTED' ${scope}
         GROUP BY category ORDER BY total DESC LIMIT 6`,
        params
      ),
    ]);

    const defaultBalance =
      Number(summary[0].posted_replenishments) - Number(summary[0].posted_expenses);
    res.json({
      success: true,
      permissions,
      fund: settings[0] || {
        fund_name: "Main Petty Cash",
        current_balance: defaultBalance,
        opening_balance: 0,
        imprest_limit: 0,
        currency_code: "INR",
      },
      summary: {
        ...summary[0],
        total_transactions: Number(summary[0].total_transactions),
        posted_expenses: Number(summary[0].posted_expenses),
        posted_replenishments: Number(summary[0].posted_replenishments),
        pending_approvals: Number(summary[0].pending_approvals),
        drafts: Number(summary[0].drafts),
      },
      recent: recent.map(serializeTransaction),
      categories: categories.map((item) => ({ ...item, total: Number(item.total) })),
    });
  } catch (error) {
    next(error);
  }
};

exports.listTransactions = async (req, res, next) => {
  try {
    await ensurePettyCashSchema();
    const permissions = await getUserPermissions(req.user);
    req.pettyCashPermissions = permissions;
    const clauses = ["t.company_id = ?"];
    const params = [req.user.company_id];

    if (!permissions.view_all) {
      clauses.push("t.created_by = ?");
      params.push(req.user.user_id);
    }
    if (req.query.status) {
      clauses.push("t.status = ?");
      params.push(String(req.query.status).toUpperCase());
    }
    if (req.query.type) {
      clauses.push("t.transaction_type = ?");
      params.push(String(req.query.type).toUpperCase());
    }
    if (req.query.from_date) {
      clauses.push("t.transaction_date >= ?");
      params.push(req.query.from_date);
    }
    if (req.query.to_date) {
      clauses.push("t.transaction_date <= ?");
      params.push(req.query.to_date);
    }
    if (req.query.search) {
      clauses.push("(t.transaction_no LIKE ? OR t.description LIKE ? OR t.payee LIKE ?)");
      const search = `%${String(req.query.search).slice(0, 100)}%`;
      params.push(search, search, search);
    }

    const [rows] = await db.query(
      `SELECT t.*, u.name AS created_by_name,
              (SELECT COUNT(*) FROM petty_cash_attachments a
               WHERE a.transaction_id=t.id AND a.company_id=t.company_id) AS attachment_count
       FROM petty_cash_transactions t
       LEFT JOIN users u ON u.id=t.created_by AND u.company_id=t.company_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY t.transaction_date DESC, t.id DESC
       LIMIT 500`,
      params
    );
    res.json({ success: true, permissions, data: rows.map(serializeTransaction) });
  } catch (error) {
    next(error);
  }
};

exports.getTransaction = async (req, res, next) => {
  try {
    await ensurePettyCashSchema();
    req.pettyCashPermissions = await getUserPermissions(req.user);
    const transaction = await findTransaction(req.params.id, req.user.company_id);
    if (!transaction) return res.status(404).json({ message: "Transaction not found" });
    if (!canViewTransaction(transaction, req)) {
      return res.status(403).json({ message: "You cannot view this transaction" });
    }
    const [attachments] = await db.query(
      `SELECT id, original_name, mime_type, size_bytes, created_at
       FROM petty_cash_attachments WHERE company_id=? AND transaction_id=? ORDER BY id`,
      [req.user.company_id, transaction.id]
    );
    const [history] = await db.query(
      `SELECT h.*, u.name AS action_by_name
       FROM petty_cash_workflow_history h
       LEFT JOIN users u ON u.id=h.action_by AND u.company_id=h.company_id
       WHERE h.company_id=? AND h.transaction_id=? ORDER BY h.created_at, h.id`,
      [req.user.company_id, transaction.id]
    );
    res.json({
      success: true,
      transaction: serializeTransaction(transaction),
      attachments,
      history,
    });
  } catch (error) {
    next(error);
  }
};

exports.createTransaction = async (req, res, next) => {
  const connection = await db.getConnection();
  try {
    rejectClientFinancialYear(req.body);
    await ensurePettyCashSchema();
    const type = String(req.body.transaction_type || "EXPENSE").toUpperCase();
    const amount = parseAmount(req.body.amount);
    if (!["EXPENSE", "REPLENISHMENT"].includes(type) || !amount || !clean(req.body.description)) {
      return res.status(400).json({ message: "Type, description, and a positive amount are required" });
    }
    await connection.beginTransaction();
    const transactionNo = await nextTransactionNumber(connection, req.user.company_id, type);
    const [result] = await connection.query(
      `INSERT INTO petty_cash_transactions
       (company_id, transaction_no, transaction_type, transaction_date, category,
        payee, description, amount, payment_method, reference_no, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.company_id,
        transactionNo,
        type,
        req.body.transaction_date || new Date().toISOString().slice(0, 10),
        clean(req.body.category, 100),
        clean(req.body.payee, 160),
        clean(req.body.description),
        amount,
        clean(req.body.payment_method, 50),
        clean(req.body.reference_no, 100),
        req.user.user_id,
      ]
    );
    await saveAttachments(connection, result.insertId, req);
    await addWorkflowHistory(connection, {
      companyId: req.user.company_id,
      transactionId: result.insertId,
      action: "CREATE",
      fromStatus: null,
      toStatus: STATUSES.DRAFT,
      comments: null,
      userId: req.user.user_id,
    });
    await connection.commit();
    res.status(201).json({
      success: true,
      message: "Petty cash draft created",
      id: result.insertId,
      transaction_no: transactionNo,
    });
  } catch (error) {
    await connection.rollback();
    sendKnownError(error, res, next);
  } finally {
    connection.release();
  }
};

exports.updateTransaction = async (req, res, next) => {
  const connection = await db.getConnection();
  try {
    rejectClientFinancialYear(req.body);
    await ensurePettyCashSchema();
    await connection.beginTransaction();
    const transaction = await findTransaction(req.params.id, req.user.company_id, connection);
    if (!transaction) return res.status(404).json({ message: "Transaction not found" });
    if (Number(transaction.created_by) !== Number(req.user.user_id) && req.user.role !== "owner") {
      return res.status(403).json({ message: "Only the creator can edit this draft" });
    }
    if (![STATUSES.DRAFT, STATUSES.REJECTED].includes(transaction.status)) {
      return res.status(409).json({ message: "Only draft or rejected transactions can be edited" });
    }
    const amount = parseAmount(req.body.amount);
    if (!amount || !clean(req.body.description)) {
      return res.status(400).json({ message: "Description and a positive amount are required" });
    }
    await connection.query(
      `UPDATE petty_cash_transactions SET transaction_date=?, category=?, payee=?,
       description=?, amount=?, payment_method=?, reference_no=?, status='DRAFT',
       rejected_by=NULL, rejected_at=NULL, rejection_reason=NULL
       WHERE id=? AND company_id=?`,
      [
        req.body.transaction_date,
        clean(req.body.category, 100),
        clean(req.body.payee, 160),
        clean(req.body.description),
        amount,
        clean(req.body.payment_method, 50),
        clean(req.body.reference_no, 100),
        transaction.id,
        req.user.company_id,
      ]
    );
    await saveAttachments(connection, transaction.id, req);
    if (transaction.status === STATUSES.REJECTED) {
      await addWorkflowHistory(connection, {
        companyId: req.user.company_id,
        transactionId: transaction.id,
        action: "EDIT",
        fromStatus: STATUSES.REJECTED,
        toStatus: STATUSES.DRAFT,
        comments: "Edited after rejection",
        userId: req.user.user_id,
      });
    }
    await connection.commit();
    res.json({ success: true, message: "Draft updated" });
  } catch (error) {
    await connection.rollback();
    sendKnownError(error, res, next);
  } finally {
    connection.release();
  }
};

const transition = ({ from, to, action, columns = "" }) => async (req, res, next) => {
  const connection = await db.getConnection();
  try {
    await ensurePettyCashSchema();
    await connection.beginTransaction();
    const transaction = await findTransaction(req.params.id, req.user.company_id, connection);
    if (!transaction) return res.status(404).json({ message: "Transaction not found" });
    if (!from.includes(transaction.status)) {
      return res.status(409).json({
        message: `Cannot ${action.toLowerCase()} a ${transaction.status.toLowerCase()} transaction`,
      });
    }
    await connection.query(
      `UPDATE petty_cash_transactions SET status=? ${columns}
       WHERE id=? AND company_id=?`,
      [to, req.user.user_id, transaction.id, req.user.company_id]
    );
    await addWorkflowHistory(connection, {
      companyId: req.user.company_id,
      transactionId: transaction.id,
      action,
      fromStatus: transaction.status,
      toStatus: to,
      comments: clean(req.body.comments),
      userId: req.user.user_id,
    });
    await connection.commit();
    res.json({ success: true, message: `${action.replace("_", " ")} completed`, status: to });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
};

exports.submitTransaction = transition({
  from: [STATUSES.DRAFT],
  to: STATUSES.SUBMITTED,
  action: "SUBMIT",
  columns: ", submitted_by=?, submitted_at=NOW()",
});
exports.managerApprove = transition({
  from: [STATUSES.SUBMITTED],
  to: STATUSES.MANAGER_APPROVED,
  action: "MANAGER_APPROVE",
  columns: ", manager_approved_by=?, manager_approved_at=NOW()",
});
exports.accountsApprove = transition({
  from: [STATUSES.MANAGER_APPROVED],
  to: STATUSES.ACCOUNTS_APPROVED,
  action: "ACCOUNTS_APPROVE",
  columns: ", accounts_approved_by=?, accounts_approved_at=NOW()",
});

exports.rejectTransaction = async (req, res, next) => {
  const reason = clean(req.body.reason);
  if (!reason) return res.status(400).json({ message: "Rejection reason is required" });
  const connection = await db.getConnection();
  try {
    await ensurePettyCashSchema();
    await connection.beginTransaction();
    const transaction = await findTransaction(req.params.id, req.user.company_id, connection);
    if (!transaction) return res.status(404).json({ message: "Transaction not found" });
    if (![STATUSES.SUBMITTED, STATUSES.MANAGER_APPROVED, STATUSES.ACCOUNTS_APPROVED].includes(transaction.status)) {
      return res.status(409).json({ message: "This transaction cannot be rejected" });
    }
    await connection.query(
      `UPDATE petty_cash_transactions
       SET status='REJECTED', rejected_by=?, rejected_at=NOW(), rejection_reason=?
       WHERE id=? AND company_id=?`,
      [req.user.user_id, reason, transaction.id, req.user.company_id]
    );
    await addWorkflowHistory(connection, {
      companyId: req.user.company_id,
      transactionId: transaction.id,
      action: "REJECT",
      fromStatus: transaction.status,
      toStatus: STATUSES.REJECTED,
      comments: reason,
      userId: req.user.user_id,
    });
    await connection.commit();
    res.json({ success: true, message: "Transaction rejected", status: STATUSES.REJECTED });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
};

exports.postTransaction = async (req, res, next) => {
  const connection = await db.getConnection();
  try {
    rejectClientFinancialYear(req.body);
    await ensurePettyCashSchema();
    await connection.beginTransaction();
    const candidate = await findTransaction(req.params.id, req.user.company_id, connection);
    if (!candidate) return res.status(404).json({ message: "Transaction not found" });
    await requireFinancialYearForPosting(
      req.user.company_id,
      candidate.transaction_date,
      connection
    );
    const transaction = await findTransaction(
      req.params.id,
      req.user.company_id,
      connection,
      { forUpdate: true }
    );
    if (!transaction) return res.status(404).json({ message: "Transaction not found" });
    if (String(transaction.transaction_date) !== String(candidate.transaction_date)) {
      const error = new Error("Petty Cash transaction date changed while posting; retry the request");
      error.status = 409;
      error.code = "PETTY_CASH_TRANSACTION_CHANGED";
      throw error;
    }
    if (transaction.status !== STATUSES.ACCOUNTS_APPROVED) {
      return res.status(409).json({ message: "Accounts approval is required before posting" });
    }
    await connection.query(
      `INSERT INTO petty_cash_settings (company_id, current_balance)
       VALUES (?, 0) ON DUPLICATE KEY UPDATE company_id=VALUES(company_id)`,
      [req.user.company_id]
    );
    const delta =
      transaction.transaction_type === "REPLENISHMENT"
        ? Number(transaction.amount)
        : -Number(transaction.amount);
    const [settings] = await connection.query(
      "SELECT current_balance FROM petty_cash_settings WHERE company_id=? FOR UPDATE",
      [req.user.company_id]
    );
    if (Number(settings[0].current_balance) + delta < 0) {
      return res.status(409).json({ message: "Insufficient petty cash balance" });
    }
    await connection.query(
      "UPDATE petty_cash_settings SET current_balance=current_balance+? WHERE company_id=?",
      [delta, req.user.company_id]
    );
    await connection.query(
      `UPDATE petty_cash_transactions SET status='POSTED', posted_by=?, posted_at=NOW()
       WHERE id=? AND company_id=?`,
      [req.user.user_id, transaction.id, req.user.company_id]
    );
    await addWorkflowHistory(connection, {
      companyId: req.user.company_id,
      transactionId: transaction.id,
      action: "POST",
      fromStatus: transaction.status,
      toStatus: STATUSES.POSTED,
      comments: clean(req.body.comments),
      userId: req.user.user_id,
    });
    await connection.commit();
    res.json({ success: true, message: "Transaction posted", status: STATUSES.POSTED });
  } catch (error) {
    await connection.rollback();
    sendKnownError(error, res, next);
  } finally {
    connection.release();
  }
};

exports.getAttachment = async (req, res, next) => {
  try {
    await ensurePettyCashSchema();
    const permissions = await getUserPermissions(req.user);
    const [rows] = await db.query(
      `SELECT a.*, t.created_by
       FROM petty_cash_attachments a
       JOIN petty_cash_transactions t ON t.id=a.transaction_id AND t.company_id=a.company_id
       WHERE a.id=? AND a.company_id=? LIMIT 1`,
      [req.params.id, req.user.company_id]
    );
    if (!rows.length) return res.status(404).json({ message: "Attachment not found" });
    if (!permissions.view_all && Number(rows[0].created_by) !== Number(req.user.user_id)) {
      return res.status(403).json({ message: "You cannot view this attachment" });
    }
    const disposition = req.query.download === "1" ? "attachment" : "inline";
    res.set({
      "Content-Type": rows[0].mime_type,
      "Content-Length": rows[0].size_bytes,
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(rows[0].original_name)}`,
      "Cache-Control": "private, no-store",
    });
    res.send(rows[0].file_data);
  } catch (error) {
    next(error);
  }
};

exports.deleteAttachment = async (req, res, next) => {
  try {
    await ensurePettyCashSchema();
    const [rows] = await db.query(
      `SELECT a.id, t.created_by, t.status
       FROM petty_cash_attachments a
       JOIN petty_cash_transactions t ON t.id=a.transaction_id AND t.company_id=a.company_id
       WHERE a.id=? AND a.company_id=? LIMIT 1`,
      [req.params.id, req.user.company_id]
    );
    if (!rows.length) return res.status(404).json({ message: "Attachment not found" });
    if (req.user.role !== "owner" && Number(rows[0].created_by) !== Number(req.user.user_id)) {
      return res.status(403).json({ message: "Only the creator can remove this attachment" });
    }
    if (![STATUSES.DRAFT, STATUSES.REJECTED].includes(rows[0].status)) {
      return res.status(409).json({ message: "Attachments can only be removed from drafts" });
    }
    await db.query("DELETE FROM petty_cash_attachments WHERE id=? AND company_id=?", [
      req.params.id,
      req.user.company_id,
    ]);
    res.json({ success: true, message: "Attachment removed" });
  } catch (error) {
    next(error);
  }
};

exports.getSettings = async (req, res, next) => {
  try {
    await ensurePettyCashSchema();
    const [rows] = await db.query(
      "SELECT * FROM petty_cash_settings WHERE company_id=? LIMIT 1",
      [req.user.company_id]
    );
    res.json({
      success: true,
      settings: rows[0] || {
        fund_name: "Main Petty Cash",
        opening_balance: 0,
        current_balance: 0,
        imprest_limit: 0,
        manager_approval_limit: 0,
        currency_code: "INR",
        is_active: 1,
      },
    });
  } catch (error) {
    next(error);
  }
};

exports.updateSettings = async (req, res, next) => {
  const connection = await db.getConnection();
  try {
    await ensurePettyCashSchema();
    const openingInput = req.body.opening_balance;
    const opening = openingInput === undefined || openingInput === null || openingInput === ""
      ? 0
      : Number(openingInput);
    await connection.beginTransaction();
    const [existing] = await connection.query(
      "SELECT opening_balance FROM petty_cash_settings WHERE company_id=? FOR UPDATE",
      [req.user.company_id]
    );
    if (!existing.length && (!Number.isFinite(opening) || opening !== 0)) {
      const error = new Error(
        "Petty Cash opening balance requires a dedicated dated opening-balance workflow"
      );
      error.status = 409;
      error.code = "PETTY_CASH_OPENING_BALANCE_WORKFLOW_REQUIRED";
      throw error;
    }
    if (
      existing.length &&
      (!Number.isFinite(opening) || opening !== Number(existing[0].opening_balance || 0))
    ) {
      const error = new Error("Petty Cash opening balance cannot be changed through settings");
      error.status = 409;
      error.code = "PETTY_CASH_OPENING_BALANCE_UPDATE_RESTRICTED";
      throw error;
    }
    await connection.query(
      `INSERT INTO petty_cash_settings
       (company_id, fund_name, opening_balance, current_balance, imprest_limit,
        manager_approval_limit, currency_code, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE fund_name=VALUES(fund_name),
         imprest_limit=VALUES(imprest_limit),
         manager_approval_limit=VALUES(manager_approval_limit),
         currency_code=VALUES(currency_code), is_active=VALUES(is_active)`,
      [
        req.user.company_id,
        clean(req.body.fund_name, 120) || "Main Petty Cash",
        opening,
        opening,
        Math.max(0, Number(req.body.imprest_limit) || 0),
        Math.max(0, Number(req.body.manager_approval_limit) || 0),
        clean(req.body.currency_code, 10) || "INR",
        req.body.is_active === false ? 0 : 1,
      ]
    );
    await connection.commit();
    res.json({ success: true, message: "Petty Cash settings saved" });
  } catch (error) {
    await connection.rollback();
    sendKnownError(error, res, next);
  } finally {
    connection.release();
  }
};

exports.listUserPermissions = async (req, res, next) => {
  try {
    await ensurePettyCashSchema();
    const [rows] = await db.query(
      `SELECT u.id AS user_id, u.name, u.email, u.role, u.access_role,
              COALESCE(p.can_create,0) can_create,
              COALESCE(p.can_edit_own,0) can_edit_own,
              COALESCE(p.can_submit,0) can_submit,
              COALESCE(p.can_approve,0) can_approve,
              COALESCE(p.can_reject,0) can_reject,
              COALESCE(p.can_post,0) can_post,
              COALESCE(p.can_view_all,0) can_view_all
       FROM users u
       LEFT JOIN petty_cash_user_permissions p
         ON p.user_id=u.id AND p.company_id=u.company_id
       WHERE u.company_id=? AND u.role='staff' ORDER BY u.name`,
      [req.user.company_id]
    );
    res.json({ success: true, users: rows });
  } catch (error) {
    next(error);
  }
};

exports.updateUserPermissions = async (req, res, next) => {
  try {
    await ensurePettyCashSchema();
    const values = ACTIONS.map((action) => (req.body[action] ? 1 : 0));
    const [users] = await db.query(
      "SELECT id FROM users WHERE id=? AND company_id=? AND role='staff' LIMIT 1",
      [req.params.userId, req.user.company_id]
    );
    if (!users.length) return res.status(404).json({ message: "Staff user not found" });
    await db.query(
      `INSERT INTO petty_cash_user_permissions
       (company_id,user_id,can_create,can_edit_own,can_submit,can_approve,can_reject,can_post,can_view_all)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE can_create=VALUES(can_create),
       can_edit_own=VALUES(can_edit_own), can_submit=VALUES(can_submit),
       can_approve=VALUES(can_approve), can_reject=VALUES(can_reject),
       can_post=VALUES(can_post), can_view_all=VALUES(can_view_all)`,
      [req.user.company_id, req.params.userId, ...values]
    );
    res.json({ success: true, message: "Permissions updated" });
  } catch (error) {
    next(error);
  }
};

exports.getReports = async (req, res, next) => {
  try {
    await ensurePettyCashSchema();
    const permissions = await getUserPermissions(req.user);
    const clauses = ["company_id=?"];
    const params = [req.user.company_id];
    if (!permissions.view_all) {
      clauses.push("created_by=?");
      params.push(req.user.user_id);
    }
    if (req.query.from_date) {
      clauses.push("transaction_date>=?");
      params.push(req.query.from_date);
    }
    if (req.query.to_date) {
      clauses.push("transaction_date<=?");
      params.push(req.query.to_date);
    }
    const [rows] = await db.query(
      `SELECT transaction_date, transaction_no, transaction_type, category, payee,
              description, amount, status, reference_no
       FROM petty_cash_transactions
       WHERE ${clauses.join(" AND ")}
       ORDER BY transaction_date DESC, id DESC`,
      params
    );
    const totals = rows.reduce(
      (result, row) => {
        if (row.transaction_type === "EXPENSE") result.expenses += Number(row.amount);
        else result.replenishments += Number(row.amount);
        return result;
      },
      { expenses: 0, replenishments: 0 }
    );
    res.json({ success: true, data: rows.map(serializeTransaction), totals });
  } catch (error) {
    next(error);
  }
};
