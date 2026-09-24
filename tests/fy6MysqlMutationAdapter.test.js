"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  Fy6MysqlReadAdapter,
  VENDOR_COPY_COLUMNS,
  vendorCopyFields,
  fingerprint,
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
test("vendor insert copies the exact protected allowlist and excludes local metadata", async () => {
  const f = pool(), a = new Fy6MysqlReadAdapter(f.p);
  const source = Object.fromEntries(VENDOR_COPY_COLUMNS.map((name) => [name, `${name}-value`]));
  Object.assign(source, { id: 1, company_id: 1, created_at: "source-time" });
  await a.beginTransaction("G1");
  const result = await a.insertVendorCopy(source, 6);
  const [sql, args] = f.calls.find(([statement]) => statement.startsWith("INSERT"));
  assert.match(sql, /^INSERT INTO vendors \(company_id,/);
  for (const name of VENDOR_COPY_COLUMNS) {
    assert.match(sql, new RegExp(`\\b${name}\\b`));
  }
  assert.doesNotMatch(sql, /created_at/);
  assert.deepEqual(args, [6, 1, 1]);
  assert.equal(result.copiedFingerprint, fingerprint(vendorCopyFields(source)));
  await a.rollback();
  await a.release();
});
test("completion update is exact parameterized vendor-only DML", async () => {
  const f = pool(), a = new Fy6MysqlReadAdapter(f.p);
  await a.beginCompletionTransaction();
  const result = await a.completeVendorCopy(1, 1, 11, 6);
  const [sql, args] = f.calls.find(([statement]) => statement.startsWith("UPDATE vendors t"));
  assert.deepEqual(args, [1, 1, 11, 6]);
  assert.match(sql, /^UPDATE vendors t JOIN vendors s/);
  assert.doesNotMatch(sql, /created_at|DELETE|INSERT|ALTER|CREATE|DROP|TRUNCATE/i);
  for (const name of VENDOR_COPY_COLUMNS) assert.match(sql, new RegExp(`t\\.${name}=s\\.${name}`));
  assert.deepEqual(result, { sequence: 1, groupId: "COMPLETION", operationType: "VENDOR_COPY_COMPLETION", table: "vendors", recordId: 11, companyId: 6, sourceVendorId: 1, affectedRows: 1, state: "ATTEMPTED" });
  await a.rollback();
  await a.release();
});
test("active G1 ledger entries are visible and commit exactly once", async () => {
  const f = pool(),
    a = new Fy6MysqlReadAdapter(f.p);
  await a.beginTransaction("G1");
  await a.insertVendorCopy({ id: 1, company_id: 1, name: "V" }, 6);
  await a.updateBillVendor(3, 6, 1, 9);

  const active = await a.getOperationLedger();
  assert.deepEqual(
    active.map((x) => [x.sequence, x.groupId, x.operationType, x.state]),
    [
      [1, "G1", "VENDOR_INSERT", "ATTEMPTED"],
      [2, "G1", "BILL_UPDATE", "ATTEMPTED"],
    ],
  );
  active[0].state = "CHANGED";
  active[1].recordId = 999;
  assert.deepEqual(
    (await a.getOperationLedger()).map((x) => [x.recordId, x.state]),
    [
      [9, "ATTEMPTED"],
      [3, "ATTEMPTED"],
    ],
  );

  await a.commit();
  const committed = await a.getOperationLedger();
  assert.equal(committed.length, 2);
  assert.deepEqual(
    committed.map((x) => x.state),
    ["COMMITTED", "COMMITTED"],
  );
  assert.deepEqual(
    committed.map((x) => x.sequence),
    [1, 2],
  );
  await a.release();
});
test("active G2 suffix is visible and rollback replaces attempted state", async () => {
  const f = pool(),
    a = new Fy6MysqlReadAdapter(f.p);
  await a.beginTransaction("G2");
  await a.insertVendorCopy({ id: 1, company_id: 1, name: "V" }, 7);
  await a.updateBillVendor(4, 7, 1, 9);
  await a.updateVendorPaymentVendor(1, 7, 1, 9);
  await a.updateVendorPaymentVendor(2, 7, 1, 9);

  const active = await a.getOperationLedger();
  assert.deepEqual(
    active.map((x) => x.operationType),
    [
      "VENDOR_INSERT",
      "BILL_UPDATE",
      "VENDOR_PAYMENT_UPDATE",
      "VENDOR_PAYMENT_UPDATE",
    ],
  );
  assert.ok(active.every((x) => x.groupId === "G2" && x.state === "ATTEMPTED"));
  active[0].groupId = "CHANGED";
  assert.equal((await a.getOperationLedger())[0].groupId, "G2");

  await a.rollback();
  const rolledBack = await a.getOperationLedger();
  assert.equal(rolledBack.length, 4);
  assert.ok(rolledBack.every((x) => x.state === "ROLLED_BACK"));
  assert.deepEqual(
    rolledBack.map((x) => x.sequence),
    [1, 2, 3, 4],
  );
  await a.release();
});
test("later ledger baselines preserve committed and rolled-back history", async () => {
  const f = pool(),
    a = new Fy6MysqlReadAdapter(f.p);

  await a.beginTransaction("G1");
  await a.insertVendorCopy({ id: 1, company_id: 1, name: "V1" }, 6);
  await a.commit();
  const committedBaseline = await a.getOperationLedger();

  await a.beginTransaction("G3");
  await a.insertVendorCopy({ id: 3, company_id: 1, name: "V3" }, 4);
  await a.rollback();
  const mixedBaseline = await a.getOperationLedger();
  assert.deepEqual(
    mixedBaseline.map((x) => x.state),
    ["COMMITTED", "ROLLED_BACK"],
  );

  await a.beginTransaction("G2");
  await a.insertVendorCopy({ id: 1, company_id: 1, name: "V1" }, 7);
  const withActive = await a.getOperationLedger();
  assert.deepEqual(withActive.slice(0, 2), mixedBaseline);
  assert.deepEqual(committedBaseline, [
    { ...mixedBaseline[0] },
  ]);
  assert.equal(withActive[2].state, "ATTEMPTED");
  assert.deepEqual(
    withActive.map((x) => x.sequence),
    [1, 2, 3],
  );
  assert.equal(new Set(withActive.map((x) => x.sequence)).size, 3);

  withActive[0].state = "CHANGED";
  withActive[2].state = "CHANGED";
  const unchanged = await a.getOperationLedger();
  assert.deepEqual(
    unchanged.map((x) => x.state),
    ["COMMITTED", "ROLLED_BACK", "ATTEMPTED"],
  );
  await a.rollback();
  await a.release();
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
test("production identity evidence uses the leased connection and exact projection", async () => {
  const f = pool();
  f.c.query = async (sql, args) => {
    f.calls.push([sql, args]);
    return [[{ host: "7102d71a58ff", port: 3306, version: "9.7.2", db: "railway" }]];
  };
  const a = new Fy6MysqlReadAdapter(f.p);
  assert.deepEqual(await a.getProductionIdentityEvidence(), {
    host: "7102d71a58ff", port: 3306, version: "9.7.2", db: "railway",
  });
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0][0], /^SELECT @@hostname AS host,@@port AS port,@@version AS version,DATABASE\(\) AS db$/);
  assert.deepEqual(f.calls[0][1], []);
  await a.release();
});
test("production identity evidence rejects missing fields", async () => {
  for (const row of [null, {}, { host: "h", port: 3306, version: "", db: "railway" }]) {
    const c = { query: async () => [[row].filter(Boolean)], release() {} };
    const a = new Fy6MysqlReadAdapter({ getConnection: async () => c });
    await assert.rejects(a.getProductionIdentityEvidence(), /PRODUCTION_LIVE_IDENTITY_REQUIRED/);
    await a.release();
  }
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
