const db = require("../db/connection");

const STAFF_ACCESS_ROLES = new Set(["sales", "purchase", "accountant", "auditor"]);
const PERMISSION_ACTIONS = ["view", "create", "edit", "delete"];
const PERMISSION_MODULES = [
  { key: "dashboard", label: "Dashboard" },
  { key: "customers", label: "Customers" },
  { key: "invoices", label: "Sales Invoices" },
  { key: "products", label: "Products & Inventory" },
  { key: "vendors", label: "Vendors" },
  { key: "purchase_orders", label: "Purchase Orders" },
  { key: "bills", label: "Purchase Bills" },
  { key: "delivery_challans", label: "Delivery Challans" },
  { key: "returns", label: "Sales & Purchase Returns" },
  { key: "accounting", label: "Accounting" },
  { key: "payroll", label: "Payroll" },
  { key: "reports", label: "Reports" },
  { key: "business", label: "Business Profile" },
];

let usersAccessReady = false;

const emptyPermissions = () =>
  PERMISSION_MODULES.reduce((permissions, module) => {
    permissions[module.key] = PERMISSION_ACTIONS.reduce((actions, action) => {
      actions[action] = false;
      return actions;
    }, {});
    return permissions;
  }, {});

const allowModule = (permissions, moduleKey, actions = PERMISSION_ACTIONS) => {
  actions.forEach((action) => {
    permissions[moduleKey][action] = true;
  });
};

const readonlyAll = () => {
  const permissions = emptyPermissions();
  PERMISSION_MODULES.forEach((module) => allowModule(permissions, module.key, ["view"]));
  return permissions;
};

const getDefaultPermissions = (role = "sales") => {
  const permissions = emptyPermissions();

  if (role === "owner") {
    PERMISSION_MODULES.forEach((module) => allowModule(permissions, module.key));
    return permissions;
  }

  if (role === "auditor") {
    return readonlyAll();
  }

  allowModule(permissions, "dashboard", ["view"]);
  allowModule(permissions, "business", ["view"]);
  allowModule(permissions, "reports", ["view"]);

  if (role === "sales") {
    allowModule(permissions, "customers");
    allowModule(permissions, "invoices");
    allowModule(permissions, "products", ["view", "create", "edit"]);
    allowModule(permissions, "delivery_challans");
    allowModule(permissions, "returns");
    allowModule(permissions, "vendors", ["view"]);
    allowModule(permissions, "purchase_orders", ["view"]);
    allowModule(permissions, "bills", ["view"]);
  }

  if (role === "purchase") {
    allowModule(permissions, "vendors");
    allowModule(permissions, "purchase_orders");
    allowModule(permissions, "bills");
    allowModule(permissions, "products");
    allowModule(permissions, "delivery_challans");
    allowModule(permissions, "returns");
    allowModule(permissions, "customers", ["view"]);
    allowModule(permissions, "invoices", ["view"]);
  }

  if (role === "accountant") {
    [
      "customers",
      "invoices",
      "products",
      "vendors",
      "purchase_orders",
      "bills",
      "returns",
      "accounting",
      "payroll",
    ].forEach((moduleKey) => allowModule(permissions, moduleKey));
    allowModule(permissions, "delivery_challans", ["view"]);
  }

  return permissions;
};

const parsePermissions = (permissions, role = "sales") => {
  if (!permissions) {
    return getDefaultPermissions(role);
  }

  try {
    const parsed =
      typeof permissions === "string" ? JSON.parse(permissions) : permissions;
    return normalizePermissions(parsed, role);
  } catch {
    return getDefaultPermissions(role);
  }
};

const normalizePermissions = (permissions, role = "sales") => {
  const defaults = getDefaultPermissions(role);
  const incoming = permissions && typeof permissions === "object" ? permissions : {};

  return PERMISSION_MODULES.reduce((result, module) => {
    result[module.key] = PERMISSION_ACTIONS.reduce((actions, action) => {
      const value = incoming[module.key]?.[action];
      actions[action] =
        typeof value === "boolean" ? value : Boolean(defaults[module.key]?.[action]);
      return actions;
    }, {});
    return result;
  }, {});
};

const { assertTableColumns } = require("./schemaReadinessService");

const USER_ACCESS_COLUMNS = Object.freeze([
  "access_role",
  "permissions",
  "is_active",
  "last_login_at",
  "must_change_password",
  "password_reset_token_hash",
  "password_reset_expires_at",
  "password_changed_at",
]);

const ensureUserAccessColumns = async () => {
  if (usersAccessReady) {
    return;
  }

  await assertTableColumns({
    executor: db,
    table: "users",
    columns: USER_ACCESS_COLUMNS,
    code: "USER_ACCESS_SCHEMA_NOT_READY",
  });

  usersAccessReady = true;
};

const normalizeAccessRole = (value, fallback = "sales") => {
  const role = String(value || "").trim().toLowerCase();
  return STAFF_ACCESS_ROLES.has(role) ? role : fallback;
};

module.exports = {
  ensureUserAccessColumns,
  getDefaultPermissions,
  normalizePermissions,
  parsePermissions,
  PERMISSION_ACTIONS,
  PERMISSION_MODULES,
  normalizeAccessRole,
  STAFF_ACCESS_ROLES,
};
