const assert = require("node:assert/strict");
const test = require("node:test");

const enabled = process.env.REVEX_MYSQL_INTEGRATION === "1";
let activeDb;
test.after(async () => {
  if (activeDb) await activeDb.end();
});

test("real MySQL multi-receipt transactions, retries, rollback, and concurrency", { skip: !enabled }, async () => {
  const db = require("../db/connection");
  activeDb = db;
  const { createReceipt, ensureReceiptEntrySchema } = require("../services/receiptEntryService");
  const companyId = 4;
  const user = { company_id: companyId, user_id: 13 };
  const marker = `S3B1-${Date.now()}`;

  await ensureReceiptEntrySchema();
  const [[cash]] = await db.query(
    `SELECT id FROM accounts WHERE company_id=? AND status=1
     AND account_type='ASSET' AND LOWER(account_name) REGEXP 'cash|petty cash' LIMIT 1`,
    [companyId]
  );
  assert.ok(cash?.id, "a company-scoped Cash account is required");

  const [customerResult] = await db.query(
    "INSERT INTO customers (name,company_id) VALUES (?,?)",
    [`${marker}-Customer`, companyId]
  );
  const [otherCustomerResult] = await db.query(
    "INSERT INTO customers (name,company_id) VALUES (?,?)",
    [`${marker}-Other`, companyId]
  );
  const customerId = customerResult.insertId;
  const insertInvoice = async (suffix, total, selectedCustomer = customerId, selectedCompany = companyId, createdBy = 13) => {
    const [result] = await db.query(
      `INSERT INTO invoices
       (company_id,created_by,invoice_number,invoice_date,customer_id,customer_name,total_amount,status,payment_status)
       VALUES (?,?,?,CURRENT_DATE,?,?,?,'pending','UNPAID')`,
      [selectedCompany, createdBy, `${marker}-${suffix}`, selectedCustomer, `${marker}-Customer`, total]
    );
    return result.insertId;
  };

  const fullInvoice = await insertInvoice("FULL", 2000);
  const partialInvoice = await insertInvoice("PARTIAL", 4000);
  const singleInvoice = await insertInvoice("SINGLE", 1000);
  const concurrentInvoice = await insertInvoice("CONCURRENT", 1000);
  const overlapA = await insertInvoice("OVERLAP-A", 2000);
  const overlapB = await insertInvoice("OVERLAP-B", 2000);
  const rollbackA = await insertInvoice("ROLLBACK-A", 500);
  const rollbackB = await insertInvoice("ROLLBACK-B", 500);
  const wrongCustomerInvoice = await insertInvoice("WRONG-CUSTOMER", 500, otherCustomerResult.insertId);

  const base = {
    receipt_date: "2026-08-28", receipt_type: "CUSTOMER", customer_id: customerId,
    received_in_account_id: cash.id, payment_mode: "cash", reference_number: marker,
  };

  const single = await createReceipt({
    ...base, invoice_id: singleInvoice, amount: 250, idempotency_key: `${marker}-single`,
  }, user);
  assert.equal(single.invoice_status, "PARTIAL");
  assert.equal(single.allocations.length, 1);

  const multiBody = {
    ...base, amount: 5000, idempotency_key: `${marker}-multi`, allocations: [
      { invoice_id: partialInvoice, amount: 3000 },
      { invoice_id: fullInvoice, amount: 2000 },
    ],
  };
  const multi = await createReceipt(multiBody, user);
  assert.equal(multi.allocations.length, 2);
  assert.equal(multi.payment_id, null);
  const retry = await createReceipt(multiBody, user);
  assert.equal(retry.duplicate, true);
  await assert.rejects(
    createReceipt({ ...multiBody, reference_number: `${marker}-changed` }, user),
    (error) => error.code === "IDEMPOTENCY_KEY_REUSED" && error.status === 409
  );

  const [[multiCounts]] = await db.query(
    `SELECT re.invoice_id,re.payment_id,re.amount,
            COUNT(DISTINCT p.id) payment_count,
            COUNT(DISTINCT je.id) journal_count,
            SUM(p.amount) allocation_total
     FROM receipt_entries re
     LEFT JOIN payments p ON p.receipt_entry_id=re.id AND p.company_id=re.company_id
     LEFT JOIN journal_entries je ON je.source_type='customer_receipt' AND je.source_id=re.id AND je.company_id=re.company_id
     WHERE re.id=? GROUP BY re.id`,
    [multi.id]
  );
  assert.equal(multiCounts.invoice_id, null);
  assert.equal(multiCounts.payment_id, null);
  assert.equal(Number(multiCounts.payment_count), 2);
  assert.equal(Number(multiCounts.journal_count), 1);
  assert.equal(Number(multiCounts.allocation_total), 5000);

  const [statuses] = await db.query(
    "SELECT id,payment_status FROM invoices WHERE id IN (?,?) ORDER BY id",
    [fullInvoice, partialInvoice]
  );
  const statusById = new Map(statuses.map((row) => [Number(row.id), row.payment_status]));
  assert.equal(statusById.get(fullInvoice), "PAID");
  assert.equal(statusById.get(partialInvoice), "PARTIAL");

  await assert.rejects(
    createReceipt({ ...base, amount: 500, idempotency_key: `${marker}-wrong-customer`, allocations: [{ invoice_id: wrongCustomerInvoice, amount: 500 }] }, user),
    /does not belong/
  );
  const [[foreignInvoice]] = await db.query(
    "SELECT id FROM invoices WHERE company_id<>? LIMIT 1",
    [companyId]
  );
  assert.ok(foreignInvoice?.id, "a foreign-company invoice is required for tenant isolation testing");
  await assert.rejects(
    createReceipt({ ...base, amount: 1, idempotency_key: `${marker}-cross-company`, allocations: [{ invoice_id: foreignInvoice.id, amount: 1 }] }, user),
    /not found for this company/
  );
  await assert.rejects(
    createReceipt({ ...base, amount: 1, received_in_account_id: 999999999, idempotency_key: `${marker}-bad-account`, allocations: [{ invoice_id: overlapA, amount: 1 }] }, user),
    /account was not found/
  );

  const [[beforeRollback]] = await db.query(
    "SELECT COUNT(*) journal_count FROM journal_entries WHERE company_id=?",
    [companyId]
  );
  await db.query("ALTER TABLE payments DROP CHECK s3b1_force_allocation_failure").catch(() => {});
  await db.query(
    `ALTER TABLE payments ADD CONSTRAINT s3b1_force_allocation_failure
     CHECK (invoice_id <> ${Number(rollbackB)})`
  );
  await assert.rejects(
    createReceipt({ ...base, amount: 1000, idempotency_key: `${marker}-rollback`, allocations: [
      { invoice_id: rollbackA, amount: 500 }, { invoice_id: rollbackB, amount: 500 },
    ] }, user),
    /constraint|check/i
  );
  await db.query("ALTER TABLE payments DROP CHECK s3b1_force_allocation_failure");
  const [[rollbackCounts]] = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM receipt_entries WHERE company_id=? AND idempotency_key=?) receipts,
       (SELECT COUNT(*) FROM payments WHERE company_id=? AND invoice_id IN (?,?)) payments,
       (SELECT COUNT(*) FROM journal_entries WHERE company_id=?) journals`,
    [companyId, `${marker}-rollback`, companyId, rollbackA, rollbackB, companyId]
  );
  assert.equal(Number(rollbackCounts.receipts), 0);
  assert.equal(Number(rollbackCounts.payments), 0);
  assert.equal(Number(rollbackCounts.journals), Number(beforeRollback.journal_count));

  const concurrent = await Promise.allSettled([
    createReceipt({ ...base, amount: 700, idempotency_key: `${marker}-concurrent-a`, allocations: [{ invoice_id: concurrentInvoice, amount: 700 }] }, user),
    createReceipt({ ...base, amount: 700, idempotency_key: `${marker}-concurrent-b`, allocations: [{ invoice_id: concurrentInvoice, amount: 700 }] }, user),
  ]);
  assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(concurrent.filter((result) => result.status === "rejected").length, 1);
  const [[concurrentPaid]] = await db.query(
    "SELECT COALESCE(SUM(amount),0) paid FROM payments WHERE company_id=? AND invoice_id=?",
    [companyId, concurrentInvoice]
  );
  assert.equal(Number(concurrentPaid.paid), 700);

  const overlapResults = await Promise.all([
    createReceipt({ ...base, amount: 600, idempotency_key: `${marker}-overlap-a`, allocations: [
      { invoice_id: overlapA, amount: 300 }, { invoice_id: overlapB, amount: 300 },
    ] }, user),
    createReceipt({ ...base, amount: 600, idempotency_key: `${marker}-overlap-b`, allocations: [
      { invoice_id: overlapB, amount: 300 }, { invoice_id: overlapA, amount: 300 },
    ] }, user),
  ]);
  assert.equal(overlapResults.length, 2);

  const advance = await createReceipt({
    receipt_date: "2026-08-28", receipt_type: "ADVANCE", customer_id: customerId,
    received_in_account_id: cash.id, amount: 125, payment_mode: "cash",
    idempotency_key: `${marker}-advance`,
  }, user);
  assert.ok(advance.advance_id);
  assert.equal(advance.payment_id, null);

  const [[integrity]] = await db.query(
    `SELECT
      (SELECT COUNT(*) FROM journal_entries je LEFT JOIN
        (SELECT journal_entry_id,SUM(debit) debit,SUM(credit) credit FROM journal_entry_details GROUP BY journal_entry_id) d
        ON d.journal_entry_id=je.id WHERE je.company_id=? AND ROUND(COALESCE(d.debit,0),2)<>ROUND(COALESCE(d.credit,0),2)) unbalanced,
      (SELECT COUNT(*) FROM journal_entry_details d LEFT JOIN journal_entries je ON je.id=d.journal_entry_id WHERE je.id IS NULL) orphan_details,
      (SELECT COUNT(*) FROM payments p LEFT JOIN receipt_entries re ON re.id=p.receipt_entry_id AND re.company_id=p.company_id WHERE p.receipt_entry_id IS NOT NULL AND re.id IS NULL) orphan_receipts,
      (SELECT COUNT(*) FROM payments p LEFT JOIN invoices i ON i.id=p.invoice_id AND i.company_id=p.company_id WHERE i.id IS NULL) orphan_invoices,
      (SELECT COUNT(*) FROM (SELECT i.id,i.total_amount,COALESCE(SUM(p.amount),0) paid FROM invoices i LEFT JOIN payments p ON p.invoice_id=i.id AND p.company_id=i.company_id WHERE i.company_id=? GROUP BY i.id,i.total_amount HAVING paid>i.total_amount) excessive) x`,
    [companyId, companyId]
  );
  assert.deepEqual(Object.values(integrity).map(Number), [0, 0, 0, 0, 0]);

});
