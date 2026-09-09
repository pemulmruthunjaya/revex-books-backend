const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");

const dbPath = require.resolve("../db/connection");
const fyPath = require.resolve("../services/financialYearService");
const grnPath = require.resolve("../controllers/goodsReceiptController");
const challanPath = require.resolve("../controllers/deliveryChallanController");

const loadWithFakes = (controllerPath, { query, posting, forDate, mutation }) => {
  const calls = [];
  let committed = false;
  let rolledBack = false;
  const connection = {
    beginTransaction: async () => calls.push(["BEGIN"]),
    commit: async () => { committed = true; },
    rollback: async () => { rolledBack = true; },
    release: () => {},
    query: async (sql, params = []) => {
      calls.push([sql, params]);
      return query(sql, params);
    },
  };
  const fakeFy = {
    rejectClientFinancialYear: (body) => {
      if (Object.prototype.hasOwnProperty.call(body || {}, "financial_year_id")) {
        throw Object.assign(new Error("Client FY is not allowed"), {
          code: "CLIENT_FINANCIAL_YEAR_NOT_ALLOWED", status: 400,
        });
      }
    },
    requireFinancialYearForPosting: async (...args) => {
      calls.push(["FY_POST", args]);
      return posting(...args);
    },
    requireFinancialYearForDate: async (...args) => {
      calls.push(["FY_DATE", args]);
      return forDate(...args);
    },
    requireFinancialYearForMutation: async (...args) => {
      calls.push(["FY_MUTATE", args]);
      return mutation(...args);
    },
  };
  const originalLoad = Module._load;
  Module._load = function(request, parent, isMain) {
    let resolved;
    try { resolved = Module._resolveFilename(request, parent); } catch { resolved = request; }
    if (resolved === dbPath) return { getConnection: async () => connection, query: connection.query };
    if (resolved === fyPath) return fakeFy;
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[controllerPath];
  const controller = require(controllerPath);
  Module._load = originalLoad;
  return { controller, connection, calls, state: () => ({ committed, rolledBack }) };
};

const restricted = (code) => Object.assign(new Error(code), { code, status: 409 });
const defaults = {
  posting: async () => ({ id: 14, status: "OPEN" }),
  forDate: async () => ({ id: 14, status: "OPEN" }),
  mutation: async () => ({ id: 14, status: "OPEN" }),
};
const req = (body = {}) => ({
  body,
  params: { id: "31" },
  user: { company_id: 8, branch_id: 2, user_id: 18 },
});
const res = () => ({
  statusCode: 200, payload: null,
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.payload = payload; return this; },
});

test("OPEN GRN posting preserves one stock movement, inventory row, Posted state, and PO refresh", async () => {
  const harness = loadWithFakes(grnPath, {
    ...defaults,
    query: async (sql) => {
      if (sql.includes("FROM goods_receipts") && sql.includes("FOR UPDATE")) {
        return [[{
          id: 31, company_id: 8, branch_id: 2, purchase_order_id: 21,
          grn_date: "2027-03-31", status: "Draft", stock_posted: 0,
        }]];
      }
      if (sql.includes("FROM purchase_orders po INNER JOIN vendors")) {
        return [[{ id: 21, company_id: 8, vendor_id: 4, status: "Sent" }]];
      }
      if (sql.includes("FROM purchase_order_items poi")) {
        return [[{
          id: 61, product_id: 9, product_name: "Widget", quantity: 5,
          received_qty: 0, pending_qty: 5,
        }]];
      }
      if (sql.includes("FROM goods_receipt_items")) {
        return [[{ purchase_order_item_id: 61, product_id: 9, accepted_qty: 2 }]];
      }
      return [{ affectedRows: 1, insertId: 71 }];
    },
  });
  await harness.controller._private.postReceipt(harness.connection, req(), 31);
  assert.equal(harness.calls.filter(([sql]) => String(sql).includes("INSERT INTO inventory_transactions")).length, 1);
  assert.equal(harness.calls.filter(([sql]) => String(sql).includes("UPDATE products SET stock=stock+?")).length, 1);
  assert.equal(harness.calls.filter(([sql]) => String(sql).includes("SET status='Posted'")).length, 1);
  assert.equal(harness.calls.filter(([sql]) => String(sql).includes("UPDATE purchase_orders SET status=?")).length, 1);
  const fyCall = harness.calls.find(([sql]) => sql === "FY_POST");
  assert.deepEqual(fyCall[1].slice(0, 2), [8, "2027-03-31"]);
});

for (const code of [
  "FINANCIAL_YEAR_DRAFT",
  "FINANCIAL_YEAR_RECONCILIATION_RESTRICTED",
  "FINANCIAL_YEAR_CLOSING_RESTRICTED",
  "FINANCIAL_YEAR_CLOSED",
  "FINANCIAL_YEAR_LOCKED",
  "FINANCIAL_YEAR_NOT_FOUND_FOR_DATE",
  "FINANCIAL_YEAR_AMBIGUOUS",
]) {
  test(`GRN ${code} rejects before stock, inventory, Posted state, or PO mutation`, async () => {
    const harness = loadWithFakes(grnPath, {
      ...defaults,
      posting: async (companyId, date, executor) => {
        assert.equal(companyId, 8);
        assert.equal(date, "2026-04-01");
        assert.equal(executor, harness.connection);
        throw restricted(code);
      },
      query: async (sql, params) => {
        if (sql.includes("FROM goods_receipts") && sql.includes("FOR UPDATE")) {
          assert.deepEqual(params, [31, 8]);
          return [[{ id: 31, company_id: 8, grn_date: "2026-04-01", status: "Draft", stock_posted: 0 }]];
        }
        throw new Error(`Unexpected query after GRN guard: ${sql}`);
      },
    });
    await assert.rejects(
      harness.controller._private.postReceipt(harness.connection, req(), 31),
      (error) => error.code === code
    );
    assert.equal(harness.calls.some(([sql]) => String(sql).includes("UPDATE products")), false);
    assert.equal(harness.calls.some(([sql]) => String(sql).includes("INSERT INTO inventory_transactions")), false);
    assert.equal(harness.calls.some(([sql]) => String(sql).includes("UPDATE purchase_orders")), false);
  });
}

test("GRN draft creation stays non-financial while both posting paths share guarded postReceipt", () => {
  const source = fs.readFileSync(grnPath, "utf8");
  assert.match(source, /if \(status === "Posted"\)\s+await postReceipt\(connection, req, result\.insertId\)/);
  assert.match(source, /exports\.post[\s\S]*await postReceipt\(connection, req, req\.params\.id\)/);
  assert.match(source, /postReceipt[\s\S]*requireFinancialYearForPosting\(companyId, receipt\.grn_date, connection\)/);
  assert.match(source, /Only draft GRNs can be deleted/);
});

for (const type of ["in", "out"]) {
  test(`OPEN Delivery ${type} creation changes stock exactly once after FY authorization`, async () => {
    const harness = loadWithFakes(challanPath, {
      ...defaults,
      query: async (sql) => {
        if (sql.startsWith("SHOW COLUMNS")) return [[{ Field: "unit" }, { Field: "batch_no" }, { Field: "status" }]];
        if (sql.includes("CREATE TABLE")) return [{ affectedRows: 0 }];
        if (sql.includes("FROM vendors") || sql.includes("FROM customers")) return [[]];
        if (sql.includes("SELECT MAX(CAST")) return [[{ max_number: 0 }]];
        if (sql.includes("INSERT INTO delivery_challans")) return [{ insertId: 31, affectedRows: 1 }];
        if (sql.includes("SELECT id, name, stock")) return [[{ id: 9, name: "Widget", stock: 10, unit: "PCS" }]];
        return [{ affectedRows: 1 }];
      },
    });
    const response = res();
    await harness.controller.createChallan(req({
      type, challan_date: "2026-04-01", party_name: "Party",
      items: [{ product_id: 9, quantity: 2 }],
    }), response);
    assert.equal(response.statusCode, 201);
    assert.equal(harness.state().committed, true);
    const fyIndex = harness.calls.findIndex(([sql]) => sql === "FY_POST");
    const headerIndex = harness.calls.findIndex(([sql]) => String(sql).includes("INSERT INTO delivery_challans"));
    assert.ok(fyIndex >= 0 && fyIndex < headerIndex);
    const stock = harness.calls.filter(([sql]) => String(sql).includes("UPDATE products"));
    assert.equal(stock.length, 1);
    assert.match(stock[0][0], type === "in" ? /stock = stock \+ \?/ : /stock = stock - \?/);
  });
}

test("OPEN Delivery deletion uses locked persisted date and reverses stock once", async () => {
  const harness = loadWithFakes(challanPath, {
    ...defaults,
    query: async (sql) => {
      if (sql.startsWith("SHOW COLUMNS")) return [[{ Field: "unit" }, { Field: "batch_no" }, { Field: "status" }]];
      if (sql.includes("CREATE TABLE")) return [{ affectedRows: 0 }];
      if (sql.includes("FROM delivery_challans") && sql.includes("FOR UPDATE")) {
        return [[{ id: 31, company_id: 8, challan_date: "2026-04-01", type: "out" }]];
      }
      if (sql.includes("FROM delivery_challan_items")) return [[{ product_id: 9, quantity: 2 }]];
      return [{ affectedRows: 1 }];
    },
  });
  const response = res();
  await harness.controller.deleteChallan(req(), response);
  assert.equal(response.statusCode, 200);
  assert.equal(harness.state().committed, true);
  assert.equal(harness.calls.filter(([sql]) => String(sql).includes("UPDATE products")).length, 1);
  assert.equal(harness.calls.filter(([sql]) => String(sql).includes("DELETE FROM delivery_challan_items")).length, 1);
  assert.equal(harness.calls.filter(([sql]) => String(sql).includes("DELETE FROM delivery_challans")).length, 1);
  assert.ok(harness.calls.findIndex(([sql]) => sql === "FY_MUTATE") < harness.calls.findIndex(([sql]) => String(sql).includes("UPDATE products")));
});

for (const code of [
  "FINANCIAL_YEAR_DRAFT",
  "FINANCIAL_YEAR_RECONCILIATION_RESTRICTED",
  "FINANCIAL_YEAR_CLOSING_RESTRICTED",
  "FINANCIAL_YEAR_CLOSED",
  "FINANCIAL_YEAR_LOCKED",
  "FINANCIAL_YEAR_NOT_FOUND_FOR_DATE",
  "FINANCIAL_YEAR_AMBIGUOUS",
]) {
  test(`Delivery creation ${code} rejects before header, items, or stock`, async () => {
    const harness = loadWithFakes(challanPath, {
      ...defaults,
      posting: async (companyId, date, executor) => {
        assert.deepEqual([companyId, date, executor], [8, "2026-04-01", harness.connection]);
        throw restricted(code);
      },
      query: async (sql) => {
        if (sql.startsWith("SHOW COLUMNS")) return [[]];
        if (sql.startsWith("ALTER TABLE") || sql.includes("CREATE TABLE")) return [{ affectedRows: 0 }];
        throw new Error(`Unexpected Delivery create query: ${sql}`);
      },
    });
    const response = res();
    await harness.controller.createChallan(req({
      type: "out", challan_date: "2026-04-01", party_name: "Customer",
      items: [{ product_id: 9, quantity: 1 }],
    }), response);
    assert.equal(response.statusCode, 409);
    assert.equal(response.payload.code, code);
    assert.equal(harness.calls.some(([sql]) => String(sql).includes("INSERT INTO delivery_challans")), false);
    assert.equal(harness.calls.some(([sql]) => String(sql).includes("UPDATE products")), false);
  });

  test(`Delivery deletion ${code} rejects before stock reversal or deletion`, async () => {
    const harness = loadWithFakes(challanPath, {
      ...defaults,
      forDate: async (companyId, date, executor) => {
        assert.deepEqual([companyId, date, executor], [8, "2026-04-01", harness.connection]);
        return { id: 14, status: code.replace("FINANCIAL_YEAR_", "") };
      },
      mutation: async () => { throw restricted(code); },
      query: async (sql, params) => {
        if (sql.startsWith("SHOW COLUMNS")) return [[{ Field: "unit" }, { Field: "batch_no" }, { Field: "status" }]];
        if (sql.includes("CREATE TABLE")) return [{ affectedRows: 0 }];
        if (sql.includes("FROM delivery_challans") && sql.includes("FOR UPDATE")) {
          assert.deepEqual(params, ["31", 8]);
          return [[{ id: 31, company_id: 8, challan_date: "2026-04-01", type: "out" }]];
        }
        throw new Error(`Unexpected Delivery delete query: ${sql}`);
      },
    });
    const response = res();
    await harness.controller.deleteChallan(req(), response);
    assert.equal(response.statusCode, 409);
    assert.equal(response.payload.code, code);
    assert.equal(harness.state().rolledBack, true);
    assert.equal(harness.calls.some(([sql]) => String(sql).includes("UPDATE products")), false);
    assert.equal(harness.calls.some(([sql]) => String(sql).includes("DELETE FROM delivery")), false);
  });
}

test("Delivery client FY cannot authorize create or delete", async () => {
  const harness = loadWithFakes(challanPath, {
    ...defaults,
    query: async (sql) => {
      if (sql.startsWith("SHOW COLUMNS")) return [[{ Field: "unit" }, { Field: "batch_no" }, { Field: "status" }]];
      if (sql.includes("CREATE TABLE")) return [{ affectedRows: 0 }];
      throw new Error(`Unexpected query: ${sql}`);
    },
  });
  for (const operation of ["createChallan", "deleteChallan"]) {
    const response = res();
    await harness.controller[operation](req({ financial_year_id: 14 }), response);
    assert.equal(response.statusCode, 400);
    assert.equal(response.payload.code, "CLIENT_FINANCIAL_YEAR_NOT_ALLOWED");
  }
  assert.equal(harness.calls.some(([sql]) => String(sql).includes("INSERT INTO delivery")), false);
  assert.equal(harness.calls.some(([sql]) => String(sql).includes("UPDATE products")), false);
});

test("Delivery has no update/date-change route and keeps stock directions and atomic transaction", () => {
  const source = fs.readFileSync(challanPath, "utf8");
  const routes = fs.readFileSync(require.resolve("../routes/deliveryChallanRoutes"), "utf8");
  assert.doesNotMatch(routes, /router\.put|router\.patch/);
  assert.match(source, /type === "in" \? "\+" : "-"/);
  assert.match(source, /challan\.type === "in" \? "-" : "\+"/);
  assert.match(source, /beginTransaction/);
  assert.match(source, /commit/);
  assert.match(source, /rollback/);
});
