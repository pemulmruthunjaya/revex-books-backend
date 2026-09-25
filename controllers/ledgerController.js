const db = require("../db/connection");
const { ensureVendorPartySchema } = require("../services/vendorPartyService");

/**
 * =========================================================
 * GET VENDOR LEDGER
 * =========================================================
 */
exports.getVendorLedger = async (req, res) => {

  try {

    const { vendor_id } = req.params;
    const company_id = req.user.company_id;
    await ensureVendorPartySchema();

    const [vendorRows] = await db.query(
      `
      SELECT id, opening_balance, opening_balance_type, created_at
      FROM vendors
      WHERE id = ?
        AND company_id = ?
        AND (status IS NULL OR status <> 'Inactive')
      `,
      [vendor_id, company_id]
    );

    if (!vendorRows.length) {
      return res.status(404).json({
        success: false,
        message: "Vendor not found"
      });
    }

    const [bills] = await db.query(
      `
      SELECT
        id,
        bill_number,
        bill_date,
        total_amount,
        status
      FROM bills
      WHERE vendor_id = ?
        AND company_id = ?
        AND total_amount > 0
      ORDER BY bill_date ASC, id ASC
      `,
      [vendor_id, company_id]
    );

    const [payments] = await db.query(
      `
      SELECT
        vp.id,
        vp.bill_id,
        vp.amount,
        vp.payment_date,
        b.bill_number
      FROM vendor_payments vp
      LEFT JOIN bills b
        ON b.id = vp.bill_id
       AND b.company_id = vp.company_id
      WHERE vp.vendor_id = ?
        AND vp.company_id = ?
      ORDER BY vp.payment_date ASC, vp.id ASC
      `,
      [vendor_id, company_id]
    );

    const paidByBill = payments.reduce((map, payment) => {
      if (payment.bill_id) {
        const key = String(payment.bill_id);
        map[key] = (map[key] || 0) + Number(payment.amount || 0);
      }

      return map;
    }, {});

    const entries = [];
    const vendor = vendorRows[0];
    const openingBalance = Number(vendor.opening_balance || 0);
    if (openingBalance > 0) {
      entries.push({
        date: vendor.created_at,
        type: "OPENING BALANCE",
        reference: "-",
        debit: vendor.opening_balance_type === "to_collect" ? 0 : openingBalance,
        credit: vendor.opening_balance_type === "to_collect" ? openingBalance : 0,
        sortOrder: 0,
      });
    }

    bills.forEach((bill) => {
      const billAmount = Number(bill.total_amount || 0);

      entries.push({
        date: bill.bill_date,
        type: "BILL",
        reference: bill.bill_number,
        debit: billAmount,
        credit: 0,
        sortOrder: 1
      });

      const recordedPayment = paidByBill[String(bill.id)] || 0;

      if (bill.status === "Paid" && recordedPayment < billAmount) {
        entries.push({
          date: bill.bill_date,
          type: "PAYMENT",
          reference: bill.bill_number,
          debit: 0,
          credit: billAmount - recordedPayment,
          sortOrder: 2
        });
      }
    });

    payments.forEach((payment) => {
      entries.push({
        date: payment.payment_date,
        type: "PAYMENT",
        reference: payment.bill_number || `PAY-${payment.id}`,
        debit: 0,
        credit: Number(payment.amount || 0),
        sortOrder: 2
      });
    });

    entries.sort((a, b) => {
      const dateA = new Date(a.date || 0).getTime();
      const dateB = new Date(b.date || 0).getTime();

      if (dateA !== dateB) {
        return dateA - dateB;
      }

      return a.sortOrder - b.sortOrder;
    });

    let balance = 0;

    const ledger = entries.map((entry) => {
      const debit = Number(entry.debit || 0);
      const credit = Number(entry.credit || 0);

      balance += debit - credit;

      return {
        date: entry.date,
        type: entry.type,
        reference: entry.reference,
        debit,
        credit,
        balance
      };

    });

    res.json(ledger);

  } catch (error) {

    console.error(
      "Vendor Ledger Fetch Error:",
      error
    );

    res.status(500).json({
      success: false,
      message: "Failed to fetch vendor ledger",
      error: error.message
    });

  }

};





/**
 * =========================================================
 * GET ACCOUNT LEDGER
 * =========================================================
 */
exports.getAccountLedger = async (req, res) => {

  try {

    const { account_id } = req.params;
    const company_id = req.user.company_id;

    const {
      from_date,
      to_date
    } = req.query;

    /**
     * =====================================================
     * GET ACCOUNT DETAILS
     * =====================================================
     */
    const [accountRows] = await db.query(
      `
      SELECT *
      FROM accounts
      WHERE id = ?
      AND company_id = ?
      `,
      [account_id, company_id]
    );

    if (accountRows.length === 0) {

      return res.status(404).json({
        success: false,
        message: "Account not found"
      });

    }

    const account = accountRows[0];



    /**
     * =====================================================
     * OPENING BALANCE
     * =====================================================
     */
    const [openingEventRows] = await db.query(
      `SELECT COALESCE(SUM(signed_delta),0) event_delta
       FROM opening_balance_events
       WHERE company_id=? AND entity_type='account' AND entity_id=?`,
      [company_id, account_id]
    );
    const storedOpening = String(account.balance_type).toUpperCase() === "CREDIT"
      ? -Number(account.opening_balance || 0)
      : Number(account.opening_balance || 0);
    let openingBalance = storedOpening - Number(openingEventRows[0]?.event_delta || 0);

    /**
     * =====================================================
     * PREVIOUS TRANSACTIONS
     * =====================================================
     */
    if (from_date) {

      const [previousRows] = await db.query(
        `
        SELECT
          SUM(debit) AS total_debit,
          SUM(credit) AS total_credit
        FROM journal_entry_details
        INNER JOIN journal_entries
        ON journal_entries.id = journal_entry_details.journal_entry_id
        WHERE account_id = ?
        AND journal_entries.company_id = ?
        AND journal_entry_details.created_at < ?
        `,
        [account_id, company_id, from_date]
      );

      const previousDebit =
        Number(previousRows[0]?.total_debit || 0);

      const previousCredit =
        Number(previousRows[0]?.total_credit || 0);

      openingBalance +=
        previousDebit -
        previousCredit;

    }



    /**
     * =====================================================
     * MAIN LEDGER TRANSACTIONS
     * =====================================================
     */
    let sql = `
      SELECT
        jd.id,
        jd.debit,
        jd.credit,
        jd.description,

        j.journal_no,
        j.journal_date,
        j.narration

      FROM journal_entry_details jd

      INNER JOIN journal_entries j
      ON jd.journal_entry_id = j.id

      WHERE jd.account_id = ?
      AND j.company_id = ?
    `;

    const params = [account_id, company_id];

    /**
     * DATE FILTERS
     */
    if (from_date) {

      sql += ` AND j.journal_date >= ? `;

      params.push(from_date);

    }

    if (to_date) {

      sql += ` AND j.journal_date <= ? `;

      params.push(to_date);

    }

    sql += `
      ORDER BY
        j.journal_date ASC,
        jd.id ASC
    `;

    const [transactions] =
      await db.query(sql, params);



    /**
     * =====================================================
     * RUNNING BALANCE
     * =====================================================
     */
    let runningBalance = openingBalance;

    const ledger = transactions.map((row) => {

      const debit =
        Number(row.debit || 0);

      const credit =
        Number(row.credit || 0);

      runningBalance +=
        debit -
        credit;

      return {

        id: row.id,

        journal_no: row.journal_no,

        date: row.journal_date,

        narration:
          row.description ||
          row.narration,

        debit,

        credit,

        balance: runningBalance

      };

    });



    /**
     * =====================================================
     * TOTALS
     * =====================================================
     */
    const totalDebit = ledger.reduce(
      (sum, item) =>
        sum + Number(item.debit),
      0
    );

    const totalCredit = ledger.reduce(
      (sum, item) =>
        sum + Number(item.credit),
      0
    );

    const closingBalance =
      openingBalance +
      totalDebit -
      totalCredit;



    /**
     * =====================================================
     * RESPONSE
     * =====================================================
     */
    return res.status(200).json({

      success: true,

      account: {
        id: account.id,
        account_name: account.account_name,
        account_code: account.account_code,
        account_type: account.account_type,
      },

      filters: {
        from_date: from_date || null,
        to_date: to_date || null,
      },

      opening_balance: openingBalance,

      total_debit: totalDebit,

      total_credit: totalCredit,

      closing_balance: closingBalance,

      transactions: ledger

    });

  } catch (error) {

    console.error(
      "Account Ledger Error:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to fetch account ledger",
      code: "INTERNAL_SERVER_ERROR",
      request_id: req.requestId || null
    });

  }

};
