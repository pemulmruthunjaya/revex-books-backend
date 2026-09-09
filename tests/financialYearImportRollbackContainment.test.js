const assert = require("node:assert/strict");
const test = require("node:test");
const db = require("../db/connection");
const {
  importMasterData,
  importTransactions,
  rollbackImport,
} = require("../controllers/backupController");

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const withConnection = async (connection, work) => {
  const original = db.getConnection;
  db.getConnection = async () => connection;
  try { await work(); } finally { db.getConnection = original; }
};

const rollbackConnection = (table, { safe = false, action = "created" } = {}) => {
  const calls = [];
  const connection = {
    calls,
    began: false,
    committed: false,
    released: false,
    async beginTransaction() { this.began = true; },
    async commit() { this.committed = true; },
    async rollback() {},
    release() { this.released = true; },
    async query(sql, params = []) {
      const text = String(sql);
      calls.push({ text, params });
      if (text.includes("CREATE TABLE IF NOT EXISTS")) return [{}];
      if (text.includes("FROM data_import_batches")) {
        return [[{ id: 7, company_id: 4, activity_type: "Import", status: "Completed" }]];
      }
      if (text.includes("FROM data_import_changes")) {
        return [[{
          id: 8,
          table_name: table,
          record_id: 22,
          action,
          before_data: action === "updated" ? JSON.stringify({ name: "Before" }) : null,
        }]];
      }
      if (safe && text.includes("SHOW COLUMNS FROM")) return [[{ Field: "id" }, { Field: "company_id" }, { Field: "name" }]];
      if (safe && /^\s*UPDATE `customers`/.test(text)) return [{ affectedRows: 1 }];
      if (safe && text.includes("UPDATE data_import_batches")) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${text}`);
    },
  };
  return connection;
};

test("rollback rejects all financial parents and children before beginning or mutating", async () => {
  const tables = [
    "invoices", "invoice_items", "payments", "bills", "bill_items",
    "vendor_payments", "ledger_entries", "expenses", "journal_entries",
    "journal_entry_details", "accounts", "products",
  ];
  for (const table of tables) {
    const connection = rollbackConnection(table);
    await withConnection(connection, async () => {
      const res = response();
      await rollbackImport({ params: { id: "7" }, user: { company_id: 4 } }, res);
      assert.equal(res.statusCode, 409, table);
      assert.equal(res.body.code, "IMPORT_ROLLBACK_FINANCIAL_HISTORY_RESTRICTED", table);
      assert.equal(connection.began, false, table);
      assert.equal(connection.calls.some(({ text }) => /^\s*(?:INSERT|UPDATE|DELETE)\b/.test(text)), false, table);
    });
  }
});

test("rollback is blocked regardless of whether protected history is OPEN, CLOSED, or LOCKED", async () => {
  for (const status of ["OPEN", "CLOSED", "LOCKED"]) {
    const connection = rollbackConnection("invoices");
    connection.query = async function query(sql, params = []) {
      const text = String(sql);
      this.calls.push({ text, params });
      if (text.includes("CREATE TABLE IF NOT EXISTS")) return [{}];
      if (text.includes("FROM data_import_batches")) return [[{ id: 7, company_id: 4, activity_type: "Import", status: "Completed", source_status: status }]];
      if (text.includes("FROM data_import_changes")) return [[{ table_name: "invoices", record_id: 22, action: "created" }]];
      throw new Error(`Unexpected SQL: ${text}`);
    };
    await withConnection(connection, async () => {
      const res = response();
      await rollbackImport({ params: { id: "7" }, user: { company_id: 4 } }, res);
      assert.equal(res.body.code, "IMPORT_ROLLBACK_FINANCIAL_HISTORY_RESTRICTED");
      assert.equal(connection.began, false);
    });
  }
});

test("a mixed rollback batch fails atomically before safe rows can be reverted", async () => {
  const connection = rollbackConnection("invoices");
  connection.query = async function query(sql, params = []) {
    const text = String(sql);
    this.calls.push({ text, params });
    if (text.includes("CREATE TABLE IF NOT EXISTS")) return [{}];
    if (text.includes("FROM data_import_batches")) return [[{ id: 7, company_id: 4, activity_type: "Import", status: "Completed" }]];
    if (text.includes("FROM data_import_changes")) return [[
      { table_name: "customers", record_id: 1, action: "created" },
      { table_name: "invoices", record_id: 2, action: "created" },
    ]];
    throw new Error(`Unexpected SQL: ${text}`);
  };
  await withConnection(connection, async () => {
    const res = response();
    await rollbackImport({ params: { id: "7" }, user: { company_id: 4 } }, res);
    assert.equal(res.statusCode, 409);
    assert.equal(connection.began, false);
    assert.equal(connection.calls.some(({ text }) => /^\s*DELETE FROM customers/.test(text)), false);
  });
});

test("safe customer attribute rollback remains supported and company scoped", async () => {
  const connection = rollbackConnection("customers", { safe: true, action: "updated" });
  await withConnection(connection, async () => {
    const res = response();
    await rollbackImport({ params: { id: "7" }, user: { company_id: 4 } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(connection.began, true);
    assert.equal(connection.committed, true);
    const update = connection.calls.find(({ text }) => /^\s*UPDATE `customers`/.test(text));
    assert.deepEqual(update.params, ["Before", 22, 4]);
    const batchRead = connection.calls.find(({ text }) => text.includes("FROM data_import_batches"));
    assert.deepEqual(batchRead.params, [7, 4]);
  });
});

test("rollback cannot remove a customer or vendor that may have gained financial references", async () => {
  for (const table of ["customers", "vendors"]) {
    const connection = rollbackConnection(table);
    await withConnection(connection, async () => {
      const res = response();
      await rollbackImport({ params: { id: "7" }, user: { company_id: 4 } }, res);
      assert.equal(res.statusCode, 409);
      assert.equal(res.body.code, "IMPORT_ROLLBACK_FINANCIAL_HISTORY_RESTRICTED");
      assert.equal(connection.began, false);
    });
  }
});

test("account import rejects nonzero, invalid, and client-FY opening data before DB access", async () => {
  const original = db.getConnection;
  let accessed = false;
  db.getConnection = async () => { accessed = true; throw new Error("database must not be accessed"); };
  try {
    for (const row of [
      { "Account Name": "Capital", "Opening Balance": 100 },
      { "Account Name": "Capital", opening_balance: -1 },
      { "Account Name": "Capital", opening: "not-a-number" },
    ]) {
      const res = response();
      await importMasterData({ params: { type: "accounts" }, body: { rows: [row] }, user: { company_id: 4 } }, res);
      assert.equal(res.statusCode, 409);
      assert.equal(res.body.code, "ACCOUNT_IMPORT_OPENING_BALANCE_RESTRICTED");
    }
    for (const key of ["financial_year_id", "Financial Year ID", "financialYearId", "FY ID"]) {
      const res = response();
      await importMasterData({ params: { type: "accounts" }, body: { rows: [{ "Account Name": "Capital", [key]: 41 }] }, user: { company_id: 4 } }, res);
      assert.equal(res.statusCode, 409);
      assert.equal(res.body.code, "ACCOUNT_IMPORT_FINANCIAL_YEAR_NOT_ALLOWED");
    }
    assert.equal(accessed, false);
  } finally {
    db.getConnection = original;
  }
});

const accountImportConnection = ({ existing = false } = {}) => {
  const calls = [];
  return {
    calls,
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async query(sql, params = []) {
      const text = String(sql);
      calls.push({ text, params });
      if (text.includes("CREATE TABLE IF NOT EXISTS")) return [{}];
      if (text === "SHOW TABLES LIKE ?") return [[{ table: "accounts" }]];
      if (text.includes("SHOW COLUMNS FROM `accounts`")) return [[
        { Field: "id" }, { Field: "company_id" }, { Field: "account_code" },
        { Field: "account_name" }, { Field: "account_type" }, { Field: "opening_balance" },
        { Field: "balance_type" }, { Field: "description" }, { Field: "status" },
      ]];
      if (text.includes("SELECT id FROM `accounts`")) return [existing ? [{ id: 31 }] : []];
      if (existing && text.includes("UPDATE `accounts`")) return [{ affectedRows: 1 }];
      if (text.includes("INSERT INTO `accounts`")) return [{ insertId: 31 }];
      if (text.includes("SELECT * FROM `accounts`")) return [[{ id: 31, company_id: 4, opening_balance: 0 }]];
      if (text.includes("INSERT INTO data_import_batches")) return [{ insertId: 61 }];
      if (text.includes("INSERT INTO data_import_changes")) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${text}`);
    },
  };
};

test("blank and zero account openings import safe master fields without writing opening accounting", async () => {
  for (const opening of ["", 0]) {
    const connection = accountImportConnection();
    await withConnection(connection, async () => {
      const res = response();
      await importMasterData({
        params: { type: "accounts" },
        body: { rows: [{ "Account Code": `A-${opening || "blank"}`, "Account Name": "Safe Account", "Account Type": "ASSET", "Opening Balance": opening }] },
        user: { company_id: 4, user_id: 7 },
      }, res);
      assert.equal(res.statusCode, 200);
      const insert = connection.calls.find(({ text }) => text.includes("INSERT INTO `accounts`"));
      assert.doesNotMatch(insert.text, /opening_balance/);
      assert.equal(connection.calls.some(({ text }) => /journal_entries|opening_balance_events/.test(text)), false);
    });
  }
});

test("zero input cannot reset an existing protected account opening balance", async () => {
  const connection = accountImportConnection({ existing: true });
  await withConnection(connection, async () => {
    const res = response();
    await importMasterData({
      params: { type: "accounts" },
      body: { rows: [{ "Account Code": "A-1", "Account Name": "Existing", "Account Type": "ASSET", "Opening Balance": 0 }] },
      user: { company_id: 4, user_id: 7 },
    }, res);
    assert.equal(res.statusCode, 200);
    const update = connection.calls.find(({ text }) => text.includes("UPDATE `accounts`"));
    assert.ok(update);
    assert.doesNotMatch(update.text, /opening_balance/);
    assert.equal(connection.calls.some(({ text }) => /journal_entries|opening_balance_events/.test(text)), false);
  });
});

test("disabled operational imports retain their existing error contract", async () => {
  for (const type of ["sales_invoices", "purchase_bills", "customer_payments", "vendor_payments"]) {
    const res = response();
    await importTransactions({ params: { type }, body: { rows: [{}] }, user: { company_id: 4 } }, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, "OPERATIONAL_IMPORT_ACCOUNTING_PATH_REQUIRED");
  }
});
