"use strict";
const crypto = require("node:crypto");
function canonical(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.keys(v)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
    .join(",")}}`;
}
const fingerprint = (v) =>
  crypto.createHash("sha256").update(canonical(v)).digest("hex");
const bundledManifest = require("./fy6c-legacy-vendor-repair-manifest.json");
const CONTRACT_VERSION = 1;
const column = (name, type = "value") => Object.freeze({ name, type });
const TABLE_CONTRACTS = Object.freeze({
  accounting: Object.freeze({
    journal_entries: Object.freeze([
      column("id"), column("journal_no"), column("journal_date", "date"),
      column("narration"), column("total_debit", "decimal"),
      column("total_credit", "decimal"), column("created_by"),
      column("status", "boolean"), column("created_at", "timestamp"),
      column("updated_at", "timestamp"), column("company_id"),
      column("vendor_id"), column("source_type"), column("source_id"),
      column("financial_year_id"),
    ]),
    journal_entry_details: Object.freeze([
      column("id"), column("journal_entry_id"), column("account_id"),
      column("debit", "decimal"), column("credit", "decimal"),
      column("description"), column("created_at", "timestamp"),
    ]),
    ledger_entries: Object.freeze([
      column("id"), column("company_id"), column("entity_type"),
      column("entity_id"), column("reference_type"), column("reference_id"),
      column("debit", "decimal"), column("credit", "decimal"),
      column("transaction_date", "date"), column("created_at", "timestamp"),
      column("financial_year_id"),
    ]),
    accounts: Object.freeze([
      column("id"), column("account_code"), column("account_name"),
      column("account_type"), column("parent_account_id"),
      column("opening_balance", "decimal"), column("balance_type"),
      column("description"), column("status", "boolean"),
      column("created_at", "timestamp"), column("updated_at", "timestamp"),
      column("company_id"),
    ]),
    bills: Object.freeze([
      column("id"), column("bill_number"), column("bill_date", "date"),
      column("due_date", "date"), column("total_amount", "decimal"),
      column("paid_amount", "decimal"), column("due_amount", "decimal"),
      column("status"), column("company_id"), column("created_at", "timestamp"),
      column("vendor_id", "controlledVendor"), column("source_purchase_order_id"),
      column("source_grn_id"), column("stock_posted", "boolean"),
      column("financial_year_id"),
    ]),
    bill_items: Object.freeze([
      column("id"), column("bill_id"), column("source_grn_item_id"),
      column("product_id"), column("product_name"), column("quantity"),
      column("price", "decimal"), column("total", "decimal"),
      column("gst_percent", "decimal"), column("cgst", "decimal"),
      column("sgst", "decimal"), column("mrp", "decimal"),
    ]),
    vendor_payments: Object.freeze([
      column("id"), column("vendor_id", "controlledVendor"), column("bill_id"),
      column("amount", "decimal"), column("payment_date", "date"),
      column("payment_method"), column("paid_from_account_id"),
      column("reference_number"), column("notes"), column("company_id"),
      column("created_by"), column("journal_entry_id"), column("idempotency_key"),
      column("status"), column("created_at", "timestamp"),
      column("financial_year_id"),
    ]),
  }),
  stock: {
    products: Object.freeze([
      column("id"), column("name"), column("sellingPrice", "decimal"),
      column("stock"), column("created_at", "timestamp"), column("company_id"),
      column("mrp", "decimal"), column("sku"), column("barcode"), column("hsn"),
      column("category"), column("unit"), column("gst", "decimal"),
      column("purchase_price", "decimal"), column("opening_stock", "decimal"),
      column("reorder_level", "decimal"), column("status"), column("batch_no"),
      column("manufactured_date", "date"), column("expiry_date", "date"),
    ]),
    inventory_transactions: Object.freeze([
      column("id"), column("company_id"), column("branch_id"), column("product_id"),
      column("transaction_type"), column("reference_type"), column("reference_id"),
      column("quantity_in", "decimal"), column("quantity_out", "decimal"),
      column("transaction_date", "date"), column("created_by"),
      column("created_at", "timestamp"),
    ]),
    bill_items: null,
    bills: null,
    goods_receipts: Object.freeze([
      column("id"), column("company_id"), column("branch_id"), column("grn_number"),
      column("purchase_order_id"), column("vendor_id"), column("grn_date", "date"),
      column("challan_number"), column("challan_date", "date"), column("status"),
      column("stock_posted", "boolean"), column("notes"), column("created_by"),
      column("posted_by"), column("posted_at", "timestamp"),
      column("created_at", "timestamp"), column("updated_at", "timestamp"),
    ]),
    goods_receipt_items: Object.freeze([
      column("id"), column("company_id"), column("goods_receipt_id"),
      column("purchase_order_item_id"), column("product_id"),
      column("received_qty", "decimal"), column("rejected_qty", "decimal"),
      column("accepted_qty", "decimal"), column("notes"),
      column("created_at", "timestamp"),
    ]),
  },
});
TABLE_CONTRACTS.stock.bill_items = TABLE_CONTRACTS.accounting.bill_items;
TABLE_CONTRACTS.stock.bills = TABLE_CONTRACTS.accounting.bills;
Object.freeze(TABLE_CONTRACTS.stock);
const scopeFromManifest = (manifest) => {
  if (!manifest || !Array.isArray(manifest.groups))
    throw Error("FY6_FINGERPRINT_SCOPE_INVALID");
  const bills = [], payments = [];
  for (const group of manifest.groups) {
    if (!group || !Array.isArray(group.records))
      throw Error("FY6_FINGERPRINT_SCOPE_INVALID");
    for (const record of group.records) {
      if (!record || !Number.isInteger(record.record_id) || record.record_id <= 0)
        throw Error("FY6_FINGERPRINT_SCOPE_INVALID");
      if (record.record_type === "BILL") bills.push(record.record_id);
      else if (record.record_type === "VENDOR_PAYMENT") payments.push(record.record_id);
      else throw Error("FY6_FINGERPRINT_SCOPE_INVALID");
    }
  }
  const unique = (values) => [...new Set(values)].sort((a, b) => a - b);
  return { billIds: unique(bills), paymentIds: unique(payments) };
};
const APPROVED_SCOPE = Object.freeze(scopeFromManifest(bundledManifest));
Object.freeze(APPROVED_SCOPE.billIds);
Object.freeze(APPROVED_SCOPE.paymentIds);
const sameIds = (a, b) =>
  a.length === b.length && a.every((value, index) => value === b[index]);
class Fy6MysqlReadAdapter {
  constructor(pool) {
    if (!pool || typeof pool.getConnection !== "function")
      throw new TypeError("FY6_POOL_REQUIRED");
    this.pool = pool;
    this.connection = null;
    this.released = false;
    this.transaction = null;
    this.ledger = [];
    this.fingerprintScope = null;
    this.ready = this.#acquire();
  }
  async #acquire() {
    this.connection = await this.pool.getConnection();
  }
  async #conn() {
    await this.ready;
    if (this.released) throw Error("FY6_ADAPTER_RELEASED");
    return this.connection;
  }
  async #query(sql, args = []) {
    return (await this.#conn()).query(sql, args);
  }
  async beginTransaction(groupId) {
    if (!/^G[1-5]$/.test(groupId)) throw Error("FY6_GROUP_REQUIRED");
    if (this.transaction) throw Error("FY6_TX_ACTIVE");
    await this.#query("START TRANSACTION", []);
    this.transaction = { groupId, ops: [] };
  }
  async getProductionIdentityEvidence() {
    const [rows] = await this.#query(
      "SELECT @@hostname AS host,@@port AS port,@@version AS version,DATABASE() AS db",
      [],
    );
    const identity = rows && rows[0];
    if (
      !identity ||
      typeof identity.host !== "string" ||
      identity.host.length === 0 ||
      !Number.isInteger(Number(identity.port)) ||
      typeof identity.version !== "string" ||
      identity.version.length === 0 ||
      typeof identity.db !== "string" ||
      identity.db.length === 0
    )
      throw Error("PRODUCTION_LIVE_IDENTITY_REQUIRED");
    return {
      host: identity.host,
      port: Number(identity.port),
      version: identity.version,
      db: identity.db,
    };
  }
  async commit() {
    if (!this.transaction) throw Error("FY6_TX_REQUIRED");
    await this.#query("COMMIT", []);
    this.transaction.ops.forEach((o) => (o.state = "COMMITTED"));
    this.ledger.push(...this.transaction.ops);
    this.transaction = null;
  }
  async rollback() {
    if (!this.transaction) throw Error("FY6_TX_REQUIRED");
    await this.#query("ROLLBACK", []);
    this.transaction.ops.forEach((o) => (o.state = "ROLLED_BACK"));
    this.ledger.push(...this.transaction.ops);
    this.transaction = null;
  }
  async release() {
    await this.ready;
    if (this.released) return;
    if (this.transaction) throw Error("FY6_TX_ACTIVE");
    this.released = true;
    this.connection.release();
  }
  async getVendorById(id) {
    const [r] = await this.#query("SELECT * FROM vendors WHERE id=? LIMIT 1", [
      id,
    ]);
    return r[0] || null;
  }
  async findEquivalentVendorInCompany(v, c) {
    const [r] = await this.#query(
      "SELECT * FROM vendors WHERE company_id=? AND name=? ORDER BY id LIMIT 1",
      [c, v.name],
    );
    return r[0] || null;
  }
  async getBillForRepair(id) {
    const [r] = await this.#query(
      "SELECT b.id,b.company_id,b.vendor_id,v.company_id AS vendor_company_id,DATE_FORMAT(b.bill_date,'%Y-%m-%d') AS transaction_date,b.status,b.financial_year_id FROM bills b LEFT JOIN vendors v ON v.id=b.vendor_id WHERE b.id=? LIMIT 1",
      [id],
    );
    return r[0] || null;
  }
  async getVendorPaymentForRepair(id) {
    const [r] = await this.#query(
      "SELECT p.id,p.company_id,p.vendor_id,v.company_id AS vendor_company_id,DATE_FORMAT(p.payment_date,'%Y-%m-%d') AS transaction_date,p.bill_id,p.status,p.financial_year_id FROM vendor_payments p LEFT JOIN vendors v ON v.id=p.vendor_id WHERE p.id=? LIMIT 1",
      [id],
    );
    return r[0] || null;
  }
  async #getMismatchCounts(manifest) {
    if (!manifest || !Array.isArray(manifest.groups))
      throw Error("FY6_MANIFEST_REQUIRED");
    const records = manifest.groups.flatMap((g) => g.records || []);
    const billIds = records
      .filter((r) => r.record_type === "BILL")
      .map((r) => r.record_id);
    const paymentIds = records
      .filter((r) => r.record_type !== "BILL")
      .map((r) => r.record_id);
    const count = async (table, alias, ids) => {
      if (ids.length === 0) return 0;
      const placeholders = ids.map(() => "?").join(",");
      const [rows] = await this.#query(
        `SELECT COUNT(*) AS mismatchCount FROM ${table} ${alias} LEFT JOIN vendors v ON v.id=${alias}.vendor_id WHERE ${alias}.id IN (${placeholders}) AND (v.id IS NULL OR ${alias}.company_id<>v.company_id)`,
        ids,
      );
      const value = Number(rows[0]?.mismatchCount);
      if (!Number.isInteger(value) || value < 0)
        throw Error("MISMATCH_COUNT_INVALID");
      return value;
    };
    return {
      billMismatches: await count("bills", "b", billIds),
      paymentMismatches: await count(
        "vendor_payments",
        "p",
        paymentIds,
      ),
    };
  }
  async getInitialState(manifest) {
    return this.#getMismatchCounts(manifest);
  }
  async getPopulationEvidence(manifest) {
    const proposedScope = scopeFromManifest(manifest);
    if (
      !sameIds(proposedScope.billIds, APPROVED_SCOPE.billIds) ||
      !sameIds(proposedScope.paymentIds, APPROVED_SCOPE.paymentIds)
    )
      throw Error("FY6_FINGERPRINT_SCOPE_INVALID");
    const bills = [];
    for (const id of manifest.groups
      .flatMap((g) => g.records)
      .filter((r) => r.record_type === "BILL")
      .map((r) => r.record_id)
      .sort((a, b) => a - b)) {
      const row = await this.getBillForRepair(id);
      if (row)
        bills.push({
          id: row.id,
          company_id: row.company_id,
          vendor_id: row.vendor_id,
        });
    }
    const payments = [];
    for (const id of manifest.groups
      .flatMap((g) => g.records)
      .filter((r) => r.record_type !== "BILL")
      .map((r) => r.record_id)
      .sort((a, b) => a - b)) {
      const row = await this.getVendorPaymentForRepair(id);
      if (row)
        payments.push({
          id: row.id,
          company_id: row.company_id,
          vendor_id: row.vendor_id,
          bill_id: row.bill_id,
        });
    }
    const equivalentTargetVendors = [];
    for (const g of manifest.groups) {
      const source = await this.getVendorById(g.source_vendor_id);
      if (!source) continue;
      const [rows] = await this.#query(
        "SELECT * FROM vendors WHERE company_id=? AND name=? ORDER BY id",
        [g.target_company_id, source.name],
      );
      for (const v of rows) {
        const sp = { ...source };
        delete sp.id;
        delete sp.company_id;
        const sourceCopiedFingerprint = fingerprint(sp);
        const ep = { ...v };
        delete ep.id;
        delete ep.company_id;
        const candidateCopiedFingerprint = fingerprint(ep);
        if (candidateCopiedFingerprint !== sourceCopiedFingerprint) continue;
        equivalentTargetVendors.push({
          groupId: g.group_id,
          sourceVendorId: source.id,
          sourceCompanyId: source.company_id,
          targetCompanyId: g.target_company_id,
          equivalentVendorId: v.id,
          sourceFingerprint: sourceCopiedFingerprint,
          equivalentFingerprint: candidateCopiedFingerprint,
        });
      }
    }
    equivalentTargetVendors.sort(
      (a, b) =>
        a.groupId.localeCompare(b.groupId) ||
        a.equivalentVendorId - b.equivalentVendorId,
    );
    const mismatchCounts = await this.#getMismatchCounts(manifest);
    const evidence = {
      ...mismatchCounts,
      bills,
      payments,
      equivalentTargetVendors,
      fingerprint: null,
    };
    evidence.fingerprint = fingerprint(evidence);
    this.fingerprintScope = Object.freeze({
      billIds: Object.freeze([...proposedScope.billIds]),
      paymentIds: Object.freeze([...proposedScope.paymentIds]),
    });
    return evidence;
  }
  async getGlobalPostState(manifest) {
    return this.#getMismatchCounts(manifest);
  }
  async getSourceVendorEvidence(id, c) {
    const v = await this.getVendorById(id);
    if (!v || v.company_id !== c) return null;
    const p = { ...v };
    delete p.id;
    delete p.company_id;
    return {
      vendorId: id,
      companyId: c,
      fingerprint: fingerprint(p),
      protectedFields: p,
    };
  }
  async getBillEvidence(id) {
    const [rows] = await this.#query(
      "SELECT id,bill_number,DATE_FORMAT(bill_date,'%Y-%m-%d') AS bill_date,DATE_FORMAT(due_date,'%Y-%m-%d') AS due_date,CAST(total_amount AS CHAR) AS total_amount,CAST(paid_amount AS CHAR) AS paid_amount,CAST(due_amount AS CHAR) AS due_amount,status,company_id,DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%f') AS created_at,vendor_id,source_purchase_order_id,source_grn_id,CAST(stock_posted AS SIGNED) AS stock_posted,financial_year_id FROM bills WHERE id=? LIMIT 1",
      [id],
    );
    const b = rows[0] || null;
    if (!b) return null;
    const p = { ...b };
    delete p.vendor_id;
    return {
      recordType: "BILL",
      recordId: id,
      companyId: b.company_id,
      vendorId: b.vendor_id,
      fingerprint: fingerprint(p),
      protectedFields: p,
    };
  }
  async getPaymentEvidence(id) {
    const [rows] = await this.#query(
      "SELECT id,vendor_id,bill_id,CAST(amount AS CHAR) AS amount,DATE_FORMAT(payment_date,'%Y-%m-%d') AS payment_date,payment_method,paid_from_account_id,reference_number,notes,company_id,created_by,journal_entry_id,idempotency_key,status,DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%f') AS created_at,financial_year_id FROM vendor_payments WHERE id=? LIMIT 1",
      [id],
    );
    const p = rows[0] || null;
    if (!p) return null;
    const x = { ...p };
    delete x.vendor_id;
    return {
      recordType: "VENDOR_PAYMENT",
      recordId: id,
      companyId: p.company_id,
      vendorId: p.vendor_id,
      billId: p.bill_id,
      fingerprint: fingerprint(x),
      protectedFields: x,
    };
  }
  #requireFingerprintScope() {
    if (!this.fingerprintScope) throw Error("FY6_FINGERPRINT_SCOPE_REQUIRED");
    return this.fingerprintScope;
  }
  #projection(columns, controlledIds) {
    const args = [];
    const sql = columns.map(({ name, type }) => {
      const q = `\`${name}\``;
      if (type === "decimal") return `CAST(${q} AS CHAR) AS ${q}`;
      if (type === "date") return `DATE_FORMAT(${q},'%Y-%m-%d') AS ${q}`;
      if (type === "timestamp")
        return `DATE_FORMAT(${q},'%Y-%m-%dT%H:%i:%s.%f') AS ${q}`;
      if (type === "boolean") return `CAST(${q} AS SIGNED) AS ${q}`;
      if (type === "controlledVendor") {
        const placeholders = controlledIds.map(() => "?").join(",");
        args.push(...controlledIds);
        return `CASE WHEN \`id\` IN (${placeholders}) THEN NULL ELSE ${q} END AS ${q}`;
      }
      return q;
    });
    return { sql: sql.join(","), args };
  }
  async #contractFingerprint(kind) {
    const scope = this.#requireFingerprintScope();
    const tables = {};
    try {
      for (const [table, columns] of Object.entries(TABLE_CONTRACTS[kind])) {
        const controlledIds =
          table === "bills"
            ? scope.billIds
            : table === "vendor_payments"
              ? scope.paymentIds
              : [];
        const projection = this.#projection(columns, controlledIds);
        const [rows] = await this.#query(
          `SELECT ${projection.sql} FROM \`${table}\` ORDER BY \`id\` ASC`,
          projection.args,
        );
        tables[table] = rows;
      }
    } catch (cause) {
      throw Object.assign(new Error("FY6_FINGERPRINT_SCHEMA_CONTRACT", { cause }), {
        code: "FY6_FINGERPRINT_SCHEMA_CONTRACT",
      });
    }
    return fingerprint({ contractVersion: CONTRACT_VERSION, tables });
  }
  async getAccountingFingerprint() {
    return this.#contractFingerprint("accounting");
  }
  async getStockFingerprint() {
    return this.#contractFingerprint("stock");
  }
  async getSchemaFingerprint() {
    const [r] = await this.#query(
      "SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,COLUMN_NAME",
      [],
    );
    return fingerprint(r);
  }
  async getOperationLedger() {
    return [
      ...this.ledger,
      ...(this.transaction ? this.transaction.ops : []),
    ].map((x) => ({ ...x }));
  }
  _requireTx() {
    if (!this.transaction) throw Error("FY6_TX_REQUIRED");
    return this.transaction;
  }
  _op(o) {
    const t = this._requireTx(),
      e = {
        sequence: this.ledger.length + t.ops.length + 1,
        ...o,
        state: "ATTEMPTED",
      };
    t.ops.push(e);
    return e;
  }
  async insertVendorCopy(source, target) {
    const t = this._requireTx(),
      [r] = await this.#query(
        "INSERT INTO vendors (company_id,name) SELECT ?,name FROM vendors WHERE id=? AND company_id=?",
        [target, source.id, source.company_id],
      );
    if (
      !r ||
      r.affectedRows !== 1 ||
      !Number.isInteger(r.insertId) ||
      r.insertId <= 0
    )
      throw Error("VENDOR_INSERT_INVALID");
    const e = this._op({
      groupId: t.groupId,
      operationType: "VENDOR_INSERT",
      table: "vendors",
      recordId: r.insertId,
      companyId: target,
      sourceVendorId: source.id,
    });
    return { ...e, copiedFingerprint: fingerprint(source) };
  }
  async updateBillVendor(id, company, oldV, newV) {
    const t = this._requireTx(),
      [r] = await this.#query(
        "UPDATE bills SET vendor_id=? WHERE id=? AND company_id=? AND vendor_id=?",
        [newV, id, company, oldV],
      );
    if (!r || r.affectedRows !== 1) throw Error("UPDATE_ROW_COUNT");
    return this._op({
      groupId: t.groupId,
      operationType: "BILL_UPDATE",
      table: "bills",
      recordId: id,
      companyId: company,
      oldVendorId: oldV,
      newVendorId: newV,
      affectedRows: 1,
    });
  }
  async updateVendorPaymentVendor(id, company, oldV, newV) {
    const t = this._requireTx(),
      [r] = await this.#query(
        "UPDATE vendor_payments SET vendor_id=? WHERE id=? AND company_id=? AND vendor_id=? AND bill_id IS NULL",
        [newV, id, company, oldV],
      );
    if (!r || r.affectedRows !== 1) throw Error("UPDATE_ROW_COUNT");
    return this._op({
      groupId: t.groupId,
      operationType: "VENDOR_PAYMENT_UPDATE",
      table: "vendor_payments",
      recordId: id,
      companyId: company,
      oldVendorId: oldV,
      newVendorId: newV,
      affectedRows: 1,
    });
  }
  async verifyGroupPostState(g, id) {
    for (const r of g.records) {
      const row =
        r.record_type === "BILL"
          ? await this.getBillForRepair(r.record_id)
          : await this.getVendorPaymentForRepair(r.record_id);
      if (
        !row ||
        row.vendor_id !== id ||
        (r.record_type !== "BILL" && row.bill_id !== null)
      )
        throw Error("POSTCONDITION_MISMATCH");
    }
    return true;
  }
}
module.exports = { Fy6MysqlReadAdapter, canonical, fingerprint };
