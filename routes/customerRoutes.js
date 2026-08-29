const express = require("express");
const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");
const {
  createCustomer,
  getCustomers,
  getCustomer,
  getCustomerFinancialSummary,
  updateCustomer,
  deleteCustomer
} = require("../controllers/customerController");

router.post("/", authMiddleware, createCustomer);
router.get("/", authMiddleware, getCustomers);
router.get("/:customerId/financial-summary", authMiddleware, getCustomerFinancialSummary);
router.get("/:id", authMiddleware, getCustomer);
router.put("/:id", authMiddleware, updateCustomer);
router.delete("/:id", authMiddleware, deleteCustomer);

module.exports = router;
