"use strict";
// Transactional in-memory SQL boundary: service lifecycle and journal verifier
// execute unchanged. Only DB transport/schema metadata and inventory proof are mocked.
class AnnualCloseFixture {
  constructor() {
    this.state = { accounts: [1,2,3,4,5,6].map(id => ({ id, status: 1, account_type: ({1:"ASSET",2:"ASSET",3:"LIABILITY",4:"EQUITY",5:"EQUITY",6:"INCOME"})[id] })),
      financial_years: [{ id:10, start_date:"2026-04-01", end_date:"2027-03-31", status:"RECONCILIATION" },{id:11,start_date:"2027-04-01",end_date:"2028-03-31",status:"OPEN"}],
      journal_entries: [{id:1,company_id:1,financial_year_id:10,journal_date:"2026-05-01",status:1,total_debit:"100.00",total_credit:"100.00",source_type:"manual"}],
      journal_entry_details: [{id:1,journal_entry_id:1,account_id:1,debit:"100.00",credit:"0.00"},{id:2,journal_entry_id:1,account_id:6,debit:"0.00",credit:"100.00"}],
      system_account_role_assignments: ["CASH","ACCOUNTS_RECEIVABLE","ACCOUNTS_PAYABLE","RETAINED_EARNINGS","OPENING_BALANCE_EQUITY"].map((role,i)=>({role,account_id:i+1,from_date:"2026-04-01",to_date:null})),
      financial_year_events: [], financial_year_close_runs: [], financial_year_close_lines: [] };
    this.tail = Promise.resolve(); this.writes = []; this.failOn = null;
  }
  async getConnection() {
    const owner = this; let before, unlock;
    const start = async () => { const previous=owner.tail; owner.tail=new Promise(resolve=>{unlock=resolve;}); await previous; before=structuredClone(owner.state); };
    return { beginTransaction:start, async commit(){before=null; unlock?.();unlock=null;}, async rollback(){if(before)owner.state=before;before=null;unlock?.();unlock=null;}, release(){}, destroy(){unlock?.();},
      async query(sql,args=[]){if(sql.startsWith("START TRANSACTION")){await start();return [[]];}return owner.query(sql,args);} };
  }
  async query(sql,args=[]) {
    const s=sql.replace(/\s+/g," ").trim();
    if(s.startsWith("SET TRANSACTION"))return [[]];
    if(s.includes("FROM companies"))return [[{id:1}]];
    if(s.includes("FROM user_company_memberships"))return [[{membership_role:"owner"}]];
    if(s.includes("FROM financial_years")) {
      let rows=this.state.financial_years;
      if(s.includes("AND id=?"))rows=rows.filter(r=>r.id===args[1]);
      if(s.includes("AND start_date=?"))rows=rows.filter(r=>r.start_date===args[1]);
      return [structuredClone(rows)];
    }
    if(s.includes("MAX(id)"))return [[{version:this.state.financial_year_events.at(-1)?.id||0}]];
    if(s.startsWith("SELECT metadata FROM financial_year_events"))return [this.state.financial_year_events.filter(e=>JSON.parse(e.metadata).idempotency_key===args[2])];
    if(s.includes("FROM financial_year_close_runs r JOIN"))return [this.state.financial_year_close_runs.filter(r=>r.status==="FINALIZED").map(r=>({...r,close_date:"2027-03-31",open_date:"2027-04-01"}))];
    if(s.startsWith("SELECT")) {
      const table=/FROM (\w+)/.exec(s)?.[1]; let rows=this.state[table]||[];
      if(table==="journal_entry_details" && s.includes("WHERE journal_entry_id=?"))rows=rows.filter(r=>r.journal_entry_id===args[0]);
      if(table==="journal_entries" && s.includes("source_type IN"))rows=rows.filter(r=>["annual_fy_close","annual_fy_opening"].includes(r.source_type)).map(r=>({...r,date:r.journal_date}));
      if(table==="financial_year_close_lines")rows=rows.filter(r=>r.close_run_id===args[1]);
      return [structuredClone(rows)];
    }
    if(/^(INSERT|UPDATE)/.test(s)) {
      this.writes.push(s);if(this.failOn && s.includes(this.failOn))throw new Error("synthetic rollback point");
      if(s.startsWith("INSERT")) {
        const [,table,columns,values]=/^INSERT INTO (\w+)\s*\(([^)]+)\)\s*VALUES\s*\((.*)\)$/.exec(s)||[];
        if(!table)throw new Error(`Unsupported insert ${s}`);
        const list=this.state[table]||(this.state[table]=[]), row={id:Math.max(0,...list.map(r=>r.id))+1};let i=0;
        const tokens=values.split(","); columns.split(",").forEach((name,j)=>{const token=tokens[j].trim();row[name.trim()]=token==="?"?args[i++]:token.startsWith("'")?token.slice(1,-1):/^\d+$/.test(token)?Number(token):"synthetic-time";});
        if(table==="journal_entries")row.status=1;
        if(table==="financial_year_close_runs")row.lock_version=0;
        list.push(row);return [{insertId:row.id,affectedRows:1}];
      }
      if(s.startsWith("UPDATE financial_years")){const row=this.state.financial_years.find(r=>r.id===args[0]);const statuses=[...s.matchAll(/status='([^']+)'/g)].map(m=>m[1]);if(row.status!==statuses[1])return [{affectedRows:0}];row.status=statuses[0];return [{affectedRows:1}];}
      if(s.startsWith("UPDATE financial_year_close_runs")){const r=this.state.financial_year_close_runs.find(r=>r.id===args[3]);if(r.status!=="READY"||r.source_fingerprint!==args[5]||r.lock_version!==args[6])return [{affectedRows:0}];Object.assign(r,{status:"FINALIZED",closing_journal_entry_id:args[0],opening_journal_entry_id:args[1],lock_version:r.lock_version+1});return [{affectedRows:1}];}
    }
    throw new Error(`Unsupported SQL ${s}`);
  }
}
module.exports={AnnualCloseFixture};
