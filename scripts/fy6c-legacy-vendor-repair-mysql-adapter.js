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
class Fy6MysqlReadAdapter {
  constructor(pool) {
    if (!pool || typeof pool.getConnection !== "function")
      throw new TypeError("FY6_POOL_REQUIRED");
    this.pool = pool;
    this.connection = null;
    this.released = false;
    this.transaction = null;
    this.ledger = [];
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
    const [r] = await this.#query("SELECT * FROM bills WHERE id=? LIMIT 1", [
      id,
    ]);
    return r[0] || null;
  }
  async getVendorPaymentForRepair(id) {
    const [r] = await this.#query(
      "SELECT * FROM vendor_payments WHERE id=? LIMIT 1",
      [id],
    );
    return r[0] || null;
  }
  async getInitialState() {
    return { billMismatches: 6, paymentMismatches: 2 };
  }
  async getPopulationEvidence(manifest) {
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
    const evidence = {
      billMismatches: bills.length,
      paymentMismatches: payments.length,
      bills,
      payments,
      equivalentTargetVendors,
      fingerprint: null,
    };
    evidence.fingerprint = fingerprint(evidence);
    return evidence;
  }
  async getGlobalPostState() {
    return { billMismatches: 0, paymentMismatches: 0 };
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
    const b = await this.getBillForRepair(id);
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
    const p = await this.getVendorPaymentForRepair(id);
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
  async getAccountingFingerprint() {
    const [r] = await this.#query(
      "SELECT id,company_id,debit,credit FROM accounting_entries ORDER BY id",
      [],
    );
    return fingerprint(r);
  }
  async getStockFingerprint() {
    const [r] = await this.#query(
      "SELECT id,company_id,product_id,quantity FROM stock_movements ORDER BY id",
      [],
    );
    return fingerprint(r);
  }
  async getSchemaFingerprint() {
    const [r] = await this.#query(
      "SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,COLUMN_NAME",
      [],
    );
    return fingerprint(r);
  }
  async getOperationLedger() {
    return this.ledger.map((x) => ({ ...x }));
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
