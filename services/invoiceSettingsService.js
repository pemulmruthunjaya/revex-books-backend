const db = require("../db/connection");

const DEFAULTS = Object.freeze({
  paper_size: "A4",
  orientation: "portrait",
  template_name: "standard",
  show_logo: true,
  show_company_address: true,
  show_gstin: true,
  show_phone: true,
  show_email: true,
  show_customer_address: true,
  show_customer_gstin: true,
  show_hsn_sku: true,
  show_mrp: true,
  show_discount: true,
  show_gst_percent: true,
  show_cgst: true,
  show_sgst: true,
  show_igst: true,
  show_amount_in_words: true,
  show_payment_status: true,
  show_received: true,
  show_pending: true,
  show_notes: true,
  show_terms: true,
  show_bank_details: true,
  show_signature: true,
  invoice_title: "Tax Invoice",
  bill_to_label: "Bill To",
  footer_text: "This is a computer generated tax invoice.",
  terms_text: "",
  bank_details: "",
  signature_label: "Authorized Signatory",
  font_size: "medium",
  header_alignment: "split",
  accent_color: "#2563eb",
  logo_size: "medium",
  table_density: "normal",
  barcodeScan: false,
  defaultUnit: "PCS",
  partyWiseItemRate: false,
  description: false,
  itemWiseDiscount: true,
  overallBillDiscount: false,
  additionalDiscount: false,
  roundOff: false,
  itemWiseTax: true,
  mrp: true,
  serialImei: false,
  batchNo: false,
  mfgDate: false,
  expDate: false,
});

const ALLOWED_ENUMS = {
  paper_size: ["A4", "A5", "Letter", "Thermal80"],
  orientation: ["portrait", "landscape"],
  template_name: ["standard", "modern", "compact"],
  font_size: ["small", "medium", "large"],
  header_alignment: ["left", "center", "split"],
  logo_size: ["small", "medium", "large"],
  table_density: ["compact", "normal"],
};

const SALES_BOOLEAN_FIELDS = [
  "barcodeScan", "partyWiseItemRate", "description", "itemWiseDiscount",
  "overallBillDiscount", "additionalDiscount", "roundOff", "itemWiseTax",
  "mrp", "serialImei", "batchNo", "mfgDate", "expDate",
];
const BOOLEAN_FIELDS = [
  ...Object.keys(DEFAULTS).filter((key) => key.startsWith("show_")),
  ...SALES_BOOLEAN_FIELDS,
];
const TEXT_FIELDS = [
  "invoice_title",
  "bill_to_label",
  "footer_text",
  "terms_text",
  "bank_details",
  "signature_label",
];

let schemaReady = false;

const ensureInvoiceCustomizationSchema = async () => {
  if (schemaReady) return;
  const [columns] = await db.query(
    `SELECT COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'invoice_settings'
       AND COLUMN_NAME = 'customization_json'`
  );
  if (!columns.length) {
    await db.query(
      "ALTER TABLE invoice_settings ADD COLUMN customization_json JSON NULL"
    );
  }
  schemaReady = true;
};

const parseCustomization = (value) => {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
};

const validateCustomization = (input = {}) => {
  const settings = {};

  for (const [field, allowed] of Object.entries(ALLOWED_ENUMS)) {
    const value = input[field] ?? DEFAULTS[field];
    if (!allowed.includes(value)) {
      const error = new Error(`Unsupported ${field}`);
      error.status = 400;
      throw error;
    }
    settings[field] = value;
  }

  for (const field of BOOLEAN_FIELDS) {
    settings[field] =
      typeof input[field] === "boolean" ? input[field] : DEFAULTS[field];
  }

  for (const field of TEXT_FIELDS) {
    settings[field] = String(input[field] ?? DEFAULTS[field])
      .trim()
      .slice(0, field === "invoice_title" || field === "bill_to_label" ? 80 : 2000);
  }

  const accentColor = String(input.accent_color || DEFAULTS.accent_color);
  if (!/^#[0-9a-fA-F]{6}$/.test(accentColor)) {
    const error = new Error("Accent color must be a 6-digit hex color");
    error.status = 400;
    throw error;
  }
  settings.accent_color = accentColor.toLowerCase();
  const defaultUnit = String(input.defaultUnit ?? DEFAULTS.defaultUnit).trim();
  if (!defaultUnit || defaultUnit.length > 30 || !/^[\p{L}\p{N} ._\/-]+$/u.test(defaultUnit)) {
    const error = new Error("Default unit is invalid");
    error.status = 400;
    throw error;
  }
  settings.defaultUnit = defaultUnit;

  if (settings.paper_size === "Thermal80") settings.orientation = "portrait";
  return settings;
};

const getSettings = async (companyId) => {
  await ensureInvoiceCustomizationSchema();
  const [rows] = await db.query(
    "SELECT prefix, current_number, customization_json FROM invoice_settings WHERE company_id = ? LIMIT 1",
    [companyId]
  );
  if (!rows.length) {
    await db.query(
      `INSERT INTO invoice_settings
       (company_id, prefix, current_number, customization_json)
       VALUES (?, 'INV', 1, ?)`,
      [companyId, JSON.stringify(DEFAULTS)]
    );
    return { prefix: "INV", current_number: 1, ...DEFAULTS };
  }
  return {
    prefix: rows[0].prefix,
    current_number: rows[0].current_number,
    ...DEFAULTS,
    ...parseCustomization(rows[0].customization_json),
  };
};

const updateSettings = async (companyId, input) => {
  await ensureInvoiceCustomizationSchema();
  const current = await getSettings(companyId);
  const customization = validateCustomization({ ...current, ...input });

  const requestedPrefix = input.prefix === undefined
    ? current.prefix
    : String(input.prefix).trim().replace(/-+$/, "");
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,18}$/.test(requestedPrefix)) {
    const error = new Error("Invoice prefix must be 1-19 letters, numbers, underscores, or hyphens");
    error.status = 400;
    throw error;
  }

  await db.query(
    `UPDATE invoice_settings
     SET prefix = ?, customization_json = ?
     WHERE company_id = ?`,
    [requestedPrefix, JSON.stringify(customization), companyId]
  );
  return { prefix: requestedPrefix, current_number: current.current_number, ...customization };
};

module.exports = {
  DEFAULTS,
  ensureInvoiceCustomizationSchema,
  getSettings,
  updateSettings,
  validateCustomization,
};
