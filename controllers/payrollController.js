const db = require("../db/connection");
const { ensurePayrollTables } = require("../services/payrollService");
const {
  FinancialYearServiceError,
  requireFinancialYearForDate,
  requireFinancialYearForMutation,
  requireFinancialYearForPosting,
  rejectClientFinancialYear,
} = require("../services/financialYearService");

const money = (value) => Math.round(Number(value || 0) * 100) / 100;
const allowedStatuses = ["Unpaid", "Paid"];

const normalizeMonth = (value) => {
  const month = String(value || "").trim();
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : "";
};

const payrollDateForMonth = (month) => `${month}-01`;

const sendPayrollMutationError = (res, error, fallbackMessage) =>
  res.status(error.status || 500).json({
    message: error.status ? error.message : fallbackMessage,
    ...(error.code ? { code: error.code } : {}),
  });

const normalizeKey = (key) =>
  String(key || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const normalizeRow = (row) =>
  Object.entries(row || {}).reduce((acc, [key, value]) => {
    acc[normalizeKey(key)] = value;
    return acc;
  }, {});

const getValue = (row, aliases) => {
  const normalized = normalizeRow(row);
  for (const alias of aliases) {
    const key = normalizeKey(alias);
    if (
      Object.prototype.hasOwnProperty.call(normalized, key) &&
      normalized[key] !== ""
    ) {
      return normalized[key];
    }
  }
  return "";
};

const numberValue = (value) => {
  if (value === "" || value === null || value === undefined) return 0;
  const cleaned = String(value).replace(/[₹,\s]/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
};

const dateValue = (value) => {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const text = String(value).trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const indian = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (indian) {
    const [, day, month, year] = indian;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  return null;
};

const daysInMonth = (month) => {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(year, monthNumber, 0).getDate();
};

const mapAttendanceRow = (row, fallbackMonth) => {
  const payrollMonth = normalizeMonth(
    getValue(row, ["Payroll Month", "Month", "Salary Month"]) || fallbackMonth
  );
  const attendanceStatus = String(getValue(row, ["Attendance Status", "Present/Absent", "Status"]) || "")
    .trim()
    .toLowerCase();

  let presentDays = numberValue(getValue(row, ["Present Days", "Present", "Paid Days"]));
  let absentDays = numberValue(getValue(row, ["Absent Days", "Absent", "Leave Days"]));
  let totalHours = numberValue(getValue(row, ["Working Hours", "Total Hours", "Hours", "Work Hrs"]));

  if (attendanceStatus === "absent") {
    presentDays = 0;
    absentDays = absentDays || 1;
    totalHours = 0;
  } else if (attendanceStatus === "present" && presentDays === 0 && totalHours === 0) {
    presentDays = 1;
  }

  return {
    employee_code: String(getValue(row, ["Employee Code", "Employee ID", "Emp Code", "Staff Code"]) || "").trim(),
    employee_name: String(getValue(row, ["Employee Name", "Name", "Staff Name"]) || "").trim(),
    payroll_month: payrollMonth,
    working_days: numberValue(getValue(row, ["Working Days", "Month Working Days", "Total Working Days"])),
    present_days: presentDays,
    absent_days: absentDays,
    total_hours: totalHours,
    overtime_hours: numberValue(getValue(row, ["Overtime Hours", "OT Hours", "Extra Hours"])),
    allowances: numberValue(getValue(row, ["Allowances", "Allowance", "OT Amount"])),
    deductions: numberValue(getValue(row, ["Deductions", "Deduction", "Advance", "Fine"])),
    status: String(getValue(row, ["Salary Status", "Payment Status"]) || "Unpaid").trim(),
    payment_date: dateValue(getValue(row, ["Payment Date", "Paid Date"])),
    notes: String(getValue(row, ["Notes", "Remarks"]) || "").trim(),
  };
};

exports.getEmployees = async (req, res) => {
  try {
    await ensurePayrollTables();

    const [employees] = await db.query(
      `SELECT *
       FROM payroll_employees
       WHERE company_id = ?
       ORDER BY status ASC, name ASC`,
      [req.user.company_id]
    );

    res.json(employees);
  } catch (error) {
    console.error("Get payroll employees error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.createEmployee = async (req, res) => {
  try {
    await ensurePayrollTables();

    const {
      name,
      employee_code,
      phone,
      email,
      designation,
      joining_date,
      monthly_salary,
      notes,
    } = req.body;

    if (!String(name || "").trim()) {
      return res.status(400).json({ message: "Employee name is required" });
    }

    const [result] = await db.query(
      `INSERT INTO payroll_employees
        (company_id, name, employee_code, phone, email, designation, joining_date,
         monthly_salary, status, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Active', ?, ?)`,
      [
        req.user.company_id,
        String(name).trim(),
        employee_code ? String(employee_code).trim() : null,
        phone || null,
        email || null,
        designation || null,
        joining_date || null,
        money(monthly_salary),
        notes || null,
        req.user.user_id || null,
      ]
    );

    res.status(201).json({
      message: "Employee created",
      employee_id: result.insertId,
    });
  } catch (error) {
    console.error("Create payroll employee error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.updateEmployee = async (req, res) => {
  try {
    await ensurePayrollTables();

    const { id } = req.params;
    const {
      name,
      employee_code,
      phone,
      email,
      designation,
      joining_date,
      monthly_salary,
      status,
      notes,
    } = req.body;

    if (!String(name || "").trim()) {
      return res.status(400).json({ message: "Employee name is required" });
    }

    const normalizedStatus = status === "Inactive" ? "Inactive" : "Active";

    const [result] = await db.query(
      `UPDATE payroll_employees
       SET name = ?, employee_code = ?, phone = ?, email = ?, designation = ?, joining_date = ?,
           monthly_salary = ?, status = ?, notes = ?
       WHERE id = ? AND company_id = ?`,
      [
        String(name).trim(),
        employee_code ? String(employee_code).trim() : null,
        phone || null,
        email || null,
        designation || null,
        joining_date || null,
        money(monthly_salary),
        normalizedStatus,
        notes || null,
        id,
        req.user.company_id,
      ]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Employee not found" });
    }

    res.json({ message: "Employee updated" });
  } catch (error) {
    console.error("Update payroll employee error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.deleteEmployee = async (req, res) => {
  try {
    await ensurePayrollTables();

    const { id } = req.params;

    const [entryRows] = await db.query(
      "SELECT id FROM payroll_entries WHERE employee_id = ? AND company_id = ? LIMIT 1",
      [id, req.user.company_id]
    );

    if (entryRows.length) {
      const [result] = await db.query(
        `UPDATE payroll_employees
         SET status = 'Inactive'
         WHERE id = ? AND company_id = ?`,
        [id, req.user.company_id]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ message: "Employee not found" });
      }

      return res.json({ message: "Employee has payroll entries, so it was marked inactive" });
    }

    const [result] = await db.query(
      "DELETE FROM payroll_employees WHERE id = ? AND company_id = ?",
      [id, req.user.company_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Employee not found" });
    }

    res.json({ message: "Employee deleted" });
  } catch (error) {
    console.error("Delete payroll employee error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.getPayrollEntries = async (req, res) => {
  try {
    await ensurePayrollTables();

    const params = [req.user.company_id];
    let filter = "";

    if (req.query.month) {
      const month = normalizeMonth(req.query.month);
      if (month) {
        filter = " AND pe.payroll_month = ?";
        params.push(month);
      }
    }

    const [entries] = await db.query(
      `SELECT pe.*, e.designation
       FROM payroll_entries pe
       LEFT JOIN payroll_employees e
         ON e.id = pe.employee_id
        AND e.company_id = pe.company_id
       WHERE pe.company_id = ?
       ${filter}
       ORDER BY pe.payroll_date DESC, pe.id DESC`,
      params
    );

    res.json(entries);
  } catch (error) {
    console.error("Get payroll entries error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

exports.createPayrollEntry = async (req, res) => {
  let connection;
  try {
    await ensurePayrollTables();
    rejectClientFinancialYear(req.body);

    const {
      employee_id,
      payroll_month,
      basic_salary,
      allowances,
      deductions,
      working_days,
      present_days,
      absent_days,
      total_hours,
      overtime_hours,
      standard_hours,
      status,
      payment_date,
      notes,
    } = req.body;

    const month = normalizeMonth(payroll_month);
    if (!employee_id || !month) {
      return res.status(400).json({ message: "Employee and payroll month are required" });
    }

    const companyId = req.user.company_id;
    const payrollDate = payrollDateForMonth(month);
    const normalizedStatus = allowedStatuses.includes(status) ? status : "Unpaid";

    connection = await db.getConnection();
    await connection.beginTransaction();
    await requireFinancialYearForPosting(companyId, payrollDate, connection);

    const [employees] = await connection.query(
      "SELECT id, name, monthly_salary FROM payroll_employees WHERE id = ? AND company_id = ? LIMIT 1",
      [employee_id, companyId]
    );

    if (!employees.length) {
      await connection.rollback();
      return res.status(404).json({ message: "Employee not found" });
    }

    const basic = money(basic_salary || employees[0].monthly_salary);
    const allowanceAmount = money(allowances);
    const deductionAmount = money(deductions);
    const netAmount = money(Math.max(basic + allowanceAmount - deductionAmount, 0));

    const [result] = await connection.query(
      `INSERT INTO payroll_entries
        (company_id, employee_id, employee_name, payroll_month, payroll_date,
         salary_mode, working_days, present_days, absent_days, total_hours,
         overtime_hours, standard_hours, basic_salary, allowances, deductions, net_amount, status, payment_date,
         notes, created_by)
       VALUES (?, ?, ?, ?, ?, 'Manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        employee_id,
        employees[0].name,
        month,
        payrollDate,
        money(working_days),
        money(present_days),
        money(absent_days),
        money(total_hours),
        money(overtime_hours),
        money(standard_hours),
        basic,
        allowanceAmount,
        deductionAmount,
        netAmount,
        normalizedStatus,
        normalizedStatus === "Paid" ? payment_date || new Date().toISOString().slice(0, 10) : null,
        notes || null,
        req.user.user_id || null,
      ]
    );

    await connection.commit();
    res.status(201).json({
      message: "Payroll entry created",
      payroll_entry_id: result.insertId,
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Create payroll entry error:", error);

    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "Payroll already exists for this employee and month" });
    }

    sendPayrollMutationError(res, error, "Server error");
  } finally {
    if (connection) connection.release();
  }
};

exports.importAttendance = async (req, res) => {
  let connection;

  try {
    await ensurePayrollTables();
    rejectClientFinancialYear(req.body);

    const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
    const suppliedFallbackMonth = String(req.body.payroll_month || "").trim();
    const fallbackMonth = suppliedFallbackMonth
      ? normalizeMonth(suppliedFallbackMonth)
      : new Date().toISOString().slice(0, 7);
    const standardHoursPerDay = Math.max(numberValue(req.body.standard_hours_per_day), 1) || 8;
    const fileName = String(req.body.fileName || "").slice(0, 255);

    if (!fallbackMonth) {
      return res.status(400).json({ message: "Payroll month must use YYYY-MM with a valid month" });
    }

    if (!rows.length) {
      return res.status(400).json({ message: "No attendance rows found" });
    }

    if (rows.length > 5000) {
      return res.status(400).json({ message: "Please import 5000 rows or less at a time" });
    }

    const summary = { total: rows.length, created: 0, updated: 0, skipped: 0 };
    const errors = [];

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [importResult] = await connection.query(
      `INSERT INTO payroll_attendance_imports
       (company_id, payroll_month, file_name, row_count, standard_hours_per_day, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        req.user.company_id,
        fallbackMonth,
        fileName || null,
        rows.length,
        standardHoursPerDay,
        req.user.user_id || req.user.id || null,
      ]
    );

    const importId = importResult.insertId;

    for (let index = 0; index < rows.length; index += 1) {
      const rowNumber = index + 2;
      const row = mapAttendanceRow(rows[index], fallbackMonth);

      try {
        if (!row.payroll_month) {
          throw new Error("Payroll month must use YYYY-MM with a valid month");
        }

        if (!row.employee_code && !row.employee_name) {
          throw new Error("Employee code or employee name is required");
        }

        const employeeParams = [req.user.company_id];
        let employeeFilter = "";

        if (row.employee_code) {
          employeeFilter = " AND employee_code = ?";
          employeeParams.push(row.employee_code);
        } else {
          employeeFilter = " AND name = ?";
          employeeParams.push(row.employee_name);
        }

        const [employees] = await connection.query(
          `SELECT id, name, monthly_salary
           FROM payroll_employees
           WHERE company_id = ?
             ${employeeFilter}
             AND status <> 'Inactive'
           LIMIT 1`,
          employeeParams
        );

        if (!employees.length) {
          throw new Error(`Employee not found: ${row.employee_code || row.employee_name}`);
        }

        const employee = employees[0];
        const targetPayrollDate = payrollDateForMonth(row.payroll_month);
        const [existingEntries] = await connection.query(
          `SELECT id, payroll_date
           FROM payroll_entries
           WHERE company_id = ? AND employee_id = ? AND payroll_month = ?
           LIMIT 1 FOR UPDATE`,
          [req.user.company_id, employee.id, row.payroll_month]
        );

        if (existingEntries.length) {
          const sourceFinancialYear = await requireFinancialYearForDate(
            req.user.company_id,
            existingEntries[0].payroll_date,
            connection
          );
          await requireFinancialYearForMutation(
            req.user.company_id,
            sourceFinancialYear.id,
            connection
          );
        }

        await requireFinancialYearForPosting(
          req.user.company_id,
          targetPayrollDate,
          connection
        );

        const monthWorkingDays = row.working_days || daysInMonth(row.payroll_month);
        const standardHours = money(monthWorkingDays * standardHoursPerDay);
        const totalHours = money(row.total_hours);
        const overtimeHours = money(row.overtime_hours);
        const presentDays = money(
          row.present_days || (totalHours > 0 ? totalHours / standardHoursPerDay : monthWorkingDays)
        );
        const absentDays = money(
          row.absent_days || Math.max(monthWorkingDays - presentDays, 0)
        );
        const monthlySalary = money(employee.monthly_salary);
        const attendanceRatio = standardHours > 0
          ? Math.min(totalHours > 0 ? totalHours / standardHours : presentDays / monthWorkingDays, 1)
          : 1;
        const earnedBasic = money(monthlySalary * attendanceRatio);
        const hourlyRate = standardHours > 0 ? monthlySalary / standardHours : 0;
        const overtimeAmount = money(hourlyRate * overtimeHours);
        const allowances = money(row.allowances + overtimeAmount);
        const deductions = money(row.deductions);
        const netAmount = money(Math.max(earnedBasic + allowances - deductions, 0));
        const normalizedStatus = String(row.status || "").trim().toLowerCase() === "paid" ? "Paid" : "Unpaid";

        const [entryResult] = await connection.query(
          `INSERT INTO payroll_entries
            (company_id, employee_id, employee_name, payroll_month, payroll_date,
             salary_mode, working_days, present_days, absent_days, total_hours,
             overtime_hours, standard_hours, basic_salary, allowances, deductions,
             net_amount, status, payment_date, notes, attendance_import_id, created_by)
           VALUES (?, ?, ?, ?, ?, 'Attendance Import', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             employee_name = VALUES(employee_name),
             payroll_date = VALUES(payroll_date),
             salary_mode = VALUES(salary_mode),
             working_days = VALUES(working_days),
             present_days = VALUES(present_days),
             absent_days = VALUES(absent_days),
             total_hours = VALUES(total_hours),
             overtime_hours = VALUES(overtime_hours),
             standard_hours = VALUES(standard_hours),
             basic_salary = VALUES(basic_salary),
             allowances = VALUES(allowances),
             deductions = VALUES(deductions),
             net_amount = VALUES(net_amount),
             status = VALUES(status),
             payment_date = VALUES(payment_date),
             notes = VALUES(notes),
             attendance_import_id = VALUES(attendance_import_id)`,
          [
            req.user.company_id,
            employee.id,
            employee.name,
            row.payroll_month,
            targetPayrollDate,
            monthWorkingDays,
            presentDays,
            absentDays,
            totalHours,
            overtimeHours,
            standardHours,
            earnedBasic,
            allowances,
            deductions,
            netAmount,
            normalizedStatus,
            normalizedStatus === "Paid" ? row.payment_date || new Date().toISOString().slice(0, 10) : null,
            row.notes || null,
            importId,
            req.user.user_id || req.user.id || null,
          ]
        );

        if (entryResult.affectedRows === 1) {
          summary.created += 1;
        } else {
          summary.updated += 1;
        }

        await connection.query(
          `INSERT INTO payroll_attendance_lines
           (import_id, company_id, employee_id, employee_code, employee_name, payroll_month,
            working_days, present_days, absent_days, total_hours, overtime_hours,
            allowances, deductions, calculated_salary, status, message)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Imported', ?)`,
          [
            importId,
            req.user.company_id,
            employee.id,
            row.employee_code || null,
            employee.name,
            row.payroll_month,
            monthWorkingDays,
            presentDays,
            absentDays,
            totalHours,
            overtimeHours,
            allowances,
            deductions,
            netAmount,
            overtimeAmount > 0 ? `Overtime amount included: ${overtimeAmount}` : null,
          ]
        );
      } catch (error) {
        if (error instanceof FinancialYearServiceError) throw error;

        summary.skipped += 1;
        errors.push({ row: rowNumber, message: error.message });

        await connection.query(
          `INSERT INTO payroll_attendance_lines
           (import_id, company_id, employee_code, employee_name, payroll_month, status, message)
           VALUES (?, ?, ?, ?, ?, 'Skipped', ?)`,
          [
            importId,
            req.user.company_id,
            row.employee_code || null,
            row.employee_name || null,
            row.payroll_month || fallbackMonth,
            error.message,
          ]
        );
      }
    }

    await connection.query(
      `UPDATE payroll_attendance_imports
       SET created_count = ?, updated_count = ?, skipped_count = ?
       WHERE id = ? AND company_id = ?`,
      [
        summary.created,
        summary.updated,
        summary.skipped,
        importId,
        req.user.company_id,
      ]
    );

    await connection.commit();

    res.json({
      message: "Attendance imported and payroll updated",
      importId,
      summary,
      errors: errors.slice(0, 50),
    });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Import payroll attendance error:", error);
    sendPayrollMutationError(res, error, "Failed to import attendance");
  } finally {
    if (connection) connection.release();
  }
};

exports.updatePayrollEntryStatus = async (req, res) => {
  let connection;
  try {
    await ensurePayrollTables();
    rejectClientFinancialYear(req.body);

    const { id } = req.params;
    const status = allowedStatuses.includes(req.body.status) ? req.body.status : "";

    if (!status) {
      return res.status(400).json({ message: "Invalid payroll status" });
    }

    const companyId = req.user.company_id;
    connection = await db.getConnection();
    await connection.beginTransaction();
    const [entries] = await connection.query(
      `SELECT id, payroll_date
       FROM payroll_entries
       WHERE id = ? AND company_id = ?
       LIMIT 1 FOR UPDATE`,
      [id, companyId]
    );

    if (!entries.length) {
      await connection.rollback();
      return res.status(404).json({ message: "Payroll entry not found" });
    }

    const financialYear = await requireFinancialYearForDate(
      companyId,
      entries[0].payroll_date,
      connection
    );
    await requireFinancialYearForMutation(companyId, financialYear.id, connection);

    const [result] = await connection.query(
      `UPDATE payroll_entries
       SET status = ?, payment_date = ?
       WHERE id = ? AND company_id = ?`,
      [
        status,
        status === "Paid" ? req.body.payment_date || new Date().toISOString().slice(0, 10) : null,
        id,
        companyId,
      ]
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Payroll entry not found" });
    }

    await connection.commit();
    res.json({ message: "Payroll status updated" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Update payroll status error:", error);
    sendPayrollMutationError(res, error, "Server error");
  } finally {
    if (connection) connection.release();
  }
};

exports.deletePayrollEntry = async (req, res) => {
  let connection;
  try {
    await ensurePayrollTables();

    const { id } = req.params;
    const companyId = req.user.company_id;

    connection = await db.getConnection();
    await connection.beginTransaction();
    const [entries] = await connection.query(
      `SELECT id, payroll_date
       FROM payroll_entries
       WHERE id = ? AND company_id = ?
       LIMIT 1 FOR UPDATE`,
      [id, companyId]
    );

    if (!entries.length) {
      await connection.rollback();
      return res.status(404).json({ message: "Payroll entry not found" });
    }

    const financialYear = await requireFinancialYearForDate(
      companyId,
      entries[0].payroll_date,
      connection
    );
    await requireFinancialYearForMutation(companyId, financialYear.id, connection);

    const [result] = await connection.query(
      "DELETE FROM payroll_entries WHERE id = ? AND company_id = ?",
      [id, companyId]
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({ message: "Payroll entry not found" });
    }

    await connection.commit();
    res.json({ message: "Payroll entry deleted" });
  } catch (error) {
    if (connection) await connection.rollback();
    console.error("Delete payroll entry error:", error);
    sendPayrollMutationError(res, error, "Server error");
  } finally {
    if (connection) connection.release();
  }
};
