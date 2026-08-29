const db = require("../db/connection");
const { ensureCustomerPartySchema } = require("../services/customerPartyService");
const {
  recordOpeningBalanceEvent,
  resolvePartyControlAccount,
} = require("../services/openingBalanceService");
const {
  getCustomerFinancialSummary,
} = require("../services/customerFinancialService");

const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const nullable = (value) => String(value || "").trim() || null;
const money = (value) => Math.max(0, Number(value) || 0);

const normalizeBankAccounts = (accounts) => {
  if (!Array.isArray(accounts)) return [];

  return accounts
    .map((account, index) => ({
      account_holder_name: nullable(account.account_holder_name),
      bank_name: String(account.bank_name || "").trim(),
      account_number: String(account.account_number || "").trim(),
      ifsc_code: String(account.ifsc_code || "").trim().toUpperCase(),
      branch_name: nullable(account.branch_name),
      is_primary: index === 0 || Boolean(account.is_primary),
    }))
    .filter((account) => account.bank_name || account.account_number);
};

exports.createCustomer = async (req, res) => {
  let connection;

  try {
    if (!req.user?.company_id) {
      return res.status(401).json({ message: "Invalid token or company not found" });
    }

    await ensureCustomerPartySchema();

    const name = String(req.body.name || "").trim();
    const email = nullable(req.body.email)?.toLowerCase() || null;
    const phone = nullable(req.body.phone);
    const gstin = String(req.body.gstin || "").trim().toUpperCase();
    const panNumber = String(req.body.pan_number || "").trim().toUpperCase();
    const billingAddress = nullable(req.body.billing_address || req.body.address);
    const sameAsBilling = req.body.same_as_billing !== false;
    const shippingAddress = sameAsBilling
      ? billingAddress
      : nullable(req.body.shipping_address);
    const openingBalanceType =
      req.body.opening_balance_type === "to_pay" ? "to_pay" : "to_collect";
    const openingBalance = money(req.body.opening_balance);
    const creditPeriodDays = Math.max(0, Number.parseInt(req.body.credit_period_days, 10) || 0);
    const bankAccounts = normalizeBankAccounts(req.body.bank_accounts);

    if (!name) {
      return res.status(400).json({ message: "Party name is required" });
    }
    if (gstin && !GSTIN_PATTERN.test(gstin)) {
      return res.status(400).json({ message: "Enter a valid 15-character GSTIN" });
    }
    if (panNumber && !PAN_PATTERN.test(panNumber)) {
      return res.status(400).json({ message: "Enter a valid PAN number" });
    }
    if (gstin && panNumber && gstin.slice(2, 12) !== panNumber) {
      return res.status(400).json({ message: "PAN does not match the GSTIN" });
    }
    if (bankAccounts.some((account) => !account.bank_name || !account.account_number)) {
      return res.status(400).json({
        message: "Bank name and account number are required for each bank account",
      });
    }
    if (bankAccounts.some((account) => account.ifsc_code && !IFSC_PATTERN.test(account.ifsc_code))) {
      return res.status(400).json({ message: "Enter a valid IFSC code" });
    }

    if (gstin) {
      const [duplicates] = await db.query(
        "SELECT id FROM customers WHERE company_id = ? AND gstin = ? LIMIT 1",
        [req.user.company_id, gstin]
      );
      if (duplicates.length) {
        return res.status(409).json({ message: "A customer with this GSTIN already exists" });
      }
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [result] = await connection.query(
      `INSERT INTO customers (
        name, email, phone, address, company_id, gstin, pan_number,
        opening_balance, opening_balance_type, party_category,
        billing_address, shipping_address, credit_period_days, credit_limit,
        contact_person_name, contact_person_dob
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        email,
        phone,
        billingAddress,
        req.user.company_id,
        gstin || null,
        panNumber || (gstin ? gstin.slice(2, 12) : null),
        openingBalance,
        openingBalanceType,
        nullable(req.body.party_category),
        billingAddress,
        shippingAddress,
        creditPeriodDays,
        money(req.body.credit_limit),
        nullable(req.body.contact_person_name),
        nullable(req.body.contact_person_dob),
      ]
    );

    if (openingBalance) {
      const targetAccount = await resolvePartyControlAccount(
        connection, req.user.company_id, "customer", openingBalanceType
      );
      await recordOpeningBalanceEvent({
        connection,
        companyId: req.user.company_id,
        entityType: "customer",
        entityId: result.insertId,
        targetAccount,
        newSignedAmount: openingBalanceType === "to_collect" ? openingBalance : -openingBalance,
        createdBy: req.user.user_id || req.user.id || null,
      });
    }

    for (const account of bankAccounts) {
      await connection.query(
        `INSERT INTO customer_bank_accounts (
          customer_id, company_id, account_holder_name, bank_name,
          account_number, ifsc_code, branch_name, is_primary
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          result.insertId,
          req.user.company_id,
          account.account_holder_name,
          account.bank_name,
          account.account_number,
          account.ifsc_code || null,
          account.branch_name,
          account.is_primary ? 1 : 0,
        ]
      );
    }

    await connection.commit();
    return res.status(201).json({
      message: "Customer created successfully",
      customer_id: result.insertId,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Create customer error:", error);
    return res.status(500).json({
      message: "Failed to create customer",
      error: error.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

exports.getCustomers = async (req, res) => {
  try {
    if (!req.user?.company_id) {
      return res.status(401).json({ message: "Invalid token" });
    }

    await ensureCustomerPartySchema();
    const [customers] = await db.query(
      `SELECT * FROM customers WHERE company_id = ? ORDER BY id DESC`,
      [req.user.company_id]
    );

    if (!customers.length) return res.json([]);

    const [accounts] = await db.query(
      `SELECT id, customer_id, account_holder_name, bank_name, account_number,
              ifsc_code, branch_name, is_primary
       FROM customer_bank_accounts
       WHERE company_id = ?
       ORDER BY is_primary DESC, id ASC`,
      [req.user.company_id]
    );
    const byCustomer = accounts.reduce((grouped, account) => {
      (grouped[account.customer_id] ||= []).push({
        ...account,
        is_primary: Number(account.is_primary) === 1,
      });
      return grouped;
    }, {});

    return res.json(
      customers.map((customer) => ({
        ...customer,
        bank_accounts: byCustomer[customer.id] || [],
      }))
    );
  } catch (error) {
    console.error("Get customers error:", error);
    return res.status(500).json({
      message: "Failed to fetch customers",
      error: error.message,
    });
  }
};

exports.getCustomer = async (req, res) => {
  try {
    if (!req.user?.company_id) {
      return res.status(401).json({ message: "Invalid token" });
    }

    await ensureCustomerPartySchema();
    const [customers] = await db.query(
      "SELECT * FROM customers WHERE id = ? AND company_id = ? LIMIT 1",
      [req.params.id, req.user.company_id]
    );
    if (!customers.length) {
      return res.status(404).json({ message: "Customer not found" });
    }

    const [bankAccounts] = await db.query(
      `SELECT id, account_holder_name, bank_name, account_number,
              ifsc_code, branch_name, is_primary
       FROM customer_bank_accounts
       WHERE customer_id = ? AND company_id = ?
       ORDER BY is_primary DESC, id ASC`,
      [req.params.id, req.user.company_id]
    );

    return res.json({
      ...customers[0],
      bank_accounts: bankAccounts.map((account) => ({
        ...account,
        is_primary: Number(account.is_primary) === 1,
      })),
    });
  } catch (error) {
    console.error("Get customer error:", error);
    return res.status(500).json({ message: "Failed to fetch customer" });
  }
};

exports.getCustomerFinancialSummary = async (req, res) => {
  try {
    const companyId = Number(req.user?.company_id);
    const customerId = Number(req.params.customerId);
    if (!companyId) {
      return res.status(401).json({ success: false, message: "Invalid token" });
    }
    if (!Number.isSafeInteger(customerId) || customerId <= 0) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }

    const data = await getCustomerFinancialSummary(companyId, customerId);
    if (!data) {
      return res.status(404).json({ success: false, message: "Customer not found" });
    }
    return res.json({ success: true, data });
  } catch (error) {
    console.error("Get customer financial summary error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch customer financial summary",
    });
  }
};

exports.updateCustomer = async (req, res) => {
  let connection;

  try {
    if (!req.user?.company_id) {
      return res.status(401).json({ message: "Invalid token" });
    }

    await ensureCustomerPartySchema();
    const name = String(req.body.name || "").trim();
    const email = nullable(req.body.email)?.toLowerCase() || null;
    const phone = nullable(req.body.phone);
    const gstin = String(req.body.gstin || "").trim().toUpperCase();
    const panNumber = String(req.body.pan_number || "").trim().toUpperCase();
    const billingAddress = nullable(req.body.billing_address || req.body.address);
    const shippingAddress =
      req.body.same_as_billing !== false
        ? billingAddress
        : nullable(req.body.shipping_address);
    const openingBalanceType =
      req.body.opening_balance_type === "to_pay" ? "to_pay" : "to_collect";
    const openingBalance = money(req.body.opening_balance);
    const creditPeriodDays = Math.max(
      0,
      Number.parseInt(req.body.credit_period_days, 10) || 0
    );
    const bankAccounts = normalizeBankAccounts(req.body.bank_accounts);

    if (!name) {
      return res.status(400).json({ message: "Party name is required" });
    }
    if (gstin && !GSTIN_PATTERN.test(gstin)) {
      return res.status(400).json({ message: "Enter a valid 15-character GSTIN" });
    }
    if (panNumber && !PAN_PATTERN.test(panNumber)) {
      return res.status(400).json({ message: "Enter a valid PAN number" });
    }
    if (gstin && panNumber && gstin.slice(2, 12) !== panNumber) {
      return res.status(400).json({ message: "PAN does not match the GSTIN" });
    }
    if (bankAccounts.some((account) => !account.bank_name || !account.account_number)) {
      return res.status(400).json({
        message: "Bank name and account number are required for each bank account",
      });
    }
    if (
      bankAccounts.some(
        (account) => account.ifsc_code && !IFSC_PATTERN.test(account.ifsc_code)
      )
    ) {
      return res.status(400).json({ message: "Enter a valid IFSC code" });
    }

    const [existing] = await db.query(
      "SELECT id FROM customers WHERE id = ? AND company_id = ? LIMIT 1",
      [req.params.id, req.user.company_id]
    );
    if (!existing.length) {
      return res.status(404).json({ message: "Customer not found" });
    }

    if (gstin) {
      const [duplicates] = await db.query(
        `SELECT id FROM customers
         WHERE company_id = ? AND gstin = ? AND id <> ? LIMIT 1`,
        [req.user.company_id, gstin, req.params.id]
      );
      if (duplicates.length) {
        return res.status(409).json({ message: "A customer with this GSTIN already exists" });
      }
    }

    connection = await db.getConnection();
    await connection.beginTransaction();
    const [lockedRows] = await connection.query(
      `SELECT id,opening_balance,opening_balance_type FROM customers
       WHERE id=? AND company_id=? LIMIT 1 FOR UPDATE`,
      [req.params.id, req.user.company_id]
    );
    if (!lockedRows.length) {
      const lockError = new Error("Customer not found");
      lockError.status = 404;
      throw lockError;
    }
    const prior = lockedRows[0];
    if (prior.opening_balance_type !== openingBalanceType &&
        (Number(prior.opening_balance || 0) || openingBalance)) {
      const typeError = new Error("Clear the opening balance with an adjustment before changing its direction");
      typeError.status = 409;
      throw typeError;
    }
    const previousSigned = prior.opening_balance_type === "to_pay"
      ? -Number(prior.opening_balance || 0)
      : Number(prior.opening_balance || 0);
    const newSigned = openingBalanceType === "to_pay" ? -openingBalance : openingBalance;
    if (newSigned !== previousSigned) {
      const targetAccount = await resolvePartyControlAccount(
        connection, req.user.company_id, "customer", openingBalanceType
      );
      await recordOpeningBalanceEvent({
        connection,
        companyId: req.user.company_id,
        entityType: "customer",
        entityId: req.params.id,
        targetAccount,
        previousSignedAmount: previousSigned,
        newSignedAmount: newSigned,
        createdBy: req.user.user_id || req.user.id || null,
      });
    }
    await connection.query(
      `UPDATE customers SET
        name = ?, email = ?, phone = ?, address = ?, gstin = ?, pan_number = ?,
        opening_balance = ?, opening_balance_type = ?, party_category = ?,
        billing_address = ?, shipping_address = ?, credit_period_days = ?,
        credit_limit = ?, contact_person_name = ?, contact_person_dob = ?
       WHERE id = ? AND company_id = ?`,
      [
        name,
        email,
        phone,
        billingAddress,
        gstin || null,
        panNumber || (gstin ? gstin.slice(2, 12) : null),
        openingBalance,
        openingBalanceType,
        nullable(req.body.party_category),
        billingAddress,
        shippingAddress,
        creditPeriodDays,
        money(req.body.credit_limit),
        nullable(req.body.contact_person_name),
        nullable(req.body.contact_person_dob),
        req.params.id,
        req.user.company_id,
      ]
    );

    await connection.query(
      "DELETE FROM customer_bank_accounts WHERE customer_id = ? AND company_id = ?",
      [req.params.id, req.user.company_id]
    );
    for (const account of bankAccounts) {
      await connection.query(
        `INSERT INTO customer_bank_accounts (
          customer_id, company_id, account_holder_name, bank_name,
          account_number, ifsc_code, branch_name, is_primary
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          req.params.id,
          req.user.company_id,
          account.account_holder_name,
          account.bank_name,
          account.account_number,
          account.ifsc_code || null,
          account.branch_name,
          account.is_primary ? 1 : 0,
        ]
      );
    }

    await connection.commit();
    return res.json({ message: "Customer updated successfully" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Update customer error:", error);
    return res.status(error.status || 500).json({
      message: "Failed to update customer",
      error: error.message,
    });
  } finally {
    if (connection) connection.release();
  }
};

exports.deleteCustomer = async (req, res) => {
  let connection;
  try {
    if (!req.user?.company_id) {
      return res.status(401).json({ message: "Invalid token" });
    }

    await ensureCustomerPartySchema();
    connection = await db.getConnection();
    await connection.beginTransaction();
    await connection.query(
      "DELETE FROM customer_bank_accounts WHERE customer_id = ? AND company_id = ?",
      [req.params.id, req.user.company_id]
    );
    const [result] = await connection.query(
      "DELETE FROM customers WHERE id = ? AND company_id = ?",
      [req.params.id, req.user.company_id]
    );
    if (!result.affectedRows) {
      await connection.rollback();
      return res.status(404).json({ message: "Customer not found" });
    }
    await connection.commit();
    return res.json({ message: "Customer deleted successfully" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Delete customer error:", error);
    return res.status(500).json({
      message: "Failed to delete customer",
      error: error.message,
    });
  } finally {
    if (connection) connection.release();
  }
};
