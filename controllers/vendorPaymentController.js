const db = require("../db/connection");
const {
  ensureVendorPaymentSchema,
  recordVendorPayment,
} = require("../services/vendorPaymentService");

exports.createVendorPayment = async (req, res) => {
  try {
    const result = await recordVendorPayment(req.body, req.user);
    return res.status(result.duplicate ? 200 : 201).json({
      message: result.duplicate ? "Payment was already recorded" : "Vendor payment recorded",
      ...result,
    });
  } catch (error) {
    console.error("Create vendor payment error:", error);
    return res.status(error.status || 500).json({
      message: error.status ? error.message : "Failed to record vendor payment",
    });
  }
};

exports.getVendorPayments = async (req, res) => {
  try {
    await ensureVendorPaymentSchema();
    const companyId = req.user.company_id;
    const clauses = ["vp.company_id = ?", "vp.status = 'SUCCESS'"];
    const params = [companyId];
    if (req.query.vendor_id) {
      clauses.push("vp.vendor_id = ?");
      params.push(req.query.vendor_id);
    }
    if (req.query.bill_id) {
      clauses.push("vp.bill_id = ?");
      params.push(req.query.bill_id);
    }
    const [payments] = await db.query(
      `SELECT vp.*,v.name vendor_name,COALESCE(b.bill_number,annual.opening_references) bill_number,a.account_name paid_from_account_name,
              je.journal_no payment_entry_number
       FROM vendor_payments vp
       INNER JOIN vendors v ON v.id=vp.vendor_id AND v.company_id=vp.company_id
       LEFT JOIN bills b ON b.id=vp.bill_id AND b.company_id=vp.company_id
       LEFT JOIN (
         SELECT asa.company_id,asa.vendor_payment_id,
           GROUP_CONCAT(DISTINCT o.reference ORDER BY o.id SEPARATOR ', ') opening_references
         FROM annual_subledger_allocations asa
         JOIN subledger_opening_items o ON o.id=asa.opening_item_id AND o.company_id=asa.company_id
         WHERE asa.party_type='VENDOR' AND asa.vendor_payment_id IS NOT NULL
         GROUP BY asa.company_id,asa.vendor_payment_id
       ) annual ON annual.company_id=vp.company_id AND annual.vendor_payment_id=vp.id
       LEFT JOIN accounts a ON a.id=vp.paid_from_account_id AND a.company_id=vp.company_id
       LEFT JOIN journal_entries je ON je.id=vp.journal_entry_id AND je.company_id=vp.company_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY vp.payment_date DESC,vp.id DESC`,
      params
    );
    return res.json(payments);
  } catch (error) {
    console.error("Get vendor payments error:", error);
    return res.status(500).json({ message: "Failed to fetch vendor payments" });
  }
};
