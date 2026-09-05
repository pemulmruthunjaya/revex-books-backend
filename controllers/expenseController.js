const db = require("../db/connection");
const { requireFinancialYearForDate, rejectClientFinancialYear } = require("../services/financialYearService");

/**
 * CREATE EXPENSE
 */
exports.createExpense = async (req, res) => {
  try {
    rejectClientFinancialYear(req.body);
    const { title, category, amount, expense_date, notes } = req.body;
    const company_id = req.user.company_id;

    if (!title || !amount || !expense_date) {
      return res.status(400).json({
        message: "Title, amount and expense date are required"
      });
    }
    const financialYear = await requireFinancialYearForDate(company_id, expense_date, db);

    const [result] = await db.query(
      `INSERT INTO expenses 
      (title, category, amount, expense_date, notes, company_id, financial_year_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [title, category, amount, expense_date, notes, company_id, financialYear.id]
    );

    res.status(201).json({
      message: "Expense created successfully",
      expense_id: result.insertId
    });

  } catch (error) {
    console.error("Create expense error:", error);
    res.status(error.status || 500).json({
      message: error.status ? error.message : "Failed to create expense"
    });
  }
};

/**
 * GET ALL EXPENSES (Company Wise)
 */
exports.getExpenses = async (req, res) => {
  try {
    const company_id = req.user.company_id;

    const [expenses] = await db.query(
      "SELECT * FROM expenses WHERE company_id = ? ORDER BY id DESC",
      [company_id]
    );

    res.json(expenses);

  } catch (error) {
    console.error("Get expenses error:", error);
    res.status(500).json({
      message: "Failed to fetch expenses"
    });
  }
};

/**
 * GET SINGLE EXPENSE
 */
exports.getExpenseById = async (req, res) => {
  try {
    const { id } = req.params;
    const company_id = req.user.company_id;

    const [expenses] = await db.query(
      "SELECT * FROM expenses WHERE id = ? AND company_id = ?",
      [id, company_id]
    );

    if (expenses.length === 0) {
      return res.status(404).json({ message: "Expense not found" });
    }

    res.json(expenses[0]);

  } catch (error) {
    console.error("Get expense error:", error);
    res.status(500).json({
      message: "Failed to fetch expense"
    });
  }
};

/**
 * DELETE EXPENSE
 */
exports.deleteExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const company_id = req.user.company_id;

    const [result] = await db.query(
      "DELETE FROM expenses WHERE id = ? AND company_id = ?",
      [id, company_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Expense not found" });
    }

    res.json({ message: "Expense deleted successfully" });

  } catch (error) {
    console.error("Delete expense error:", error);
    res.status(500).json({
      message: "Failed to delete expense"
    });
  }
};
