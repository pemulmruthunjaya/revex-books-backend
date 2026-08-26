const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  addCalendarDays,
  normalizeCreditDays,
  normalizeInvoiceType,
  resolveInvoicePersistence,
} = require("../controllers/invoiceController");

const customer = {
  id: 7,
  name: "Credit Customer",
  phone: "9876543210",
  credit_period_days: 30,
  shipping_address: "Shipping snapshot",
  billing_address: "Billing fallback",
};

const customerConnection = (record = customer) => ({
  calls: [],
  async query(sql, params) {
    this.calls.push({ sql, params });
    return [[record].filter(Boolean)];
  },
});

const resolve = (body, options = {}) => resolveInvoicePersistence({
  body: { invoice_date: "2026-08-26", ...body },
  companyId: options.companyId || 4,
  connection: options.connection || customerConnection(),
  existing: options.existing || null,
  creating: options.creating !== false,
});

test("new invoices require an explicit valid type", () => {
  assert.throws(() => normalizeInvoiceType(undefined, { required: true }), /CASH or CREDIT/);
  assert.throws(() => normalizeInvoiceType("other", { required: true }), /CASH or CREDIT/);
  assert.equal(normalizeInvoiceType("cash", { required: true }), "CASH");
  assert.equal(normalizeInvoiceType("CREDIT", { required: true }), "CREDIT");
});

test("Cash snapshots are optional and never create a customer relationship", async () => {
  const blank = await resolve({ invoice_type: "CASH" });
  assert.deepEqual(blank, {
    invoiceType: "CASH",
    customerId: null,
    customerName: "Cash Customer",
    customerPhone: null,
    cashCustomerName: null,
    cashCustomerMobile: null,
    creditDays: null,
    dueDate: null,
    shippingAddress: null,
  });

  const nameOnly = await resolve({ invoice_type: "CASH", cash_customer_name: "Walk In" });
  assert.equal(nameOnly.customerName, "Walk In");
  assert.equal(nameOnly.cashCustomerMobile, null);

  const mobileOnly = await resolve({ invoice_type: "CASH", cash_customer_mobile: "9999999999" });
  assert.equal(mobileOnly.customerName, "Cash Customer");
  assert.equal(mobileOnly.customerPhone, "9999999999");

  const both = await resolve({
    invoice_type: "CASH",
    cash_customer_name: "Counter Sale",
    cash_customer_mobile: "8888888888",
    shipping_address: "Cash shipping snapshot",
  });
  assert.equal(both.cashCustomerName, "Counter Sale");
  assert.equal(both.cashCustomerMobile, "8888888888");
  assert.equal(both.shippingAddress, "Cash shipping snapshot");
  await assert.rejects(
    resolve({ invoice_type: "CASH", customer_id: 7 }),
    (error) => error.code === "CASH_CUSTOMER_ID_NOT_ALLOWED"
  );
  await assert.rejects(
    resolve({ invoice_type: "CASH", credit_days: 1 }),
    (error) => error.code === "CASH_CREDIT_TERMS_NOT_ALLOWED"
  );
});

test("Credit customer is tenant scoped and authoritative snapshots are server generated", async () => {
  const connection = customerConnection();
  const result = await resolve({
    invoice_type: "CREDIT",
    customer_id: 7,
    company_id: 999,
    customer_name: "Untrusted",
    customer_phone: "000",
  }, { connection, companyId: 4 });

  assert.deepEqual(connection.calls[0].params, [7, 4]);
  assert.equal(result.customerName, customer.name);
  assert.equal(result.customerPhone, customer.phone);
  assert.equal(result.creditDays, 30);
  assert.equal(result.dueDate, "2026-09-25");
  assert.equal(result.shippingAddress, customer.shipping_address);
  assert.equal(result.cashCustomerName, null);
  assert.equal(result.cashCustomerMobile, null);

  await assert.rejects(resolve({ invoice_type: "CREDIT" }), (error) => error.code === "CREDIT_CUSTOMER_REQUIRED");
  await assert.rejects(
    resolve({ invoice_type: "CREDIT", customer_id: 999 }, { connection: customerConnection(null) }),
    (error) => error.code === "CREDIT_CUSTOMER_NOT_FOUND" && error.status === 404
  );
});

test("Credit terms support overrides, address override/fallback, and calendar boundaries", async () => {
  const overridden = await resolve({
    invoice_type: "CREDIT",
    customer_id: 7,
    credit_days: 0,
    shipping_address: "Invoice override",
  });
  assert.equal(overridden.creditDays, 0);
  assert.equal(overridden.dueDate, "2026-08-26");
  assert.equal(overridden.shippingAddress, "Invoice override");

  const billingFallback = await resolve(
    { invoice_type: "CREDIT", customer_id: 7 },
    { connection: customerConnection({ ...customer, shipping_address: null }) }
  );
  assert.equal(billingFallback.shippingAddress, customer.billing_address);
  assert.equal(addCalendarDays("2026-01-31", 30), "2026-03-02");
  assert.equal(addCalendarDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addCalendarDays("2028-02-28", 1), "2028-02-29");
  assert.equal(normalizeCreditDays(3650), 3650);
  assert.throws(() => normalizeCreditDays(3651), /between 0 and 3650/);
});

test("legacy edits preserve NULL mode and explicit safe classification is supported", async () => {
  const legacy = {
    invoice_type: null,
    customer_id: null,
    customer_name: "Legacy Snapshot",
    customer_phone: null,
    due_date: null,
    shipping_address: null,
  };
  const unchanged = await resolveInvoicePersistence({
    body: { invoice_date: "2026-08-26", customer_name: "Legacy Snapshot" },
    companyId: 4,
    connection: customerConnection(),
    existing: legacy,
  });
  assert.equal(unchanged.invoiceType, null);

  const classified = await resolveInvoicePersistence({
    body: { invoice_date: "2026-08-26", invoice_type: "CASH" },
    companyId: 4,
    connection: customerConnection(),
    existing: legacy,
  });
  assert.equal(classified.invoiceType, "CASH");
  assert.equal(classified.cashCustomerName, "Legacy Snapshot");
  assert.equal(classified.customerName, "Legacy Snapshot");
});

test("Credit to Cash conversion is rejected while Cash to Credit validates customer terms", async () => {
  const credit = { ...customer, invoice_type: "CREDIT", customer_id: 7, customer_name: customer.name };
  await assert.rejects(
    resolveInvoicePersistence({
      body: { invoice_date: "2026-08-26", invoice_type: "CASH" },
      companyId: 4,
      connection: customerConnection(),
      existing: credit,
    }),
    (error) => error.code === "INVOICE_TYPE_CHANGE_NOT_ALLOWED" && error.status === 409
  );

  const converted = await resolveInvoicePersistence({
    body: { invoice_date: "2026-08-26", invoice_type: "CREDIT", customer_id: 7 },
    companyId: 4,
    connection: customerConnection(),
    existing: { invoice_type: "CASH", customer_id: null, customer_name: "Cash Customer" },
  });
  assert.equal(converted.invoiceType, "CREDIT");
  assert.equal(converted.customerId, 7);
});

test("controller wiring keeps payment status separate and exposes new invoice fields through i.*", () => {
  const source = fs.readFileSync(path.join(__dirname, "../controllers/invoiceController.js"), "utf8");
  const createStart = source.indexOf("const createInvoiceRecord");
  const createEnd = source.indexOf("exports.createInvoiceRecord");
  const createHandler = source.slice(createStart, createEnd);
  assert.match(createHandler, /invoice_type/);
  assert.match(createHandler, /cash_customer_name/);
  assert.match(createHandler, /shipping_address/);
  assert.doesNotMatch(createHandler, /status\s*=\s*["']paid["']/i);
  assert.doesNotMatch(createHandler, /INSERT INTO payments/i);
  assert.doesNotMatch(createHandler, /INSERT INTO journal_entries/i);
  assert.match(source, /i\.\*/);
  assert.match(source, /WHERE id=\? AND company_id=\? FOR UPDATE/);
});
