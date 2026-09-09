"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { postReceipt } = require("../services/receiptEntryService");

const root = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("sales create, conversion, recurring generation and accounting use centralized lifecycle guards", () => {
  const invoice = source("controllers/invoiceController.js");
  const quotation = source("controllers/quotationController.js");
  const recurring = source("services/recurringInvoiceService.js");
  const accounting = source("services/salesInvoiceAccountingService.js");
  assert.match(invoice, /requireFinancialYearForPosting\(company_id, invoice_date, connection\)/);
  assert.match(quotation, /requireFinancialYearForPosting\(companyId, invoiceDate, connection\)/);
  assert.match(recurring, /createInvoiceRecord\([\s\S]*invoice_date: scheduledDate/);
  assert.match(accounting, /requireFinancialYearForMutation\(companyId, invoiceRows\[0\]\.financial_year_id, connection\)/);
});

test("invoice edit checks persisted source before destination and item/delete/status paths lock parents", () => {
  const invoice = source("controllers/invoiceController.js");
  const edit = invoice.slice(invoice.indexOf("exports.updateInvoice ="), invoice.indexOf("exports.getPartyItemRate"));
  assert.ok(edit.indexOf("requireFinancialYearForMutation") < edit.indexOf("requireFinancialYearForPosting"));
  assert.match(edit, /financial_year_id=\?/);
  const item = source("controllers/invoiceItemController.js");
  assert.equal((item.match(/financial_year_id[\s\S]{0,250}FOR UPDATE/g) || []).length, 3);
  assert.equal((item.match(/requireFinancialYearForMutation/g) || []).length, 4);
  assert.match(invoice.slice(invoice.indexOf("exports.deleteInvoice"), invoice.indexOf("exports.updateInvoice")), /financial_year_id[\s\S]*FOR UPDATE[\s\S]*requireFinancialYearForMutation/);
  assert.match(invoice.slice(invoice.indexOf("exports.updateInvoiceStatus")), /financial_year_id[\s\S]*FOR UPDATE[\s\S]*requireFinancialYearForMutation/);
});

test("receipt posting and every allocated invoice are lifecycle checked before financial inserts", () => {
  const receipt = source("services/receiptEntryService.js");
  const body = receipt.slice(receipt.indexOf("const postReceipt"), receipt.indexOf("const createReceipt"));
  assert.ok(body.indexOf("requireFinancialYearForPosting") < body.indexOf("INSERT INTO receipt_entries"));
  assert.ok(body.indexOf("requireFinancialYearForMutation") < body.indexOf("INSERT INTO receipt_entries"));
  assert.match(body, /financial_year_id[\s\S]*FROM invoices[\s\S]*FOR UPDATE/);
});

test("all five restricted receipt FY states fail before any financial write", async () => {
  const codes = {
    DRAFT: "FINANCIAL_YEAR_DRAFT",
    RECONCILIATION: "FINANCIAL_YEAR_RECONCILIATION_RESTRICTED",
    CLOSING: "FINANCIAL_YEAR_CLOSING_RESTRICTED",
    CLOSED: "FINANCIAL_YEAR_CLOSED",
    LOCKED: "FINANCIAL_YEAR_LOCKED",
  };
  for (const [status, code] of Object.entries(codes)) {
    const writes = [];
    const connection = { query: async (sql) => {
      if (/FROM financial_years/.test(sql)) return [[{ id: 8, company_id: 4, status }]];
      if (/INSERT|UPDATE|DELETE/.test(sql)) writes.push(sql);
      return [[]];
    } };
    await assert.rejects(postReceipt(connection, {
      receipt_date: "2026-08-12", receipt_type: "CUSTOMER", invoice_id: 7,
      received_in_account_id: 10, amount: 1, payment_method: "cash", idempotency_key: `restricted-${status}`,
    }, { company_id: 4, user_id: 13 }), { code, status: 409 });
    assert.deepEqual(writes, []);
  }
});
