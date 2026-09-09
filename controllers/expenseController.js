const db = require("../db/connection");
const { requireFinancialYearForPosting, requireFinancialYearForMutation, rejectClientFinancialYear } = require("../services/financialYearService");

/**
 * CREATE EXPENSE
 */
exports.createExpense = async (req, res) => {
  let connection;
  try {
    rejectClientFinancialYear(req.body);
    const { title, category, amount, expense_date, notes } = req.body;
    const company_id = req.user.company_id;

    if (!title || !amount || !expense_date) {
      return res.status(400).json({
        message: "Title, amount and expense date are required"
      });
    }
    connection = await db.getConnection();
    await connection.beginTransaction();
    const financialYear = await requireFinancialYearForPosting(company_id, expense_date, connection);

    const [result] = await connection.query(
      `INSERT INTO expenses 
      (title, category, amount, expense_date, notes, company_id, financial_year_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [title, category, amount, expense_date, notes, company_id, financialYear.id]
    );

    await connection.commit();
    res.status(201).json({
      message: "Expense created successfully",
      expense_id: result.insertId
    });

  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Create expense error:", error);
    res.status(error.status || 500).json({
      message: error.status ? error.message : "Failed to create expense",
      ...(error.code ? { code: error.code } : {}),
    });
  } finally {
    if (connection) connection.release();
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
  let connection;
  try {
    const { id } = req.params;
    const company_id = req.user.company_id;

    connection = await db.getConnection();
    await connection.beginTransaction();
    const [rows] = await connection.query(
      "SELECT id,financial_year_id FROM expenses WHERE id=? AND company_id=? FOR UPDATE",
      [id, company_id]
    );
    if (!rows.length) { await connection.rollback(); return res.status(404).json({ message: "Expense not found" }); }
    await requireFinancialYearForMutation(company_id, rows[0].financial_year_id, connection);
    const [result] = await connection.query(
      "DELETE FROM expenses WHERE id = ? AND company_id = ?",
      [id, company_id]
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Expense not found" });
    }

    await connection.commit();
    res.json({ message: "Expense deleted successfully" });

  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Delete expense error:", error);
    res.status(error.status || 500).json({
      message: error.status ? error.message : "Failed to delete expense",
      ...(error.code ? { code: error.code } : {}),
    });
  } finally {
    if (connection) connection.release();
  }
};
