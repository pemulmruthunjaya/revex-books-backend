const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const {
  createPurchaseOrder,
  convertPurchaseOrderToBill,
  deletePurchaseOrder,
  getPurchaseOrderById,
  getPurchaseOrders,
  getNextPurchaseOrderNumber,
  updatePurchaseOrder,
  updatePurchaseOrderStatus,
} = require("../controllers/purchaseOrderController");

router.post("/", authMiddleware, createPurchaseOrder);
router.get("/next-number", authMiddleware, getNextPurchaseOrderNumber);
router.get("/", authMiddleware, getPurchaseOrders);
router.get("/:id", authMiddleware, getPurchaseOrderById);
router.put("/:id", authMiddleware, updatePurchaseOrder);
router.put("/:id/status", authMiddleware, updatePurchaseOrderStatus);
router.post("/:id/convert-to-bill", authMiddleware, convertPurchaseOrderToBill);
router.delete("/:id", authMiddleware, deletePurchaseOrder);

module.exports = router;
