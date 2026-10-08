"use strict";
const router = require("express").Router();
const auth = require("../middleware/authMiddleware");
const { allowAccess } = require("../middleware/permissionMiddleware");
const controller = require("../controllers/inventoryValuationController")(require("../db/connection"));
// Mounted within the existing bills/GRN module permission boundary. Evidence
// preparation additionally requires create permission, even for read requests.
router.use(auth);
router.use((req, res, next) => allowAccess(["purchase", "accountant"], {
  moduleKey: req.baseUrl.includes("goods-receipts") ? "purchase_orders" : "bills", action: "create",
})(req, res, next));
for (const operation of ["acquisition", "component", "cost", "submit", "approve", "reject", "opening", "correction", "approve-correction"]) router.post(`/${operation}`, controller[operation]);
router.get("/readiness", controller.readiness);
router.get("/history/:product_id", controller.history);
module.exports = router;
