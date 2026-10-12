"use strict";
// AUTHORED ONLY. Requires separately authorized disposable schema/seed setup:
// annual + IV + GL migrations installed, exactly synthetic company 1, owner 2,
// FY 10 (2026-04-01..2027-03-31) and FY 11 (next year), both OPEN.
// Accounts 1 cash,2 AR,3 AP,4 retained,5 opening equity,6 income,7 inventory,
// 8 COGS,9 GRNI,10 input tax; annual role assignments preinstalled. No products
// or business data. This test never installs migrations or repairs the seed.
const test=require("node:test"),assert=require("node:assert/strict");
const enabled=process.env.ANNUAL_GL_MYSQL_TEST_ENABLED==="1";
test("isolated persisted FY lifecycle: bridge, concurrent retry, rollback and SQL journal protection",{skip:!enabled},async()=>{
  const url=new URL(process.env.ANNUAL_GL_MYSQL_TEST_URL||"invalid:");
  if(url.protocol!=="mysql:"||url.hostname!=="127.0.0.1"||url.port!=="3407"||url.search||url.hash||!/^\/annual_gl_proof_[a-f0-9]{32}$/.test(url.pathname)||!url.username||decodeURIComponent(url.username)==="root")throw new Error("ISOLATED_ANNUAL_TARGET_REQUIRED");
  const mysql=require("mysql2/promise"),pool=mysql.createPool({host:url.hostname,port:3407,user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),database:url.pathname.slice(1),connectionLimit:3,dateStrings:true});
  const a=require("../services/annualSubledgerService"),gl=require("../services/inventoryGlService"),journal=require("../services/annualJournalService");
  const svc=require("../services/financialYearCloseService").createFinancialYearCloseService(pool);
  const key=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
  const request=(p,n,confirmation)=>({idempotency_key:key(n),confirmation,reason:"isolated synthetic proof",expected_version:p.version,preview_fingerprint:p.fingerprint});
  try {
    const [[identity]]=await pool.query("SELECT VERSION() version,DATABASE() db,@@port port,CURRENT_USER() user");
    assert.equal(identity.version,"9.7.2");assert.equal(identity.port,3306);assert.equal(identity.db,url.pathname.slice(1));assert.ok(!identity.user.startsWith("root@"));
    const [grants]=await pool.query("SHOW GRANTS");assert.ok(!grants.some(r=>Object.values(r).some(s=>/SUPER|ALL PRIVILEGES ON \*\.\*/i.test(s))));
    for(const table of ["products","expenses","invoices","bills","journal_entries","financial_year_events","financial_year_close_runs","iv_operations","iv_records"]){const [[r]]=await pool.query(`SELECT COUNT(*) n FROM ${table}`);assert.equal(r.n,0,`${table} must be empty`);}
    assert.equal((await require("../services/annualSubledgerReadinessService").inspectAnnualSchema(pool)).ready,true);
    await require("../services/inventoryGlSchema").assertReady(pool);
    for(const [role,account_id] of Object.entries({INVENTORY:7,COGS:8,GRNI:9,ACCOUNTS_PAYABLE:3,INPUT_TAX:10}))await a.transaction(pool,cx=>gl.assignRole(cx,{company_id:1,actor_id:2,role,account_id,effective_date:"2026-04-01",idempotency_key:`isolated-role-${role}`}));
    await a.transaction(pool,cx=>gl.approveCutover(cx,{company_id:1,actor_id:2,date:"2026-04-01",reason:"isolated zero opening",idempotency_key:"isolated-cutover"}));
    await a.transaction(pool,async cx=>{
      const [h]=await cx.query("INSERT INTO journal_entries (company_id,financial_year_id,journal_no,journal_date,narration,total_debit,total_credit,created_by) VALUES (1,10,'SYNTHETIC-ANNUAL','2026-05-01','synthetic',100,100,2)");
      await cx.query("INSERT INTO journal_entry_details (journal_entry_id,account_id,debit,credit) VALUES (?,1,100,0),(?,6,0,100)",[h.insertId,h.insertId]);
      await cx.query("UPDATE financial_years SET status='RECONCILIATION' WHERE id=10 AND company_id=1 AND status='OPEN'");
    });
    const p=await svc.preview(1,10,2);assert.equal(p.ready,true,JSON.stringify(p.blockers));await svc.begin(1,10,2,request(p,1,"BEGIN CLOSE"));
    const next=await svc.preview(1,10,2),final=request(next,2,"FINALIZE CLOSE");
    await assert.rejects(svc.finalize(1,10,2,{...final,preview_fingerprint:"f".repeat(64)}),{code:"ANNUAL_STALE_PREVIEW"});
    // Inject a transport failure after journal/line writes, before snapshots.
    const failPool={async getConnection(){const cx=await pool.getConnection();return new Proxy(cx,{get(target,prop){if(prop==="query")return async(sql,args)=>{if(sql.includes("INSERT INTO financial_year_inventory_snapshots"))throw new Error("synthetic snapshot failure");return target.query(sql,args);};const value=target[prop];return typeof value==="function"?value.bind(target):value;}});}};
    const failing=require("../services/financialYearCloseService").createFinancialYearCloseService(failPool);
    await assert.rejects(failing.finalize(1,10,2,final),{code:"ANNUAL_OPERATION_FAILED"});
    const [[rolled]]=await pool.query("SELECT COUNT(*) n FROM journal_entries WHERE source_type IN ('annual_fy_close','annual_fy_opening')");assert.equal(rolled.n,0);
    const results=await Promise.all([svc.finalize(1,10,2,final),svc.finalize(1,10,2,final)]);assert.equal(results.filter(r=>r.changed).length,1);assert.equal(results.filter(r=>r.replay).length,1);
    const ids=await journal.verify(pool,1);assert.equal(ids.size,2);
    for(const id of ids){
      for(const sql of ["UPDATE journal_entries SET total_debit=101,total_credit=101 WHERE id=?","DELETE FROM journal_entries WHERE id=?","UPDATE journal_entry_details SET description='tampered' WHERE journal_entry_id=?","DELETE FROM journal_entry_details WHERE journal_entry_id=?"])await assert.rejects(pool.query(sql,[id]),e=>e.sqlMessage==="IV_GL_LINKED_JOURNAL_IMMUTABLE");
      await assert.rejects(pool.query("INSERT INTO journal_entry_details (journal_entry_id,account_id,debit,credit) VALUES (?,1,1,0)",[id]),e=>e.sqlMessage==="IV_GL_LINKED_JOURNAL_IMMUTABLE");
    }
    await assert.rejects(pool.query("UPDATE financial_year_close_runs SET status='READY' WHERE company_id=1"),e=>e.sqlMessage==="IV_GL_FINALIZED_RUN_IMMUTABLE");
    const lock=request({version:results.find(r=>r.changed).version},3,"LOCK");await svc.lock(1,10,2,lock);assert.equal((await svc.lock(1,10,2,lock)).replay,true);
    assert.equal((await journal.verify(pool,1)).size,2);
  } finally {await pool.end();} // preserve disposable evidence; no automatic rerun or cleanup
});
