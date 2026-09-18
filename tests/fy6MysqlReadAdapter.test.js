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
      if (sql.includes("FROM vendors WHERE id"))
        return [[{ id: 1, company_id: 7, name: "V" }]];
      if (sql.includes("FROM bills"))
        return [[{ id: 3, company_id: 7, vendor_id: 1, total: 10 }]];
      if (sql.includes("FROM vendor_payments"))
        return [
          [{ id: 1, company_id: 7, vendor_id: 1, bill_id: null, amount: 5 }],
        ];
      if (sql.includes("COUNT(*)"))
        return [[{ billMismatches: 0, paymentMismatches: 0 }]];
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
