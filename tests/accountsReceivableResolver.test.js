"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {resolveAccountsReceivable}=require("../services/accountsReceivableResolver");
const {roleRow,isRoleQuery}=require("./helpers/accountsReceivableFixture");
const {postSalesInvoiceJournal}=require("../services/salesInvoiceAccountingService");
const {postReceipt,createReceipt}=require("../services/receiptEntryService");
const {runInvoiceCreationTransaction}=require("../controllers/invoiceController");
const invoice={id:7,company_id:9,created_by:19,financial_year_id:15,invoice_date:"2026-10-20",invoice_number:"SYNTHETIC-7",total_amount:1180,tax_amount:180};
const receipt={receipt_date:"2026-10-20",receipt_type:"CUSTOMER",invoice_id:7,received_in_account_id:50,amount:"590.00",payment_mode:"bank",idempotency_key:"synthetic-receipt"};
function fixture(rows=[roleRow()]){
  const calls=[],events=[];
  const cx={calls,events,writes:[],async beginTransaction(){events.push("begin");},async commit(){events.push("commit");},async rollback(){events.push("rollback");},release(){events.push("release");},
    async query(sql,args=[]){
      calls.push({sql,args});
      if(isRoleQuery(sql)){assert.deepEqual(args,["9","15"]);assert.match(sql,/FOR SHARE$/);return [rows];}
      if(sql==="DO 0")return [{serverStatus:1}];
      if(sql.includes("FROM companies"))return [[{id:9}]];
      if(sql.includes("FROM financial_years"))return [[{id:15,company_id:9,status:"OPEN",start_date:"2026-04-01",end_date:"2027-03-31"}]];
      if(sql.includes("FROM invoices"))return [[{id:7,invoice_number:"SYNTHETIC-7",total_amount:1180,financial_year_id:15,customer_id:null,status:"pending"}]];
      if(sql.includes("FROM receipt_entries")||sql.includes("FROM payments")||sql.includes("FROM journal_entries"))return [[]];
      if(sql.includes("SELECT a.*"))return [[{id:50,account_name:"Pilot Bank",account_type:"ASSET",status:1}]];
      if(sql.includes("LOWER(account_name)")){
        assert.notEqual(args[1],"Accounts Receivable");
        return [[{id:args[1]==="Sales"?51:52,account_type:args[1]==="Sales"?"INCOME":"LIABILITY"}]];
      }
      if(/^(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)/.test(sql.trim())){cx.writes.push({sql,args});return [{insertId:100+cx.writes.length,affectedRows:1}];}
      throw Error("Unexpected fixture query");
    }};
  return cx;
}
test("Company 9 lower-ID 1100 Inventory never wins over mapped 1300 AR in invoice or receipt",async()=>{
  const masters=[{id:30,account_code:"1100",account_name:"Inventory",account_type:"ASSET"},{id:32,account_code:"1300",account_name:"Accounts Receivable",account_type:"ASSET"}];
  const sale=fixture();await postSalesInvoiceJournal(sale,invoice);
  const debit=sale.writes.find(x=>x.sql.includes("INSERT INTO journal_entry_details"));assert.equal(debit.args[1],masters[1].id);
  const cash=fixture();await postReceipt(cash,receipt,{company_id:9,user_id:19});
  assert.equal(cash.writes.find(x=>x.sql.includes("INSERT INTO receipt_entries")).args[6],32);
  assert.equal(cash.writes.find(x=>x.sql.includes("INSERT INTO journal_entry_details")).args[5],32);
  assert.ok(!sale.calls.concat(cash.calls).some(x=>x.args.includes("1100")));
});
const invalid={
  missing:[roleRow(9,15,{assignment_id:null})], duplicate:[roleRow(),roleRow(9,15,{assignment_id:2})],
  future:[roleRow(9,15,{from_date:"2027-04-01"})], expired:[roleRow(9,15,{from_date:"2025-04-01",effective_to_financial_year_id:14,to_company_id:9,to_date:"2026-03-31"})],
  partial:[roleRow(9,15,{from_date:"2026-10-01"})], wrongCompany:[roleRow(9,15,{role_company_id:8})], foreignYear:[roleRow(9,15,{from_company_id:8})],
  foreignEnd:[roleRow(9,15,{effective_to_financial_year_id:16,to_company_id:8,to_date:"2028-03-31"})],
  foreignAccount:[roleRow(9,15,{account_company_id:8})], inactive:[roleRow(9,15,{status:0})], liability:[roleRow(9,15,{account_type:"LIABILITY"})],
  inventory:[roleRow(9,15,{id:30,account_code:"1100",inventory_role:1})], missingAccount:[roleRow(9,15,{id:null})], wrongFY:[roleRow(9,16)],
};
for(const [label,rows]of Object.entries(invalid))test(`${label}: invoice and receipt rollback with zero business/schema writes`,async()=>{
  const sale=fixture(rows);
  await assert.rejects(runInvoiceCreationTransaction({connection:sale,body:{invoice_date:"2026-10-20",items:[{}]},user:{company_id:9,user_id:19}}),e=>e.code.startsWith("AR_ROLE_"));
  assert.deepEqual(sale.events,["begin","rollback"]);assert.equal(sale.writes.length,0);
  const cash=fixture(rows),db=require("../db/connection"),original=db.getConnection;
  db.getConnection=async()=>cash;
  try{await assert.rejects(createReceipt(receipt,{company_id:9,user_id:19}),e=>e.code.startsWith("AR_ROLE_"));}
  finally{db.getConnection=original;}
  assert.deepEqual(cash.events,["begin","rollback","release"]);assert.equal(cash.writes.length,0);
  const posting=fixture(rows);await assert.rejects(postSalesInvoiceJournal(posting,invoice),e=>e.code.startsWith("AR_ROLE_"));assert.equal(posting.writes.length,0);
});
test("effective assignment selection is independent of row order and excludes historical/future periods",async()=>{
  const active=roleRow(),past=roleRow(9,15,{assignment_id:2,from_date:"2025-04-01",effective_to_financial_year_id:14,to_company_id:9,to_date:"2026-03-31"}),future=roleRow(9,15,{assignment_id:3,from_date:"2027-04-01"});
  for(const rows of [[past,active,future],[future,active,past]])assert.equal((await resolveAccountsReceivable(fixture(rows),9,15)).id,32);
});
test("missing schema errors are sanitized and no lookup falls back or creates accounts",async()=>{
  let count=0;await assert.rejects(resolveAccountsReceivable({async query(){count++;throw Error("sensitive database text");}},9,15),{code:"AR_ROLE_SCHEMA_NOT_READY",message:"AR_ROLE_SCHEMA_NOT_READY"});assert.equal(count,1);
});
