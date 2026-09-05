const assert = require("node:assert/strict");
const test = require("node:test");
const db = require("../db/connection");

const request = (body = {}) => ({
  user: { company_id: 4, user_id: 13 },
  body: {
    vendor_id: 7,
    bill_number: "BILL-FY-1",
    bill_date: "2026-08-12",
    due_date: "2026-09-11",
    items: [{ product_id: 9, name: "Item", qty: 2, price: 100, mrp: 120, gst: 18 }],
    ...body,
  },
});

const response = () => ({
  statusCode: null,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const connectionFor = (failure = null) => {
  const events = [];
  const connection = {
    events,
    async beginTransaction() { events.push("begin"); },
    async commit() { events.push("commit"); },
    async rollback() { events.push("rollback"); },
    release() { events.push("release"); },
    async query(sql, params) {
      events.push({ sql, params });
      if (sql.includes("FROM financial_years")) {
        if (failure === "fy") return [[]];
        return [[{ id: 2026, company_id: 4, code: "FY26", start_date: "2026-04-01", end_date: "2027-03-31", status: "OPEN", is_default: 1 }]];
      }
      if (sql.includes("INSERT INTO bills")) return [{ insertId: 81 }];
      if (sql.includes("INSERT INTO bill_items")) {
        if (failure === "item") throw new Error("forced item failure");
        return [{ insertId: 91 }];
      }
      if (sql.includes("UPDATE products")) {
        if (failure === "stock") throw new Error("forced stock failure");
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected transaction query: ${sql}`);
    },
  };
  return connection;
};

test("normal Bill creation is FY-aware and atomic across header, item, and stock writes", async () => {
  const originalQuery = db.query;
  const originalGetConnection = db.getConnection;
  const originalError = console.error;
  db.query = async (sql) => {
    if (sql.includes("SHOW COLUMNS FROM products")) return [[
      { Field: "mrp" }, { Field: "purchase_price" }, { Field: "gst" },
    ]];
    if (sql.includes("SHOW COLUMNS FROM bill_items")) return [[{ Field: "mrp" }]];
    throw new Error(`Unexpected pool query: ${sql}`);
  };
  console.error = () => {};
  delete require.cache[require.resolve("../controllers/billController")];
  const { createBill } = require("../controllers/billController");
  try {
    for (const failure of ["fy", "item", "stock", null]) {
      const connection = connectionFor(failure);
      db.getConnection = async () => connection;
      const res = response();
      await createBill(request(), res);
      const sqlCalls = connection.events.filter((event) => typeof event === "object");
      const headers = sqlCalls.filter(({ sql }) => sql.includes("INSERT INTO bills"));
      const itemWrites = sqlCalls.filter(({ sql }) => sql.includes("INSERT INTO bill_items"));
      const stockWrites = sqlCalls.filter(({ sql }) => sql.includes("UPDATE products"));
      if (failure) {
        assert.equal(connection.events.filter((event) => event === "rollback").length, 1);
        assert.equal(connection.events.includes("commit"), false);
        if (failure === "fy") assert.equal(headers.length, 0);
      } else {
        assert.equal(res.statusCode, 201);
        assert.equal(headers.length, 1);
        assert.equal(itemWrites.length, 1);
        assert.equal(stockWrites.length, 1);
        assert.equal(connection.events.filter((event) => event === "commit").length, 1);
        assert.equal(headers[0].params[7], 2026);
        assert.equal(headers[0].params[4], 236);
      }
      assert.equal(connection.events.at(-1), "release");
    }

    const connection = connectionFor();
    db.getConnection = async () => connection;
    const res = response();
    await createBill(request({ financial_year_id: 999 }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, "CLIENT_FINANCIAL_YEAR_NOT_ALLOWED");
    assert.equal(connection.events.some((event) => typeof event === "object"), false);
  } finally {
    db.query = originalQuery;
    db.getConnection = originalGetConnection;
    console.error = originalError;
  }
});
