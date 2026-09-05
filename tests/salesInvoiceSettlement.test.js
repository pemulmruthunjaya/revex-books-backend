const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  normalizePaymentMethod,
  pendingReceiptNumber,
  paymentStatusFor,
  postReceipt,
  validateReceiptDestination,
} = require("../services/receiptEntryService");
const { postSalesInvoiceJournal } = require("../services/salesInvoiceAccountingService");
const {
  normalizeSettlement,
  runInvoiceCreationTransaction,
  settlementIdempotencyKey,
  IDEMPOTENCY_LOOKUP_DELAYS_MS,
  INVOICE_DEADLOCK_RETRY_BASE_MS,
  executeInvoiceCreationRequest,
  isInvoiceRequestRace,
  resolveCommittedInvoiceRequest,
} = require("../controllers/invoiceController");

const account = (name, type = "ASSET", parent = "") => ({
  id: 10,
  account_name: name,
  account_type: type,
  parent_account_name: parent,
  description: "",
});

test("settlement temporary receipt numbers are deterministic and bounded", () => {
  const idempotencyKey = `invoice:${"a".repeat(64)}`;
  const otherKey = `invoice:${"b".repeat(64)}`;
  const originalKey = idempotencyKey;
  const pending = pendingReceiptNumber(idempotencyKey);

  assert.equal(idempotencyKey.length, 72);
  assert.equal(pending.length, 56);
  assert.ok(pending.length <= 60);
  assert.match(pending, /^PENDING-[0-9a-f]{48}$/);
  assert.equal(pendingReceiptNumber(idempotencyKey), pending);
  assert.notEqual(pendingReceiptNumber(otherKey), pending);
  assert.equal(idempotencyKey, originalKey);
});

test("new payment methods are canonical lowercase and legacy bank label is accepted", () => {
  for (const method of ["cash", "UPI", "bank", "Card", "cheque", "Other"]) {
    assert.ok(["cash", "upi", "bank", "card", "cheque", "other"].includes(normalizePaymentMethod(method)));
  }
  assert.equal(normalizePaymentMethod("Bank Transfer"), "bank");
  assert.throws(() => normalizePaymentMethod("crypto"), /Unsupported/);
});

test("settlement destination rules distinguish cash from bank-compatible methods", () => {
  assert.doesNotThrow(() => validateReceiptDestination(account("Cash in Hand"), "cash"));
  assert.throws(() => validateReceiptDestination(account("HDFC Bank"), "cash"));
  for (const method of ["bank", "upi", "card", "cheque"]) {
    assert.doesNotThrow(() => validateReceiptDestination(account("HDFC Bank"), method));
    assert.throws(() => validateReceiptDestination(account("Cash in Hand"), method));
  }
  assert.throws(() => validateReceiptDestination(account("Sales", "INCOME"), "other"));
});

test("invoice settlement contract rejects missing account and overpayment", () => {
  assert.equal(normalizeSettlement(undefined, 950), null);
  assert.deepEqual(normalizeSettlement({ amount: 950, payment_method: "Cash", account_id: 4 }, 950), {
    amount: 950,
    paymentMethod: "cash",
    accountId: 4,
    referenceNumber: null,
  });
  assert.throws(() => normalizeSettlement({ amount: 951, payment_method: "cash", account_id: 4 }, 950), /cannot exceed/);
  assert.throws(() => normalizeSettlement({ amount: 1, payment_method: "cash" }, 950), /account_id/);
});

test("payment status is derived from paid total for unpaid, advance and full settlement", () => {
  assert.equal(paymentStatusFor(10000, 0), "UNPAID");
  assert.equal(paymentStatusFor(10000, 2000), "PARTIAL");
  assert.equal(paymentStatusFor(10000, 10000), "PAID");
  assert.equal(paymentStatusFor(10000, 11000), "PAID");
});

test("sales invoice journal posts balanced receivable, sales and GST lines once", async () => {
  const calls = [];
  let accountId = 20;
  const connection = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("FROM journal_entries") && sql.includes("source_type='sales_invoice'")) return [[]];
      if (sql.includes("FROM accounts") && sql.includes("LOWER(account_name)")) {
        const type = params[1] === "Accounts Receivable" ? "ASSET" : params[1] === "Sales" ? "INCOME" : "LIABILITY";
        return [[{ id: accountId++, account_code: params[3], account_name: params[1], account_type: type }]];
      }
      if (sql.includes("INSERT INTO journal_entries")) return [{ insertId: 91 }];
      if (sql.includes("INSERT INTO journal_entry_details")) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const result = await postSalesInvoiceJournal(connection, {
    id: 7, company_id: 4, created_by: 13, invoice_number: "INV-0007",
    invoice_date: "2026-08-26", total_amount: 1180, tax_amount: 180,
  });
  assert.equal(result.debit, 1180);
  assert.equal(result.credit, 1180);
  const journalInsert = calls.find((call) => call.sql.includes("INSERT INTO journal_entries"));
  assert.deepEqual(journalInsert.params.slice(3, 5), [1180, 1180]);
  const lines = calls.filter((call) => call.sql.includes("INSERT INTO journal_entry_details"));
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map((line) => line.params.slice(2, 4)), [[1180, 0], [0, 1000], [0, 180]]);
});

test("walk-in Cash invoice can settle directly by invoice without a dummy customer", async () => {
  const calls = [];
  const connection = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("FROM receipt_entries")) return [[]];
      if (sql.includes("SELECT a.*") && sql.includes("parent_account_name")) return [[account("Cash in Hand")]];
      if (sql.includes("SELECT id, invoice_number")) return [[{
        id: 44, invoice_number: "INV-0044", total_amount: 950,
        status: "pending", customer_id: null, customer_name: "Walk In",
      }]];
      if (sql.includes("SELECT invoice_id, amount") && sql.includes("FROM payments")) {
        return [[]];
      }
      if (sql.includes("FROM accounts") && sql.includes("LOWER(account_name)")) {
        return [[{ id: 24, account_code: "1100", account_name: "Accounts Receivable", account_type: "ASSET" }]];
      }
      if (sql.includes("INSERT INTO receipt_entries")) return [{ insertId: 5 }];
      if (sql.includes("INSERT INTO journal_entries")) return [{ insertId: 6 }];
      if (sql.includes("INSERT INTO payments")) return [{ insertId: 7 }];
      return [{ affectedRows: 1 }];
    },
  };
  const result = await postReceipt(connection, {
    receipt_date: "2026-08-26", receipt_type: "CUSTOMER", invoice_id: 44,
    customer_id: null, received_in_account_id: 10, amount: 950,
    payment_method: "Cash", idempotency_key: "invoice-44-settlement",
  }, { company_id: 4, user_id: 13 }, { financialYear: { id: 2026 } });
  assert.equal(result.invoice_status, "PAID");
  const receiptInsert = calls.find((call) => call.sql.includes("INSERT INTO receipt_entries"));
  assert.equal(receiptInsert.params[3], null);
  const paymentInsert = calls.find((call) => call.sql.includes("INSERT INTO payments"));
  assert.equal(paymentInsert.params[0], 44);
  assert.equal(paymentInsert.params[2], 2026);
  assert.equal(paymentInsert.params[5], "cash");
});

test("caller-owned invoice transaction commits once and rolls back forced failures", async () => {
  const events = [];
  const connection = {
    async beginTransaction() { events.push("begin"); },
    async commit() { events.push("commit"); },
    async rollback() { events.push("rollback"); },
  };
  await runInvoiceCreationTransaction({
    connection, body: {}, user: {},
    createRecord: async () => ({ invoice_id: 1, duplicate: false }),
  });
  assert.deepEqual(events, ["begin", "commit"]);

  events.length = 0;
  await assert.rejects(runInvoiceCreationTransaction({
    connection, body: {}, user: {},
    createRecord: async () => { throw new Error("forced settlement failure"); },
  }), /forced settlement failure/);
  assert.deepEqual(events, ["begin", "rollback"]);

  events.length = 0;
  const duplicate = await runInvoiceCreationTransaction({
    connection, body: {}, user: {},
    createRecord: async () => ({ invoice_id: 1, duplicate: true }),
  });
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(events, ["begin", "rollback"]);
});

test("recognized same-request deadlock and unique-key races resolve the committed winner", async () => {
  assert.equal(isInvoiceRequestRace({ code: "ER_LOCK_DEADLOCK", errno: 1213 }), true);
  assert.equal(isInvoiceRequestRace({
    code: "ER_DUP_ENTRY", errno: 1062,
    sqlMessage: "Duplicate entry for key 'invoices.uq_invoices_company_request'",
  }), true);
  assert.equal(isInvoiceRequestRace({
    code: "ER_DUP_ENTRY", errno: 1062,
    sqlMessage: "Duplicate entry for key 'invoices.invoice_number'",
  }), false);

  const calls = [];
  const winner = await resolveCommittedInvoiceRequest({
    companyId: 4,
    requestId: "same-request",
    delays: [0],
    executor: { async query(sql, params) { calls.push({ sql, params }); return [[{ invoice_id: 91, invoice_number: "INV-0091", payment_status: "PAID" }]]; } },
  });
  assert.deepEqual(winner, {
    message: "Invoice request already processed",
    invoice_id: 91,
    invoice_number: "INV-0091",
    payment_status: "PAID",
    duplicate: true,
  });
  assert.deepEqual(calls[0].params, [4, "same-request"]);
});

test("winner lookup is bounded, waits for visibility, and never recreates financial effects", async () => {
  let lookups = 0;
  const waits = [];
  const laterWinner = await resolveCommittedInvoiceRequest({
    companyId: 4,
    requestId: "delayed-winner",
    delays: [0, 10, 20],
    sleep: async (delay) => waits.push(delay),
    executor: { async query(sql) {
      assert.match(sql, /^SELECT/i);
      lookups += 1;
      return [lookups === 3 ? [{ invoice_id: 92 }] : []];
    } },
  });
  assert.equal(laterWinner.invoice_id, 92);
  assert.equal(lookups, 3);
  assert.deepEqual(waits, [10, 20]);

  lookups = 0;
  const missing = await resolveCommittedInvoiceRequest({
    companyId: 4,
    requestId: "missing-winner",
    delays: [0, 1, 2],
    sleep: async () => {},
    executor: { async query() { lookups += 1; return [[]]; } },
  });
  assert.equal(missing, null);
  assert.equal(lookups, 3);
  assert.deepEqual(IDEMPOTENCY_LOOKUP_DELAYS_MS, [0, 15, 30, 60, 120, 120]);
});

test("non-idempotent deadlocks and unrelated duplicate keys are not replay candidates", () => {
  const source = fs.readFileSync(path.join(__dirname, "../controllers/invoiceController.js"), "utf8");
  assert.match(source, /if \(requestId && isInvoiceRequestRace\(error\)\)/);
  assert.match(executeInvoiceCreationRequest.toString(), /await resolveWinner/);
  assert.doesNotMatch(resolveCommittedInvoiceRequest.toString(), /createInvoiceRecord|UPDATE products|INSERT INTO/);
});

test("different-request deadlocks retry the complete transaction on fresh connections", async () => {
  const events = [];
  let calls = 0;
  const connections = [1, 2, 3].map((id) => ({
    id,
    async beginTransaction() { events.push(`begin-${id}`); },
    async commit() { events.push(`commit-${id}`); },
    async rollback() { events.push(`rollback-${id}`); },
    release() { events.push(`release-${id}`); },
  }));
  const result = await executeInvoiceCreationRequest({
    body: { request_id: "different-request" },
    user: { company_id: 4 },
    connectionProvider: async () => connections[calls],
    createRecord: async ({ connection }) => {
      calls += 1;
      if (calls < 3) throw Object.assign(new Error("deadlock"), { code: "ER_LOCK_DEADLOCK", errno: 1213 });
      return { invoice_id: 99, connection_id: connection.id, duplicate: false };
    },
    resolveWinner: async () => null,
    sleep: async (delay) => events.push(`wait-${delay}`),
    random: () => 0,
  });
  assert.equal(result.status, 201);
  assert.equal(result.invoice.connection_id, 3);
  assert.equal(calls, 3);
  assert.deepEqual(events, [
    "begin-1", "rollback-1", "wait-25", "release-1",
    "begin-2", "rollback-2", "wait-60", "release-2",
    "begin-3", "commit-3", "release-3",
  ]);
});

test("deadlock transaction retries are bounded and non-deadlock failures never retry", async () => {
  const run = async (error, requestId = "request") => {
    let attempts = 0;
    const released = [];
    await assert.rejects(executeInvoiceCreationRequest({
      body: { request_id: requestId },
      user: { company_id: 4 },
      connectionProvider: async () => ({
        async beginTransaction() {}, async rollback() {},
        release() { released.push(true); },
      }),
      createRecord: async () => { attempts += 1; throw error; },
      resolveWinner: async () => null,
      sleep: async () => {},
      random: () => 0,
    }), (thrown) => thrown === error);
    return { attempts, released: released.length };
  };
  assert.deepEqual(await run(Object.assign(new Error("deadlock limit"), { errno: 1213 })), { attempts: 3, released: 3 });
  assert.deepEqual(await run(Object.assign(new Error("validation"), { status: 400 })), { attempts: 1, released: 1 });
  assert.deepEqual(await run(Object.assign(new Error("settlement failure"), { code: "ACCOUNTING_ERROR" })), { attempts: 1, released: 1 });
  assert.deepEqual(await run(Object.assign(new Error("no request deadlock"), { errno: 1213 }), ""), { attempts: 1, released: 1 });
  assert.deepEqual(INVOICE_DEADLOCK_RETRY_BASE_MS, [25, 60]);
});

test("same-request winner resolution precedes and suppresses transaction replay", async () => {
  let attempts = 0;
  const result = await executeInvoiceCreationRequest({
    body: { request_id: "same-request" },
    user: { company_id: 4 },
    connectionProvider: async () => ({
      async beginTransaction() {}, async rollback() {}, release() {},
    }),
    createRecord: async () => { attempts += 1; throw Object.assign(new Error("deadlock"), { errno: 1213 }); },
    resolveWinner: async ({ companyId, requestId }) => {
      assert.deepEqual([companyId, requestId], [4, "same-request"]);
      return { invoice_id: 88, duplicate: true };
    },
  });
  assert.equal(result.status, 200);
  assert.equal(result.invoice.invoice_id, 88);
  assert.equal(attempts, 1);
});

test("invoice and journal idempotency wiring precedes stock effects", async () => {
  assert.equal(settlementIdempotencyKey("same-request", 4, 1), settlementIdempotencyKey("same-request", 4, 99));
  assert.notEqual(settlementIdempotencyKey("same-request", 4, 1), settlementIdempotencyKey("other-request", 4, 1));
  assert.ok(settlementIdempotencyKey("x".repeat(80), 4, 1).length <= 80);

  let inserts = 0;
  const duplicateConnection = {
    async query(sql) {
      if (sql.includes("FROM journal_entries")) return [[{ id: 91, journal_no: "SINV-4-7" }]];
      inserts += 1;
      return [{ insertId: 1 }];
    },
  };
  const duplicate = await postSalesInvoiceJournal(duplicateConnection, {
    id: 7, company_id: 4, created_by: 13, invoice_number: "INV-0007",
    invoice_date: "2026-08-26", total_amount: 1180, tax_amount: 180,
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(inserts, 0);

  const source = fs.readFileSync(path.join(__dirname, "../controllers/invoiceController.js"), "utf8");
  const createBody = source.slice(source.indexOf("const createInvoiceRecord"), source.indexOf("exports.createInvoiceRecord"));
  assert.ok(createBody.indexOf("request_id=?") < createBody.indexOf("UPDATE products"));
  assert.ok(createBody.indexOf("UPDATE products") < createBody.indexOf("postSalesInvoiceJournal"));
  assert.ok(createBody.indexOf("postSalesInvoiceJournal") < createBody.indexOf("postReceipt"));
  assert.match(createBody, /payment_status/);
  assert.match(source, /POSTED_INVOICE_EDIT_NOT_ALLOWED/);
  assert.match(source, /POSTED_INVOICE_DELETE_NOT_ALLOWED/);

  const receiptSource = fs.readFileSync(path.join(__dirname, "../services/receiptEntryService.js"), "utf8");
  const reusableBody = receiptSource.slice(receiptSource.indexOf("const postReceipt"), receiptSource.indexOf("const createReceipt"));
  assert.doesNotMatch(reusableBody, /beginTransaction|\.commit\(|\.rollback\(/);
});
