const router = require("express").Router();
const controller = require("../controllers/barcodeController");

router.get("/settings", controller.getSettings);
router.put("/settings", controller.saveSettings);
router.get("/profiles", controller.listProfiles);
router.post("/profiles", controller.createProfile);
router.put("/profiles/:id", controller.updateProfile);
router.delete("/profiles/:id", controller.deleteProfile);
router.get("/templates", controller.listTemplates);
router.post("/templates", controller.createTemplate);
router.put("/templates/:id", controller.updateTemplate);
router.delete("/templates/:id", controller.deleteTemplate);
router.post("/products/:id/barcode", controller.ensureProductBarcode);

module.exports = router;
