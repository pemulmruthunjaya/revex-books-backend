"use strict";
const gl = require("./inventoryGlService");
const m = require("./inventoryValuationMath");
const number = value => Number((value < 0n ? "-" : "") + m.moneyDecimal(value < 0n ? -value : value));
function range(start, filters, years) {
  const from = m.date(filters.from_date), to = m.date(filters.to_date);
  if (from > to || from < start.date) m.fail("IV_GL_MIXED_BASIS_RANGE");
  const scope = years.filter(year => from >= year.start_date && to <= year.end_date);
  if (scope.length !== 1) m.fail("IV_GL_SINGLE_FY_REPORT_REQUIRED");
  return { from, to, year: scope[0] };
}
function render(kind, accounts, lines, filters) {
  const totals = new Map();
  for (const line of lines) {
    // Annual transfer journals are excluded only from operating P&L. They must
    // remain in the trial balance and balance sheet to avoid double carrying.
    if (kind === "profit-loss" && (line.date < filters.from_date || ["annual_fy_close", "annual_fy_opening"].includes(line.source_type))) continue;
    totals.set(String(line.account_id), (totals.get(String(line.account_id)) || 0n) + BigInt(line.signed_minor));
  }
  const rows = [...totals].map(([id, amount]) => {
    const account = accounts.find(row => String(row.id) === id);
    if (!account) m.fail("IV_GL_REPORT_ACCOUNT_MISSING");
    return { ...account, id, minor: amount };
  });
  const base = { success: true, basis: "JOURNAL_PERPETUAL_INVENTORY", filters };
  if (kind === "trial-balance") {
    let debit = 0n, credit = 0n;
    const data = rows.map(({ minor, ...row }) => { debit += minor > 0n ? minor : 0n; credit -= minor < 0n ? minor : 0n; return { ...row, debit: number(minor > 0n ? minor : 0n), credit: number(minor < 0n ? -minor : 0n) }; });
    if (debit !== credit) m.fail("IV_GL_REPORT_UNBALANCED");
    return { ...base, data, totals: { debit: number(debit), credit: number(credit), difference: 0 } };
  }
  const income = rows.filter(row => row.account_type === "INCOME"), expenses = rows.filter(row => row.account_type === "EXPENSE");
  const revenue = -income.reduce((s, row) => s + row.minor, 0n), expense = expenses.reduce((s, row) => s + row.minor, 0n), profit = revenue - expense;
  if (kind === "profit-loss") return { ...base,
    summary: { total_income: number(revenue), total_expense: number(expense), net_profit: number(profit), status: profit >= 0n ? "PROFIT" : "LOSS" },
    income_accounts: income.map(({ minor, ...row }) => ({ ...row, amount: number(-minor) })), expense_accounts: expenses.map(({ minor, ...row }) => ({ ...row, amount: number(minor) })),
  };
  const group = type => rows.filter(row => row.account_type === type).map(({ minor, ...row }) => ({ ...row, balance: number(type === "ASSET" ? minor : -minor) }));
  const balance = type => rows.filter(row => row.account_type === type).reduce((s, row) => s + (type === "ASSET" ? row.minor : -row.minor), 0n);
  const assets = balance("ASSET"), liabilities = balance("LIABILITY"), equity = balance("EQUITY") + profit;
  if (assets !== liabilities + equity) m.fail("IV_GL_REPORT_UNBALANCED");
  return { ...base, assets: group("ASSET"), liabilities: group("LIABILITY"), equity: group("EQUITY"), currentYearProfit: number(profit), totals: { totalAssets: number(assets), totalLiabilities: number(liabilities), totalEquity: number(equity), totalLiabilitiesAndEquity: number(liabilities + equity) } };
}
async function maybeReport(pool, company, filters, kind) {
  // The preliminary read only selects the basis. Repeat it in the dedicated
  // snapshot before returning any journal-derived result.
  let cx;
  try {
    if (!await gl.cutover(pool, company)) return null;
    cx = await pool.getConnection();
    await cx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await cx.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
    const start = await gl.cutover(cx, company);
    const [years] = await cx.query("SELECT id,DATE_FORMAT(start_date,'%Y-%m-%d') start_date,DATE_FORMAT(end_date,'%Y-%m-%d') end_date FROM financial_years WHERE company_id=?", [company]);
    const selected = range(start, filters, years), proof = await gl.inspect(cx, company, selected.to);
    if (proof.blockers.some(code => code !== "IV_GL_PROVISIONAL_GRNI_UNRESOLVED")) m.fail("IV_GL_REPORT_RECONCILIATION_REQUIRED");
    const [accounts] = await cx.query("SELECT id,account_code,account_name,account_type FROM accounts WHERE company_id=? ORDER BY id", [company]);
    const [lines] = await cx.query("SELECT d.account_id,CAST(d.debit AS CHAR) debit,CAST(d.credit AS CHAR) credit,DATE_FORMAT(j.journal_date,'%Y-%m-%d') date,j.source_type FROM journal_entry_details d JOIN journal_entries j ON j.id=d.journal_entry_id WHERE j.company_id=? AND j.financial_year_id=? AND j.journal_date<=? ORDER BY j.id,d.id", [company, selected.year.id, selected.to]);
    return { ...render(kind, accounts, lines.map(line => ({ ...line, signed_minor: (m.money(line.debit) - m.money(line.credit)).toString() })), filters), provisional_costs: proof.blockers.length > 0, reconciliation_fingerprint: proof.fingerprint };
  } catch (error) {
    m.fail(error.code?.startsWith("IV_") ? error.code : "IV_GL_REPORT_NOT_READY");
  } finally {
    if (cx) {
      try { await cx.rollback(); } catch { m.fail("IV_GL_READ_SNAPSHOT_FAILED"); }
      finally { cx.release(); }
    }
  }
}
module.exports = { range, render, maybeReport };
