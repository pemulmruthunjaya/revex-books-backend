const db = require("../db/connection");
const { getAccountingSummary, toTrialRow } = require("./accountingSummary");

/**
 * =========================================================
 * GET TRIAL BALANCE
 * =========================================================
 */

exports.getTrialBalance = async (req, res) => {

  try {

    const company_id = req.user.company_id;
    const journalReport = await require("../services/inventoryGlReportService").maybeReport(db, company_id, req.query, "trial-balance");
    if (journalReport) return res.status(200).json(journalReport);

    const {
      from_date,
      to_date
    } = req.query;



    const summary = await getAccountingSummary(db, company_id, {
      from_date,
      to_date
    });

    const rows = [
      toTrialRow({
        id: "cash-bank",
        code: "1000",
        name: "Cash / Bank",
        type: "ASSET",
        amount: summary.cash,
        normal: "DEBIT"
      }),
      toTrialRow({
        id: "customer-receivables",
        code: "1100",
        name: "Customer Receivables",
        type: "ASSET",
        amount: summary.receivables,
        normal: "DEBIT"
      }),
      toTrialRow({
        id: "gst-input",
        code: "1200",
        name: "GST Input Credit",
        type: "ASSET",
        amount: summary.gstInput,
        normal: "DEBIT"
      }),
      toTrialRow({
        id: "vendor-credits",
        code: "1300",
        name: "Vendor Credits",
        type: "ASSET",
        amount: summary.vendorCredits,
        normal: "DEBIT"
      }),
      toTrialRow({
        id: "vendor-payables",
        code: "2100",
        name: "Vendor Payables",
        type: "LIABILITY",
        amount: summary.payables,
        normal: "CREDIT"
      }),
      toTrialRow({
        id: "customer-credits",
        code: "2150",
        name: "Customer Credits",
        type: "LIABILITY",
        amount: summary.customerCredits,
        normal: "CREDIT"
      }),
      toTrialRow({
        id: "gst-output",
        code: "2200",
        name: "GST Output Payable",
        type: "LIABILITY",
        amount: summary.gstOutput,
        normal: "CREDIT"
      }),
      toTrialRow({
        id: "salary-payable",
        code: "2300",
        name: "Salary Payable",
        type: "LIABILITY",
        amount: summary.salaryPayable,
        normal: "CREDIT"
      }),
      toTrialRow({
        id: "sales",
        code: "4000",
        name: "Sales",
        type: "INCOME",
        amount: summary.sales,
        normal: "CREDIT"
      }),
      toTrialRow({
        id: "purchases",
        code: "5000",
        name: "Purchases",
        type: "EXPENSE",
        amount: summary.purchases,
        normal: "DEBIT"
      }),
      toTrialRow({
        id: "salaries",
        code: "5100",
        name: "Salaries",
        type: "EXPENSE",
        amount: summary.payrollExpense,
        normal: "DEBIT"
      })
    ].filter((row) => Number(row.debit || 0) !== 0 || Number(row.credit || 0) !== 0);

    for (const opening of summary.openingBalances || []) {
      rows.push({
        id: `opening-${opening.id}`,
        account_code: opening.account_code,
        account_name: opening.account_name,
        account_type: opening.account_type,
        debit: Number(opening.debit || 0),
        credit: Number(opening.credit || 0)
      });
    }



    /**
     * =====================================================
     * TOTALS
     * =====================================================
     */

    let totalDebit = 0;
    let totalCredit = 0;



    const formattedRows = rows.map((row) => {

      const debit =
        Number(row.debit || 0);

      const credit =
        Number(row.credit || 0);

      totalDebit += debit;
      totalCredit += credit;

      return {

        id: row.id,

        account_code:
          row.account_code,

        account_name:
          row.account_name,

        account_type:
          row.account_type,

        debit,

        credit

      };

    });



    /**
     * =====================================================
     * RESPONSE
     * =====================================================
     */

    res.status(200).json({

      success: true,

      filters: {
        from_date:
          from_date || null,

        to_date:
          to_date || null
      },

      totals: {

        debit: totalDebit,

        credit: totalCredit,

        difference:
          totalDebit - totalCredit

      },

      data: formattedRows

    });

  } catch (error) {

    console.error(
      "Trial balance error:",
      error
    );

    res.status(500).json({

      success: false,

      message:
        "Failed to fetch trial balance",

      error: error.message

    });

  }

};
