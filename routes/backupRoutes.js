const express = require("express");
const router = express.Router();

const {
  previewRestoreBackup,
  trialBackupUnavailable,
} = require("../controllers/backupController");

router.get("/history", trialBackupUnavailable);
router.get("/export", trialBackupUnavailable);
router.get("/export/:type", trialBackupUnavailable);
router.post("/restore/preview", previewRestoreBackup);
router.post("/import/:type", trialBackupUnavailable);
router.post("/transactions/:type", trialBackupUnavailable);
router.post("/rollback/:id", trialBackupUnavailable);

module.exports = router;
