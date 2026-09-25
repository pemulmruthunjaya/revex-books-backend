const db = require("../db/connection");
const { getActionFromMethod } = require("../middleware/permissionMiddleware");
const { assertTableColumns } = require("./schemaReadinessService");

let auditTableReady = false;

const MODULE_FROM_PATH = [
  ["/api/staff", "staff"],
  ["/api/users", "users"],
  ["/api/customers", "customers"],
  ["/api/quotations", "invoices"],
  ["/api/invoices", "invoices"],
  ["/api/products", "products"],
  ["/api/vendors", "vendors"],
  ["/api/purchase-orders", "purchase_orders"],
  ["/api/vendor-payments", "bills"],
  ["/api/bills", "bills"],
  ["/api/delivery-challans", "delivery_challans"],
  ["/api/returns", "returns"],
  ["/api/expenses", "accounting"],
  ["/api/accounts", "accounting"],
  ["/api/journal-entries", "accounting"],
  ["/api/receipt-entries", "accounting"],
  ["/api/payment-entries", "accounting"],
  ["/api/payroll", "payroll"],
  ["/api/business", "business"],
];

const ensureAuditLogTable = async () => {
  if (auditTableReady) {
    return;
  }

  await assertTableColumns({
    executor: db,
    table: "audit_logs",
    columns: [
      "id", "company_id", "user_id", "user_name", "user_role", "access_role",
      "module_key", "action", "method", "path", "resource_id", "status_code",
      "ip_address", "user_agent", "details", "created_at",
    ],
    code: "AUDIT_LOG_SCHEMA_NOT_READY",
  });

  auditTableReady = true;
};

const getModuleFromPath = (path = "") => {
  const match = MODULE_FROM_PATH.find(([prefix]) => path.startsWith(prefix));
  return match ? match[1] : "system";
};

const getResourceIdFromPath = (path = "") => {
  const parts = path.split("?")[0].split("/").filter(Boolean);
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (/^\d+$/.test(parts[index])) {
      return parts[index];
    }
  }
  return null;
};

const getAuditDetails = (req) => {
  const body = req.body && typeof req.body === "object" ? { ...req.body } : {};
  delete body.password;
  delete body.token;

  return {
    params: req.params || {},
    body,
  };
};

const recordAuditLog = async (req, res) => {
  if (!req.user?.company_id) {
    return;
  }

  await ensureAuditLogTable();

  const path = req.originalUrl || req.url || "";

  await db.query(
    `INSERT INTO audit_logs
      (company_id, user_id, user_name, user_role, access_role, module_key, action,
       method, path, resource_id, status_code, ip_address, user_agent, details)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.user.company_id,
      req.user.user_id || req.user.id || null,
      req.user.name || null,
      req.user.role || null,
      req.user.access_role || null,
      getModuleFromPath(path),
      getActionFromMethod(req.method),
      req.method,
      path,
      getResourceIdFromPath(path),
      res.statusCode,
      req.ip || req.socket?.remoteAddress || null,
      req.get("user-agent") || null,
      JSON.stringify(getAuditDetails(req)),
    ]
  );
};

module.exports = {
  ensureAuditLogTable,
  recordAuditLog,
};
