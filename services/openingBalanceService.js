const SOURCE_TYPE = "opening_balance";
const { requireFinancialYearForPosting, requireFinancialYearForMutation } = require("./financialYearService");
const BALANCE_SHEET_TYPES = new Set(["ASSET", "LIABILITY", "EQUITY"]);

const money = (value) => Math.round(Number(value || 0) * 100) / 100;
const naturalSide = (accountType) => accountType === "ASSET" ? "DEBIT" : "CREDIT";

const signedAccountOpening = (amount, accountType) => {
  const type = String(accountType || "").toUpperCase();
  const value = money(amount);
  if (value && !BALANCE_SHEET_TYPES.has(type)) {
    const error = new Error("Opening balances are supported only for Asset, Liability, and Equity accounts");
    error.status = 400;
    throw error;
  }
  return type === "ASSET" ? value : -value;
};

const ensureLedger = async (connection, companyId, definition) => {
  const { name, code, type, aliases = [], codeAliases = [], description } = definition;
  const names = [name, ...aliases];
  const codes = [code, ...codeAliases];
  const namePlaceholders = names.map(() => "LOWER(?)").join(",");
  const codePlaceholders = codes.map(() => "?").join(",");
  const [rows] = await connection.query(
    `SELECT id,account_code,account_name,account_type
     FROM accounts
     WHERE company_id=? AND status=1
       AND (LOWER(account_name) IN (${namePlaceholders}) OR account_code IN (${codePlaceholders}))
     ORDER BY CASE WHEN LOWER(account_name)=LOWER(?) THEN 0 ELSE 1 END,id
     LIMIT 1 FOR UPDATE`,
    [companyId, ...names, ...codes, name]
  );
  if (rows.length) {
    if (String(rows[0].account_type).toUpperCase() !== type) {
      const error = new Error(`${rows[0].account_name} exists with an invalid account type`);
      error.status = 409;
      throw error;
    }
    return rows[0];
  }
  const [result] = await connection.query(
    `INSERT INTO accounts
     (account_code,account_name,account_type,opening_balance,balance_type,description,status,company_id)
     VALUES (?,?,?,0,?,?,1,?)`,
    [code, name, type, naturalSide(type), description, companyId]
  );
  return { id: result.insertId, account_code: code, account_name: name, account_type: type };
};

const ensureOpeningBalanceEquity = (connection, companyId) => ensureLedger(connection, companyId, {
  code: `SYS-OBE-${companyId}`,
  name: "Opening Balance Equity",
  type: "EQUITY",
  description: "System counter-ledger for journalized opening balances",
});

const resolvePartyControlAccount = async (connection, companyId, entityType, openingType) => {
  if (entityType === "customer" && openingType === "to_collect") {
    return ensureLedger(connection, companyId, {
      code: `SYS-AR-${companyId}`, name: "Accounts Receivable", type: "ASSET",
      aliases: ["Customer Receivables"], codeAliases: ["1100"],
      description: "Customer receivables control account",
    });
  }
  if (entityType === "customer") {
    return ensureLedger(connection, companyId, {
      code: `SYS-CC-${companyId}`, name: "Customer Credits", type: "LIABILITY",
      aliases: ["Customer Advances"], codeAliases: ["2150", `SYS-ADV-${companyId}`],
      description: "Customer credit balances control account",
    });
  }
  if (entityType === "vendor" && openingType === "to_pay") {
    return ensureLedger(connection, companyId, {
      code: `SYS-AP-${companyId}`, name: "Accounts Payable", type: "LIABILITY",
      aliases: ["Vendor Payables", "Creditors", "Sundry Creditors"], codeAliases: ["2100", "0003"],
      description: "Vendor payables control account",
    });
  }
  return ensureLedger(connection, companyId, {
    code: `SYS-VA-${companyId}`, name: "Vendor Advances", type: "ASSET",
    aliases: ["Vendor Credits"], codeAliases: ["1300"],
    description: "Vendor debit balances control account",
  });
};

const recordOpeningBalanceEvent = async ({
  connection, companyId, entityType, entityId, targetAccount,
  previousSignedAmount = 0, newSignedAmount = 0, createdBy = null,
}) => {
  const delta = money(newSignedAmount - previousSignedAmount);
  if (!delta) return { posted: false, delta: 0 };

  const [[dateRow]] = await connection.query("SELECT DATE_FORMAT(CURRENT_DATE,'%Y-%m-%d') opening_date");
  const openingDate = dateRow.opening_date;
  if (previousSignedAmount) {
    const [existingRows] = await connection.query(
      `SELECT je.financial_year_id
       FROM opening_balance_events obe
       INNER JOIN journal_entries je ON je.id=obe.journal_entry_id AND je.company_id=obe.company_id
       WHERE obe.company_id=? AND obe.entity_type=? AND obe.entity_id=?
       ORDER BY obe.sequence_no DESC LIMIT 1 FOR UPDATE`,
      [companyId, entityType, entityId]
    );
    if (!existingRows.length) {
      const error = new Error("Existing opening balance accounting history was not found");
      error.status = 409;
      error.code = "OPENING_BALANCE_HISTORY_NOT_FOUND";
      throw error;
    }
    await requireFinancialYearForMutation(companyId, existingRows[0].financial_year_id, connection);
  }
  const financialYear = await requireFinancialYearForPosting(companyId, openingDate, connection);

  const equity = await ensureOpeningBalanceEquity(connection, companyId);
  if (Number(equity.id) === Number(targetAccount.id)) {
    const error = new Error("Opening Balance Equity cannot carry its own opening balance");
    error.status = 400;
    throw error;
  }
  const [sequenceRows] = await connection.query(
    `SELECT COALESCE(MAX(sequence_no),0) sequence_no
     FROM opening_balance_events
     WHERE company_id=? AND entity_type=? AND entity_id=? FOR UPDATE`,
    [companyId, entityType, entityId]
  );
  const sequence = Number(sequenceRows[0]?.sequence_no || 0) + 1;
  const eventKind = sequence === 1 && !previousSignedAmount ? "initial" : "adjustment";
  const [eventResult] = await connection.query(
    `INSERT INTO opening_balance_events
     (company_id,entity_type,entity_id,sequence_no,event_kind,signed_delta,target_account_id,created_by)
     VALUES (?,?,?,?,?,?,?,?)`,
    [companyId, entityType, entityId, sequence, eventKind, delta, targetAccount.id, createdBy]
  );
  const eventId = eventResult.insertId;
  const amount = Math.abs(delta);
  const narration = `${eventKind === "initial" ? "Opening balance" : "Opening balance adjustment"} - ${targetAccount.account_name}`;
  const [journalResult] = await connection.query(
    `INSERT INTO journal_entries
     (journal_no,journal_date,narration,total_debit,total_credit,created_by,company_id,financial_year_id,source_type,source_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [`OB-${companyId}-${eventId}`, openingDate, narration, amount, amount, createdBy, companyId, financialYear.id, SOURCE_TYPE, eventId]
  );
  const journalId = journalResult.insertId;
  const debitAccount = delta > 0 ? targetAccount.id : equity.id;
  const creditAccount = delta > 0 ? equity.id : targetAccount.id;
  await connection.query(
    `INSERT INTO journal_entry_details
     (journal_entry_id,account_id,debit,credit,description) VALUES
     (?,?,?,0,?),(?,?,0,?,?)`,
    [journalId, debitAccount, amount, narration, journalId, creditAccount, amount, narration]
  );
  await connection.query(
    `UPDATE opening_balance_events SET journal_entry_id=?
     WHERE id=? AND company_id=? AND journal_entry_id IS NULL`,
    [journalId, eventId, companyId]
  );
  return { posted: true, delta, eventId, journalId, sequence };
};

module.exports = {
  SOURCE_TYPE,
  ensureLedger,
  ensureOpeningBalanceEquity,
  naturalSide,
  recordOpeningBalanceEvent,
  resolvePartyControlAccount,
  signedAccountOpening,
};
