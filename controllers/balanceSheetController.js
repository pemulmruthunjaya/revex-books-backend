const db = require("../db/connection");
const { getAccountingSummary } = require("./accountingSummary");

/**
 * =========================================================
 * GET BALANCE SHEET
 * =========================================================
 */

exports.getBalanceSheet = async (req, res) => {

  try {
    const company_id = req.user.company_id;
    const journalReport = await require("../services/inventoryGlReportService").maybeReport(db, company_id, req.query, "balance-sheet");
    if (journalReport) return res.status(200).json(journalReport);

    const {
      from_date,
      to_date
    } = req.query;

    const summary = await getAccountingSummary(db, company_id, {
      from_date,
      to_date
    });

    const assetRows = [
      summary.cash > 0 && {
        id: "cash-bank",
        account_code: "1000",
        account_name: "Cash / Bank",
        account_type: "ASSET",
        balance: summary.cash
      },
      summary.receivables > 0 && {
        id: "customer-receivables",
        account_code: "1100",
        account_name: "Customer Receivables",
        account_type: "ASSET",
        balance: summary.receivables
      },
      summary.gstInput > 0 && {
        id: "gst-input",
        account_code: "1200",
        account_name: "GST Input Credit",
        account_type: "ASSET",
        balance: summary.gstInput
      },
      summary.vendorCredits > 0 && {
        id: "vendor-credits",
        account_code: "1300",
        account_name: "Vendor Credits",
        account_type: "ASSET",
        balance: summary.vendorCredits
      }
    ].filter(Boolean);

    const liabilityRows = [
      summary.cash < 0 && {
        id: "bank-overdraft",
        account_code: "2000",
        account_name: "Cash / Bank Overdrawn",
        account_type: "LIABILITY",
        balance: Math.abs(summary.cash)
      },
      summary.payables > 0 && {
        id: "vendor-payables",
        account_code: "2100",
        account_name: "Vendor Payables",
        account_type: "LIABILITY",
        balance: summary.payables
      },
      summary.customerCredits > 0 && {
        id: "customer-credits",
        account_code: "2150",
        account_name: "Customer Credits",
        account_type: "LIABILITY",
        balance: summary.customerCredits
      },
      summary.gstOutput > 0 && {
        id: "gst-output",
        account_code: "2200",
        account_name: "GST Output Payable",
        account_type: "LIABILITY",
        balance: summary.gstOutput
      },
      summary.salaryPayable > 0 && {
        id: "salary-payable",
        account_code: "2300",
        account_name: "Salary Payable",
        account_type: "LIABILITY",
        balance: summary.salaryPayable
      }
    ].filter(Boolean);

    const equityRows = [];

    for (const opening of summary.openingBalances || []) {
      const debit = Number(opening.debit || 0);
      const credit = Number(opening.credit || 0);
      const row = {
        id: `opening-${opening.id}`,
        account_code: opening.account_code,
        account_name: opening.account_name,
        account_type: opening.account_type,
        balance: opening.account_type === "ASSET" ? debit - credit : credit - debit
      };
      if (opening.account_type === "ASSET") assetRows.push(row);
      if (opening.account_type === "LIABILITY") liabilityRows.push(row);
      if (opening.account_type === "EQUITY") equityRows.push(row);
    }

    const currentYearProfit =
      summary.profit;

    /**
     * =====================================================
     * TOTALS
     * =====================================================
     */

    const totalAssets =
      assetRows.reduce(
        (sum, row) =>
          sum + Number(row.balance),
        0
      );

    const totalLiabilities =
      liabilityRows.reduce(
        (sum, row) =>
          sum + Number(row.balance),
        0
      );

    const totalEquity =
      equityRows.reduce(
        (sum, row) =>
          sum + Number(row.balance),
        0
      );

    const finalEquity =
      totalEquity +
      currentYearProfit;

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

      assets: assetRows,

      liabilities: liabilityRows,

      equity: equityRows,

      currentYearProfit,

      totals: {

        totalAssets,

        totalLiabilities,

        totalEquity: finalEquity,

        totalLiabilitiesAndEquity:
          totalLiabilities +
          finalEquity

      }

    });

  } catch (error) {

    console.error(
      "Balance Sheet Error:",
      error
    );

    res.status(500).json({

      success: false,

      message:
        "Failed to fetch balance sheet",

      error:
        error.message

    });

  }

};
