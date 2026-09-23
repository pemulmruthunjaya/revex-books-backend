"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  Fy6MysqlReadAdapter,
  fingerprint,
} = require("../scripts/fy6c-legacy-vendor-repair-mysql-adapter");
function fake() {
  const calls = [];
  const conn = {
    query: async (sql, args) => {
      calls.push({ sql, args });
      if (sql.includes("COUNT(*) AS mismatchCount"))
        return [[{ mismatchCount: 0 }]];
      if (sql.includes("FROM vendors WHERE id"))
        return [[{ id: 1, company_id: 7, name: "V" }]];
      if (sql.includes("FROM bills"))
        return [[{ id: 3, company_id: 7, vendor_id: 1, total: 10 }]];
      if (sql.includes("FROM vendor_payments"))
        return [
          [{ id: 1, company_id: 7, vendor_id: 1, bill_id: null, amount: 5 }],
        ];
      return [[]];
    },
    release() {
      this.released = (this.released || 0) + 1;
    },
  };
  const pool = {
    getConnection: async () => {
      pool.acquired = (pool.acquired || 0) + 1;
      return conn;
    },
    query() {
      throw Error("POOL_QUERY_FORBIDDEN");
    },
  };
  return { pool, conn, calls };
}
test("FY6 read adapter leases one connection and releases once", async () => {
  const f = fake(),
    a = new Fy6MysqlReadAdapter(f.pool);
  assert.deepEqual(await a.getVendorById(1), {
    id: 1,
    company_id: 7,
    name: "V",
  });
  await a.release();
  await a.release();
  assert.equal(f.pool.acquired, 1);
  assert.equal(f.conn.released, 1);
  await assert.rejects(a.getBillForRepair(3), /FY6_ADAPTER_RELEASED/);
  assert.ok(f.calls.every((x) => x.args));
  assert.deepEqual(await a.getOperationLedger(), []);
});
test("production repair getters normalize bill and payment identities", async () => {
  const calls = [];
  const rows = {
    bill: {
      id: 3,
      company_id: 6,
      vendor_id: 1,
      vendor_company_id: 1,
      transaction_date: "2026-03-03",
      status: "Unpaid",
      financial_year_id: 10,
    },
    payment: {
      id: 1,
      company_id: 7,
      vendor_id: 1,
      vendor_company_id: 1,
      transaction_date: "2026-03-04",
      bill_id: null,
      status: "SUCCESS",
      financial_year_id: 12,
    },
  };
  const conn = {
    async query(sql, args) {
      calls.push([sql, args]);
      if (sql.includes("FROM bills b LEFT JOIN vendors v")) return [[rows.bill]];
      if (sql.includes("FROM vendor_payments p LEFT JOIN vendors v"))
        return [[rows.payment]];
      return [[]];
    },
    release() {},
  };
  const adapter = new Fy6MysqlReadAdapter({ getConnection: async () => conn });
  assert.deepEqual(await adapter.getBillForRepair(3), rows.bill);
  assert.deepEqual(await adapter.getVendorPaymentForRepair(1), rows.payment);
  assert.equal((await adapter.getVendorPaymentForRepair(1)).bill_id, null);
  assert.ok(
    calls.every(
      ([sql, args]) =>
        sql.startsWith("SELECT ") &&
        !sql.includes("SELECT *") &&
        sql.includes("LEFT JOIN vendors v ON v.id=") &&
        sql.includes("DATE_FORMAT(") &&
        sql.endsWith("WHERE " + (sql.includes("FROM bills b") ? "b" : "p") + ".id=? LIMIT 1") &&
        args.length === 1 &&
        Number.isInteger(args[0]),
    ),
  );

  rows.bill = { ...rows.bill, vendor_company_id: null };
  rows.payment = { ...rows.payment, vendor_company_id: null, bill_id: 3 };
  assert.equal((await adapter.getBillForRepair(3)).vendor_company_id, null);
  const linked = await adapter.getVendorPaymentForRepair(1);
  assert.equal(linked.vendor_company_id, null);
  assert.equal(linked.bill_id, 3);
  await adapter.release();
});
test("FY6 evidence fingerprints are deterministic", async () => {
  const f = fake(),
    a = new Fy6MysqlReadAdapter(f.pool);
  const e = await a.getPaymentEvidence(1);
  assert.equal(e.billId, null);
  assert.match(e.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(e.fingerprint, fingerprint(e.protectedFields));
  const copy = await a.getOperationLedger();
  copy.push({ x: 1 });
  assert.deepEqual(await a.getOperationLedger(), []);
  await a.release();
});
test("FY6 population evidence pristine control is deterministic", async () => {
  const f = fake(),
    a = new Fy6MysqlReadAdapter(f.pool),
    m = require("../scripts/fy6c-legacy-vendor-repair-manifest.json");
  const x = await a.getPopulationEvidence(m),
    y = await a.getPopulationEvidence(m);
  assert.deepEqual(x.equivalentTargetVendors, []);
  assert.equal(x.fingerprint, y.fingerprint);
  assert.match(x.fingerprint, /^[0-9a-f]{64}$/);
  await a.release();
});
test("equivalent candidates require full copied-field fingerprint", async () => {
  const calls=[]; const src={id:1,company_id:7,name:"V",status:"ACTIVE"}; const exact={id:10,company_id:6,name:"V",status:"ACTIVE"}; const wrong={id:11,company_id:6,name:"V",status:"INACTIVE"}; const dup={id:12,company_id:6,name:"V",status:"ACTIVE"};
  const c={query:async(s,a)=>{calls.push([s,a]);if(s.includes("COUNT(*) AS mismatchCount"))return [[{mismatchCount:s.includes("FROM bills b")?6:2}]];if(s.includes("FROM bills WHERE"))return [[]];if(s.includes("FROM vendor_payments WHERE"))return [[]];if(s.includes("FROM vendors WHERE id"))return [[{...src,id:a[0],company_id:1}]];if(s.includes("WHERE company_id=?"))return [a[0]===6?[exact,wrong,dup]:[]];return [[]]},release(){}}; const a=new Fy6MysqlReadAdapter({getConnection:async()=>c}); const m=require("../scripts/fy6c-legacy-vendor-repair-manifest.json"); const e=await a.getPopulationEvidence(m); assert.deepEqual(e.equivalentTargetVendors.filter(x=>x.groupId==="G1").map(x=>x.equivalentVendorId),[10,12]); assert.ok(calls.every(([s])=>s.startsWith("SELECT"))); await a.release();
});
test("dynamic mismatch counts are consistent for pristine repaired and missing-vendor state", async () => {
  const manifest = require("../scripts/fy6c-legacy-vendor-repair-manifest.json");
  const calls = [];
  const vendors = new Map(
    [1, 2, 3, 5].map((id) => [
      id,
      { id, company_id: 1, name: `V${id}`, status: "Active" },
    ]),
  );
  const bills = new Map(
    manifest.transactions
      .filter((t) => t.record_type === "BILL")
      .map((t) => [
        t.record_id,
        {
          id: t.record_id,
          company_id: t.expected_company_id,
          vendor_id: t.expected_current_vendor_id,
        },
      ]),
  );
  const payments = new Map(
    manifest.transactions
      .filter((t) => t.record_type === "VENDOR_PAYMENT")
      .map((t) => [
        t.record_id,
        {
          id: t.record_id,
          company_id: t.expected_company_id,
          vendor_id: t.expected_current_vendor_id,
          bill_id: null,
        },
      ]),
  );
  const conn = {
    async query(sql, args) {
      calls.push([sql, args]);
      if (sql.includes("COUNT(*) AS mismatchCount")) {
        const rows = sql.includes("FROM bills b") ? bills : payments;
        const mismatchCount = args.filter((id) => {
          const row = rows.get(id), vendor = row && vendors.get(row.vendor_id);
          return row && (!vendor || row.company_id !== vendor.company_id);
        }).length;
        return [[{ mismatchCount }]];
      }
      if (sql.includes("FROM bills b LEFT JOIN vendors v"))
        return [[bills.get(args[0])].filter(Boolean)];
      if (sql.includes("FROM vendor_payments p LEFT JOIN vendors v"))
        return [[payments.get(args[0])].filter(Boolean)];
      if (sql === "SELECT * FROM vendors WHERE id=? LIMIT 1")
        return [[vendors.get(args[0])].filter(Boolean)];
      if (sql.includes("FROM vendors WHERE company_id=? AND name=?"))
        return [[...vendors.values()].filter(
          (v) => v.company_id === args[0] && v.name === args[1],
        )];
      return [[]];
    },
    release() {},
  };
  const adapter = new Fy6MysqlReadAdapter({ getConnection: async () => conn });
  const pristinePopulation = await adapter.getPopulationEvidence(manifest);
  assert.deepEqual(
    {
      billMismatches: pristinePopulation.billMismatches,
      paymentMismatches: pristinePopulation.paymentMismatches,
    },
    { billMismatches: 6, paymentMismatches: 2 },
  );
  assert.deepEqual(await adapter.getInitialState(manifest), {
    billMismatches: 6,
    paymentMismatches: 2,
  });
  assert.deepEqual(await adapter.getGlobalPostState(manifest), {
    billMismatches: 6,
    paymentMismatches: 2,
  });

  const targetIds = new Map(manifest.groups.map((g, i) => [g.group_id, 100 + i]));
  for (const g of manifest.groups) {
    const source = vendors.get(g.source_vendor_id), id = targetIds.get(g.group_id);
    vendors.set(id, { ...source, id, company_id: g.target_company_id });
    for (const record of g.records) {
      const rows = record.record_type === "BILL" ? bills : payments;
      rows.get(record.record_id).vendor_id = id;
    }
  }
  const repairedPopulation = await adapter.getPopulationEvidence(manifest);
  assert.deepEqual(
    {
      billMismatches: repairedPopulation.billMismatches,
      paymentMismatches: repairedPopulation.paymentMismatches,
    },
    { billMismatches: 0, paymentMismatches: 0 },
  );
  assert.deepEqual(await adapter.getInitialState(manifest), {
    billMismatches: 0,
    paymentMismatches: 0,
  });
  assert.deepEqual(await adapter.getGlobalPostState(manifest), {
    billMismatches: 0,
    paymentMismatches: 0,
  });

  vendors.delete(targetIds.get("G1"));
  assert.deepEqual(await adapter.getInitialState(manifest), {
    billMismatches: 1,
    paymentMismatches: 0,
  });
  assert.ok(
    calls
      .filter(([sql]) => sql.includes("COUNT(*) AS mismatchCount"))
      .every(
        ([sql, args]) =>
          sql.includes("LEFT JOIN vendors") &&
          sql.includes("v.id IS NULL") &&
          args.every(Number.isInteger),
      ),
  );
  await adapter.release();
});

function productionFingerprintFake() {
  const manifest = require("../scripts/fy6c-legacy-vendor-repair-manifest.json");
  const state = {
    journal_entries: [{ id: 1, journal_no: "J1", journal_date: "2026-03-03", narration: null, total_debit: "10.00", total_credit: "10.00", created_by: 1, status: 1, created_at: "2026-03-03T01:02:03.000000", updated_at: "2026-03-03T01:02:03.000000", company_id: 6, vendor_id: 1, source_type: "BILL", source_id: 3, financial_year_id: 10 }],
    journal_entry_details: [{ id: 1, journal_entry_id: 1, account_id: 1, debit: "10.00", credit: "0.00", description: "expense", created_at: "2026-03-03T01:02:03.000000" }],
    ledger_entries: [{ id: 1, company_id: 6, entity_type: "ACCOUNT", entity_id: 1, reference_type: "BILL", reference_id: 3, debit: "10.00", credit: "0.00", transaction_date: "2026-03-03", created_at: "2026-03-03T01:02:03.000000", financial_year_id: 10 }],
    accounts: [{ id: 1, account_code: "A1", account_name: "Expense", account_type: "EXPENSE", parent_account_id: null, opening_balance: "0.00", balance_type: "DEBIT", description: null, status: 1, created_at: "2026-01-01T00:00:00.000000", updated_at: "2026-01-01T00:00:00.000000", company_id: 6 }],
    bills: manifest.transactions.filter((t) => t.record_type === "BILL").map((t) => ({ id: t.record_id, bill_number: `B${t.record_id}`, bill_date: t.expected_transaction_date, due_date: null, total_amount: "10.00", paid_amount: "0.00", due_amount: "10.00", status: t.expected_status, company_id: t.expected_company_id, created_at: "2026-03-03T01:02:03.000000", vendor_id: t.expected_current_vendor_id, source_purchase_order_id: null, source_grn_id: null, stock_posted: 1, financial_year_id: t.expected_financial_year_id })),
    bill_items: [{ id: 1, bill_id: 3, source_grn_item_id: 1, product_id: 1, product_name: "P", quantity: 1, price: "10.00", total: "10.00", gst_percent: "0.00", cgst: "0.00", sgst: "0.00", mrp: "10.00" }],
    vendor_payments: manifest.transactions.filter((t) => t.record_type === "VENDOR_PAYMENT").map((t) => ({ id: t.record_id, vendor_id: t.expected_current_vendor_id, bill_id: null, amount: "5.00", payment_date: t.expected_transaction_date, payment_method: "CASH", paid_from_account_id: 1, reference_number: null, notes: null, company_id: t.expected_company_id, created_by: 1, journal_entry_id: 1, idempotency_key: `P${t.record_id}`, status: t.expected_status, created_at: "2026-03-04T01:02:03.000000", financial_year_id: t.expected_financial_year_id })),
    products: [{ id: 1, name: "P", sellingPrice: "12.00", stock: 5, created_at: "2026-01-01T00:00:00.000000", company_id: 6, mrp: "12.00", sku: "SKU", barcode: null, hsn: null, category: null, unit: "PCS", gst: "0.00", purchase_price: "10.00", opening_stock: "5.00", reorder_level: "1.00", status: "ACTIVE", batch_no: null, manufactured_date: null, expiry_date: null }],
    inventory_transactions: [{ id: 1, company_id: 6, branch_id: null, product_id: 1, transaction_type: "IN", reference_type: "GRN", reference_id: 1, quantity_in: "5.00", quantity_out: "0.00", transaction_date: "2026-03-03", created_by: 1, created_at: "2026-03-03T01:02:03.000000" }],
    goods_receipts: [{ id: 1, company_id: 6, branch_id: null, grn_number: "G1", purchase_order_id: 1, vendor_id: 1, grn_date: "2026-03-03", challan_number: null, challan_date: null, status: "Posted", stock_posted: 1, notes: null, created_by: 1, posted_by: 1, posted_at: "2026-03-03T01:02:03.000000", created_at: "2026-03-03T01:02:03.000000", updated_at: "2026-03-03T01:02:03.000000" }],
    goods_receipt_items: [{ id: 1, company_id: 6, goods_receipt_id: 1, purchase_order_item_id: 1, product_id: 1, received_qty: "5.00", rejected_qty: "0.00", accepted_qty: "5.00", notes: null, created_at: "2026-03-03T01:02:03.000000" }],
  };
  const vendors = new Map([1, 2, 3, 5].map((id) => [id, { id, company_id: 1, name: `V${id}` }]));
  const calls = [];
  const conn = {
    async query(sql, args = []) {
      calls.push([sql, args]);
      if (sql.includes("COUNT(*) AS mismatchCount"))
        return [[{ mismatchCount: sql.includes("FROM bills b") ? 6 : 2 }]];
      if (sql.includes("FROM bills b LEFT JOIN vendors v"))
        return [[state.bills.find((row) => row.id === args[0])].filter(Boolean)];
      if (sql.includes("FROM vendor_payments p LEFT JOIN vendors v"))
        return [[state.vendor_payments.find((row) => row.id === args[0])].filter(Boolean)];
      if (sql === "SELECT * FROM vendors WHERE id=? LIMIT 1")
        return [[vendors.get(args[0])].filter(Boolean)];
      if (sql.includes("FROM vendors WHERE company_id=? AND name=?")) return [[]];
      const match = sql.match(/ FROM `([^`]+)` ORDER BY `id` ASC$/);
      if (match) {
        const table = match[1];
        if (conn.missingTable === table) throw Object.assign(Error("missing"), { code: "ER_NO_SUCH_TABLE" });
        if (conn.missingColumn && sql.includes(`\`${conn.missingColumn}\``)) throw Object.assign(Error("missing"), { code: "ER_BAD_FIELD_ERROR" });
        const controlled = new Set(args);
        return [state[table].map((row) => ({ ...row, ...(controlled.has(row.id) && Object.hasOwn(row, "vendor_id") ? { vendor_id: null } : {}) }))];
      }
      return [[]];
    },
    release() {},
  };
  return { manifest, state, calls, conn, adapter: new Fy6MysqlReadAdapter({ getConnection: async () => conn }) };
}

test("production-real accounting and stock fingerprints are scoped and deterministic", async () => {
  const f = productionFingerprintFake();
  await assert.rejects(f.adapter.getAccountingFingerprint(), /FY6_FINGERPRINT_SCOPE_REQUIRED/);
  await f.adapter.getPopulationEvidence(f.manifest);
  const accounting = await f.adapter.getAccountingFingerprint();
  const stock = await f.adapter.getStockFingerprint();
  assert.match(accounting, /^[0-9a-f]{64}$/);
  assert.match(stock, /^[0-9a-f]{64}$/);
  assert.equal(await f.adapter.getAccountingFingerprint(), accounting);
  assert.equal(await f.adapter.getStockFingerprint(), stock);
  assert.ok(f.calls.filter(([sql]) => / FROM `/.test(sql)).every(([sql]) => !sql.includes("SELECT *") && sql.endsWith("ORDER BY `id` ASC")));
  assert.ok(f.calls.every(([sql]) => !/accounting_entries|stock_movements/.test(sql)));
  await f.adapter.release();
});

test("only manifest-controlled bill and payment vendor ids are normalized", async () => {
  const f = productionFingerprintFake();
  await f.adapter.getPopulationEvidence(f.manifest);
  const accounting = await f.adapter.getAccountingFingerprint(), stock = await f.adapter.getStockFingerprint();
  f.state.bills[0].vendor_id = 100;
  f.state.vendor_payments[0].vendor_id = 101;
  assert.equal(await f.adapter.getAccountingFingerprint(), accounting);
  assert.equal(await f.adapter.getStockFingerprint(), stock);
  f.state.bills.push({ ...f.state.bills[0], id: 99, vendor_id: 1 });
  const withUncontrolled = await f.adapter.getAccountingFingerprint();
  const withUncontrolledStock = await f.adapter.getStockFingerprint();
  f.state.bills.at(-1).vendor_id = 2;
  assert.notEqual(await f.adapter.getAccountingFingerprint(), withUncontrolled);
  assert.notEqual(await f.adapter.getStockFingerprint(), withUncontrolledStock);
  f.state.vendor_payments.push({ ...f.state.vendor_payments[0], id: 99, vendor_id: 1 });
  const paymentBaseline = await f.adapter.getAccountingFingerprint();
  f.state.vendor_payments.at(-1).vendor_id = 2;
  assert.notEqual(await f.adapter.getAccountingFingerprint(), paymentBaseline);
  await f.adapter.release();
});

test("all production-real protected fields participate in fingerprints", async () => {
  for (const kind of ["accounting", "stock"]) {
    const f = productionFingerprintFake();
    await f.adapter.getPopulationEvidence(f.manifest);
    const getter = kind === "accounting" ? "getAccountingFingerprint" : "getStockFingerprint";
    const tables = kind === "accounting"
      ? ["journal_entries", "journal_entry_details", "ledger_entries", "accounts", "bills", "bill_items", "vendor_payments"]
      : ["products", "inventory_transactions", "bill_items", "bills", "goods_receipts", "goods_receipt_items"];
    for (const table of tables) {
      for (const key of Object.keys(f.state[table][0])) {
        if (key === "vendor_id" && ((table === "bills" && f.state[table][0].id <= 8) || table === "vendor_payments")) continue;
        const before = await f.adapter[getter]();
        const old = f.state[table][0][key];
        f.state[table][0][key] = old === null ? "changed" : typeof old === "number" ? old + 1 : `${old}-changed`;
        assert.notEqual(await f.adapter[getter](), before, `${kind}.${table}.${key}`);
        f.state[table][0][key] = old;
      }
      const beforeInsert = await f.adapter[getter]();
      f.state[table].push({ ...f.state[table][0], id: 999 });
      assert.notEqual(await f.adapter[getter](), beforeInsert, `${kind}.${table}.insert`);
      f.state[table].pop();
    }
    await f.adapter.release();
  }
});

test("fingerprint schema and scope failures are fail closed", async () => {
  const expanded = JSON.parse(JSON.stringify(require("../scripts/fy6c-legacy-vendor-repair-manifest.json")));
  expanded.groups[0].records.push({ record_type: "BILL", record_id: 999 });
  const scope = productionFingerprintFake();
  await assert.rejects(scope.adapter.getPopulationEvidence(expanded), /FY6_FINGERPRINT_SCOPE_INVALID/);
  await scope.adapter.release();
  for (const failure of [{ missingTable: "accounts" }, { missingColumn: "total_debit" }]) {
    const f = productionFingerprintFake();
    Object.assign(f.conn, failure);
    await f.adapter.getPopulationEvidence(f.manifest);
    await assert.rejects(f.adapter.getAccountingFingerprint(), (error) => error.code === "FY6_FINGERPRINT_SCHEMA_CONTRACT");
    await f.adapter.release();
  }
});
