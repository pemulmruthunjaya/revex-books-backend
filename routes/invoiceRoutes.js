const express = require("express");
const router = express.Router();

const invoiceController = require("../controllers/invoiceController");
const authMiddleware = require("../middleware/authMiddleware");

/**
 * 🛡️ SAFE HANDLER WRAPPER
 * Prevents "handler must be a function" crash
 */
const safe = (fn) => {
  return (req, res, next) => {
    if (typeof fn !== "function") {
      console.error("❌ Route handler is missing!");
      return res.status(500).json({
        message: "Route not implemented yet"
      });
    }
    return fn(req, res, next);
  };
};

/* ================= CREATE ================= */
router.post("/", authMiddleware, safe(invoiceController.createInvoice));

/* ================= GET ALL ================= */
router.get("/", authMiddleware, safe(invoiceController.getInvoices));

router.get("/party-item-rate", authMiddleware, safe(invoiceController.getPartyItemRate));
router.get("/next-number", authMiddleware, safe(invoiceController.getNextInvoiceNumber));

/* ================= GET ONE ================= */
router.get("/:id", authMiddleware, safe(invoiceController.getInvoiceById));

/* ================= UPDATE FULL ================= */
router.put("/:id", authMiddleware, safe(invoiceController.updateInvoice));

/* ================= UPDATE STATUS ================= */
router.put("/:id/status", authMiddleware, safe(invoiceController.updateInvoiceStatus));

/* ================= DELETE ================= */
router.delete("/:id", authMiddleware, safe(invoiceController.deleteInvoice));

/* ================= PDF ================= */
router.get("/:id/pdf", authMiddleware, safe(invoiceController.generateInvoicePDF));

module.exports = router;
