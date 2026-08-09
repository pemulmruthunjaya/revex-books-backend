const db = require("../db/connection");

const defaults = {
  default_barcode_type: "CODE128", show_barcode_text: 1, barcode_height_mm: 12,
  barcode_scale: 2, barcode_rotation: 0, default_label_width_mm: 50,
  default_label_height_mm: 25, labels_per_row: 1, horizontal_gap_mm: 0,
  vertical_gap_mm: 0, margin_top_mm: 0, margin_bottom_mm: 0,
  margin_left_mm: 0, margin_right_mm: 0, paper_type: "thermal_roll", default_dpi: 203,
};

const settingFields = Object.keys(defaults);
const profileFields = ["name", "label_width_mm", "label_height_mm", "dpi", "labels_per_row",
  "horizontal_gap_mm", "vertical_gap_mm", "margin_top_mm", "margin_bottom_mm",
  "margin_left_mm", "margin_right_mm", "paper_type", "is_default"];

const pick = (body, fields) => Object.fromEntries(fields.map((field) => [field, body[field]]));
const parseTemplate = (row) => ({ ...row, template_json: typeof row.template_json === "string" ? JSON.parse(row.template_json) : row.template_json });

exports.getSettings = async (req, res) => {
  const [rows] = await db.query("SELECT * FROM barcode_settings WHERE company_id=? LIMIT 1", [req.user.company_id]);
  res.json(rows[0] || defaults);
};

exports.saveSettings = async (req, res) => {
  const values = pick({ ...defaults, ...req.body }, settingFields);
  const columns = settingFields.join(", ");
  const placeholders = settingFields.map(() => "?").join(", ");
  const updates = settingFields.map((field) => `${field}=VALUES(${field})`).join(", ");
  await db.query(`INSERT INTO barcode_settings (company_id, ${columns}) VALUES (?, ${placeholders}) ON DUPLICATE KEY UPDATE ${updates}`,
    [req.user.company_id, ...settingFields.map((field) => values[field])]);
  res.json({ message: "Barcode settings saved" });
};

exports.listProfiles = async (req, res) => {
  const [rows] = await db.query("SELECT * FROM printer_profiles WHERE company_id=? ORDER BY is_default DESC, name", [req.user.company_id]);
  res.json(rows);
};

exports.createProfile = async (req, res) => {
  const data = pick(req.body, profileFields);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    if (data.is_default) await connection.query("UPDATE printer_profiles SET is_default=0 WHERE company_id=?", [req.user.company_id]);
    const [result] = await connection.query(`INSERT INTO printer_profiles (company_id, ${profileFields.join(",")}) VALUES (?,${profileFields.map(() => "?").join(",")})`, [req.user.company_id, ...profileFields.map((f) => data[f])]);
    await connection.commit();
    res.status(201).json({ id: result.insertId, message: "Printer profile created" });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
};

exports.updateProfile = async (req, res) => {
  const data = pick(req.body, profileFields);
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    if (data.is_default) await connection.query("UPDATE printer_profiles SET is_default=0 WHERE company_id=?", [req.user.company_id]);
    const [result] = await connection.query(`UPDATE printer_profiles SET ${profileFields.map((f) => `${f}=?`).join(",")} WHERE id=? AND company_id=?`, [...profileFields.map((f) => data[f]), req.params.id, req.user.company_id]);
    if (!result.affectedRows) { await connection.rollback(); return res.status(404).json({ message: "Printer profile not found" }); }
    await connection.commit(); res.json({ message: "Printer profile updated" });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
};

exports.deleteProfile = async (req, res) => {
  const [result] = await db.query("DELETE FROM printer_profiles WHERE id=? AND company_id=?", [req.params.id, req.user.company_id]);
  if (!result.affectedRows) return res.status(404).json({ message: "Printer profile not found" });
  res.json({ message: "Printer profile deleted" });
};

exports.listTemplates = async (req, res) => {
  const [rows] = await db.query("SELECT * FROM barcode_templates WHERE company_id=? ORDER BY is_default DESC, name", [req.user.company_id]);
  res.json(rows.map(parseTemplate));
};

const saveTemplate = async (req, res, id) => {
  const { name, label_width_mm, label_height_mm, template_json, is_default = 0 } = req.body;
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    if (is_default) await connection.query("UPDATE barcode_templates SET is_default=0 WHERE company_id=?", [req.user.company_id]);
    let result;
    if (id) [result] = await connection.query("UPDATE barcode_templates SET name=?,label_width_mm=?,label_height_mm=?,template_json=?,is_default=? WHERE id=? AND company_id=?", [name, label_width_mm, label_height_mm, JSON.stringify(template_json), is_default, id, req.user.company_id]);
    else [result] = await connection.query("INSERT INTO barcode_templates (company_id,name,label_width_mm,label_height_mm,template_json,is_default) VALUES (?,?,?,?,?,?)", [req.user.company_id, name, label_width_mm, label_height_mm, JSON.stringify(template_json), is_default]);
    if (id && !result.affectedRows) { await connection.rollback(); return res.status(404).json({ message: "Template not found" }); }
    await connection.commit(); res.status(id ? 200 : 201).json({ id: id || result.insertId, message: `Template ${id ? "updated" : "created"}` });
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
};
exports.createTemplate = (req, res) => saveTemplate(req, res);
exports.updateTemplate = (req, res) => saveTemplate(req, res, req.params.id);
exports.deleteTemplate = async (req, res) => {
  const [result] = await db.query("DELETE FROM barcode_templates WHERE id=? AND company_id=?", [req.params.id, req.user.company_id]);
  if (!result.affectedRows) return res.status(404).json({ message: "Template not found" });
  res.json({ message: "Template deleted" });
};

exports.ensureProductBarcode = async (req, res) => {
  const companyId = req.user.company_id;
  const [rows] = await db.query("SELECT id,barcode FROM products WHERE id=? AND company_id=?", [req.params.id, companyId]);
  if (!rows.length) return res.status(404).json({ message: "Product not found" });
  if (rows[0].barcode) return res.json({ barcode: rows[0].barcode });
  const barcode = `RVX${String(companyId).padStart(4, "0")}${String(rows[0].id).padStart(8, "0")}`;
  await db.query("UPDATE products SET barcode=? WHERE id=? AND company_id=? AND (barcode IS NULL OR barcode='')", [barcode, rows[0].id, companyId]);
  res.json({ barcode });
};
