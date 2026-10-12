"use strict";
// Read-only verification against immutable close-line evidence, never a label exemption.
const a = require("./annualSubledgerService");
const fail = () => { const e = new Error("Annual journal reconciliation required"); e.code = "IV_ANNUAL_JOURNAL_MISMATCH"; throw e; };
async function verify(cx, company, locking = false) {
  const suffix = locking ? " FOR UPDATE" : "";
  const [headers] = await cx.query(`SELECT *,DATE_FORMAT(journal_date,'%Y-%m-%d') date FROM journal_entries WHERE company_id=? AND source_type IN ('annual_fy_close','annual_fy_opening') ORDER BY id${suffix}`, [company]);
  const [runs] = await cx.query(`SELECT r.*,DATE_FORMAT(s.end_date,'%Y-%m-%d') close_date,DATE_FORMAT(d.start_date,'%Y-%m-%d') open_date FROM financial_year_close_runs r JOIN financial_years s ON s.id=r.source_financial_year_id AND s.company_id=r.company_id JOIN financial_years d ON d.id=r.destination_financial_year_id AND d.company_id=r.company_id WHERE r.company_id=? AND r.status='FINALIZED' ORDER BY r.id${suffix}`, [company]);
  const seen = new Set();
  for (const run of runs) {
    const [evidence] = await cx.query(`SELECT * FROM financial_year_close_lines WHERE company_id=? AND close_run_id=? ORDER BY account_id${suffix}`, [company, run.id]);
    for (const opening of [false, true]) {
      const prefix = opening ? "opening" : "closing", type = opening ? "annual_fy_opening" : "annual_fy_close";
      const id = run[`${prefix}_journal_entry_id`];
      const expected = evidence.filter(row => a.minor(row[`${prefix}_journal_debit`]) || a.minor(row[`${prefix}_journal_credit`]));
      if (!expected.length) { if (id != null) fail(); continue; }
      const matches = headers.filter(h => String(h.id) === String(id));
      if (matches.length !== 1 || seen.has(String(id))) fail();
      const h = matches[0];
      if (h.source_type !== type || String(h.source_id) !== String(run.id) || Number(h.status) !== 1 ||
          String(h.financial_year_id) !== String(run[opening ? "destination_financial_year_id" : "source_financial_year_id"]) || h.date !== run[opening ? "open_date" : "close_date"]) fail();
      const [details] = await cx.query(`SELECT id,account_id,debit,credit FROM journal_entry_details WHERE journal_entry_id=? ORDER BY account_id,id${suffix}`, [id]);
      if (details.length !== expected.length) fail();
      let debit = 0n, credit = 0n;
      for (const row of expected) {
        const ds = details.filter(d => String(d.id) === String(row[`${prefix}_journal_detail_id`]) && String(d.account_id) === String(row.account_id));
        if (String(row[`${prefix}_journal_entry_id`]) !== String(id) || ds.length !== 1 || a.minor(ds[0].debit) !== a.minor(row[`${prefix}_journal_debit`]) || a.minor(ds[0].credit) !== a.minor(row[`${prefix}_journal_credit`])) fail();
        debit += a.minor(ds[0].debit); credit += a.minor(ds[0].credit);
      }
      if (debit !== credit || debit !== a.minor(h.total_debit) || credit !== a.minor(h.total_credit)) fail();
      seen.add(String(id));
    }
  }
  if (headers.length !== seen.size) fail();
  return seen;
}
module.exports = { verify };
