const express = require("express");
const { ownerOnly } = require("../middleware/permissionMiddleware");
const controller = require("../controllers/financialYearController");

const router = express.Router();

router.get("/", controller.list);
router.get("/default", controller.getDefault);
router.get("/resolve", controller.resolve);
router.get("/:id/events", controller.events);
router.get("/:id", controller.getOne);
router.post("/", ownerOnly, controller.create);
router.post("/:id/default", ownerOnly, controller.setDefault);

module.exports = router;
