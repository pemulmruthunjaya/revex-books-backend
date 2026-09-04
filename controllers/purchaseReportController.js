const db = require("../db/connection");

const num = (value) => Number(value || 0);
const round = (value) => Math.round(num(value) * 100) / 100;
const validateDates = (query) => {
  const date = /^\d{4}-\d{2}-\d{2}$/;
  if (
    (query.from_date && !date.test(query.from_date)) ||
    (query.to_date && !date.test(query.to_date))
  ) {
    throw Object.assign(new Error("Dates must use YYYY-MM-DD"), {
      status: 400,
    });
  }
  if (query.from_date && query.to_date && query.from_date > query.to_date) {
    throw Object.assign(new Error("From date cannot be after To date"), {
      status: 400,
    });
  }
};
const filters = (req, alias, dateColumn, options = {}) => {
  validateDates(req.query);
  const clauses = [`${alias}.company_id=?`],
    params = [req.user.company_id];
  if (req.query.from_date) {
    clauses.push(`${dateColumn}>=?`);
    params.push(req.query.from_date);
  }
  if (req.query.to_date) {
    clauses.push(`${dateColumn}<=?`);
    params.push(req.query.to_date);
  }
  if (options.vendor && req.query.vendor_id) {
    clauses.push(`${alias}.vendor_id=?`);
    params.push(Number(req.query.vendor_id));
  }
  if (options.product && req.query.product_id) {
    clauses.push(`${options.product}=?`);
    params.push(Number(req.query.product_id));
  }
  if (options.status && req.query.status) {
    clauses.push(`${alias}.status=?`);
    params.push(req.query.status);
  }
  if (req.user.branch_id && options.branch !== false) {
    clauses.push(`${alias}.branch_id=?`);
    params.push(req.user.branch_id);
  }
  return { where: clauses.join(" AND "), params };
};
const agingClause = (query, column) => {
  const ranges = {
    "0-7": `DATEDIFF(CURDATE(),${column}) BETWEEN 0 AND 7`,
    "8-15": `DATEDIFF(CURDATE(),${column}) BETWEEN 8 AND 15`,
    "16-30": `DATEDIFF(CURDATE(),${column}) BETWEEN 16 AND 30`,
    "31+": `DATEDIFF(CURDATE(),${column})>=31`,
  };
  return ranges[query.aging] ? ` AND ${ranges[query.aging]}` : "";
};
const send = (handler) => async (req, res) => {
  try {
    res.json(await handler(req));
  } catch (error) {
    console.error("Purchase report error", {
      report: req.path,
      companyId: req.user.company_id,
      code: error.code,
      message: error.message,
    });
    res
      .status(error.status || 500)
      .json({
        message: error.status
          ? error.message
          : "Unable to load purchase report",
      });
  }
};

exports.purchaseRegister = send(async (req) => {
  const { where, params } = filters(req, "b", "b.bill_date", {
    vendor: true,
    branch: false,
  });
  const extra = [];
  if (req.query.source === "Direct Purchase")
    extra.push("b.source_grn_id IS NULL");
  if (req.query.source === "GRN") extra.push("b.source_grn_id IS NOT NULL");
  if (req.query.status) {
    extra.push("b.status=?");
    params.push(req.query.status);
  }
  const [data] = await db.query(
    `SELECT b.id,b.bill_number,b.bill_date,v.name vendor_name,IF(b.source_grn_id IS NULL,'Direct Purchase','GRN') source,po.po_number,gr.grn_number,
    COALESCE(i.taxable_value,b.total_amount) taxable_value,COALESCE(i.cgst,0) cgst,COALESCE(i.sgst,0) sgst,0 igst,COALESCE(i.gst_total,0) gst_total,b.total_amount grand_total,
    GREATEST(COALESCE(p.paid_amount,0),COALESCE(b.paid_amount,0)) paid,GREATEST(b.total_amount-GREATEST(COALESCE(p.paid_amount,0),COALESCE(b.paid_amount,0)),0) due,
    CASE WHEN GREATEST(b.total_amount-GREATEST(COALESCE(p.paid_amount,0),COALESCE(b.paid_amount,0)),0)<=0 THEN 'Paid' WHEN GREATEST(COALESCE(p.paid_amount,0),COALESCE(b.paid_amount,0))>0 THEN 'Partial Paid' ELSE 'Unpaid' END status
    FROM bills b INNER JOIN vendors v ON v.id=b.vendor_id AND v.company_id=b.company_id
    LEFT JOIN purchase_orders po ON po.id=b.source_purchase_order_id AND po.company_id=b.company_id LEFT JOIN goods_receipts gr ON gr.id=b.source_grn_id AND gr.company_id=b.company_id
    LEFT JOIN (SELECT bill_id,SUM(quantity*price) taxable_value,SUM(cgst) cgst,SUM(sgst) sgst,SUM(cgst+sgst) gst_total FROM bill_items GROUP BY bill_id)i ON i.bill_id=b.id
    LEFT JOIN (SELECT bill_id,company_id,SUM(amount) paid_amount FROM vendor_payments WHERE status='SUCCESS' GROUP BY bill_id,company_id)p ON p.bill_id=b.id AND p.company_id=b.company_id
    WHERE ${where}${extra.length ? ` AND ${extra.join(" AND ")}` : ""} ORDER BY b.bill_date DESC,b.id DESC`,
    params,
  );
  const summary = data.reduce(
    (a, r) => (
      a.bills++,
      (a.taxable += num(r.taxable_value)),
      (a.gst += num(r.gst_total)),
      (a.total += num(r.grand_total)),
      (a.paid += num(r.paid)),
      (a.due += num(r.due)),
      a
    ),
    { bills: 0, taxable: 0, gst: 0, total: 0, paid: 0, due: 0 },
  );
  Object.keys(summary).forEach((k) => {
    if (k !== "bills") summary[k] = round(summary[k]);
  });
  return { summary, data };
});

const poBase = async (req, pendingOnly = false) => {
  const { where, params } = filters(req, "po", "po.po_date", {
    vendor: true,
    branch: false,
  });
  const [data] = await db.query(
    `SELECT po.id,po.po_number,po.po_date,v.name vendor_name,COUNT(DISTINCT poi.id) total_items,SUM(poi.quantity) ordered_qty,
    COALESCE(SUM(r.received_qty),0) received_qty,SUM(poi.quantity)-COALESCE(SUM(r.received_qty),0) pending_qty,po.total_amount po_value,po.status,
    CASE WHEN COALESCE(SUM(r.received_qty),0)=0 THEN 'Not Received' WHEN COALESCE(SUM(r.received_qty),0)>=SUM(poi.quantity) THEN 'Fully Received' ELSE 'Partially Received' END receipt_status
    FROM purchase_orders po INNER JOIN vendors v ON v.id=po.vendor_id AND v.company_id=po.company_id INNER JOIN purchase_order_items poi ON poi.purchase_order_id=po.id
    LEFT JOIN (SELECT gri.purchase_order_item_id,SUM(gri.accepted_qty) received_qty FROM goods_receipt_items gri INNER JOIN goods_receipts gr ON gr.id=gri.goods_receipt_id AND gr.company_id=gri.company_id AND gr.status='Posted' GROUP BY gri.purchase_order_item_id)r ON r.purchase_order_item_id=poi.id
    WHERE ${where} GROUP BY po.id ${pendingOnly ? "HAVING pending_qty>0" : ""} ORDER BY po.po_date DESC,po.id DESC`,
    params,
  );
  return data;
};
exports.purchaseOrders = send(async (req) => {
  let data = await poBase(req);
  if (req.query.receipt_status)
    data = data.filter((r) => r.receipt_status === req.query.receipt_status);
  const summary = {
    total_pos: data.length,
    total_value: round(data.reduce((s, r) => s + num(r.po_value), 0)),
    open: data.filter((r) => r.receipt_status !== "Fully Received").length,
    partial: data.filter((r) => r.receipt_status === "Partially Received")
      .length,
    fully_received: data.filter((r) => r.receipt_status === "Fully Received")
      .length,
  };
  return { summary, data };
});

exports.pendingPurchaseOrders = send(async (req) => {
  const { where, params } = filters(req, "po", "po.po_date", {
    vendor: true,
    product: "poi.product_id",
    branch: false,
  });
  const [data] = await db.query(
    `SELECT po.id,po.po_number,po.po_date,v.name vendor_name,poi.product_name product,poi.quantity ordered_qty,COALESCE(r.received_qty,0) received_qty,poi.quantity-COALESCE(r.received_qty,0) pending_qty,COALESCE(poi.unit,p.unit,'PCS') unit,poi.price purchase_rate,(poi.quantity-COALESCE(r.received_qty,0))*poi.price pending_value,DATEDIFF(CURDATE(),po.po_date) days_pending
    FROM purchase_orders po INNER JOIN vendors v ON v.id=po.vendor_id AND v.company_id=po.company_id INNER JOIN purchase_order_items poi ON poi.purchase_order_id=po.id LEFT JOIN products p ON p.id=poi.product_id AND p.company_id=po.company_id
    LEFT JOIN (SELECT gri.purchase_order_item_id,SUM(gri.accepted_qty) received_qty FROM goods_receipt_items gri INNER JOIN goods_receipts gr ON gr.id=gri.goods_receipt_id AND gr.status='Posted' AND gr.company_id=gri.company_id GROUP BY gri.purchase_order_item_id)r ON r.purchase_order_item_id=poi.id
    WHERE ${where} AND poi.quantity>COALESCE(r.received_qty,0)${agingClause(req.query, "po.po_date")} ORDER BY po.po_date,po.id`,
    params,
  );
  const summary = {
    pending_po_count: new Set(data.map((r) => r.id)).size,
    pending_lines: data.length,
    pending_quantity: round(data.reduce((s, r) => s + num(r.pending_qty), 0)),
    pending_value: round(data.reduce((s, r) => s + num(r.pending_value), 0)),
  };
  return { summary, data };
});

const grnLines = async (req, onlyUnbilled = false) => {
  const { where, params } = filters(req, "gr", "gr.grn_date", {
    vendor: true,
    status: true,
    product: "gri.product_id",
  });
  const [data] = await db.query(
    `SELECT gr.id,gr.grn_number,gr.grn_date,po.po_number,v.name vendor_name,gr.challan_number,gr.challan_date,gr.status grn_status,gri.id grn_item_id,p.name product,p.sku,gri.received_qty,gri.accepted_qty,gri.rejected_qty,COALESCE(SUM(CASE WHEN b.id IS NOT NULL THEN bi.quantity ELSE 0 END),0) billed_qty,gri.accepted_qty-COALESCE(SUM(CASE WHEN b.id IS NOT NULL THEN bi.quantity ELSE 0 END),0) remaining_qty,poi.price purchase_rate,(gri.accepted_qty-COALESCE(SUM(CASE WHEN b.id IS NOT NULL THEN bi.quantity ELSE 0 END),0))*poi.price estimated_unbilled_value,DATEDIFF(CURDATE(),gr.grn_date) days_unbilled,GROUP_CONCAT(DISTINCT b.bill_number ORDER BY b.bill_number SEPARATOR ', ') related_bills,
    CASE WHEN COALESCE(SUM(CASE WHEN b.id IS NOT NULL THEN bi.quantity ELSE 0 END),0)=0 THEN 'Unbilled' WHEN COALESCE(SUM(CASE WHEN b.id IS NOT NULL THEN bi.quantity ELSE 0 END),0)>=gri.accepted_qty THEN 'Fully Billed' ELSE 'Partially Billed' END billing_status
    FROM goods_receipts gr INNER JOIN purchase_orders po ON po.id=gr.purchase_order_id AND po.company_id=gr.company_id INNER JOIN vendors v ON v.id=gr.vendor_id AND v.company_id=gr.company_id INNER JOIN goods_receipt_items gri ON gri.goods_receipt_id=gr.id AND gri.company_id=gr.company_id INNER JOIN purchase_order_items poi ON poi.id=gri.purchase_order_item_id INNER JOIN products p ON p.id=gri.product_id AND p.company_id=gr.company_id LEFT JOIN bill_items bi ON bi.source_grn_item_id=gri.id LEFT JOIN bills b ON b.id=bi.bill_id AND b.company_id=gr.company_id
    WHERE ${where}${onlyUnbilled ? " AND gr.status='Posted'" : ""}${agingClause(req.query, "gr.grn_date")} GROUP BY gri.id ${onlyUnbilled ? "HAVING remaining_qty>0" : ""} ORDER BY gr.grn_date DESC,gr.id DESC`,
    params,
  );
  return req.query.billing_status
    ? data.filter((r) => r.billing_status === req.query.billing_status)
    : data;
};
exports.grnRegister = send(async (req) => {
  const lines = await grnLines(req);
  const grouped = new Map();
  for (const r of lines) {
    const row = grouped.get(r.id) || {
      ...r,
      total_received: 0,
      accepted: 0,
      rejected: 0,
      billed: 0,
    };
    row.total_received += num(r.received_qty);
    row.accepted += num(r.accepted_qty);
    row.rejected += num(r.rejected_qty);
    row.billed += num(r.billed_qty);
    grouped.set(r.id, row);
  }
  const data = [...grouped.values()].map((r) => ({
    ...r,
    billing_status:
      r.billed <= 0
        ? "Unbilled"
        : r.billed >= r.accepted
          ? "Fully Billed"
          : "Partially Billed",
  }));
  return {
    summary: {
      grn_count: data.length,
      accepted_qty: round(data.reduce((s, r) => s + r.accepted, 0)),
      rejected_qty: round(data.reduce((s, r) => s + r.rejected, 0)),
      unbilled: data.filter((r) => r.billing_status === "Unbilled").length,
      partially_billed: data.filter(
        (r) => r.billing_status === "Partially Billed",
      ).length,
    },
    data,
  };
});
exports.grnBillReconciliation = send(async (req) => {
  const data = await grnLines(req);
  return {
    summary: {
      accepted_qty: round(data.reduce((s, r) => s + num(r.accepted_qty), 0)),
      billed_qty: round(data.reduce((s, r) => s + num(r.billed_qty), 0)),
      remaining_qty: round(data.reduce((s, r) => s + num(r.remaining_qty), 0)),
      fully_billed_grns: new Set(
        data
          .filter((r) => r.billing_status === "Fully Billed")
          .map((r) => r.id),
      ).size,
      unbilled_partial_grns: new Set(
        data
          .filter((r) => r.billing_status !== "Fully Billed")
          .map((r) => r.id),
      ).size,
    },
    data,
  };
});
exports.unbilledGrns = send(async (req) => {
  const data = await grnLines(req, true);
  return {
    summary: {
      unbilled_grn_count: new Set(data.map((r) => r.id)).size,
      unbilled_lines: data.length,
      remaining_qty: round(data.reduce((s, r) => s + num(r.remaining_qty), 0)),
      estimated_value: round(
        data.reduce((s, r) => s + num(r.estimated_unbilled_value), 0),
      ),
    },
    data,
  };
});
