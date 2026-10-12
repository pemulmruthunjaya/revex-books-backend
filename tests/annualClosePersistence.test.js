"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {AnnualCloseFixture}=require("./helpers/annualCloseFixture");
const readiness=require("../services/annualSubledgerReadinessService");
const gl=require("../services/inventoryGlService");
const journals=require("../services/annualJournalService");
const key=n=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
function setup(t){
  t.mock.method(readiness,"inspectAnnualSchema",async()=>({ready:true}));
  t.mock.method(gl,"inspect",async()=>({ready:true,blockers:[],inventory:[],fingerprint:"a".repeat(64)}));
  t.mock.method(gl,"events",async()=>[]);
  delete require.cache[require.resolve("../services/financialYearCloseService")];
  const f=new AnnualCloseFixture(),service=require("../services/financialYearCloseService").createFinancialYearCloseService(f);
  return {f,service};
}
const body=(p,n,confirmation)=>({idempotency_key:key(n),confirmation,reason:"synthetic review",expected_version:p.version,preview_fingerprint:p.fingerprint});
async function begin(service){const p=await service.preview(1,10,2);assert.equal(p.ready,true,JSON.stringify(p));return service.begin(1,10,2,body(p,1,"BEGIN CLOSE"));}
test("persisted close creates balanced linked journals/snapshots; concurrent identical finalization and lock replay once",async t=>{
  const {f,service}=setup(t);await begin(service);
  const p=await service.preview(1,10,2),request=body(p,2,"FINALIZE CLOSE");assert.equal(p.ready,true);
  const results=await Promise.all([service.finalize(1,10,2,request),service.finalize(1,10,2,request)]);
  assert.equal(results.filter(r=>r.changed).length,1);assert.equal(results.filter(r=>r.replay).length,1);
  assert.equal(f.state.journal_entries.length,3);assert.equal(f.state.financial_year_close_runs[0].status,"FINALIZED");
  assert.equal(f.state.financial_year_inventory_snapshots.length,1);assert.equal(f.state.financial_year_subledger_snapshots.length,2);
  assert.equal((await journals.verify(f,1)).size,2);
  const lock={idempotency_key:key(3),confirmation:"LOCK",reason:"reviewed",expected_version:String(f.state.financial_year_events.at(-1).id)};
  await service.lock(1,10,2,lock);assert.equal(f.state.financial_years[0].status,"LOCKED");
  assert.equal((await service.lock(1,10,2,lock)).replay,true);
});
test("stale preview and injected snapshot failure commit no partial journal, snapshot, event or state",async t=>{
  const {f,service}=setup(t);await begin(service);const p=await service.preview(1,10,2),request=body(p,2,"FINALIZE CLOSE");
  await assert.rejects(service.finalize(1,10,2,{...request,preview_fingerprint:"f".repeat(64)}),{code:"ANNUAL_STALE_PREVIEW"});
  const before=structuredClone(f.state);f.failOn="INSERT INTO financial_year_inventory_snapshots";
  await assert.rejects(service.finalize(1,10,2,request),{code:"ANNUAL_OPERATION_FAILED"});assert.deepEqual(f.state,before);
  f.failOn=null;await service.finalize(1,10,2,request);assert.equal((await journals.verify(f,1)).size,2);
});
test("post-close balanced tampering and spoofed annual source labels prevent permanent lock",async t=>{
  const {f,service}=setup(t);await begin(service);const p=await service.preview(1,10,2);await service.finalize(1,10,2,body(p,2,"FINALIZE CLOSE"));
  const snapshot=structuredClone(f.state),opening=f.state.financial_year_close_runs[0].opening_journal_entry_id;
  const d=f.state.journal_entry_details.filter(d=>d.journal_entry_id===opening);d[0].debit="101.00";d[1].credit="101.00";
  const h=f.state.journal_entries.find(h=>h.id===opening);h.total_debit=h.total_credit="101.00";
  await assert.rejects(journals.verify(f,1),{code:"IV_ANNUAL_JOURNAL_MISMATCH"});
  await assert.rejects(service.lock(1,10,2,{idempotency_key:key(3),confirmation:"LOCK",reason:"reviewed",expected_version:String(f.state.financial_year_events.at(-1).id)}));
  assert.equal(f.state.financial_years[0].status,"CLOSED");f.state=snapshot;
  f.state.journal_entries.push({...h,id:99,source_id:999});await assert.rejects(journals.verify(f,1),{code:"IV_ANNUAL_JOURNAL_MISMATCH"});
});
