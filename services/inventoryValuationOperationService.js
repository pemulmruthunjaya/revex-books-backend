"use strict";
const m = require("./inventoryValuationMath");
const schema = require("./inventoryValuationSchema");
const normalized = value => {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, normalized(v)]));
  if (typeof value === "number") { if (!Number.isFinite(value)) m.fail("IV_INVALID_VALUE"); return String(value); }
  return value;
};
async function begin(cx, company, actor, key, action, input) {
  const [status] = await cx.query("DO 0");
  if (!Number.isInteger(status.serverStatus) || !(status.serverStatus & 1)) m.fail("IV_TRANSACTION_REQUIRED");
  m.text(String(company), 15); m.text(String(actor), 15); m.text(key, 128); m.text(action, 40);
  await schema.assertReady(cx);
  // One transaction-owned tenant lock provides a common ordering before all
  // product/date locks, including multi-product allocations and corrections.
  const [companies] = await cx.query("SELECT id FROM companies WHERE id=? FOR UPDATE", [company]);
  if (companies.length !== 1) m.fail("IV_COMPANY_NOT_FOUND");
  const [actors] = await cx.query("SELECT id,role FROM users WHERE id=? AND company_id=? AND is_active=1 FOR SHARE", [actor, company]);
  if (actors.length !== 1) m.fail("IV_ACTOR_NOT_AUTHORIZED");
  const fingerprint = m.fingerprint(normalized({ action, actor, input }));
  const [rows] = await cx.query("SELECT action,fingerprint,result FROM iv_operations WHERE company_id=? AND operation_key=? FOR UPDATE", [company, key]);
  if (rows.length > 1) m.fail("IV_OPERATION_CORRUPT");
  if (rows.length && (rows[0].action !== action || rows[0].fingerprint !== fingerprint)) m.fail("IV_IDEMPOTENCY_CONFLICT");
  return { company, actor, key, action, fingerprint, completed: rows.length === 1, result: rows.length ? (typeof rows[0].result === "string" ? JSON.parse(rows[0].result) : rows[0].result) : null };
}
async function complete(cx, operation, result) {
  if (operation.completed) return operation.result;
  await cx.query("INSERT INTO iv_operations (company_id,operation_key,actor_id,action,fingerprint,result) VALUES (?,?,?,?,?,?)", [operation.company, operation.key, operation.actor, operation.action, operation.fingerprint, JSON.stringify(result)]);
  return result;
}
function wrap(action, fn) {
  return async (cx, x, ...args) => {
    if (action === "recordCost") m.validateCost(x.evidence);
    if (action === "postMovement") m.operationalQuantity(x.quantity);
    const key = x.idempotency_key || (action === "applyBillCost" && `bill:${args[0]?.bill_id}:${args[0]?.revision_id}`);
    const fingerprintArgs = action === "applyBillCost" ? args.map(({ proof, ...input }) => input) : args;
    const op = await begin(cx, x.company_id, x.actor_id, key, action, { x, args: fingerprintArgs });
    if (op.completed) return op.result;
    const posting = ["postAcquisition", "finalizeAcquisition", "postMovement", "applyBillCost"].includes(action);
    try {
      if (posting) await require("./inventoryGlService").guardOperation(cx, x, action, args[0]);
      const result = await fn(cx, x, ...args);
      if (posting) await require("./inventoryGlService").post(cx, x);
      return await complete(cx, op, result);
    } finally { if (posting) require("./inventoryGlService").clearProof(cx, x); }
  };
}
const requestOperation = Symbol("inventory-operation");
async function beginRequest(cx, req, action, resource = null) {
  const input = { body: req.body, resource };
  const supplied = req.get?.("Idempotency-Key") || req.headers?.["idempotency-key"] || req.body?.idempotency_key;
  const key = supplied || `request:${m.fingerprint(normalized({ action, input }))}`;
  const op = await begin(cx, req.user.company_id, req.user.user_id || req.user.id, key, action, input);
  req[requestOperation] = op;
  return op.completed ? op.result : null;
}
async function completeRequest(cx, req, status, body) {
  if (!req[requestOperation]) m.fail("IV_OPERATION_REQUIRED");
  return complete(cx, req[requestOperation], { status, body });
}
module.exports = { begin, complete, wrap, beginRequest, completeRequest, normalized };
