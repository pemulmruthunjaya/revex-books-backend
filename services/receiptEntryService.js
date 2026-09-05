const crypto = require("node:crypto");
const db = require("../db/connection");
const { requireFinancialYearForDate, rejectClientFinancialYear } = require("./financialYearService");

const RECEIPT_TYPES = Object.freeze(["CUSTOMER", "OTHER", "ADVANCE"]);
const CREDIT_ACCOUNT_TYPES = new Set(["INCOME", "LIABILITY", "EQUITY", "CAPITAL"]);
const CASH_PATTERN = /(cash|petty cash)/i;
const BANK_PATTERN = /(bank|current account|savings account)/i;
const EXCLUDED_CREDIT_PATTERN =
  /(cash|bank|salary|wages|expense|purchase|receivable|debtor)/i;
const receiptJournalSourceType = (receiptType) =>
  receiptType === "CUSTOMER" ? "customer_receipt" : "receipt_entry";
const pendingReceiptNumber = (idempotencyKey) =>
  `PENDING-${crypto
    .createHash("sha256")
    .update(idempotencyKey)
    .digest("hex")
    .slice(0, 48)}`;

let schemaReady = false;

const ensurePaymentsReceiptColumn = async () => {
  const [columns] = await db.query(
    "SHOW COLUMNS FROM payments LIKE 'receipt_entry_id'"
  );
  if (!columns.length) {
    await db.query(
      "ALTER TABLE payments ADD COLUMN receipt_entry_id BIGINT UNSIGNED NULL"
    );
  }
  const [uniqueIndexes] = await db.query(
    "SHOW INDEX FROM payments WHERE Key_name = 'uq_payments_receipt_entry'"
  );
  if (uniqueIndexes.length) {
    await db.query("DROP INDEX uq_payments_receipt_entry ON payments");
  }
  const [indexes] = await db.query(
    "SHOW INDEX FROM payments WHERE Key_name = 'idx_payments_receipt_entry'"
  );
  if (!indexes.length) {
    await db.query(
      "CREATE INDEX idx_payments_receipt_entry ON payments (receipt_entry_id)"
    );
  }
};

const ensureReceiptEntrySchema = async () => {
  if (schemaReady) return;

  await db.query(`
    CREATE TABLE IF NOT EXISTS receipt_entries (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      receipt_number VARCHAR(60) NOT NULL,
      receipt_date DATE NOT NULL,
      receipt_type ENUM('CUSTOMER','OTHER','ADVANCE') NOT NULL,
      customer_id BIGINT UNSIGNED NULL,
      invoice_id BIGINT UNSIGNED NULL,
      received_in_account_id BIGINT UNSIGNED NOT NULL,
      received_from_account_id BIGINT UNSIGNED NOT NULL,
      amount DECIMAL(15,2) NOT NULL,
      payment_mode VARCHAR(40) NOT NULL,
      reference_number VARCHAR(120) NULL,
      narration VARCHAR(500) NULL,
      company_id BIGINT UNSIGNED NOT NULL,
      created_by BIGINT UNSIGNED NOT NULL,
      journal_entry_id BIGINT UNSIGNED NULL,
      payment_id BIGINT UNSIGNED NULL,
      advance_id BIGINT UNSIGNED NULL,
      idempotency_key VARCHAR(80) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_receipt_company_number (company_id, receipt_number),
      UNIQUE KEY uq_receipt_company_idempotency (company_id, idempotency_key),
      KEY idx_receipt_company_date (company_id, receipt_date),
      KEY idx_receipt_customer (company_id, customer_id),
      KEY idx_receipt_invoice (company_id, invoice_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS customer_advances (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      company_id BIGINT UNSIGNED NOT NULL,
      customer_id BIGINT UNSIGNED NOT NULL,
      receipt_entry_id BIGINT UNSIGNED NOT NULL,
      original_amount DECIMAL(15,2) NOT NULL,
      unapplied_amount DECIMAL(15,2) NOT NULL,
      status ENUM('UNAPPLIED','PARTIALLY_APPLIED','APPLIED','CANCELLED') NOT NULL DEFAULT 'UNAPPLIED',
      created_by BIGINT UNSIGNED NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_customer_advance_receipt (company_id, receipt_entry_id),
      KEY idx_customer_advances_customer (company_id, customer_id, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  await ensurePaymentsReceiptColumn();
  schemaReady = true;
};

const accountSearchText = (account) =>
  [
    account.account_name,
    account.parent_account_name,
    account.description,
  ]
    .filter(Boolean)
    .join(" ");

const isCashBankAccount = (account) =>
  String(account.account_type || "").toUpperCase() === "ASSET" &&
  (CASH_PATTERN.test(accountSearchText(account)) ||
    BANK_PATTERN.test(accountSearchText(account)));

const isCashAccount = (account) =>
  String(account.account_type || "").toUpperCase() === "ASSET" &&
  CASH_PATTERN.test(accountSearchText(account));

const isBankAccount = (account) =>
  String(account.account_type || "").toUpperCase() === "ASSET" &&
  BANK_PATTERN.test(accountSearchText(account));

const isOtherCreditAccount = (account) =>
  CREDIT_ACCOUNT_TYPES.has(String(account.account_type || "").toUpperCase()) &&
  !EXCLUDED_CREDIT_PATTERN.test(accountSearchText(account));

const listAccountOptions = async (companyId) => {
  const [accounts] = await db.query(
    `SELECT a.id, a.account_code, a.account_name, a.account_type, a.description,
            p.account_name AS parent_account_name
     FROM accounts a
     LEFT JOIN accounts p
       ON p.id = a.parent_account_id AND p.company_id = a.company_id
     WHERE a.company_id = ? AND a.status = 1
     ORDER BY a.account_name`,
    [companyId]
  );

  return {
    received_in_accounts: accounts.filter(isCashBankAccount),
    other_credit_accounts: accounts.filter(isOtherCreditAccount),
  };
};

const ensureSystemAccount = async (
  connection,
  companyId,
  { code, name, type, alternateCode = code, alternateName = name, description = "System ledger used by Receipt Entry" }
) => {
  const [rows] = await connection.query(
    `SELECT id, account_code, account_name, account_type
     FROM accounts
     WHERE company_id = ?
       AND status = 1
       AND (LOWER(account_name) IN (LOWER(?), LOWER(?)) OR account_code IN (?, ?))
     ORDER BY id
     LIMIT 1`,
    [companyId, name, alternateName, code, alternateCode]
  );
  if (rows.length) {
    if (String(rows[0].account_type).toUpperCase() !== type) {
      throw Object.assign(
        new Error(`${name} ledger exists with an invalid account type`),
        { status: 409 }
      );
    }
    return rows[0];
  }

  const [result] = await connection.query(
    `INSERT INTO accounts
     (account_code, account_name, account_type, opening_balance,
      balance_type, description, company_id)
     VALUES (?, ?, ?, 0, ?, ?, ?)`,
    [
      code,
      name,
      type,
      type === "ASSET" ? "DEBIT" : "CREDIT",
      description,
      companyId,
    ]
  );
  return { id: result.insertId, account_code: code, account_name: name, account_type: type };
};

const getCustomerOpenInvoices = async (companyId, customerId) => {
  const [customers] = await db.query(
    "SELECT id, name FROM customers WHERE id = ? AND company_id = ? LIMIT 1",
    [customerId, companyId]
  );
  if (!customers.length) return null;

  const [invoices] = await db.query(
    `SELECT i.id, i.invoice_number, i.invoice_date, i.total_amount,
            COALESCE(SUM(p.amount), 0) AS already_paid,
            GREATEST(i.total_amount - COALESCE(SUM(p.amount), 0), 0) AS outstanding_amount
     FROM invoices i
     LEFT JOIN payments p
       ON p.invoice_id = i.id AND p.company_id = i.company_id
     WHERE i.company_id = ?
       AND i.customer_name = ?
       AND LOWER(COALESCE(i.status, 'pending')) <> 'cancelled'
     GROUP BY i.id, i.invoice_number, i.invoice_date, i.total_amount
     HAVING outstanding_amount > 0
     ORDER BY i.invoice_date, i.id`,
    [companyId, customers[0].name]
  );
  return { customer: customers[0], invoices };
};

const clean = (value, maxLength) => {
  const text = String(value || "").trim();
  return text ? text.slice(0, maxLength) : null;
};

const moneyToMinor = (value, field = "Amount") => {
  if (value === null || value === undefined || value === "") {
    throw Object.assign(new Error(`${field} is required`), { status: 400 });
  }
  const text = String(value).trim();
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) {
    throw Object.assign(new Error(`${field} must have at most two decimal places`), { status: 400 });
  }
  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [whole, fraction = ""] = unsigned.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor)) {
    throw Object.assign(new Error(`${field} is outside the supported range`), { status: 400 });
  }
  return negative ? -minor : minor;
};

const minorToMoney = (minor) => Number((Number(minor) / 100).toFixed(2));

const normalizeCustomerAllocations = (body) => {
  const hasAllocations = body.allocations !== undefined;
  const source = hasAllocations
    ? body.allocations
    : [{ invoice_id: body.invoice_id, amount: body.amount }];
  if (!Array.isArray(source) || source.length === 0) {
    throw Object.assign(new Error("Allocations must be a non-empty array"), { status: 400 });
  }

  const seen = new Set();
  const allocations = source.map((allocation, index) => {
    const invoiceId = Number(allocation?.invoice_id);
    if (!Number.isSafeInteger(invoiceId) || invoiceId <= 0) {
      throw Object.assign(new Error(`Allocation ${index + 1} has an invalid invoice_id`), { status: 400 });
    }
    if (seen.has(invoiceId)) {
      throw Object.assign(new Error("Duplicate invoice allocations are not allowed"), { status: 400 });
    }
    seen.add(invoiceId);
    const amountMinor = moneyToMinor(allocation?.amount, `Allocation ${index + 1} amount`);
    if (amountMinor <= 0) {
      throw Object.assign(new Error("Allocation amounts must be greater than zero"), { status: 400 });
    }
    return { invoiceId, amountMinor, amount: minorToMoney(amountMinor) };
  });

  allocations.sort((left, right) => left.invoiceId - right.invoiceId);
  const receiptMinor = moneyToMinor(body.amount, "Receipt amount");
  if (receiptMinor <= 0) {
    throw Object.assign(new Error("Amount must be greater than zero"), { status: 400 });
  }
  const allocatedMinor = allocations.reduce((sum, allocation) => sum + allocation.amountMinor, 0);
  if (allocatedMinor !== receiptMinor) {
    throw Object.assign(new Error("Allocation total must equal receipt amount"), { status: 400 });
  }
  return { allocations, receiptMinor, isMulti: hasAllocations && allocations.length > 1 };
};

const PAYMENT_METHODS = Object.freeze(["cash", "upi", "bank", "card", "cheque", "other"]);
const normalizePaymentMethod = (value) => {
  const text = String(value || "").trim().toLowerCase();
  const aliases = { "bank transfer": "bank", "bank_transfer": "bank" };
  const method = aliases[text] || text;
  if (!PAYMENT_METHODS.includes(method)) {
    throw Object.assign(new Error("Unsupported payment method"), {
      status: 400,
      code: "INVALID_PAYMENT_METHOD",
    });
  }
  return method;
};

const validateReceiptDestination = (account, method) => {
  const valid = method === "cash"
    ? isCashAccount(account)
    : ["bank", "upi", "card", "cheque"].includes(method)
      ? isBankAccount(account)
      : isCashBankAccount(account);
  if (!valid) {
    throw Object.assign(new Error(`Selected account is not valid for ${method}`), {
      status: 400,
      code: "INVALID_SETTLEMENT_ACCOUNT",
    });
  }
};

const paymentStatusFor = (total, paid) => {
  const invoiceTotal = moneyToMinor(total || 0, "Invoice total");
  const paidTotal = moneyToMinor(paid || 0, "Paid total");
  if (paidTotal >= invoiceTotal) return "PAID";
  if (paidTotal > 0) return "PARTIAL";
  return "UNPAID";
};

const dateKey = (value) => {
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  return String(value || "").slice(0, 10);
};

const assertIdempotentReceiptEquivalent = async (executor, existing, body, companyId) => {
  const receiptType = String(body.receipt_type || "").toUpperCase();
  const method = normalizePaymentMethod(body.payment_mode || body.payment_method || "cash");
  const expectedAmountMinor = moneyToMinor(body.amount, "Receipt amount");
  const sameHeader =
    receiptType === String(existing.receipt_type || "").toUpperCase() &&
    dateKey(body.receipt_date) === dateKey(existing.receipt_date) &&
    Number(body.received_in_account_id) === Number(existing.received_in_account_id) &&
    Number(body.customer_id || 0) === Number(existing.customer_id || 0) &&
    expectedAmountMinor === moneyToMinor(existing.amount, "Existing receipt amount") &&
    method === String(existing.payment_mode || "").toLowerCase() &&
    clean(body.reference_number, 120) === clean(existing.reference_number, 120) &&
    clean(body.narration, 500) === clean(existing.narration, 500) &&
    (receiptType !== "OTHER" || Number(body.received_from_account_id) === Number(existing.received_from_account_id));
  if (!sameHeader) {
    throw Object.assign(new Error("Idempotency key was already used with different receipt details"), {
      status: 409,
      code: "IDEMPOTENCY_KEY_REUSED",
    });
  }

  if (receiptType === "CUSTOMER") {
    const expected = normalizeCustomerAllocations(body).allocations;
    const [rows] = await executor.query(
      `SELECT invoice_id, amount FROM payments
       WHERE company_id = ? AND receipt_entry_id = ?
       ORDER BY invoice_id`,
      [companyId, existing.id]
    );
    const equivalent = rows.length === expected.length && rows.every((row, index) =>
      Number(row.invoice_id) === expected[index].invoiceId &&
      moneyToMinor(row.amount, "Existing allocation amount") === expected[index].amountMinor
    );
    if (!equivalent) {
      throw Object.assign(new Error("Idempotency key was already used with different allocations"), {
        status: 409,
        code: "IDEMPOTENCY_KEY_REUSED",
      });
    }
  }
};

const postReceipt = async (connection, body, user, context = {}) => {
  rejectClientFinancialYear(body);
  const companyId = Number(user.company_id);
  const createdBy = Number(user.user_id);
  const receiptType = String(body.receipt_type || "").toUpperCase();
  const amountMinor = moneyToMinor(body.amount, "Receipt amount");
  const amount = minorToMoney(amountMinor);
  const idempotencyKey = clean(body.idempotency_key, 80);
  const paymentMethod = normalizePaymentMethod(body.payment_mode || body.payment_method || "cash");
  const allocationPlan = receiptType === "CUSTOMER"
    ? normalizeCustomerAllocations(body)
    : null;

  if (!body.receipt_date) throw Object.assign(new Error("Receipt date is required"), { status: 400 });
  const financialYear = context.financialYear ||
    await requireFinancialYearForDate(companyId, body.receipt_date, connection);
  if (!RECEIPT_TYPES.includes(receiptType)) {
    throw Object.assign(new Error("Valid receipt type is required"), { status: 400 });
  }
  if (!body.received_in_account_id) {
    throw Object.assign(new Error("Received In account is required"), { status: 400 });
  }
  if (amountMinor <= 0) {
    throw Object.assign(new Error("Amount must be greater than zero"), { status: 400 });
  }
  if (!idempotencyKey) {
    throw Object.assign(new Error("Submission key is required"), { status: 400 });
  }
  if (receiptType === "ADVANCE" && !body.customer_id) {
    throw Object.assign(new Error("Customer is required"), { status: 400 });
  }
  if (receiptType === "CUSTOMER" && body.allocations !== undefined && !body.customer_id) {
    throw Object.assign(new Error("Customer is required for multi-invoice allocations"), { status: 400 });
  }
  if (receiptType === "OTHER" && !body.received_from_account_id) {
    throw Object.assign(new Error("Received From account is required"), { status: 400 });
  }

  const [duplicates] = await connection.query(
      `SELECT id, receipt_number, receipt_date, receipt_type, customer_id,
              received_in_account_id, received_from_account_id, amount,
              payment_mode, reference_number, narration, journal_entry_id
       FROM receipt_entries
       WHERE company_id = ? AND idempotency_key = ?
       LIMIT 1`,
      [companyId, idempotencyKey]
    );
  if (duplicates.length) {
    await assertIdempotentReceiptEquivalent(connection, duplicates[0], body, companyId);
    return { ...duplicates[0], duplicate: true };
  }

    const [receivedInRows] = await connection.query(
      `SELECT a.*, p.account_name AS parent_account_name
       FROM accounts a
       LEFT JOIN accounts p
         ON p.id = a.parent_account_id AND p.company_id = a.company_id
       WHERE a.id = ? AND a.company_id = ? AND a.status = 1
       LIMIT 1
       FOR UPDATE`,
      [body.received_in_account_id, companyId]
    );
  if (!receivedInRows.length) {
    throw Object.assign(new Error("Received In account was not found for this company"), { status: 400 });
  }
  validateReceiptDestination(receivedInRows[0], paymentMethod);

    let customer = null;
    let invoices = [];
    let singleInvoice = null;
    let receivedFromAccount = null;

    if (body.customer_id) {
      const [customers] = await connection.query(
        "SELECT id, name FROM customers WHERE id = ? AND company_id = ? LIMIT 1 FOR UPDATE",
        [body.customer_id, companyId]
      );
      if (!customers.length) {
        throw Object.assign(new Error("Customer not found"), { status: 404 });
      }
      customer = customers[0];
    }

  if (receiptType === "CUSTOMER") {
      const invoiceIds = allocationPlan.allocations.map((allocation) => allocation.invoiceId);
      const placeholders = invoiceIds.map(() => "?").join(",");
      const [lockedInvoices] = await connection.query(
        `SELECT id, invoice_number, total_amount, status, customer_id, customer_name
         FROM invoices
         WHERE company_id = ? AND id IN (${placeholders})
         ORDER BY id
         FOR UPDATE`,
        [companyId, ...invoiceIds]
      );
      if (lockedInvoices.length !== invoiceIds.length) {
        throw Object.assign(new Error("One or more invoices were not found for this company"), { status: 404 });
      }
      const invoiceById = new Map(lockedInvoices.map((invoice) => [Number(invoice.id), invoice]));
      invoices = allocationPlan.allocations.map((allocation) => {
        const invoice = invoiceById.get(allocation.invoiceId);
        if (customer && Number(invoice.customer_id) !== Number(customer.id) &&
            !(invoice.customer_id == null && invoice.customer_name === customer.name)) {
          throw Object.assign(new Error("Selected invoice does not belong to this customer"), { status: 400 });
        }
        if (String(invoice.status || "").toLowerCase() === "cancelled") {
          throw Object.assign(new Error("A cancelled invoice cannot receive payment"), { status: 400 });
        }
        return { ...invoice, allocation };
      });

      const [paidRows] = await connection.query(
        `SELECT invoice_id, amount
         FROM payments
         WHERE company_id = ? AND invoice_id IN (${placeholders})
         ORDER BY invoice_id, id
         FOR UPDATE`,
        [companyId, ...invoiceIds]
      );
      const paidByInvoice = paidRows.reduce((totals, row) => {
        const invoiceId = Number(row.invoice_id);
        totals.set(invoiceId, (totals.get(invoiceId) || 0) + moneyToMinor(row.amount || 0, "Paid amount"));
        return totals;
      }, new Map());
      invoices = invoices.map((invoice) => {
        const alreadyPaidMinor = paidByInvoice.get(Number(invoice.id)) || 0;
        const totalMinor = moneyToMinor(invoice.total_amount, "Invoice total");
        const outstandingMinor = Math.max(totalMinor - alreadyPaidMinor, 0);
        if (invoice.allocation.amountMinor > outstandingMinor) {
          throw Object.assign(
            new Error(`Allocation cannot exceed outstanding amount for invoice ${invoice.invoice_number}`),
            { status: 400 }
          );
        }
        return { ...invoice, alreadyPaidMinor, totalMinor, outstandingMinor };
      });
      singleInvoice = invoices.length === 1 ? invoices[0] : null;
      receivedFromAccount = await ensureSystemAccount(connection, companyId, {
        code: `SYS-AR-${companyId}`,
        name: "Accounts Receivable",
        type: "ASSET",
        alternateCode: "1100",
        alternateName: "Customer Receivables",
      });
    } else if (receiptType === "ADVANCE") {
      receivedFromAccount = await ensureSystemAccount(connection, companyId, {
        code: `SYS-ADV-${companyId}`,
        name: "Customer Advances",
        type: "LIABILITY",
      });
    } else {
      const [creditAccounts] = await connection.query(
        `SELECT a.*, p.account_name AS parent_account_name
         FROM accounts a
         LEFT JOIN accounts p
           ON p.id = a.parent_account_id AND p.company_id = a.company_id
         WHERE a.id = ? AND a.company_id = ? AND a.status = 1
         LIMIT 1
         FOR UPDATE`,
        [body.received_from_account_id, companyId]
      );
      if (!creditAccounts.length || !isOtherCreditAccount(creditAccounts[0])) {
        throw Object.assign(
          new Error("Received From must be a valid income, liability, or capital ledger"),
          { status: 400 }
        );
      }
      receivedFromAccount = creditAccounts[0];
    }

    if (Number(receivedFromAccount.id) === Number(receivedInRows[0].id)) {
      throw Object.assign(
        new Error("Received In and Received From cannot be the same ledger"),
        { status: 400 }
      );
    }

    const pendingNumber = pendingReceiptNumber(idempotencyKey);
    const [receiptResult] = await connection.query(
      `INSERT INTO receipt_entries
       (receipt_number, receipt_date, receipt_type, customer_id, invoice_id,
        received_in_account_id, received_from_account_id, amount, payment_mode,
        reference_number, narration, company_id, created_by, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        pendingNumber,
        body.receipt_date,
        receiptType,
        customer?.id || null,
        singleInvoice?.id || null,
        receivedInRows[0].id,
        receivedFromAccount.id,
        amount,
        paymentMethod,
        clean(body.reference_number, 120),
        clean(body.narration, 500),
        companyId,
        createdBy,
        idempotencyKey,
      ]
    );

    const receiptId = receiptResult.insertId;
    const year = String(body.receipt_date).slice(0, 4);
    const receiptNumber = `RCPT-${year}-${String(receiptId).padStart(6, "0")}`;
    await connection.query(
      "UPDATE receipt_entries SET receipt_number = ? WHERE id = ?",
      [receiptNumber, receiptId]
    );

    const [journalResult] = await connection.query(
      `INSERT INTO journal_entries
       (journal_no, journal_date, narration, total_debit, total_credit, company_id,
        financial_year_id, source_type, source_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        receiptNumber,
        body.receipt_date,
        clean(body.narration, 500) || `${receiptType} receipt`,
        amount,
        amount,
        companyId,
        financialYear.id,
        receiptJournalSourceType(receiptType),
        receiptId,
      ]
    );
    const journalId = journalResult.insertId;
    await connection.query(
      `INSERT INTO journal_entry_details
       (journal_entry_id, account_id, debit, credit, description)
       VALUES (?, ?, ?, 0, ?), (?, ?, 0, ?, ?)`,
      [
        journalId,
        receivedInRows[0].id,
        amount,
        receiptNumber,
        journalId,
        receivedFromAccount.id,
        amount,
        receiptNumber,
      ]
    );

    let paymentId = null;
    let advanceId = null;
    let invoiceStatus = null;
    let remainingAmount = null;
    let allocations = [];

    if (receiptType === "CUSTOMER") {
      for (const invoice of invoices) {
        const [paymentResult] = await connection.query(
          `INSERT INTO payments
           (invoice_id, company_id, financial_year_id, amount, payment_date, payment_method,
            reference_number, receipt_entry_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            invoice.id,
            companyId,
            financialYear.id,
            invoice.allocation.amount,
            body.receipt_date,
            paymentMethod,
            clean(body.reference_number, 120),
            receiptId,
          ]
        );
        const totalPaidMinor = invoice.alreadyPaidMinor + invoice.allocation.amountMinor;
        const invoiceRemainingMinor = Math.max(invoice.totalMinor - totalPaidMinor, 0);
        const status = paymentStatusFor(minorToMoney(invoice.totalMinor), minorToMoney(totalPaidMinor));
        await connection.query(
          `UPDATE invoices
           SET payment_status=?,
               status=CASE
                 WHEN LOWER(COALESCE(status,'')) IN ('pending','partial','paid') THEN LOWER(?)
                 ELSE status
               END
           WHERE id=? AND company_id=?`,
          [status, status, invoice.id, companyId]
        );
        allocations.push({
          payment_id: paymentResult.insertId,
          invoice_id: Number(invoice.id),
          amount: invoice.allocation.amount,
          invoice_status: status,
          remaining_amount: minorToMoney(invoiceRemainingMinor),
        });
      }
      if (allocations.length === 1) {
        paymentId = allocations[0].payment_id;
        invoiceStatus = allocations[0].invoice_status;
        remainingAmount = allocations[0].remaining_amount;
      }
    }

    if (receiptType === "ADVANCE") {
      const [advanceResult] = await connection.query(
        `INSERT INTO customer_advances
         (company_id, customer_id, receipt_entry_id, original_amount,
          unapplied_amount, status, created_by)
         VALUES (?, ?, ?, ?, ?, 'UNAPPLIED', ?)`,
        [companyId, customer.id, receiptId, amount, amount, createdBy]
      );
      advanceId = advanceResult.insertId;
    }

    await connection.query(
      `UPDATE receipt_entries
       SET journal_entry_id = ?, payment_id = ?, advance_id = ?
       WHERE id = ? AND company_id = ?`,
      [journalId, paymentId, advanceId, receiptId, companyId]
    );

    return {
      id: receiptId,
      receipt_number: receiptNumber,
      journal_entry_id: journalId,
      payment_id: paymentId,
      advance_id: advanceId,
      invoice_status: invoiceStatus,
      remaining_amount: remainingAmount,
      allocations,
      duplicate: false,
    };
};

const createReceipt = async (body, user) => {
  await ensureReceiptEntrySchema();
  const connection = await db.getConnection();
  const idempotencyKey = clean(body.idempotency_key, 80);
  try {
    await connection.beginTransaction();
    const result = await postReceipt(connection, body, user);
    if (result.duplicate) await connection.rollback();
    else await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    if (error.code === "ER_DUP_ENTRY" && idempotencyKey) {
      const [duplicates] = await db.query(
        `SELECT id, receipt_number, receipt_date, receipt_type, customer_id,
                received_in_account_id, received_from_account_id, amount,
                payment_mode, reference_number, narration, journal_entry_id
         FROM receipt_entries
         WHERE company_id=? AND idempotency_key=? LIMIT 1`,
        [Number(user.company_id), idempotencyKey]
      );
      if (duplicates.length) {
        await assertIdempotentReceiptEquivalent(db, duplicates[0], body, Number(user.company_id));
        return { ...duplicates[0], duplicate: true };
      }
    }
    throw error;
  } finally {
    connection.release();
  }
};

module.exports = {
  RECEIPT_TYPES,
  createReceipt,
  postReceipt,
  ensureReceiptEntrySchema,
  getCustomerOpenInvoices,
  ensureSystemAccount,
  isCashBankAccount,
  isCashAccount,
  isBankAccount,
  isOtherCreditAccount,
  listAccountOptions,
  receiptJournalSourceType,
  normalizePaymentMethod,
  validateReceiptDestination,
  paymentStatusFor,
  pendingReceiptNumber,
  moneyToMinor,
  minorToMoney,
  normalizeCustomerAllocations,
  assertIdempotentReceiptEquivalent,
};
