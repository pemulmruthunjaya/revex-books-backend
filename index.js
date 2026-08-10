require("dotenv").config();

const express = require("express");
const cors = require("cors");
const {
  apiRateLimiter,
  authRateLimiter,
  securityHeaders,
} = require("./middleware/securityMiddleware");
const authMiddleware = require("./middleware/authMiddleware");
const {
  allowAccess,
  ownerOnly,
} = require("./middleware/permissionMiddleware");
const auditLogMiddleware = require("./middleware/auditLogMiddleware");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

/**
 * =========================================================
 * DATABASE CONNECTION
 * =========================================================
 */
const db = require("./db/connection");

/**
 * =========================================================
 * ROUTE IMPORTS
 * =========================================================
 */

/* ================= AUTH ================= */
const authRoutes = require("./routes/authRoutes");
const usersRoutes = require("./routes/usersRoutes");
const staffRoutes = require("./routes/staffRoutes");
const auditLogRoutes = require("./routes/auditLogRoutes");

/* ================= SALES ================= */
const customerRoutes = require("./routes/customerRoutes");
const invoiceRoutes = require("./routes/invoiceRoutes");
const invoiceItemRoutes = require("./routes/invoiceItemRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const invoiceSettingsRoutes = require("./routes/invoiceSettingsRoutes");
const quotationRoutes = require("./routes/quotationRoutes");
const recurringInvoiceRoutes = require("./routes/recurringInvoices");

/* ================= PRODUCTS ================= */
const productRoutes = require("./routes/productRoutes");
const barcodeRoutes = require("./routes/barcodeRoutes");

/* ================= VENDORS ================= */
const vendorRoutes = require("./routes/vendorRoutes");
const vendorPaymentRoutes = require("./routes/vendorPaymentRoutes");

/* ================= PURCHASES ================= */
const purchaseOrderRoutes = require("./routes/purchaseOrderRoutes");
const goodsReceiptRoutes = require("./routes/goodsReceiptRoutes");
const billRoutes = require("./routes/billRoutes");

/* ================= DELIVERY CHALLANS ================= */
const deliveryChallanRoutes = require("./routes/deliveryChallanRoutes");

/* ================= RETURNS ================= */
const returnRoutes = require("./routes/returnRoutes");

/* ================= ACCOUNTING ================= */
const expenseRoutes = require("./routes/expenseRoutes");
const ledgerRoutes = require("./routes/ledgerRoutes");
const accountRoutes = require("./routes/accountRoutes");
const journalEntryRoutes = require("./routes/journalEntryRoutes");
const receiptEntryRoutes = require("./routes/receiptEntryRoutes");
const paymentEntryRoutes = require("./routes/paymentEntryRoutes");
const cashBookRoutes = require("./routes/cashBookRoutes");
const bankBookRoutes = require("./routes/bankBookRoutes");
const customerStatementRoutes = require("./routes/customerStatementRoutes");
const payrollRoutes = require("./routes/payrollRoutes");
const pettyCashRoutes = require("./routes/pettyCashRoutes");

/* ================= ACCOUNTING REPORTS ================= */
const trialBalanceRoutes = require(
  "./routes/trialBalanceRoutes"
);

const profitLossRoutes = require(
  "./routes/profitLossRoutes"
);

const balanceSheetRoutes = require(
  "./routes/balanceSheetRoutes"
);

/* ================= DASHBOARD ================= */
const dashboardRoutes = require("./routes/dashboardRoutes");

/* ================= BUSINESS ================= */
const businessRoutes = require("./routes/businessRoutes");

/* ================= REPORTS ================= */
const reportRoutes = require("./routes/reportRoutes");
const backupRoutes = require("./routes/backupRoutes");
const {
  buildProductionReadinessReport,
} = require("./services/productionReadinessService");
const {
  startRecurringInvoiceScheduler,
} = require("./jobs/recurringInvoiceScheduler");

/**
 * =========================================================
 * MIDDLEWARE
 * =========================================================
 */

/**
 * CORS
 */
const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions = {

  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Not allowed by CORS"));
  },

  methods: [
    "GET",
    "POST",
    "PUT",
    "DELETE"
  ],

  credentials: true,

};

app.use(cors(corsOptions));
app.use(securityHeaders);

/**
 * JSON PARSER
 */
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "25mb" }));
app.use(express.urlencoded({ extended: true, limit: process.env.JSON_BODY_LIMIT || "25mb" }));
app.use("/api", apiRateLimiter);
app.use("/api", auditLogMiddleware);

/**
 * =========================================================
 * HEALTH CHECK
 * =========================================================
 */
app.get("/", (req, res) => {

  res.status(200).json({

    success: true,

    message:
      "RevEx Books Backend Running 🚀",

    environment:
      process.env.NODE_ENV || "development"

  });

});

/**
 * =========================================================
 * API ROUTES
 * =========================================================
 */

/* =========================================================
   AUTH & USER MANAGEMENT
========================================================= */

app.use("/api/auth", authRateLimiter, authRoutes);

app.use("/api/users", authMiddleware, ownerOnly, usersRoutes);

app.use("/api/staff", authMiddleware, ownerOnly, staffRoutes);

app.use("/api/audit-logs", authMiddleware, ownerOnly, auditLogRoutes);

/* =========================================================
   SALES MODULE
========================================================= */

app.use(
  "/api/customers",
  authMiddleware,
  allowAccess(["sales", "accountant"], {
    moduleKey: "customers",
    readOnlyRoles: ["purchase", "auditor"],
  }),
  customerRoutes
);

app.use(
  "/api/invoices",
  authMiddleware,
  allowAccess(["sales", "accountant"], {
    moduleKey: "invoices",
    readOnlyRoles: ["purchase", "auditor"],
  }),
  invoiceRoutes
);

app.use(
  "/api/recurring-invoices",
  authMiddleware,
  allowAccess(["sales", "accountant"], {
    moduleKey: "invoices",
    readOnlyRoles: ["auditor"],
  }),
  recurringInvoiceRoutes
);

app.use(
  "/api/invoices",
  authMiddleware,
  allowAccess(["sales", "accountant"], {
    moduleKey: "invoices",
    readOnlyRoles: ["purchase", "auditor"],
  }),
  invoiceItemRoutes
);

app.use(
  "/api/invoices",
  authMiddleware,
  allowAccess(["sales", "accountant"], {
    moduleKey: "invoices",
    readOnlyRoles: ["purchase", "auditor"],
  }),
  paymentRoutes
);

app.use(
  "/api/invoice-settings",
  authMiddleware,
  allowAccess([], {
    moduleKey: "invoices",
    readOnlyRoles: ["sales", "purchase", "accountant", "auditor"],
  }),
  invoiceSettingsRoutes
);

app.use(
  "/api/quotations",
  authMiddleware,
  allowAccess(["sales", "accountant"], {
    moduleKey: "invoices",
    readOnlyRoles: ["purchase", "auditor"],
  }),
  quotationRoutes
);

/* =========================================================
   PRODUCT MODULE
========================================================= */

app.use(
  "/api/products",
  authMiddleware,
  allowAccess(["sales", "purchase", "accountant"], {
    moduleKey: "products",
    readOnlyRoles: ["auditor"],
  }),
  productRoutes
);

app.use(
  "/api/barcodes",
  authMiddleware,
  allowAccess(["sales", "purchase", "accountant"], {
    moduleKey: "products",
    readOnlyRoles: ["auditor"],
  }),
  barcodeRoutes
);

/* =========================================================
   PURCHASE MODULE
========================================================= */

app.use(
  "/api/vendors",
  authMiddleware,
  allowAccess(["purchase", "accountant"], {
    moduleKey: "vendors",
    readOnlyRoles: ["sales", "auditor"],
  }),
  vendorRoutes
);

app.use(
  "/api/vendor-payments",
  authMiddleware,
  allowAccess(["purchase", "accountant"], {
    moduleKey: "bills",
    readOnlyRoles: ["auditor"],
  }),
  vendorPaymentRoutes
);

app.use(
  "/api/purchase-orders",
  authMiddleware,
  allowAccess(["purchase", "accountant"], {
    moduleKey: "purchase_orders",
    readOnlyRoles: ["sales", "auditor"],
  }),
  purchaseOrderRoutes
);

app.use(
  "/api/bills",
  authMiddleware,
  allowAccess(["purchase", "accountant"], {
    moduleKey: "bills",
    readOnlyRoles: ["sales", "auditor"],
  }),
  billRoutes
);

app.use(
  "/api/goods-receipts",
  authMiddleware,
  allowAccess(["purchase", "accountant"], {
    moduleKey: "purchase_orders",
    readOnlyRoles: ["auditor"],
  }),
  goodsReceiptRoutes
);

app.use(
  "/api/delivery-challans",
  authMiddleware,
  allowAccess(["sales", "purchase"], {
    moduleKey: "delivery_challans",
    readOnlyRoles: ["accountant", "auditor"],
  }),
  deliveryChallanRoutes
);

app.use(
  "/api/returns",
  authMiddleware,
  allowAccess(["sales", "purchase", "accountant"], {
    moduleKey: "returns",
    readOnlyRoles: ["auditor"],
  }),
  returnRoutes
);

/* =========================================================
   ACCOUNTING MODULE
========================================================= */

app.use(
  "/api/expenses",
  authMiddleware,
  allowAccess(["accountant"], {
    moduleKey: "accounting",
    readOnlyRoles: ["auditor"],
  }),
  expenseRoutes
);

app.use(
  "/api/petty-cash",
  authMiddleware,
  pettyCashRoutes
);

app.use(
  "/api/accounts",
  authMiddleware,
  allowAccess(["accountant"], {
    moduleKey: "accounting",
    readOnlyRoles: ["auditor"],
  }),
  accountRoutes
);

app.use(
  "/api/journal-entries",
  authMiddleware,
  allowAccess(["accountant"], {
    moduleKey: "accounting",
    readOnlyRoles: ["auditor"],
  }),
  journalEntryRoutes
);

app.use(
  "/api/receipt-entries",
  authMiddleware,
  allowAccess(["accountant"], {
    moduleKey: "accounting",
    readOnlyRoles: ["auditor"],
  }),
  receiptEntryRoutes
);

app.use(
  "/api/payment-entries",
  authMiddleware,
  allowAccess(["accountant"], {
    moduleKey: "accounting",
    readOnlyRoles: ["auditor"],
  }),
  paymentEntryRoutes
);

app.use(
  "/api/payroll",
  authMiddleware,
  allowAccess(["accountant"], {
    moduleKey: "payroll",
    readOnlyRoles: ["auditor"],
  }),
  payrollRoutes
);

app.use(
  "/api/cash-book",
  authMiddleware,
  allowAccess(["accountant"], {
    moduleKey: "accounting",
    readOnlyRoles: ["auditor"],
  }),
  cashBookRoutes
);

app.use(
  "/api/bank-book",
  authMiddleware,
  allowAccess(["accountant"], {
    moduleKey: "accounting",
    readOnlyRoles: ["auditor"],
  }),
  bankBookRoutes
);

app.use(
  "/api/customer-statement",
  authMiddleware,
  allowAccess(["sales", "accountant"], {
    moduleKey: "accounting",
    readOnlyRoles: ["auditor"],
  }),
  customerStatementRoutes
);


app.use(
  "/api/ledger",
  authMiddleware,
  allowAccess(["accountant"], {
    moduleKey: "accounting",
    readOnlyRoles: ["auditor"],
  }),
  ledgerRoutes
);

/* =========================================================
   ACCOUNTING REPORTS
========================================================= */

app.use(
  "/api/trial-balance",
  authMiddleware,
  allowAccess(["accountant"], {
    moduleKey: "accounting",
    readOnlyRoles: ["auditor"],
  }),
  trialBalanceRoutes
);

app.use(
  "/api/profit-loss",
  authMiddleware,
  allowAccess(["accountant"], {
    moduleKey: "accounting",
    readOnlyRoles: ["auditor"],
  }),
  profitLossRoutes
);

app.use(
  "/api/balance-sheet",
  authMiddleware,
  allowAccess(["accountant"], {
    moduleKey: "accounting",
    readOnlyRoles: ["auditor"],
  }),
  balanceSheetRoutes
);

/* =========================================================
   BUSINESS PROFILE
========================================================= */

app.use(
  "/api/business",
  authMiddleware,
  allowAccess([], {
    moduleKey: "business",
    readOnlyRoles: ["sales", "purchase", "accountant", "auditor"],
  }),
  businessRoutes
);

/* =========================================================
   REPORTS MODULE
========================================================= */

app.use(
  "/api/reports",
  authMiddleware,
  allowAccess(["sales", "purchase", "accountant"], {
    moduleKey: "reports",
    readOnlyRoles: ["auditor"],
  }),
  reportRoutes
);

/* =========================================================
   DATA IMPORT & BACKUP
========================================================= */

app.use(
  "/api/backup",
  authMiddleware,
  ownerOnly,
  backupRoutes
);

/* =========================================================
   DASHBOARD MODULE
========================================================= */

app.use(
  "/api/dashboard",
  authMiddleware,
  allowAccess(["sales", "purchase", "accountant"], {
    moduleKey: "dashboard",
    readOnlyRoles: ["auditor"],
  }),
  dashboardRoutes
);

/**
 * =========================================================
 * READINESS CHECK
 * =========================================================
 */
const livenessCheckHandler = (req, res) => {
  res.status(200).json({
    success: true,
    status: "ok",
    checkedAt: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  });
};

const readinessCheckHandler = async (req, res, next) => {
  try {
    const report = await buildProductionReadinessReport();

    res.status(report.success ? 200 : 503).json(report);
  } catch (error) {
    next(error);
  }
};

app.get("/health", livenessCheckHandler);
app.get("/api/health", readinessCheckHandler);

/**
 * =========================================================
 * ERROR HANDLER
 * =========================================================
 */
app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  console.error("API error:", err.message);
  return res.status(err.status || 500).json({
    success: false,
    message: err.message === "Not allowed by CORS" ? "Origin not allowed" : "Server error",
  });
});

/**
 * =========================================================
 * 404 HANDLER
 * =========================================================
 */
app.use((req, res) => {

  res.status(404).json({

    success: false,

    message: "API route not found"

  });

});

/**
 * =========================================================
 * START SERVER
 * =========================================================
 */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {

  console.log(
    "✅ Connected to Railway MySQL (Promise Pool)"
  );

  console.log(
    `🚀 ERP Backend running on port ${PORT}`
  );

  startRecurringInvoiceScheduler();
});
