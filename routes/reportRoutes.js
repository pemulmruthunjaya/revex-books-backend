const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const purchaseReports = require("../controllers/purchaseReportController");

const {
  getProfit,
  getSales,
  getPurchase,
  getStock,
  getStockMovementReport,
  getLowStock,
  getDeliveryChallanReport,
  getReturnReport,
  getGstSalesRegister,
  getGstPurchaseRegister,
  getGstr1Summary,
  getGstr3bSummary,
  getItcReport,
  getOutputGstReport,
  getHsnReport,
  getGstFilingReadiness,
  getPayrollReport,
} = require("../controllers/reportController");

router.get("/profit", authMiddleware, getProfit);
router.get("/sales", authMiddleware, getSales);
router.get("/purchase", authMiddleware, getPurchase);
router.get("/stock", authMiddleware, getStock);
router.get("/inventory", authMiddleware, getStock);
router.get("/stock-movement", authMiddleware, getStockMovementReport);
router.get("/low-stock", authMiddleware, getLowStock);
router.get("/delivery-challans", authMiddleware, getDeliveryChallanReport);
router.get("/returns", authMiddleware, getReturnReport);
router.get("/gst-sales-register", authMiddleware, getGstSalesRegister);
router.get("/gst-purchase-register", authMiddleware, getGstPurchaseRegister);
router.get("/gstr-1-summary", authMiddleware, getGstr1Summary);
router.get("/gstr-3b-summary", authMiddleware, getGstr3bSummary);
router.get("/itc", authMiddleware, getItcReport);
router.get("/output-gst", authMiddleware, getOutputGstReport);
router.get("/hsn", authMiddleware, getHsnReport);
router.get("/gst-readiness", authMiddleware, getGstFilingReadiness);
router.get("/payroll", authMiddleware, getPayrollReport);
router.get(
  "/purchases/register",
  authMiddleware,
  purchaseReports.purchaseRegister,
);
router.get(
  "/purchases/purchase-orders",
  authMiddleware,
  purchaseReports.purchaseOrders,
);
router.get(
  "/purchases/pending-purchase-orders",
  authMiddleware,
  purchaseReports.pendingPurchaseOrders,
);
router.get(
  "/purchases/grn-register",
  authMiddleware,
  purchaseReports.grnRegister,
);
router.get(
  "/purchases/grn-bill-reconciliation",
  authMiddleware,
  purchaseReports.grnBillReconciliation,
);
router.get(
  "/purchases/unbilled-grns",
  authMiddleware,
  purchaseReports.unbilledGrns,
);

module.exports = router;
