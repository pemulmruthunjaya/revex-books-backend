const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");

// ✅ ONLY import functions that actually exist
const {
  createBill,
  createBillFromGrn,
  getBills,
  getBillById,
  updateBill,
  deleteBill,
  getLastPurchasePrices,
  updateBillStatus,
} = require("../controllers/billController");

/* ================= CREATE ================= */
router.post("/", authMiddleware, createBill);
router.post("/from-grn", authMiddleware, createBillFromGrn);

/* ================= GET ALL ================= */
router.get("/", authMiddleware, getBills);

/* ================= GET LAST PURCHASE PRICES ================= */
router.get("/item-prices", authMiddleware, getLastPurchasePrices);

/* ================= GET ONE ================= */
router.get("/:id", authMiddleware, getBillById);

/* ================= UPDATE FULL ================= */
router.put("/:id", authMiddleware, updateBill);

/* ================= UPDATE STATUS ================= */
router.put("/:id/status", authMiddleware, updateBillStatus);

/* ================= DELETE ================= */
router.delete("/:id", authMiddleware, deleteBill);

module.exports = router;
