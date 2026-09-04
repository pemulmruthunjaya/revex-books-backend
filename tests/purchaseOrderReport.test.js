const assert = require("node:assert/strict");
const test = require("node:test");

const connectionPath = require.resolve("../db/connection");
const controllerPath = require.resolve("../controllers/purchaseReportController");
const originalConnection = require.cache[connectionPath];
const calls = [];
let queryRows = [];

require.cache[connectionPath] = {
  id: connectionPath,
  filename: connectionPath,
  loaded: true,
  exports: {
    async query(sql, params) {
      calls.push({ sql, params });
      return [queryRows.map((row) => ({ ...row }))];
    },
  },
};
delete require.cache[controllerPath];
const controller = require(controllerPath);

test.after(() => {
  delete require.cache[controllerPath];
  if (originalConnection) require.cache[connectionPath] = originalConnection;
  else delete require.cache[connectionPath];
});

const invoke = async (handler, { query = {}, companyId = 4, branchId = 9 } = {}) => {
  let body;
  let statusCode = 200;
  await handler(
    { query, user: { company_id: companyId, branch_id: branchId }, path: "/purchases/purchase-orders" },
    {
      status(code) { statusCode = code; return this; },
      json(value) { body = value; },
    },
  );
  return { body, statusCode };
};

const productionRows = [
  { id: 1, po_number: "PO-65464", po_date: "2026-08-12", vendor_name: "Alpha enterprises", ordered_qty: 10, received_qty: 0, pending_qty: 10, po_value: 17700, status: "Converted", receipt_status: "Not Received", branch_id: null },
  { id: 2, po_number: "PO-0003", po_date: "2026-08-11", vendor_name: "Venu Enterprises", ordered_qty: 4, received_qty: 4, pending_qty: 0, po_value: 784, status: "Fully Received", receipt_status: "Fully Received", branch_id: null },
  { id: 3, po_number: "PO-0002", po_date: "2026-07-18", vendor_name: "PKD Traders", ordered_qty: 8, received_qty: 3, pending_qty: 5, po_value: 7985, status: "Converted", receipt_status: "Partially Received", branch_id: null },
  { id: 4, po_number: "PO-0001", po_date: "2026-07-17", vendor_name: "Alpha enterprises", ordered_qty: 2, received_qty: 0, pending_qty: 2, po_value: 1416, status: "Draft", receipt_status: "Not Received", branch_id: null },
];

const pendingRows = [
  { id: 1, po_number: "PO-65464", po_date: "2026-08-12", vendor_name: "Alpha enterprises", product: "Widget A", ordered_qty: 10, received_qty: 0, pending_qty: 10, unit: "PCS", purchase_rate: 1500, pending_value: 15000, days_pending: 21, branch_id: null },
  { id: 3, po_number: "PO-0002", po_date: "2026-07-18", vendor_name: "PKD Traders", product: "Widget B", ordered_qty: 8, received_qty: 3, pending_qty: 5, unit: "PCS", purchase_rate: 950, pending_value: 4750, days_pending: 46, branch_id: null },
  { id: 4, po_number: "PO-0001", po_date: "2026-07-17", vendor_name: "Alpha enterprises", product: "Widget C", ordered_qty: 2, received_qty: 0, pending_qty: 2, unit: "PCS", purchase_rate: 600, pending_value: 1200, days_pending: 47, branch_id: null },
];

test.beforeEach(() => {
  calls.length = 0;
  queryRows = productionRows;
});

test("Purchase Order report is company scoped but does not exclude NULL branch orders", async () => {
  const result = await invoke(controller.purchaseOrders, {
    query: { from_date: "2026-04-01", to_date: "2026-09-02" },
  });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.data.map(({ po_number }) => po_number), ["PO-65464", "PO-0003", "PO-0002", "PO-0001"]);
  assert.match(calls[0].sql, /po\.company_id=\?/);
  assert.doesNotMatch(calls[0].sql, /po\.branch_id=\?/);
  assert.deepEqual(calls[0].params, [4, "2026-04-01", "2026-09-02"]);
});

test("date and vendor filters retain their exact SQL parameters", async () => {
  await invoke(controller.purchaseOrders, {
    query: { from_date: "2026-04-01", to_date: "2026-09-02", vendor_id: "17" },
    companyId: 8,
  });
  assert.match(calls[0].sql, /po\.po_date>=\?/);
  assert.match(calls[0].sql, /po\.po_date<=\?/);
  assert.match(calls[0].sql, /po\.vendor_id=\?/);
  assert.deepEqual(calls[0].params, [8, "2026-04-01", "2026-09-02", 17]);
});

test("receipt status remains derived and filters the returned report rows", async () => {
  for (const receiptStatus of ["Not Received", "Partially Received", "Fully Received"]) {
    calls.length = 0;
    const result = await invoke(controller.purchaseOrders, { query: { receipt_status: receiptStatus } });
    assert.ok(result.body.data.length > 0);
    assert.ok(result.body.data.every((row) => row.receipt_status === receiptStatus));
    assert.equal(calls[0].params[0], 4);
  }
});

test("another company cannot enter the Purchase Order report query", async () => {
  queryRows = [];
  const result = await invoke(controller.purchaseOrders, { companyId: 5 });
  assert.deepEqual(result.body.data, []);
  assert.match(calls[0].sql, /WHERE po\.company_id=\?/);
  assert.equal(calls[0].params[0], 5);
});

test("Pending Purchase Orders stays company scoped and includes NULL branch orders", async () => {
  queryRows = pendingRows;
  const result = await invoke(controller.pendingPurchaseOrders, {
    query: { from_date: "2026-04-01", to_date: "2026-09-02" },
  });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.data.map(({ po_number }) => po_number), ["PO-65464", "PO-0002", "PO-0001"]);
  assert.match(calls[0].sql, /po\.company_id=\?/);
  assert.doesNotMatch(calls[0].sql, /po\.branch_id=\?/);
  assert.deepEqual(calls[0].params, [4, "2026-04-01", "2026-09-02"]);
  assert.deepEqual(result.body.summary, {
    pending_po_count: 3,
    pending_lines: 3,
    pending_quantity: 17,
    pending_value: 20950,
  });
});

test("Pending Purchase Orders preserves date, vendor and product filters", async () => {
  queryRows = pendingRows;
  await invoke(controller.pendingPurchaseOrders, {
    companyId: 8,
    query: {
      from_date: "2026-04-01",
      to_date: "2026-09-02",
      vendor_id: "17",
      product_id: "31",
    },
  });
  assert.match(calls[0].sql, /po\.po_date>=\?/);
  assert.match(calls[0].sql, /po\.po_date<=\?/);
  assert.match(calls[0].sql, /po\.vendor_id=\?/);
  assert.match(calls[0].sql, /poi\.product_id=\?/);
  assert.deepEqual(calls[0].params, [8, "2026-04-01", "2026-09-02", 17, 31]);
});

test("Pending Purchase Orders preserves every backend-authoritative aging bucket", async () => {
  const expected = {
    "0-7": "DATEDIFF(CURDATE(),po.po_date) BETWEEN 0 AND 7",
    "8-15": "DATEDIFF(CURDATE(),po.po_date) BETWEEN 8 AND 15",
    "16-30": "DATEDIFF(CURDATE(),po.po_date) BETWEEN 16 AND 30",
    "31+": "DATEDIFF(CURDATE(),po.po_date)>=31",
  };
  for (const [aging, sqlFragment] of Object.entries(expected)) {
    calls.length = 0;
    queryRows = [];
    await invoke(controller.pendingPurchaseOrders, { query: { aging } });
    assert.ok(calls[0].sql.includes(sqlFragment));
    assert.equal(calls[0].params[0], 4);
  }
});

test("Pending Purchase Orders cannot include another company", async () => {
  queryRows = [];
  const result = await invoke(controller.pendingPurchaseOrders, { companyId: 5 });
  assert.deepEqual(result.body.data, []);
  assert.match(calls[0].sql, /WHERE po\.company_id=\?/);
  assert.equal(calls[0].params[0], 5);
});

test("Pending quantity and value SQL semantics remain unchanged", async () => {
  queryRows = [];
  await invoke(controller.pendingPurchaseOrders);
  assert.match(calls[0].sql, /poi\.quantity-COALESCE\(r\.received_qty,0\) pending_qty/);
  assert.match(calls[0].sql, /\(poi\.quantity-COALESCE\(r\.received_qty,0\)\)\*poi\.price pending_value/);
  assert.match(calls[0].sql, /poi\.quantity>COALESCE\(r\.received_qty,0\)/);
});

test("Purchase Register remains company-wide and GRN Register keeps its branch scope", async () => {
  queryRows = [];
  await invoke(controller.purchaseRegister);
  assert.match(calls[0].sql, /b\.company_id=\?/);
  assert.doesNotMatch(calls[0].sql, /b\.branch_id=\?/);

  calls.length = 0;
  await invoke(controller.grnRegister);
  assert.match(calls[0].sql, /gr\.company_id=\?/);
  assert.match(calls[0].sql, /gr\.branch_id=\?/);
  assert.deepEqual(calls[0].params, [4, 9]);
});
