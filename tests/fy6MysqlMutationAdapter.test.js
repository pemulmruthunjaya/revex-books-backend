"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  Fy6MysqlReadAdapter,
} = require("../scripts/fy6c-legacy-vendor-repair-mysql-adapter");
function pool(fail, insertId = 9) {
  const calls = [];
  const c = {
    query: async (s, a) => {
      calls.push([s, a]);
      if (s.startsWith("INSERT")) return [{ affectedRows: 1, ...(insertId === "missing" ? {} : { insertId }) }];
      if (s.startsWith("UPDATE")) return [{ affectedRows: fail ? 0 : 1 }];
      return [[]];
    },
    release() {
      c.released = (c.released || 0) + 1;
    },
  };
  return { calls, c, p: { getConnection: async () => c } };
}
test("typed mutations and ledger commit on leased connection", async () => {
  const f = pool(),
    a = new Fy6MysqlReadAdapter(f.p);
  await a.beginTransaction("G2");
  const v = await a.insertVendorCopy({ id: 1, company_id: 7, name: "V" }, 4);
  assert.equal(v.groupId, "G2");
  await a.updateBillVendor(4, 7, 1, 9);
  await a.updateVendorPaymentVendor(1, 7, 1, 9);
  await a.updateVendorPaymentVendor(2, 7, 1, 9);
  await a.commit();
  const l = await a.getOperationLedger();
  assert.equal(l.length, 4);
  assert.ok(l.every((x) => x.state === "COMMITTED"));
  assert.ok(
    f.calls.every(
      (x) =>
        x[0].includes("?") || x[0].includes("TRANSACTION") || x[0] === "COMMIT",
    ),
  );
  await a.release();
  assert.equal(f.c.released, 1);
});
test("rollback marks attempted operations and no retry", async () => {
  const f = pool(),
    a = new Fy6MysqlReadAdapter(f.p);
  await a.beginTransaction("G3");
  await a.insertVendorCopy({ id: 1, company_id: 7, name: "V" }, 4);
  await a.rollback();
  assert.equal((await a.getOperationLedger()).filter(x => x.state === "ROLLED_BACK").length, 1);
  await assert.rejects(a.commit(), /FY6_TX_REQUIRED/);
  await a.release();
});
test("mutation return failures remain rollback-capable", async () => {
  for (const kind of ["insert", "bill", "payment"]) {
    const f = kind === "insert" ? pool(false, 0) : pool(true),
      a = new Fy6MysqlReadAdapter(f.p);
    await a.beginTransaction("G2");
    if (kind === "insert")
      await assert.rejects(
        a.insertVendorCopy({ id: 1, company_id: 7, name: "V" }, 4),
        /VENDOR_INSERT_INVALID/,
      );
    else if (kind === "bill")
      await assert.rejects(a.updateBillVendor(4, 7, 1, 9), /UPDATE_ROW_COUNT/);
    else
      await assert.rejects(
        a.updateVendorPaymentVendor(1, 7, 1, 9),
        /UPDATE_ROW_COUNT/,
      );
    await a.rollback();
    assert.equal(f.calls.filter((x) => x[0] === "COMMIT").length, 0);
    await a.release();
  }
});
test("uncertain commit is not retried", async () => {
  const f = pool();
  const original = f.c.query;
  f.c.query = async (s, a) => {
    if (s === "COMMIT") {
      f.calls.push([s, a]);
      throw Error("UNCERTAIN_COMMIT");
    }
    return original(s, a);
  };
  const ad = new Fy6MysqlReadAdapter(f.p);
  await ad.beginTransaction("G1");
  await assert.rejects(ad.commit(), /UNCERTAIN_COMMIT/);
  assert.equal(f.calls.filter((x) => x[0] === "COMMIT").length, 1);
  assert.equal(f.calls.filter((x) => x[0] === "ROLLBACK").length, 0);
  await ad.rollback();
  await ad.release();
});
test("mutation SQL allowlist is parameterized", async () => {
  const f = pool(),
    a = new Fy6MysqlReadAdapter(f.p);
  await a.beginTransaction("G2");
  await a.insertVendorCopy({ id: 1, company_id: 7, name: "V" }, 4);
  await a.updateBillVendor(4, 7, 1, 9);
  await a.updateVendorPaymentVendor(1, 7, 1, 9);
  for (const [sql, args] of f.calls.filter((x) =>
    /^(INSERT|UPDATE)/.test(x[0]),
  )) {
    assert.ok(sql.includes("?"));
    assert.ok(!/DELETE|ALTER|CREATE|DROP|TRUNCATE/i.test(sql));
    assert.ok(args.length > 0);
  }
  await a.rollback();
  await a.release();
});
test("invalid insert ids fail closed", async () => {
  for (const val of [undefined, 0, -1, 1.5]) {
    const calls = [];
    const c = {
      query: async (s, a) => {
        calls.push(s);
        if (s.startsWith("INSERT")) return [{ affectedRows: 1, insertId: val }];
        return [[]];
      },
      release() {},
    };
    const a = new Fy6MysqlReadAdapter({ getConnection: async () => c });
    await a.beginTransaction("G1");
    await assert.rejects(
      a.insertVendorCopy({ id: 1, company_id: 7, name: "V" }, 4),
      /VENDOR_INSERT_INVALID/,
    );
    assert.equal(calls.includes("COMMIT"), false);
    await a.rollback();
    await a.release();
  }
});
