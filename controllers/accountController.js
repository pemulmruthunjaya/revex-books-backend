const db = require("../db/connection");
const { rejectClientFinancialYear } = require("../services/financialYearService");
const {
  naturalSide,
  recordOpeningBalanceEvent,
  signedAccountOpening,
} = require("../services/openingBalanceService");

const accountError = (message, status = 400) => Object.assign(new Error(message), { status });
const accountValues = (body) => {
  const type = String(body.account_type || "").toUpperCase();
  const opening = Math.max(0, Number(body.opening_balance) || 0);
  return {
    code: String(body.account_code || "").trim() || null,
    name: String(body.account_name || "").trim(),
    type,
    parentId: body.parent_account_id || null,
    opening,
    side: opening ? naturalSide(type) : (body.balance_type || naturalSide(type)),
    description: String(body.description || "").trim() || null,
    signedOpening: signedAccountOpening(opening, type),
  };
};

const validateParent = async (connection, parentId, companyId, ownId = null) => {
  if (!parentId) return;
  if (ownId && Number(parentId) === Number(ownId)) throw accountError("Account cannot be parent of itself");
  const [rows] = await connection.query(
    "SELECT id FROM accounts WHERE id=? AND company_id=? AND status=1 LIMIT 1 FOR UPDATE",
    [parentId, companyId]
  );
  if (!rows.length) throw accountError("Parent account not found for this company");
};

const sendAccountError = (res, error) => {
  if (error.code === "ER_DUP_ENTRY") {
    return res.status(400).json({ success: false, message: "Account code or opening event already exists" });
  }
  return res.status(error.status || 500).json({
    success: false,
    message: error.status ? error.message : "Server error",
    ...(error.code ? { code: error.code } : {}),
  });
};

exports.createAccount = async (req, res) => {
  let connection;
  try {
    rejectClientFinancialYear(req.body);
    if (!req.user?.company_id) return res.status(401).json({ success: false, message: "Invalid token" });
    const companyId = req.user.company_id;
    const values = accountValues(req.body);
    if (!values.name || !values.type) throw accountError("Account name and account type are required");

    connection = await db.getConnection();
    await connection.beginTransaction();
    await validateParent(connection, values.parentId, companyId);
    const [result] = await connection.query(
      `INSERT INTO accounts
       (account_code,account_name,account_type,parent_account_id,opening_balance,balance_type,description,company_id)
       VALUES (?,?,?,?,?,?,?,?)`,
      [values.code, values.name, values.type, values.parentId, values.opening, values.side, values.description, companyId]
    );
    await recordOpeningBalanceEvent({
      connection, companyId, entityType: "account", entityId: result.insertId,
      targetAccount: { id: result.insertId, account_name: values.name, account_type: values.type },
      newSignedAmount: values.signedOpening,
      createdBy: req.user.user_id || req.user.id || null,
    });
    await connection.commit();
    return res.status(201).json({ success: true, message: "Account created successfully", account_id: result.insertId });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("CREATE ACCOUNT ERROR:", error);
    return sendAccountError(res, error);
  } finally {
    if (connection) connection.release();
  }
};

exports.getAllAccounts = async (req, res) => {
  try {
    const [results] = await db.query(
      `SELECT a.*,p.account_name parent_account_name FROM accounts a
       LEFT JOIN accounts p ON p.id=a.parent_account_id AND p.company_id=a.company_id
       WHERE a.status=1 AND a.company_id=? ORDER BY a.account_type,a.account_name`,
      [req.user.company_id]
    );
    return res.status(200).json({ success: true, count: results.length, data: results });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Server error" });
  }
};

exports.getSingleAccount = async (req, res) => {
  try {
    const [results] = await db.query(
      `SELECT a.*,p.account_name parent_account_name FROM accounts a
       LEFT JOIN accounts p ON p.id=a.parent_account_id AND p.company_id=a.company_id
       WHERE a.id=? AND a.company_id=?`,
      [req.params.id, req.user.company_id]
    );
    if (!results.length) return res.status(404).json({ success: false, message: "Account not found" });
    return res.status(200).json({ success: true, data: results[0] });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Server error" });
  }
};

exports.updateAccount = async (req, res) => {
  let connection;
  try {
    rejectClientFinancialYear(req.body);
    if (!req.user?.company_id) return res.status(401).json({ success: false, message: "Invalid token" });
    const companyId = req.user.company_id;
    const values = accountValues(req.body);
    if (!values.name || !values.type) throw accountError("Account name and account type are required");

    connection = await db.getConnection();
    await connection.beginTransaction();
    const [existingRows] = await connection.query(
      `SELECT id,account_name,account_type,opening_balance,balance_type
       FROM accounts WHERE id=? AND company_id=? LIMIT 1 FOR UPDATE`,
      [req.params.id, companyId]
    );
    if (!existingRows.length) throw accountError("Account not found", 404);
    await validateParent(connection, values.parentId, companyId, req.params.id);
    const existing = existingRows[0];
    if (String(existing.account_type).toUpperCase() !== values.type &&
        (Number(existing.opening_balance || 0) || values.opening)) {
      throw accountError("Clear the opening balance with an adjustment before changing the account type", 409);
    }
    const oldSigned = String(existing.account_type).toUpperCase() === "ASSET"
      ? Number(existing.opening_balance || 0) : -Number(existing.opening_balance || 0);
    await recordOpeningBalanceEvent({
      connection, companyId, entityType: "account", entityId: req.params.id,
      targetAccount: { id: req.params.id, account_name: values.name, account_type: values.type },
      previousSignedAmount: oldSigned, newSignedAmount: values.signedOpening,
      createdBy: req.user.user_id || req.user.id || null,
    });
    await connection.query(
      `UPDATE accounts SET account_code=?,account_name=?,account_type=?,parent_account_id=?,
       opening_balance=?,balance_type=?,description=? WHERE id=? AND company_id=?`,
      [values.code, values.name, values.type, values.parentId, values.opening, values.side,
       values.description, req.params.id, companyId]
    );
    await connection.commit();
    return res.status(200).json({ success: true, message: "Account updated successfully" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("UPDATE ACCOUNT ERROR:", error);
    return sendAccountError(res, error);
  } finally {
    if (connection) connection.release();
  }
};

exports.deleteAccount = async (req, res) => {
  try {
    const [result] = await db.query(
      "UPDATE accounts SET status=0 WHERE id=? AND company_id=?",
      [req.params.id, req.user.company_id]
    );
    if (!result.affectedRows) return res.status(404).json({ success: false, message: "Account not found" });
    return res.status(200).json({ success: true, message: "Account deleted successfully" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || "Server error" });
  }
};
