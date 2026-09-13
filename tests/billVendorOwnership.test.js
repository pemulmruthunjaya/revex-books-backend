"use strict";


const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const db = require("../db/connection");
test("valid GRN bill preserves inherited vendor, FY, item linkage and no duplicate stock posting", async () => {
  const old={query:db.query,get:db.getConnection};
  const calls=[];
  db.query=async sql=>{
    if(sql.includes("SHOW COLUMNS FROM products"))return [[{Field:"mrp"},{Field:"purchase_price"},{Field:"gst"}]];
    if(sql.includes("SHOW COLUMNS FROM bill_items"))return [[{Field:"mrp"}]];
    throw Error("Unexpected pool query");
  };
  db.getConnection=async()=>({
    beginTransaction:async()=>{},commit:async()=>calls.push({event:"commit"}),
    rollback:async()=>assert.fail("rollback"),release:()=>{},
    query:async(sql,params)=>{
      calls.push({sql,params});
      if(sql.includes("FROM financial_years"))return [[{id:2026,company_id:4,status:"OPEN"}]];
      if(sql.includes("FROM goods_receipts gr")){
        assert.deepEqual(params,[31,4]);
        return [[{id:31,vendor_id:7,purchase_order_id:21,grn_number:"GRN-TEST"}]];
      }
      if(sql.includes("FROM goods_receipt_items"))return [[{id:41,product_id:9,accepted_qty:3,product_name:"Item"}]];
      if(sql.includes("billed_quantity"))return [[]];
      if(sql.includes("INSERT INTO bills"))return [{insertId:81}];
      if(sql.includes("INSERT INTO bill_items"))return [{insertId:91}];
      throw Error("Unexpected query: "+sql);
    }
  });
  delete require.cache[require.resolve("../controllers/billController")];
  try {
    const request=req(7);request.body.source_grn_id=31;request.body.items[0].source_grn_item_id=41;
    const res=response();
    await require("../controllers/billController").createBillFromGrn(request,res);
    assert.equal(res.statusCode,201);
    const header=calls.find(x=>x.sql?.includes("INSERT INTO bills"));
    assert.deepEqual(header.params,[7,"TEST","2026-08-12",null,236,4,2026,21,31]);
    assert.match(header.sql,/0\)$/);
    assert.ok(!calls.some(x=>/UPDATE products|INSERT INTO inventory|INSERT INTO journal|INSERT INTO ledger/.test(x.sql||"")));
    assert.ok(calls.some(x=>x.event==="commit"));
  } finally {db.query=old.query;db.getConnection=old.get;}
});
const response = () => ({ statusCode: 200, status(n) { this.statusCode=n; return this; }, json(b) { this.body=b; return this; } });
const req = vendor => ({ user:{company_id:4,user_id:13}, params:{id:81}, body:{
  vendor_id:vendor, company_id:99, bill_number:"TEST", bill_date:"2026-08-12",
  items:[{product_id:9,name:"Item",qty:2,price:100,mrp:120,gst:18}]
}});
async function exercise(method, vendor, disappears=false) {
  const calls=[]; let lookups=0;
  const old={query:db.query,get:db.getConnection,error:console.error};
  db.query=async sql=>{
    calls.push({sql,pool:true});
    if(sql.includes("SHOW COLUMNS FROM products")) return [[{Field:"mrp"},{Field:"purchase_price"},{Field:"gst"}]];
    if(sql.includes("SHOW COLUMNS FROM bill_items")) return [[{Field:"mrp"}]];
    if(sql.includes("ALTER TABLE bills MODIFY status")) return [{affectedRows:0}];
    throw Error("Unexpected pool query: "+sql);
  };
  const c={
    beginTransaction:async()=>calls.push({event:"begin"}),
    commit:async()=>calls.push({event:"commit"}),
    rollback:async()=>calls.push({event:"rollback"}),
    release:()=>calls.push({event:"release"}),
    query:async(sql,params)=>{
      calls.push({sql,params});
      if(sql.includes("FROM vendors")) {
        assert.match(sql,/WHERE id = \? AND company_id = \?/);
        assert.deepEqual(params,[vendor,4]); // Never use body.company_id.
        lookups++;
        return [[...(vendor===7&&!(disappears&&lookups===2)?[{id:7}]:[])]];
      }
      if(sql.includes("FROM financial_years"))return [[{id:2026,company_id:4,start_date:"2026-04-01",end_date:"2027-03-31",status:"OPEN"}]];
      if(sql.includes("SELECT id, status, stock_posted"))return [[{id:81,status:"Unpaid",stock_posted:1,source_grn_id:null,financial_year_id:2026}]];
      if(sql.includes("SELECT bi.product_id"))return [[{product_id:9,quantity:1}]];
      if(sql.includes("SELECT id, name FROM products"))return [[{id:9,name:"Item"}]];
      if(sql.includes("AS paid_amount"))return [[{paid_amount:0}]];
      if(/^\s*(INSERT|UPDATE|DELETE)\b/.test(sql))return [{insertId:81,affectedRows:1}];
      throw Error("Unexpected transaction query: "+sql);
    }
  };
  db.getConnection=async()=>c; console.error=()=>{};
  delete require.cache[require.resolve("../controllers/billController")];
  try {const res=response();await require("../controllers/billController")[method](req(vendor),res);return {calls,res};}
  finally {db.query=old.query;db.getConnection=old.get;console.error=old.error;}
}
for(const method of ["createBill","updateBill"]) {
  test(method+": same-company vendor preserves successful bill/item/stock transaction",async()=>{
    const {calls,res}=await exercise(method,7);
    assert.equal(res.statusCode,method==="createBill"?201:200);
    assert.equal(res.body.message,method==="createBill"?"Bill created & stock increased ✅":"Bill updated");
    const checks=calls.filter(x=>x.sql?.includes("FROM vendors"));
    assert.equal(checks.length,2);assert.match(checks[1].sql,/FOR SHARE$/);
    assert.ok(calls.indexOf(checks[1])>calls.findIndex(x=>x.event==="begin"));
    const mutation=calls.findIndex(x=>/^\s*(INSERT|UPDATE|DELETE)\b/.test(x.sql||""));
    assert.ok(mutation>calls.indexOf(checks[1]));
    assert.ok(calls.some(x=>x.sql?.includes("INSERT INTO bill_items")));
    assert.ok(calls.some(x=>x.sql?.includes("UPDATE products")));
    const header=calls.find(x=>method==="createBill"?x.sql?.includes("INSERT INTO bills"):x.sql?.includes("SET vendor_id"));
    assert.equal(header.params[4],236);
    assert.ok(header.params.includes(2026));
    assert.ok(calls.some(x=>x.event==="commit"));
    assert.equal(calls.at(-1).event,"release");
  });
  for(const [label,vendor] of [["foreign",8],["nonexistent",999]])test(method+": "+label+" vendor rejected before every persistent effect",async()=>{
    const {calls,res}=await exercise(method,vendor);
    assert.equal(res.statusCode,404);assert.deepEqual(res.body,{message:"Vendor not found"});
    assert.equal(calls.filter(x=>x.sql).length,1); // No schema helper, FY lookup or any DML.
    assert.ok(!calls.some(x=>x.event==="commit"));
    assert.equal(calls.at(-1).event,"release");
  });
  test(method+": ownership loss before transaction recheck fails before bill DML",async()=>{
    const {calls,res}=await exercise(method,7,true);
    assert.equal(res.statusCode,404);
    assert.ok(!calls.some(x=>/^\s*(INSERT|UPDATE|DELETE)\b/.test(x.sql||"")));
    assert.ok(calls.some(x=>x.event==="rollback"));
    assert.ok(!calls.some(x=>x.event==="commit"));
  });
}
test("legacy mismatched bill cannot reaffirm foreign vendor; response equals nonexistent",async()=>{
  const foreign=await exercise("updateBill",8),missing=await exercise("updateBill",999);
  assert.deepEqual(foreign.res.body,missing.res.body);
  assert.equal(foreign.calls.filter(x=>x.sql).length,1);
});
test("entry-point audit: inherited GRN/PO identity, blocked imports and unchanged payment guard",()=>{
  const read=f=>fs.readFileSync(path.join(__dirname,"..",f),"utf8");
  const bill=read("controllers/billController.js");
  const grn=bill.slice(bill.indexOf("exports.createBillFromGrn"),bill.indexOf("exports.updateBill ="));
  assert.match(grn,/gr\.id=\? AND gr\.company_id=\?/);
  assert.match(grn,/Number\(grn.vendor_id\) !== Number\(vendor_id\)/);
  const po=read("controllers/purchaseOrderController.js");
  assert.match(po.slice(po.indexOf("exports.convertPurchaseOrderToBill")),/v\.company_id = po\.company_id[\s\S]*order.vendor_id/);
  const receipt=read("controllers/goodsReceiptController.js");
  assert.match(receipt.slice(receipt.indexOf("exports.createBill =")),/id=\? AND company_id=\?[\s\S]*grn.vendor_id/);
  const backup=read("controllers/backupController.js");
  const imports=backup.slice(backup.indexOf("exports.importTransactions ="));
  assert.ok(imports.indexOf("OPERATIONAL_IMPORT_ACCOUNTING_PATH_REQUIRED")<imports.indexOf("importPurchaseBills("));
  const payment=read("services/vendorPaymentService.js");
  assert.match(payment,/v\.id=b\.vendor_id AND v\.company_id=b\.company_id/);
  assert.match(payment,/b\.id=\? AND b\.vendor_id=\? AND b\.company_id=\?/);
});
test("vendor payment rejects foreign vendor or foreign bill before transaction DML",async()=>{
  const old={query:db.query,get:db.getConnection};
  db.query=async sql=>{
    if(sql.includes("information_schema"))return [[{present:1}]];
    if(sql.includes("UPDATE bills b"))return [{affectedRows:0}]; // Existing schema initialization, not redesigned here.
    throw Error("Unexpected pool query");
  };
  delete require.cache[require.resolve("../services/vendorPaymentService")];
  const {recordVendorPayment}=require("../services/vendorPaymentService");
  try {
    for(const scenario of ["foreignVendor","foreignBill"]){
      const calls=[];
      db.getConnection=async()=>({
        beginTransaction:async()=>{},rollback:async()=>{},release:()=>{},commit:async()=>assert.fail("commit"),
        query:async(sql,params)=>{
          calls.push(sql);
          if(sql.includes("FROM financial_years"))return [[{id:2026,company_id:4,status:"OPEN"}]];
          if(sql.includes("SELECT id,journal_entry_id"))return [[]];
          if(sql.includes("FROM bills b INNER JOIN vendors")){
            assert.deepEqual(params,[scenario==="foreignBill"?99:81,scenario==="foreignVendor"?8:7,4]);
            return [[]];
          }
          throw Error("Unexpected query: "+sql);
        }
      });
      await assert.rejects(recordVendorPayment({vendor_id:scenario==="foreignVendor"?8:7,bill_id:scenario==="foreignBill"?99:81,amount:1,payment_date:"2026-08-12",payment_method:"Cash",paid_from_account_id:9,idempotency_key:"test-"+scenario},{company_id:4,user_id:13}),e=>e.status===404);
      assert.ok(!calls.some(sql=>/^\s*(INSERT|UPDATE|DELETE)\b/.test(sql)));
    }
  }finally{db.query=old.query;db.getConnection=old.get;}
});
