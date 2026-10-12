"use strict";
const a = require("../services/annualSubledgerService");
const { createFinancialYearCloseService } = require("../services/financialYearCloseService");
const executor = () => require("../db/connection");
const sendError = (res, e) => res.status(e.code?.startsWith("ANNUAL_") ? e.status || 409 : 503).json({ success: false,
  code: e.code?.startsWith("ANNUAL_") ? e.code : "ANNUAL_OPERATION_FAILED", message: "Financial year operation cannot be completed" });
const identity = req => [a.id(req.user?.company_id), a.id(req.params.id), a.id(req.user?.user_id || req.user?.id)];
const get = method => async (req, res) => {
  try { const result = await createFinancialYearCloseService(executor())[method](...identity(req)); return res.json({ success: true, data: result }); }
  catch (e) { return sendError(res, e); }
};
const post = method => async (req, res) => {
  try {
    const body = req.body || {};
    const fields = ["confirmation", "reason", "expected_version", "idempotency_key", ...(method === "lock" ? [] : ["preview_fingerprint"])];
    if (Object.keys(body).some(k => !fields.includes(k))) a.fail("ANNUAL_UNSUPPORTED_FIELD", 400);
    const result = await createFinancialYearCloseService(executor())[method](...identity(req), body);
    return res.json({ success: true, data: result });
  } catch (e) { return sendError(res, e); }
};
const openings = async (req, res) => {
  try {
    const schema = await require("../services/annualSubledgerReadinessService").inspectAnnualSchema(executor());
    if (!schema.ready) a.fail("ANNUAL_SCHEMA_NOT_READY", 503);
    const rows = await a.listOpenings(executor(), req.user.company_id, req.query.party_type, req.query.party_id, req.query.date);
    return res.json({ success: true, data: rows });
  } catch (e) { return sendError(res, e); }
};
const reverse = async (req, res) => {
  try {
    const result = await a.transaction(executor(), cx => a.reverseSettlement(cx, req.body || {}, req.user));
    return res.json({ success: true, data: result });
  } catch (e) { return sendError(res, e); }
};
const operation = async (req, res) => {
  try {
    const key = a.uuid(req.params.key), companyId = a.id(req.user.company_id);
    const [rows] = await executor().query("SELECT id,journal_entry_id,receipt_entry_id,vendor_payment_id FROM annual_subledger_allocations WHERE company_id=? AND idempotency_key=? ORDER BY id", [companyId, key]);
    const [events] = await executor().query("SELECT id,financial_year_id,event_type FROM financial_year_events WHERE company_id=? AND JSON_UNQUOTE(JSON_EXTRACT(metadata,'$.idempotency_key'))=? ORDER BY id", [companyId, key]);
    const [reversals] = await executor().query("SELECT id,reversal_journal_entry_id FROM annual_subledger_allocation_reversals WHERE company_id=? AND idempotency_key=? ORDER BY id", [companyId, key]);
    return res.json({ success: true, data: { committed: Boolean(rows.length || events.length || reversals.length), allocations: rows, events, reversals } });
  } catch (e) { return sendError(res, e); }
};
module.exports = { readiness: get("readiness"), preview: get("preview"), begin: post("begin"), finalize: post("finalize"), lock: post("lock"), openings, reverse, operation, sendError };
