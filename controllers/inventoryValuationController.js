"use strict";
const v = require("../services/inventoryValuationService");
const m = require("../services/inventoryValuationMath");
const readiness = require("../services/inventoryValuationReadinessService");

// Factory keeps imports inert and permits mocked transaction executors.
module.exports = function createController(pool) {
  const fields = {
    correction: ["product_id", "bill_id", "movement_id", "previous_bill_link_id", "new_source_id", "new_revision_id", "reason", "idempotency_key"],
    "approve-correction": ["product_id", "correction_id", "reason", "idempotency_key"],
    component: ["product_id", "date", "document_id", "component_line", "kind", "basis", "total_minor", "recipients", "reference", "recoverability", "supersedes_id", "idempotency_key"],
    acquisition: ["product_id", "date", "document_type", "document_id", "source_line", "reference", "idempotency_key"],
    cost: ["product_id", "source_id", "supersedes_id", "evidence", "idempotency_key"],
    submit: ["product_id", "revision_id", "reason", "idempotency_key"],
    approve: ["product_id", "revision_id", "reason", "idempotency_key"],
    reject: ["product_id", "revision_id", "reason", "idempotency_key"],
    opening: ["product_id", "source_id", "revision_id", "idempotency_key"],
  };
  const methods = { component: require("../services/inventoryValuationComponentService").create, acquisition: v.createAcquisition, cost: v.recordCost, submit: v.submitCost, approve: v.approveCost, reject: v.rejectCost };
  methods.correction = require("../services/inventoryValuationCorrectionService").create;
  methods["approve-correction"] = require("../services/inventoryValuationCorrectionService").approve;
  const errorResponse = (res, error) => res.status(error.code?.startsWith("IV_") || error.code === "INVENTORY_QUANTITY_PRECISION_UNSUPPORTED" ? 409 : 500)
    .json({ code: error.code?.startsWith("IV_") || error.code === "INVENTORY_QUANTITY_PRECISION_UNSUPPORTED" ? error.code : "IV_OPERATION_FAILED" });
  const mutate = operation => async (req, res) => {
    let cx;
    try {
      if (!req.user?.company_id || !(req.user.user_id || req.user.id)) return res.status(401).json({ code: "IV_AUTHENTICATION_REQUIRED" });
      if (!req.body || Array.isArray(req.body) || Object.keys(req.body).some(key => !fields[operation].includes(key))) m.fail("IV_UNSUPPORTED_EVIDENCE_FIELD");
      if (operation === "cost") m.validateCost(req.body.evidence);
      if (["approve", "reject", "approve-correction"].includes(operation) && req.user.role !== "owner") return res.status(403).json({ code: "IV_OWNER_APPROVAL_REQUIRED" });
      cx = await pool.getConnection();
      await cx.beginTransaction();
      const x = { ...req.body, company_id: req.user.company_id, actor_id: req.user.user_id || req.user.id };
      let result;
      if (operation === "opening") {
        await v.prepare(cx, x);
        const rows = await v.records(cx, x);
        if (v.find(rows, x.source_id, "ACQUISITION").document_type !== "OPENING") m.fail("IV_SOURCE_UNSUPPORTED");
        result = await v.postAcquisition(cx, x);
      } else result = await methods[operation](cx, x);
      await cx.commit();
      res.status(200).json({ evidence: result });
    } catch (error) { if (cx) await cx.rollback(); errorResponse(res, error); }
    finally { if (cx) cx.release(); }
  };
  const history = async (req, res) => {
    let cx;
    try {
      cx = await pool.getConnection();
      const rows = await v.records(cx, { company_id: req.user.company_id, product_id: req.params.product_id }, false);
      res.json({ evidence: rows });
    } catch (error) { errorResponse(res, error); } finally { if (cx) cx.release(); }
  };
  return { ...Object.fromEntries(Object.keys(fields).map(k => [k, mutate(k)])), history,
    readiness: async (req, res) => {
      const cx = await pool.getConnection();
      try { res.json(await readiness.inspectInventoryValuation(cx, req.user.company_id)); } finally { cx.release(); }
    } };
};
