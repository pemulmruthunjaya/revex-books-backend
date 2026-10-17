"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const key = "11111111-1111-4111-8111-111111111111";
const names = [["1100","Inventory","ASSET"],["1200","Recoverable Input Tax","ASSET"],["1300","Accounts Receivable","ASSET"],["2000","Accounts Payable","LIABILITY"],["2100","Goods Received Not Invoiced","LIABILITY"],["3100","Retained Earnings","EQUITY"],["3200","Opening Balance Equity","EQUITY"],["5100","Cost of Goods Sold","EXPENSE"]];
class Fixture {
  constructor() {
    this.operations=[]; this.roles=[]; this.writes=0; this.calls=[]; this.readyCalls=0;
    this.accounts=names.map(([account_code,account_name,account_type],i)=>({id:String(i+30),account_code,account_name,account_type,status:1,opening_balance:"0.00"}));
    this.fy={id:"10",code:"FY2026-27",start_date:"2026-04-01",end_date:"2027-03-31",status:"OPEN",is_default:1};
    this.company={id:9,name:"RevEx FY Pilot",status:"active"}; this.user={id:19,company_id:9,role:"owner",is_active:1};
    this.tables=["companies","users","user_company_memberships","accounts","financial_years","system_account_role_assignments","iv_operations","products","invoices","bills","goods_receipts","inventory_transactions","journal_entries","journal_entry_details","opening_balance_events","expenses","subledger_opening_items"];
  }
  async cleanup(sql) { return this.query(sql); }
  async query(sql,args=[]) {
    this.calls.push(sql);
    if(sql==="START TRANSACTION"){this.snapshot=structuredClone([this.operations,this.roles]);this.active=true;return [{}];}
    if(sql==="ROLLBACK"){[this.operations,this.roles]=this.snapshot;this.active=false;return [{}];}
    if(sql==="COMMIT"){if(this.lostCommit)throw Error("sensitive transport");this.active=false;return [{}];}
    if(sql.startsWith("SET TRANSACTION"))return [{}];
    if(sql==="DO 0")return [{serverStatus:this.active?3:2}];
    if(sql.includes("information_schema.TABLES"))return [this.tables.map(TABLE_NAME=>({TABLE_NAME,ENGINE:this.badEngine?"MyISAM":"InnoDB",TABLE_TYPE:"BASE TABLE"}))];
    if(sql.includes("information_schema.COLUMNS"))return [[{TABLE_NAME:"products"},{TABLE_NAME:"expenses"},{TABLE_NAME:"opening_balance_events"}]];
    if(sql.endsWith("LIMIT 0"))return [[]];
    if(sql.includes("FROM companies"))return [[this.company]];
    if(sql.includes("FROM users"))return [[this.user]];
    if(sql.includes("FROM user_company_memberships"))return [[{membership_role:"owner",is_active:1}]];
    if(sql.includes("FROM financial_years"))return [[this.fy]];
    if(sql.includes("FROM accounts"))return [sql.includes("AND id=?")?this.accounts.filter(a=>a.id===String(args[1])):this.accounts];
    if(sql.startsWith("SELECT company_id"))return [this.history?[{company_id:9}]:[]];
    if(sql.includes("FROM iv_operations")) {
      let rows=this.operations;
      if(sql.includes("operation_key=?"))rows=rows.filter(o=>o.operation_key===args[1]);
      if(sql.includes("action=?"))rows=rows.filter(o=>o.action===args[1]);
      return [rows.map(o=>structuredClone(o))];
    }
    if(sql.includes("FROM system_account_role_assignments")) {
      const order=["OPENING_BALANCE_EQUITY","RETAINED_EARNINGS","ACCOUNTS_RECEIVABLE","ACCOUNTS_PAYABLE"];
      return [[...this.roles].sort((a,b)=>order.indexOf(a.role)-order.indexOf(b.role))];
    }
    if(sql.startsWith("INSERT")) {
      this.writes++;
      if(this.failAt===this.writes)throw Error("sensitive injected failure");
      if(sql.includes("INSERT INTO iv_operations")){const [company_id,operation_key,actor_id,action,fingerprint,result]=args;this.operations.push({company_id,operation_key,actor_id,action,fingerprint,result});}
      else if(sql.includes("INSERT INTO system_account_role_assignments")){const [role,account_id,fy]=args;this.roles.push({role,account_id,fy,effective_to_financial_year_id:null,protected_at:null,protected_by_close_run_id:null,created_by:"19"});}
      else throw Error(`Unexpected insert`);
      return [{affectedRows:1}];
    }
    if(/FROM (products|journal_entries|journal_entry_details|bill_items|invoice_items|inventory_transactions|delivery_challan_items|return_items)/.test(sql))return [[]];
    throw Error(`Unhandled test query: ${sql}`);
  }
}
async function run(f, fn) {
  const replacements = {
    "../utils/pinnedMysqlConnection":{pin:cx=>cx,identity:async()=>{}},
    "../db/migrations/2026-10-12-operational-quantity-q2":{inspect:async()=>({classification:"ALREADY_APPLIED"})},
    "../db/migrations/2026-10-17-account-code-tenant-scope":{inspect:async()=>({classification:"ALREADY_APPLIED"})},
    "../db/migrations/2026-10-04-annual-subledger-carry-forward":{plan:async()=>[]},
    "../services/inventoryValuationSchema":{assertReady:async()=>{f.readyCalls++;if(f.schemaRace&&f.readyCalls===2)throw Error("schema changed");}},
    "../services/inventoryGlSchema":{assertReady:async()=>{}},
    "../services/annualSubledgerReadinessService":{inspectAnnualSchema:async()=>({ready:true})},
    "../services/fyPilotRoleSchema":{assertReady:async()=>{}},
  };
  const saved=[];
  const unload=["../scripts/activate-fy-pilot","../services/inventoryGlService","../services/inventoryValuationOperationService","../services/inventoryValuationService"];
  for(const p of [...Object.keys(replacements),...unload]){const id=require.resolve(p);saved.push([id,require.cache[id]]);delete require.cache[id];if(replacements[p])require.cache[id]={id,filename:id,loaded:true,exports:replacements[p]};}
  try {const r=require("../scripts/activate-fy-pilot");await fn(r,{confirmation:r.CONFIRMATION,transactionOwnership:"EXCLUSIVE_IDLE_CONNECTION",idempotencyKey:key,identity:{}});} finally {for(const [id,value]of saved){delete require.cache[id];if(value)require.cache[id]=value;}}
}
test("real MySQL ENUM order succeeds: nine roles/empty cutover atomically and retries without writes",async()=>{
  const f=new Fixture();await run(f,async(r,x)=>{
    const result=await r.activate(f,x);assert.equal(result.replay,false);assert.equal(f.roles.length,4);assert.equal(f.operations.length,7);assert.equal(f.writes,11);
    assert.deepEqual(result.cutover.openings,[]);assert.deepEqual(result.cutover.journals,[]);
    const retry=await r.activate(f,x);assert.equal(retry.replay,true);assert.equal(f.writes,11);
    assert.equal(result.mapping.ACCOUNTS_PAYABLE,f.roles.find(a=>a.role==="ACCOUNTS_PAYABLE").account_id);
    assert.ok(!f.calls.some(s=>/^(CREATE|ALTER|UPDATE|DELETE)|INSERT INTO (journal|iv_records)/.test(s)));
    await assert.rejects(r.activate(f,{...x,idempotencyKey:"22222222-2222-4222-8222-222222222222"}),{code:"FY_PILOT_EXISTING_OR_PARTIAL_STATE"});
  });
});
for(const [label,change]of Object.entries({missing:f=>f.roles.pop(),duplicate:f=>f.roles[1]={...f.roles[0]},unexpected:f=>f.roles[0].role="CASH",wrongAccount:f=>f.roles[0].account_id="999"}))test(`annual postflight rejects ${label} mapping without new writes`,async()=>{
  const f=new Fixture();await run(f,async(r,x)=>{await r.activate(f,x);change(f);const writes=f.writes;await assert.rejects(r.activate(f,x),{code:"FY_PILOT_POSTFLIGHT_MISMATCH"});assert.equal(f.writes,writes);});
});
for(const [label,mutate]of Object.entries({missingAP:f=>f.accounts.splice(3,1),extraAccount:f=>f.accounts.push({...f.accounts[0],id:"99"}),wrongName:f=>f.accounts[0].account_name="Other",wrongType:f=>f.accounts[7].account_type="INCOME",nonzero:f=>f.accounts[0].opening_balance="0.01",inactive:f=>f.user.is_active=0,foreignOwner:f=>f.user.company_id=8,wrongCompany:f=>f.company.name="Other",closedFY:f=>f.fy.status="RECONCILIATION",notDefault:f=>f.fy.is_default=0,history:f=>f.history=true,engine:f=>f.badEngine=true,schemaRace:f=>f.schemaRace=true}))test(`${label} rejects before every write`,async()=>{
  const f=new Fixture();mutate(f);await run(f,async(r,x)=>{await assert.rejects(r.activate(f,x));assert.equal(f.writes,0);assert.equal(f.roles.length,0);assert.equal(f.operations.length,0);});
});
for(const failAt of [1,5,6,9,10,11])test(`failure at business write ${failAt} rolls back every role/operation`,async()=>{
  const f=new Fixture();f.failAt=failAt;await run(f,async(r,x)=>{await assert.rejects(r.activate(f,x),{code:"FY_PILOT_ACTIVATION_REJECTED"});assert.deepEqual(f.roles,[]);assert.deepEqual(f.operations,[]);assert.equal(f.active,false);});
});
test("tampered retry is rejected and uncertain commit never auto-retries",async()=>{
  const f=new Fixture();await run(f,async(r,x)=>{await r.activate(f,x);f.roles[0].account_id="999";await assert.rejects(r.activate(f,x),{code:"FY_PILOT_POSTFLIGHT_MISMATCH"});});
  const uncertain=new Fixture();uncertain.lostCommit=true;await run(uncertain,async(r,x)=>{await assert.rejects(r.activate(uncertain,x),{code:"FY_PILOT_COMMIT_UNCERTAIN_DO_NOT_RETRY_AUTOMATICALLY"});assert.equal(uncertain.calls.filter(s=>s==="COMMIT").length,1);});
});
test("explicit authorization and physical connection required",async()=>{
  const r=require("../scripts/activate-fy-pilot");await assert.rejects(r.activate({},{}),{code:"FY_PILOT_AUTHORIZATION_REQUIRED"});
  await assert.rejects(r.activate({},{confirmation:r.CONFIRMATION,transactionOwnership:"EXCLUSIVE_IDLE_CONNECTION",idempotencyKey:key}),{code:"PILOT_PINNED_CONNECTION_REQUIRED"});
});
