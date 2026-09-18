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
    m = {
      groups: [1, 2, 3, 4, 5].map((n) => ({
        group_id: `G${n}`,
        source_vendor_id: 1,
        target_company_id: 6,
        records: [],
      })),
    };
  const x = await a.getPopulationEvidence(m),
    y = await a.getPopulationEvidence(m);
  assert.deepEqual(x.equivalentTargetVendors, []);
  assert.equal(x.fingerprint, y.fingerprint);
  assert.match(x.fingerprint, /^[0-9a-f]{64}$/);
  await a.release();
});
test("equivalent candidates require full copied-field fingerprint", async () => {
  const calls=[]; const src={id:1,company_id:7,name:"V",status:"ACTIVE"}; const exact={id:10,company_id:6,name:"V",status:"ACTIVE"}; const wrong={id:11,company_id:6,name:"V",status:"INACTIVE"}; const dup={id:12,company_id:6,name:"V",status:"ACTIVE"};
  const c={query:async(s,a)=>{calls.push([s,a]);if(s.includes("WHERE id=?"))return [[src]];if(s.includes("WHERE company_id=?"))return [[exact,wrong,dup]];return [[]]},release(){}}; const a=new Fy6MysqlReadAdapter({getConnection:async()=>c}); const m={groups:[{group_id:"G1",source_vendor_id:1,target_company_id:6,records:[]}]}; const e=await a.getPopulationEvidence(m); assert.deepEqual(e.equivalentTargetVendors.map(x=>x.equivalentVendorId),[10,12]); assert.ok(calls.every(([s])=>s.startsWith("SELECT"))); await a.release();
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
      if (sql === "SELECT * FROM bills WHERE id=? LIMIT 1")
        return [[bills.get(args[0])].filter(Boolean)];
      if (sql === "SELECT * FROM vendor_payments WHERE id=? LIMIT 1")
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
