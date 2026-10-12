const db = require("../db/connection");
const { getAccountingSummary } = require("./accountingSummary");

/**
 * =========================================================
 * GET PROFIT & LOSS REPORT
 * =========================================================
 */

exports.getProfitLoss = async (req, res) => {

  try {
    const company_id = req.user.company_id;
    const journalReport = await require("../services/inventoryGlReportService").maybeReport(db, company_id, req.query, "profit-loss");
    if (journalReport) return res.status(200).json(journalReport);

    /**
     * =====================================================
     * DATE FILTERS
     * =====================================================
     */

    const {
      from_date,
      to_date
    } = req.query;



    const summary = await getAccountingSummary(db, company_id, {
      from_date,
      to_date
    });

    const incomeRows = summary.sales
      ? [
          {
            id: "sales",
            account_code: "4000",
            account_name: "Sales",
            account_type: "INCOME",
            amount: summary.sales
          }
        ]
      : [];

    const expenseRows = [
      summary.purchases && {
        id: "purchases",
        account_code: "5000",
        account_name: "Purchases",
        account_type: "EXPENSE",
        amount: summary.purchases
      },
      summary.payrollExpense && {
        id: "salaries",
        account_code: "5100",
        account_name: "Salaries",
        account_type: "EXPENSE",
        amount: summary.payrollExpense
      }
    ].filter(Boolean);



    /**
     * =====================================================
     * TOTALS
     * =====================================================
     */

    const totalIncome = incomeRows.reduce(

      (sum, row) =>
        sum + Number(row.amount),

      0

    );



    const totalExpense = expenseRows.reduce(

      (sum, row) =>
        sum + Number(row.amount),

      0

    );



    /**
     * =====================================================
     * NET PROFIT / LOSS
     * =====================================================
     */

    const netProfit =
      totalIncome - totalExpense;



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

      summary: {

        total_income:
          totalIncome,

        total_expense:
          totalExpense,

        net_profit:
          netProfit,

        status:

          netProfit >= 0
            ? "PROFIT"
            : "LOSS"

      },

      income_accounts:
        incomeRows,

      expense_accounts:
        expenseRows

    });

  } catch (error) {

    console.error(
      "Profit & Loss fetch error:",
      error
    );

    res.status(500).json({

      success: false,

      message:
        "Failed to fetch Profit & Loss report",

      error:
        error.message

    });

  }

};
