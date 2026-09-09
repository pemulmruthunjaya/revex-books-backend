const db = require("../db/connection");
const { ensureVendorPartySchema } = require("../services/vendorPartyService");
const { rejectClientFinancialYear } = require("../services/financialYearService");
const {
  recordOpeningBalanceEvent,
  resolvePartyControlAccount,
} = require("../services/openingBalanceService");

const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const text = (value) => String(value || "").trim() || null;
const amount = (value) => Math.max(0, Number(value) || 0);
const banks = (value) =>
  (Array.isArray(value) ? value : [])
    .map((bank, index) => ({
      account_holder_name: text(bank.account_holder_name),
      bank_name: String(bank.bank_name || "").trim(),
      account_number: String(bank.account_number || "").trim(),
      ifsc_code: String(bank.ifsc_code || "").trim().toUpperCase(),
      branch_name: text(bank.branch_name),
      is_primary: index === 0 || Boolean(bank.is_primary),
    }))
    .filter((bank) => bank.bank_name || bank.account_number);

const normalize = (body) => {
  const billing = text(body.billing_address || body.address);
  const gst = String(body.gstin || body.gst_number || "").trim().toUpperCase();
  return {
    name: String(body.name || "").trim(),
    phone: text(body.phone),
    email: text(body.email)?.toLowerCase() || null,
    gst,
    pan: String(body.pan_number || "").trim().toUpperCase(),
    opening: amount(body.opening_balance),
    openingType: body.opening_balance_type === "to_collect" ? "to_collect" : "to_pay",
    category: text(body.party_category),
    billing,
    shipping: body.same_as_billing !== false ? billing : text(body.shipping_address),
    creditDays: Math.max(0, Number.parseInt(body.credit_period_days, 10) || 0),
    creditLimit: amount(body.credit_limit),
    contactName: text(body.contact_person_name),
    contactDob: text(body.contact_person_dob),
    bankAccounts: banks(body.bank_accounts),
  };
};

const validate = (party) => {
  if (!party.name) return "Party name is required";
  if (party.gst && !GSTIN.test(party.gst)) return "Enter a valid 15-character GSTIN";
  if (party.pan && !PAN.test(party.pan)) return "Enter a valid PAN number";
  if (party.gst && party.pan && party.gst.slice(2, 12) !== party.pan) {
    return "PAN does not match the GSTIN";
  }
  if (party.bankAccounts.some((bank) => !bank.bank_name || !bank.account_number)) {
    return "Bank name and account number are required for each bank account";
  }
  if (party.bankAccounts.some((bank) => bank.ifsc_code && !IFSC.test(bank.ifsc_code))) {
    return "Enter a valid IFSC code";
  }
  return null;
};

const saveBanks = async (connection, vendorId, companyId, bankAccounts) => {
  await connection.query(
    "DELETE FROM vendor_bank_accounts WHERE vendor_id = ? AND company_id = ?",
    [vendorId, companyId]
  );
  for (const bank of bankAccounts) {
    await connection.query(
      `INSERT INTO vendor_bank_accounts
       (vendor_id, company_id, account_holder_name, bank_name, account_number,
        ifsc_code, branch_name, is_primary)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [vendorId, companyId, bank.account_holder_name, bank.bank_name,
       bank.account_number, bank.ifsc_code || null, bank.branch_name,
       bank.is_primary ? 1 : 0]
    );
  }
};

exports.createVendor = async (req, res) => {
  let connection;
  try {
    rejectClientFinancialYear(req.body);
    await ensureVendorPartySchema();
    const party = normalize(req.body);
    const error = validate(party);
    if (error) return res.status(400).json({ message: error });
    if (party.gst) {
      const [duplicate] = await db.query(
        "SELECT id FROM vendors WHERE company_id = ? AND gst_number = ? LIMIT 1",
        [req.user.company_id, party.gst]
      );
      if (duplicate.length) return res.status(409).json({ message: "A vendor with this GSTIN already exists" });
    }
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [result] = await connection.query(
      `INSERT INTO vendors
       (name, phone, email, gst_number, address, company_id, pan_number,
        opening_balance, opening_balance_type, party_category, billing_address,
        shipping_address, credit_period_days, credit_limit,
        contact_person_name, contact_person_dob)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [party.name, party.phone, party.email, party.gst || null, party.billing,
       req.user.company_id, party.pan || (party.gst ? party.gst.slice(2, 12) : null),
       party.opening, party.openingType, party.category, party.billing,
       party.shipping, party.creditDays, party.creditLimit, party.contactName,
       party.contactDob]
    );
    if (party.opening) {
      const targetAccount = await resolvePartyControlAccount(
        connection, req.user.company_id, "vendor", party.openingType
      );
      await recordOpeningBalanceEvent({
        connection,
        companyId: req.user.company_id,
        entityType: "vendor",
        entityId: result.insertId,
        targetAccount,
        newSignedAmount: party.openingType === "to_pay" ? -party.opening : party.opening,
        createdBy: req.user.user_id || req.user.id || null,
      });
    }
    await saveBanks(connection, result.insertId, req.user.company_id, party.bankAccounts);
    await connection.commit();
    return res.status(201).json({ message: "Vendor created successfully", vendorId: result.insertId });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Create vendor error:", error);
    return res.status(error.status || 500).json({
      message: error.status ? error.message : "Failed to create vendor",
      ...(error.code ? { code: error.code } : {}),
    });
  } finally {
    if (connection) connection.release();
  }
};

const vendorStatsSql = `
  SELECT v.*,
    COALESCE(s.bill_balance, 0) +
      CASE WHEN v.opening_balance_type = 'to_pay' THEN v.opening_balance ELSE -v.opening_balance END AS balance,
    COALESCE(s.paid_total, 0) AS paid_total,
    COALESCE(s.bill_count, 0) AS bill_count
  FROM vendors v
  LEFT JOIN (
    SELECT b.vendor_id,
      SUM(GREATEST(b.total_amount - CASE WHEN b.status = 'Paid' THEN b.total_amount
        ELSE LEAST(COALESCE(p.paid_amount, 0), b.total_amount) END, 0)) AS bill_balance,
      SUM(CASE WHEN b.status = 'Paid' THEN b.total_amount
        ELSE LEAST(COALESCE(p.paid_amount, 0), b.total_amount) END) AS paid_total,
      COUNT(*) AS bill_count
    FROM bills b
    LEFT JOIN (
      SELECT bill_id, company_id, SUM(amount) AS paid_amount
      FROM vendor_payments GROUP BY bill_id, company_id
    ) p ON p.bill_id = b.id AND p.company_id = b.company_id
    WHERE b.company_id = ? AND b.total_amount > 0 GROUP BY b.vendor_id
  ) s ON s.vendor_id = v.id`;

exports.getVendors = async (req, res) => {
  try {
    await ensureVendorPartySchema();
    const [rows] = await db.query(
      `${vendorStatsSql}
       WHERE v.company_id = ? AND (v.status IS NULL OR v.status <> 'Inactive')
       ORDER BY v.created_at DESC`,
      [req.user.company_id, req.user.company_id]
    );
    return res.json(rows);
  } catch (error) {
    console.error("Get vendors error:", error);
    return res.status(500).json({ message: "Failed to fetch vendors" });
  }
};

exports.getVendorById = async (req, res) => {
  try {
    await ensureVendorPartySchema();
    const [rows] = await db.query(
      `${vendorStatsSql}
       WHERE v.id = ? AND v.company_id = ?
         AND (v.status IS NULL OR v.status <> 'Inactive')`,
      [req.user.company_id, req.params.id, req.user.company_id]
    );
    if (!rows.length) return res.status(404).json({ message: "Vendor not found" });
    const [bankAccounts] = await db.query(
      `SELECT id, account_holder_name, bank_name, account_number,
              ifsc_code, branch_name, is_primary
       FROM vendor_bank_accounts WHERE vendor_id = ? AND company_id = ?
       ORDER BY is_primary DESC, id ASC`,
      [req.params.id, req.user.company_id]
    );
    return res.json({
      ...rows[0],
      gstin: rows[0].gst_number,
      bank_accounts: bankAccounts.map((bank) => ({
        ...bank,
        is_primary: Number(bank.is_primary) === 1,
      })),
    });
  } catch (error) {
    console.error("Get vendor error:", error);
    return res.status(500).json({ message: "Failed to fetch vendor" });
  }
};

exports.updateVendor = async (req, res) => {
  let connection;
  try {
    rejectClientFinancialYear(req.body);
    await ensureVendorPartySchema();
    const party = normalize(req.body);
    const error = validate(party);
    if (error) return res.status(400).json({ message: error });
    const [found] = await db.query(
      "SELECT id FROM vendors WHERE id = ? AND company_id = ? LIMIT 1",
      [req.params.id, req.user.company_id]
    );
    if (!found.length) return res.status(404).json({ message: "Vendor not found" });
    if (party.gst) {
      const [duplicate] = await db.query(
        "SELECT id FROM vendors WHERE company_id = ? AND gst_number = ? AND id <> ? LIMIT 1",
        [req.user.company_id, party.gst, req.params.id]
      );
      if (duplicate.length) return res.status(409).json({ message: "A vendor with this GSTIN already exists" });
    }
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [lockedRows] = await connection.query(
      `SELECT id,opening_balance,opening_balance_type FROM vendors
       WHERE id=? AND company_id=? LIMIT 1 FOR UPDATE`,
      [req.params.id, req.user.company_id]
    );
    if (!lockedRows.length) {
      const lockError = new Error("Vendor not found");
      lockError.status = 404;
      throw lockError;
    }
    const prior = lockedRows[0];
    if (prior.opening_balance_type !== party.openingType &&
        (Number(prior.opening_balance || 0) || party.opening)) {
      const typeError = new Error("Clear the opening balance with an adjustment before changing its direction");
      typeError.status = 409;
      throw typeError;
    }
    const previousSigned = prior.opening_balance_type === "to_collect"
      ? Number(prior.opening_balance || 0)
      : -Number(prior.opening_balance || 0);
    const newSigned = party.openingType === "to_collect" ? party.opening : -party.opening;
    if (newSigned !== previousSigned) {
      const targetAccount = await resolvePartyControlAccount(
        connection, req.user.company_id, "vendor", party.openingType
      );
      await recordOpeningBalanceEvent({
        connection,
        companyId: req.user.company_id,
        entityType: "vendor",
        entityId: req.params.id,
        targetAccount,
        previousSignedAmount: previousSigned,
        newSignedAmount: newSigned,
        createdBy: req.user.user_id || req.user.id || null,
      });
    }
    await connection.query(
      `UPDATE vendors SET name=?, phone=?, email=?, gst_number=?, address=?,
       pan_number=?, opening_balance=?, opening_balance_type=?, party_category=?,
       billing_address=?, shipping_address=?, credit_period_days=?, credit_limit=?,
       contact_person_name=?, contact_person_dob=?
       WHERE id=? AND company_id=?`,
      [party.name, party.phone, party.email, party.gst || null, party.billing,
       party.pan || (party.gst ? party.gst.slice(2, 12) : null), party.opening,
       party.openingType, party.category, party.billing, party.shipping,
       party.creditDays, party.creditLimit, party.contactName, party.contactDob,
       req.params.id, req.user.company_id]
    );
    await saveBanks(connection, req.params.id, req.user.company_id, party.bankAccounts);
    await connection.commit();
    return res.json({ message: "Vendor updated successfully" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Update vendor error:", error);
    return res.status(error.status || 500).json({
      message: error.status ? error.message : "Failed to update vendor",
      ...(error.code ? { code: error.code } : {}),
    });
  } finally {
    if (connection) connection.release();
  }
};

exports.deleteVendor = async (req, res) => {
  try {
    const [result] = await db.query(
      "UPDATE vendors SET status='Inactive' WHERE id=? AND company_id=?",
      [req.params.id, req.user.company_id]
    );
    if (!result.affectedRows) return res.status(404).json({ message: "Vendor not found" });
    return res.json({ message: "Vendor set to Inactive" });
  } catch (error) {
    console.error("Delete vendor error:", error);
    return res.status(500).json({ message: "Failed to deactivate vendor" });
  }
};
