"use strict";
const schema = require("./inventoryValuationSchema");
const v = require("./inventoryValuationService");
const m = require("./inventoryValuationMath");
const components = require("./inventoryValuationComponentService");

async function inspectInventoryValuation(cx, companyId, { withinSnapshot = false, valuationOnly = false, allowSales = false } = {}) {
  const blockers = new Set(["GL_COGS_RECONCILIATION_NOT_IMPLEMENTED"]);
  const fingerprints = [];
  let snapshot = false, fingerprint;
  try {
    const [status] = await cx.query("DO 0");
    if (!Number.isInteger(status.serverStatus) || (withinSnapshot ? !(status.serverStatus & 1) : status.serverStatus & 1)) m.fail("IV_DEDICATED_READ_CONNECTION_REQUIRED");
    if (!withinSnapshot) {
      await cx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      await cx.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
      snapshot = true;
    }
    const state = await schema.inspect(cx);
    if (!state.ready) m.fail(state.conflicts.length ? "IV_SCHEMA_INCOMPATIBLE" : "IV_SCHEMA_NOT_READY");
    if (!valuationOnly && await require("./inventoryGlService").cutover(cx, companyId)) {
      const [[today]] = await cx.query("SELECT DATE_FORMAT(CURRENT_DATE(),'%Y-%m-%d') as_of");
      const result = await require("./inventoryGlService").inspect(cx, companyId, today.as_of);
      if (snapshot) { await cx.rollback(); snapshot = false; }
      return { ...result, valuation_ready: result.ready };
    }
    const [products] = await cx.query("SELECT id,CAST(stock AS CHAR) stock,CAST(opening_stock AS CHAR) opening_stock FROM products WHERE company_id=? ORDER BY id", [v.id(companyId)]);
    const companyRows = await components.read(cx, companyId, false);
    const componentHeads = companyRows.filter(r => ["COMPONENT", "COMPONENT_REVISION"].includes(r.kind) && !companyRows.some(n => n.supersedes_id === r.id));
    for (const component of componentHeads) {
      components.validateDefinition(component.payload);
      for (const allocation of component.payload.calculated) {
        const source = v.find(companyRows, allocation.line, "ACQUISITION");
        const heads = companyRows.filter(r => r.kind === "COST" && r.source_id === source.id && !companyRows.some(n => n.kind === "COST" && n.supersedes_id === r.id));
        const effective = [...heads, ...v.latestBillLinks(companyRows, source.id).map(link => v.find(companyRows, link.target_id, "COST"))];
        if (!effective.some(cost => [...cost.payload.taxes, ...cost.payload.allocations].some(item => item.component_id === component.id))) blockers.add("IV_COMPONENT_ALLOCATION_UNAPPLIED");
      }
    }
    // Inspect company-wide sources independently of the surviving product list.
    for (const sql of [
      "SELECT t.id FROM inventory_transactions t LEFT JOIN products p ON p.id=t.product_id AND p.company_id=t.company_id WHERE t.company_id=? AND p.id IS NULL LIMIT 1",
      "SELECT t.id FROM iv_records t LEFT JOIN products p ON p.id=t.product_id AND p.company_id=t.company_id WHERE t.company_id=? AND p.id IS NULL LIMIT 1",
      "SELECT bi.id FROM bill_items bi INNER JOIN bills b ON b.id=bi.bill_id LEFT JOIN products p ON p.id=bi.product_id AND p.company_id=b.company_id WHERE b.company_id=? AND p.id IS NULL LIMIT 1",
      "SELECT ii.id FROM invoice_items ii INNER JOIN invoices i ON i.id=ii.invoice_id WHERE i.company_id=? LIMIT 1",
      "SELECT id FROM return_items WHERE company_id=? LIMIT 1",
      "SELECT id FROM delivery_challan_items WHERE company_id=? LIMIT 1",
    ]) { if (allowSales && sql.includes("invoice_items")) continue; const [unsupported] = await cx.query(sql, [companyId]); if (unsupported.length) blockers.add("IV_UNSUPPORTED_HISTORICAL_MOVEMENT"); }
    for (const product of products) {
      const x = { company_id: companyId, product_id: product.id }, rows = await v.records(cx, x, false);
      const result = v.projection(rows);
      const input = { product: String(product.id), stock: String(product.stock), opening_stock: String(product.opening_stock), records: rows.map(r => ({ id: r.id, fingerprint: r.fingerprint })) };
      fingerprints.push(input);
      const physical = m.operationalQuantity(product.stock), valued = m.operationalQuantity(result.quantity);
      if (physical.q2 !== valued.q2 || physical.q6 !== valued.q6 || physical.q2 * 10000n !== valued.q6) blockers.add("IV_STOCK_HISTORY_INCOMPLETE");
      const sequences = new Map();
      for (const row of rows) {
        const next = (sequences.get(row.effective_date) || 0n) + 1n;
        if (BigInt(row.sequence) !== next) blockers.add("IV_SEQUENCE_GAP_OR_DUPLICATE");
        sequences.set(row.effective_date, BigInt(row.sequence));
      }
      const [counters] = await cx.query("SELECT DATE_FORMAT(effective_date,'%Y-%m-%d') effective_date,CAST(last_sequence AS CHAR) last_sequence FROM iv_date_sequences WHERE company_id=? AND product_id=? ORDER BY effective_date", [companyId, product.id]);
      input.counters = counters;
      if (counters.length !== sequences.size || counters.some(counter => sequences.get(counter.effective_date) !== BigInt(counter.last_sequence))) blockers.add("IV_SEQUENCE_COUNTER_MISMATCH");
      for (const head of rows.filter(r => r.kind === "COST" && !rows.some(n => n.kind === "COST" && n.supersedes_id === r.id))) {
        if (rows.some(r => r.kind === "REJECTION" && r.target_id === head.id)) blockers.add("IV_COST_REJECTED");
        if (head.payload.state !== "FINAL") blockers.add("IV_PROVISIONAL_COST");
        components.verifyCost(companyRows, v.find(rows, head.source_id, "ACQUISITION"), head.payload);
        if (!rows.some(r => ["OPENING", "RECEIPT", "COST_REPLACEMENT", "STOCK_REPLACEMENT", "BILL_LINK"].includes(r.kind) && r.payload.revision_id === head.id)) blockers.add("IV_UNAPPLIED_REVISION");
      }
      for (const source of rows.filter(r => r.kind === "ACQUISITION")) if (!rows.some(r => r.kind === "COST" && r.source_id === source.id)) blockers.add("IV_ACQUISITION_COST_MISSING");
      if ((m.quantity(product.opening_stock) || rows.some(r => r.kind === "RECEIPT")) && !rows.some(r => r.kind === "OPENING")) blockers.add("IV_OPENING_EVIDENCE_REQUIRED");
      for (const movement of rows.filter(r => ["OPENING", "RECEIPT"].includes(r.kind))) {
        const cost = v.appliedBasis(rows, movement).revision;
        const coverage = v.latestBillLinks(rows, movement.source_id).reduce((sum, r) => sum + m.operationalQuantity(r.payload.quantity).q6, 0n);
        const complete = movement.document_type === "GRN" && coverage === m.operationalQuantity(cost.payload.quantity).q6;
        if (cost.payload.state !== "FINAL" && (movement.document_type !== "GRN" || coverage !== m.operationalQuantity(cost.payload.quantity).q6)) blockers.add("IV_PROVISIONAL_COST");
        if (!complete) {
          components.verifyCost(companyRows, v.find(rows, cost.source_id, "ACQUISITION"), cost.payload);
          if (cost.payload.taxes.some(t => t.recoverability === "UNKNOWN")) blockers.add("IV_TAX_RECOVERABILITY_UNKNOWN");
        }
        if (movement.kind === "OPENING" && m.operationalQuantity(product.opening_stock).q6 !== m.operationalQuantity(cost.payload.quantity).q6) blockers.add("IV_OPENING_QUANTITY_MISMATCH");
      }
      // Unsupported history is rejected even if opposing movements net to zero.
      const [legacy] = await cx.query("SELECT reference_type,reference_id,CAST(quantity_in AS CHAR) quantity_in,CAST(quantity_out AS CHAR) quantity_out FROM inventory_transactions WHERE company_id=? AND product_id=?", [companyId, product.id]);
      input.legacy = legacy.map(r => ({ ...r })).sort((a, b) => m.canonical(a).localeCompare(m.canonical(b)));
      const legacyKeys = new Set();
      for (const old of legacy) {
        const key = `${old.reference_type}:${old.reference_id}`;
        if (legacyKeys.has(key)) blockers.add("IV_DUPLICATE_PHYSICAL_MOVEMENT");
        legacyKeys.add(key);
        m.operationalQuantity(old.quantity_in); m.operationalQuantity(old.quantity_out);
        const covered = rows.filter(r => r.kind === "RECEIPT" && r.document_type === old.reference_type && r.document_id === String(old.reference_id));
        if (old.reference_type !== "GRN" || m.quantity(old.quantity_out) || !covered.length) { blockers.add("IV_UNSUPPORTED_HISTORICAL_MOVEMENT"); continue; }
        const q = covered.reduce((sum, r) => sum + m.quantity(v.find(rows, r.payload.revision_id, "COST").payload.quantity), 0n);
        if (q !== m.quantity(old.quantity_in)) blockers.add("IV_SOURCE_QUANTITY_MISMATCH");
      }
      const [bills] = await cx.query("SELECT bi.id,bi.bill_id,bi.product_id,CAST(bi.quantity AS CHAR) quantity,CAST(bi.price AS CHAR) price,CAST(bi.total AS CHAR) total,bi.source_grn_item_id,b.source_grn_id,DATE_FORMAT(b.bill_date,'%Y-%m-%d') bill_date FROM bill_items bi INNER JOIN bills b ON b.id=bi.bill_id WHERE b.company_id=? AND bi.product_id=? ORDER BY bi.id", [companyId, product.id]);
      const normalize = values => values.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value === null ? null : String(value)]))).sort((a, b) => m.canonical(a).localeCompare(m.canonical(b)));
      input.bills = normalize(bills);
      const activeLinks = rows.filter(r => r.kind === "BILL_LINK" && !rows.some(n => n.kind === "BILL_LINK" && n.supersedes_id === r.id));
      for (const bill of bills) {
        const links = activeLinks.filter(r => r.source_line === String(bill.id) && r.document_id === String(bill.bill_id));
        if (links.length !== 1) { blockers.add("IV_UNLINKED_BILL_HISTORY"); continue; }
        const link = links[0], cost = v.approved(rows, v.find(rows, link.target_id, "COST")), source = v.find(rows, link.source_id, "ACQUISITION");
        if (source.document_type === "SUPPLIER" && source.effective_date !== bill.bill_date) blockers.add("IV_DIRECT_STOCK_DATE_MISMATCH");
        const actual = m.operationalQuantity(bill.quantity), expected = m.operationalQuantity(cost.payload.quantity), linked = m.operationalQuantity(link.payload.quantity);
        if (actual.q2 !== expected.q2 || actual.q6 !== expected.q6 || actual.q2 * 10000n !== linked.q6 || linked.q2 !== actual.q2) blockers.add("IV_BILL_QUANTITY_MISMATCH");
        if (cost.source_id !== source.id || String(bill.product_id) !== String(product.id) || bill.bill_date !== link.effective_date ||
          (source.document_type === "GRN" ? String(bill.source_grn_item_id) !== source.source_line || String(bill.source_grn_id) !== source.document_id : bill.source_grn_item_id != null || bill.source_grn_id != null)) blockers.add("IV_BILL_SOURCE_MISMATCH");
        const purchase = m.halfUp(actual.q6 * m.money(bill.price), 1000000n), tax = cost.payload.taxes.reduce((sum, item) => sum + m.integer(item.amount_minor), 0n);
        if (purchase !== m.integer(cost.payload.purchase_minor) || m.money(bill.total) !== purchase + tax) blockers.add("IV_BILL_COST_EVIDENCE_MISMATCH");
      }
      const [grns] = await cx.query("SELECT gri.id,gri.goods_receipt_id,gri.product_id,CAST(gri.received_qty AS CHAR) received_qty,CAST(gri.rejected_qty AS CHAR) rejected_qty,CAST(gri.accepted_qty AS CHAR) accepted_qty,gr.status,gr.stock_posted,DATE_FORMAT(gr.grn_date,'%Y-%m-%d') grn_date FROM goods_receipt_items gri INNER JOIN goods_receipts gr ON gr.id=gri.goods_receipt_id AND gr.company_id=gri.company_id WHERE gri.company_id=? AND gri.product_id=? AND (gr.status='Posted' OR gr.stock_posted=1) ORDER BY gri.id", [companyId, product.id]);
      input.grns = normalize(grns);
      for (const grn of grns) {
        const receipts = rows.filter(r => r.kind === "RECEIPT" && r.document_type === "GRN" && r.document_id === String(grn.goods_receipt_id) && r.source_line === String(grn.id));
        const accepted = m.operationalQuantity(grn.accepted_qty), received = m.operationalQuantity(grn.received_qty), rejected = m.operationalQuantity(grn.rejected_qty);
        if (received.q6 - rejected.q6 !== accepted.q6 || received.q2 - rejected.q2 !== accepted.q2 || grn.status !== "Posted" || String(grn.stock_posted) !== "1") blockers.add("IV_GRN_SOURCE_MISMATCH");
        if (!accepted.q6 && !receipts.length) continue;
        if (receipts.length !== 1) { blockers.add("IV_UNLINKED_GRN_HISTORY"); continue; }
        const receipt = receipts[0], quantity = m.operationalQuantity(v.find(rows, receipt.payload.revision_id, "COST").payload.quantity);
        if (quantity.q2 !== accepted.q2 || quantity.q6 !== accepted.q6 || accepted.q2 * 10000n !== quantity.q6) blockers.add("IV_SOURCE_QUANTITY_MISMATCH");
        if (grn.grn_date !== receipt.effective_date || String(grn.product_id) !== String(product.id)) blockers.add("IV_GRN_SOURCE_MISMATCH");
      }
      for (const receipt of rows.filter(r => r.kind === "RECEIPT" && r.document_type === "GRN")) if (!grns.some(g => String(g.id) === receipt.source_line && String(g.goods_receipt_id) === receipt.document_id)) blockers.add("IV_ORPHAN_GRN_LINK");
      for (const source of rows.filter(r => r.kind === "ACQUISITION")) {
        const links = v.latestBillLinks(rows, source.id), claims = new Set();
        for (const link of links) {
          if (!bills.some(b => String(b.id) === link.source_line && String(b.bill_id) === link.document_id)) blockers.add("IV_ORPHAN_BILL_LINK");
          const cost = v.approved(rows, v.find(rows, link.target_id, "COST"));
          components.verifyCost(companyRows, source, cost.payload);
          for (const component of [...cost.payload.taxes, ...cost.payload.allocations]) {
            const root = components.componentRoot(v.find(companyRows, component.component_id));
            if (claims.has(root)) blockers.add("IV_COMPONENT_OVERALLOCATED");
            claims.add(root);
          }
        }
        if (source.document_type === "GRN" && rows.some(r => r.kind === "RECEIPT" && r.source_id === source.id) && !legacyKeys.has(`GRN:${source.document_id}`)) blockers.add("IV_PHYSICAL_RECEIPT_MISSING");
      }
      // Sales/challans/returns are not integrated by this prerequisite. Never
      // certify their cost from selling prices, current stock, or net quantities.
      for (const sql of [
        "SELECT ii.id FROM invoice_items ii INNER JOIN invoices i ON i.id=ii.invoice_id WHERE i.company_id=? AND ii.product_id=? LIMIT 1",
        "SELECT id FROM return_items WHERE company_id=? AND product_id=? LIMIT 1",
        "SELECT id FROM delivery_challan_items WHERE company_id=? AND product_id=? LIMIT 1",
      ]) { if (allowSales && sql.includes("invoice_items")) continue; const [unsupported] = await cx.query(sql, [companyId, product.id]); if (unsupported.length) blockers.add("IV_UNSUPPORTED_HISTORICAL_MOVEMENT"); }
    }
    fingerprint = m.fingerprint(fingerprints);
  } catch (error) { blockers.add(error.code?.startsWith("IV_") || error.code === "INVENTORY_QUANTITY_PRECISION_UNSUPPORTED" ? error.code : "IV_HISTORY_SCHEMA_NOT_READY"); }
  finally {
    if (snapshot) try { await cx.rollback(); } catch { blockers.add("IV_READ_SNAPSHOT_FAILED"); }
  }
  return { ready: false, valuation_ready: blockers.size === 1, blockers: [...blockers].sort(), ...(fingerprint ? { fingerprint } : {}) };
}
module.exports = { inspectInventoryValuation };
