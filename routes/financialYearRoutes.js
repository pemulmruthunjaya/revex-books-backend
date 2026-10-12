const express = require("express");
const { ownerOnly } = require("../middleware/permissionMiddleware");
const controller = require("../controllers/financialYearController");
const close = require("../controllers/financialYearCloseController");

const router = express.Router();

router.get("/", controller.list);
router.get("/default", controller.getDefault);
router.get("/resolve", controller.resolve);
router.get("/subledger/items", close.openings);
router.get("/operations/:key", ownerOnly, close.operation);
router.post("/subledger/reversals", ownerOnly, close.reverse);
router.get("/:id/close-readiness", ownerOnly, close.readiness);
router.get("/:id/close-preview", ownerOnly, close.preview);
router.post("/:id/begin-close", ownerOnly, close.begin);
router.post("/:id/finalize-close", ownerOnly, close.finalize);
router.post("/:id/permanent-lock", ownerOnly, close.lock);
router.get("/:id/events", controller.events);
router.get("/:id", controller.getOne);
router.post("/", ownerOnly, controller.create);
router.post("/:id/default", ownerOnly, controller.setDefault);
router.post("/:id/transitions", ownerOnly, controller.transition);

module.exports = router;
