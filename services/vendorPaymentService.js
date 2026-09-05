const db = require("../db/connection");
const { isCashBankAccount } = require("./receiptEntryService");
const { requireFinancialYearForDate, rejectClientFinancialYear } = require("./financialYearService");

const METHODS = ["Cash", "Bank Transfer", "UPI", "Cheque", "Card", "Other"];
let schemaReady = false;

const paymentError = (message, status = 400) => Object.assign(new Error(message), { status });
const calculatePaymentState = (total, alreadyPaid, paymentAmount) => {
  const paidAmount = Number(alreadyPaid || 0) + Number(paymentAmount || 0);
  const dueAmount = Math.max(Number(total || 0) - paidAmount, 0);
  return {
    paidAmount,
    dueAmount,
    status: dueAmount <= 0 ? "Paid" : paidAmount > 0 ? "Partial Paid" : "Unpaid",
  };
};

const ensureColumn = async (table, column, definition) => {
  const [rows] = await db.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (!rows.length) await db.query(`ALTER TABLE \`${table}\` ADD COLUMN ${definition}`);
};

const ensureVendorPaymentSchema = async () => {
  if (schemaReady) return;
  await ensureColumn("vendor_payments", "paid_from_account_id", "paid_from_account_id INT NULL AFTER payment_method");
  await ensureColumn("vendor_payments", "reference_number", "reference_number VARCHAR(120) NULL AFTER paid_from_account_id");
  await ensureColumn("vendor_payments", "created_by", "created_by INT NULL AFTER company_id");
  await ensureColumn("vendor_payments", "journal_entry_id", "journal_entry_id BIGINT NULL AFTER created_by");
  await ensureColumn("vendor_payments", "idempotency_key", "idempotency_key VARCHAR(100) NULL AFTER journal_entry_id");
  await ensureColumn("vendor_payments", "status", "status VARCHAR(20) NOT NULL DEFAULT 'SUCCESS' AFTER idempotency_key");
  await ensureColumn("bills", "paid_amount", "paid_amount DECIMAL(15,2) NOT NULL DEFAULT 0 AFTER total_amount");
  await ensureColumn("bills", "due_amount", "due_amount DECIMAL(15,2) NOT NULL DEFAULT 0 AFTER paid_amount");
  await ensureColumn("journal_entries", "vendor_id", "vendor_id INT NULL AFTER company_id");
  await ensureColumn("journal_entries", "source_type", "source_type VARCHAR(50) NULL AFTER vendor_id");
  await ensureColumn("journal_entries", "source_id", "source_id BIGINT NULL AFTER source_type");
  const [indexes] = await db.query(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='vendor_payments'
       AND INDEX_NAME='uq_vendor_payment_submission'`
  );
  if (!indexes.length) {
    await db.query(
      "CREATE UNIQUE INDEX uq_vendor_payment_submission ON vendor_payments(company_id, idempotency_key)"
    );
  }
  const [journalIndexes] = await db.query(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='journal_entries'
       AND INDEX_NAME='uq_journal_source'`
  );
  if (!journalIndexes.length) {
    await db.query(
      "CREATE UNIQUE INDEX uq_journal_source ON journal_entries(company_id, source_type, source_id)"
    );
  }
  await db.query(
    `UPDATE bills b
     LEFT JOIN (
       SELECT bill_id, company_id, SUM(amount) paid
       FROM vendor_payments WHERE status='SUCCESS'
       GROUP BY bill_id, company_id
     ) p ON p.bill_id=b.id AND p.company_id=b.company_id
     SET b.paid_amount=GREATEST(COALESCE(p.paid,0), IF(b.status='Paid',b.total_amount,0)),
         b.due_amount=GREATEST(b.total_amount-GREATEST(COALESCE(p.paid,0),IF(b.status='Paid',b.total_amount,0)),0),
         b.status=CASE
           WHEN GREATEST(b.total_amount-GREATEST(COALESCE(p.paid,0),IF(b.status='Paid',b.total_amount,0)),0)<=0 THEN 'Paid'
           WHEN GREATEST(COALESCE(p.paid,0),IF(b.status='Paid',b.total_amount,0))>0 THEN 'Partial Paid'
           ELSE 'Unpaid' END`
  );
  schemaReady = true;
};

const findPayableAccount = async (connection, companyId) => {
  const [rows] = await connection.query(
    `SELECT * FROM accounts
     WHERE company_id=? AND status=1 AND account_type='LIABILITY'
       AND LOWER(CONCAT_WS(' ',account_name,description))
           REGEXP 'accounts payable|trade payable|vendor payable|sundry creditor|creditor'
     ORDER BY id LIMIT 1 FOR UPDATE`,
    [companyId]
  );
  if (rows.length) return rows[0];
  const code = `SYS-AP-${companyId}`;
  const [existing] = await connection.query(
    "SELECT * FROM accounts WHERE company_id=? AND account_code=? LIMIT 1 FOR UPDATE",
    [companyId, code]
  );
  if (existing.length) return existing[0];
  const [result] = await connection.query(
    `INSERT INTO accounts
     (account_code,account_name,account_type,opening_balance,balance_type,
      description,status,company_id)
     VALUES (?, 'Accounts Payable', 'LIABILITY', 0, 'CREDIT',
             'System vendor control account', 1, ?)`,
    [code, companyId]
  );
  return { id: result.insertId, account_name: "Accounts Payable" };
};

const recordVendorPayment = async (body, user) => {
  rejectClientFinancialYear(body);
  await ensureVendorPaymentSchema();
  const companyId = user.company_id;
  const createdBy = user.user_id || user.id || null;
  const amount = Number(body.amount || 0);
  const idempotencyKey = String(body.idempotency_key || "").trim();
  if (!body.vendor_id) throw paymentError("Vendor is required");
  if (!body.bill_id) throw paymentError("Outstanding bill is required");
  if (!body.payment_date) throw paymentError("Payment date is required");
  if (!(amount > 0)) throw paymentError("Payment amount must be greater than zero");
  if (!body.paid_from_account_id) throw paymentError("Paid From account is required");
  if (!METHODS.includes(body.payment_method)) throw paymentError("Valid payment method is required");
  if (!idempotencyKey) throw paymentError("Submission key is required");

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const financialYear = await requireFinancialYearForDate(companyId, body.payment_date, connection);
    const [duplicate] = await connection.query(
      `SELECT id,journal_entry_id FROM vendor_payments
       WHERE company_id=? AND idempotency_key=? LIMIT 1`,
      [companyId, idempotencyKey]
    );
    if (duplicate.length) {
      await connection.rollback();
      return { payment_id: duplicate[0].id, journal_entry_id: duplicate[0].journal_entry_id, duplicate: true };
    }
    const [billRows] = await connection.query(
      `SELECT b.id,b.vendor_id,b.bill_number,b.total_amount,v.name vendor_name
       FROM bills b INNER JOIN vendors v
         ON v.id=b.vendor_id AND v.company_id=b.company_id
       WHERE b.id=? AND b.vendor_id=? AND b.company_id=?
         AND (v.status IS NULL OR v.status<>'Inactive')
       LIMIT 1 FOR UPDATE`,
      [body.bill_id, body.vendor_id, companyId]
    );
    if (!billRows.length) throw paymentError("Bill not found for this vendor and company", 404);
    const bill = billRows[0];
    const [paidRows] = await connection.query(
      `SELECT COALESCE(SUM(amount),0) paid
       FROM vendor_payments WHERE bill_id=? AND company_id=? AND status='SUCCESS'`,
      [bill.id, companyId]
    );
    const alreadyPaid = Number(paidRows[0].paid || 0);
    const outstanding = Math.max(Number(bill.total_amount) - alreadyPaid, 0);
    if (amount > outstanding) throw paymentError(`Payment exceeds outstanding amount of ${outstanding.toFixed(2)}`);

    const [accountRows] = await connection.query(
      `SELECT a.*,p.account_name parent_account_name
       FROM accounts a LEFT JOIN accounts p
         ON p.id=a.parent_account_id AND p.company_id=a.company_id
       WHERE a.id=? AND a.company_id=? AND a.status=1 LIMIT 1 FOR UPDATE`,
      [body.paid_from_account_id, companyId]
    );
    if (!accountRows.length || !isCashBankAccount(accountRows[0])) {
      throw paymentError("Paid From must be a valid Cash or Bank account");
    }
    const payable = await findPayableAccount(connection, companyId);
    const [paymentResult] = await connection.query(
      `INSERT INTO vendor_payments
       (vendor_id,bill_id,amount,payment_date,payment_method,paid_from_account_id,
        reference_number,notes,company_id,financial_year_id,created_by,idempotency_key,status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'SUCCESS')`,
      [bill.vendor_id,bill.id,amount,body.payment_date,body.payment_method,
       body.paid_from_account_id,String(body.reference_number||"").trim()||null,
       String(body.notes||"").trim()||null,companyId,financialYear.id,createdBy,idempotencyKey]
    );
    const paymentId = paymentResult.insertId;
    const narration = `Vendor payment to ${bill.vendor_name} against ${bill.bill_number}`;
    const [journalResult] = await connection.query(
      `INSERT INTO journal_entries
       (journal_no,journal_date,narration,total_debit,total_credit,
        company_id,financial_year_id,vendor_id,source_type,source_id)
       VALUES (?,?,?,?,?,?,?,?,'vendor_payment',?)`,
      [`VPAY-${String(paymentId).padStart(5,"0")}`,body.payment_date,narration,
       amount,amount,companyId,financialYear.id,bill.vendor_id,paymentId]
    );
    const journalId = journalResult.insertId;
    await connection.query(
      `INSERT INTO journal_entry_details
       (journal_entry_id,account_id,debit,credit,description) VALUES
       (?,?,?,0,?),(?,?,0,?,?)`,
      [journalId,payable.id,amount,narration,journalId,body.paid_from_account_id,amount,narration]
    );
    await connection.query(
      `INSERT INTO ledger_entries
       (company_id,financial_year_id,entity_type,entity_id,reference_type,reference_id,debit,credit,transaction_date)
       VALUES (?,?,'vendor',?,'vendor_payment',?,0,?,?)`,
      [companyId,financialYear.id,bill.vendor_id,paymentId,amount,body.payment_date]
    );
    await connection.query(
      "UPDATE vendor_payments SET journal_entry_id=? WHERE id=? AND company_id=?",
      [journalId,paymentId,companyId]
    );
    const { paidAmount, dueAmount, status } = calculatePaymentState(
      bill.total_amount,
      alreadyPaid,
      amount
    );
    await connection.query(
      "UPDATE bills SET paid_amount=?,due_amount=?,status=? WHERE id=? AND company_id=?",
      [paidAmount,dueAmount,status,bill.id,companyId]
    );
    await connection.commit();
    return { payment_id: paymentId,journal_entry_id: journalId,paid_amount: paidAmount,due_amount: dueAmount,status,duplicate: false };
  } catch (error) {
    await connection.rollback();
    if (error.code === "ER_DUP_ENTRY") {
      const [duplicate] = await db.query(
        "SELECT id,journal_entry_id FROM vendor_payments WHERE company_id=? AND idempotency_key=? LIMIT 1",
        [companyId,idempotencyKey]
      );
      if (duplicate.length) return { payment_id: duplicate[0].id,journal_entry_id: duplicate[0].journal_entry_id,duplicate: true };
    }
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = { METHODS, calculatePaymentState, ensureVendorPaymentSchema, recordVendorPayment };
