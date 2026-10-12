"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const runner=require("../db/migrations/2026-10-04-annual-subledger-carry-forward");
const {Schema}=require("./helpers/annualMigrationSchemaFixture");
const options={confirmation:"APPLY_ANNUAL_CARRY_FORWARD_V1"};
test("annual runner is pinned, explicit, fresh-applicable and already-applied no-op",async()=>{
  const cx=new Schema();await assert.rejects(runner.migrate(cx),{code:"ANNUAL_EXPLICIT_MIGRATION_REQUIRED"});assert.equal(cx.writes.length,0);
  assert.equal(runner.SQL_SHA256,require("node:crypto").createHash("sha256").update(require("node:fs").readFileSync(require("node:path").join(__dirname,"../db/migrations/2026-10-04-annual-subledger-carry-forward.sql"),"utf8").replace(/\r\n/g,"\n")).digest("hex"));
  const result=await runner.migrate(cx,options);assert.ok(result.applied>25);const count=cx.writes.length;
  assert.equal((await runner.migrate(cx,options)).applied,0);assert.equal(cx.writes.length,count);
});
test("partial committed DDL resumes only missing objects with no automatic retry",async()=>{
  const cx=new Schema();cx.failAfter=12;await assert.rejects(runner.migrate(cx,options),/synthetic DDL interruption/);assert.equal(cx.writes.length,12);
  const prefix=[...cx.writes];cx.failAfter=Infinity;await runner.migrate(cx,options);assert.equal(new Set(cx.writes).size,cx.writes.length);assert.deepEqual(cx.writes.slice(0,12),prefix);
});
test("incompatible column, index, check, trigger or FK prerequisite refuses before any DDL",async()=>{
  for(const mutate of [
    cx=>cx.tables.get("subledger_opening_items").push("original_invoice_id VARCHAR(10) NULL"),
    cx=>cx.tables.get("bills").push("UNIQUE KEY uq_annual_bill_origin(id,company_id)"),
    cx=>cx.tables.get("subledger_opening_items").push("CONSTRAINT chk_annual_opening_lineage CHECK (1=1)"),
    cx=>cx.triggers.push({TRIGGER_NAME:"trg_annual_opening_no_delete",EVENT_OBJECT_TABLE:"subledger_opening_items",EVENT_MANIPULATION:"DELETE",ACTION_TIMING:"BEFORE",ACTION_STATEMENT:"BEGIN END"}),
    cx=>cx.tables.get("users").splice(1,1,"company_id BIGINT UNSIGNED NOT NULL"),
  ]){const cx=new Schema();mutate(cx);await assert.rejects(runner.migrate(cx,options),e=>/CONFLICT|PREREQUISITE/.test(e.code));assert.equal(cx.writes.length,0);}
});
test("CHECK comparison tolerates redundant MySQL grouping but preserves operator meaning",()=>{
  assert.equal(runner.norm("CONSTRAINT x CHECK (amount > 0 AND company_id IS NOT NULL)"),runner.norm("CONSTRAINT `x` CHECK (((`amount` > 0) and (`company_id` is not null)))"));
  assert.notEqual(runner.norm("CONSTRAINT x CHECK (amount > 0 AND company_id IS NOT NULL)"),runner.norm("CONSTRAINT x CHECK (amount > 0 OR company_id IS NOT NULL)"));
});
module.exports={Schema};

test("realistic MySQL SHOW CREATE CHECK literals retain exact values, operators and grouping",()=>{
  // Representative MySQL SHOW CREATE formatting; no live metadata is fetched.
  const show="CREATE TABLE `annual_subledger_allocation_reversals` (\n"+
    " `amount` decimal(15,2) NOT NULL,\n"+
    " CONSTRAINT `chk_annual_reversal_amount` CHECK ((`amount` > 0)),\n"+
    " CONSTRAINT `party_check` CHECK (((`party_type` = _utf8mb4'CUSTOMER') and (`vendor_id` is null)) or ((`party_type` = _utf8mb4'VENDOR') and (`customer_id` is null)))\n"+
    ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci";
  const clause=runner.tableParts(show).find(c=>c.includes("party_check"));
  const expected="CONSTRAINT party_check CHECK ((party_type='CUSTOMER' AND vendor_id IS NULL) OR (party_type='VENDOR' AND customer_id IS NULL))";
  assert.equal(runner.norm(clause),runner.norm(expected));
  assert.notEqual(runner.norm(clause.replace("'CUSTOMER'","'customer'")),runner.norm(expected));
  assert.notEqual(runner.norm(clause.replace(" = "," <> ")),runner.norm(expected));
  for(const changed of [clause.replace("_utf8mb4'CUSTOMER'","_latin1'CUSTOMER'"),clause.replace("_utf8mb4'CUSTOMER'","_utf8mb4'OTHER'"),clause.replace("_utf8mb4'CUSTOMER'","_utf8mb4'CUSTOMER' COLLATE utf8mb4_bin"),clause.replace("_utf8mb4'CUSTOMER'","_utf8mb4'CUS\\TOMER'")])assert.throws(()=>runner.norm(changed),{code:"ANNUAL_MIGRATION_CHECK_UNSUPPORTED"});
});

test("every baseline OLD/NEW trigger column is preflighted: missing or incompatible means zero DDL",async()=>{
  for(const name of Object.keys(runner.triggerColumns))for(const replacement of [null,`${name} VARCHAR(1) NULL`]){
    const cx=new Schema(),fields=cx.tables.get("subledger_opening_items"),index=fields.findIndex(c=>c.startsWith(`${name} `));
    assert.ok(index>=0,name);if(replacement)fields.splice(index,1,replacement);else fields.splice(index,1);
    await assert.rejects(runner.migrate(cx,options),e=>/TRIGGER_PREREQUISITE|SCHEMA_CONFLICT|PREREQUISITE_MISSING/.test(e.code),name);
    assert.equal(cx.writes.length,0,name);
  }
});

test("trigger prerequisite default and nullability conflicts reject an interrupted schema before further DDL",async()=>{
  for(const bad of ["entry_kind ENUM('ORIGINAL','REVERSAL') NULL DEFAULT 'ORIGINAL'","entry_kind ENUM('ORIGINAL','REVERSAL') NOT NULL DEFAULT 'REVERSAL'"]){
    const cx=new Schema();cx.failAfter=12;await assert.rejects(runner.migrate(cx,options),/synthetic DDL interruption/);
    const fields=cx.tables.get("subledger_opening_items");fields.splice(fields.findIndex(c=>c.startsWith("entry_kind ")),1,bad);
    cx.failAfter=Infinity;const before=cx.writes.length;
    await assert.rejects(runner.migrate(cx,options),{code:"ANNUAL_MIGRATION_TRIGGER_PREREQUISITE_INCOMPATIBLE"});assert.equal(cx.writes.length,before);
  }
});

test("MySQL 9.7.2 inherited enum and varchar collations are compatible through resume and no-op",async()=>{
  const cx=new Schema();cx.explicitInheritedCollation=true;cx.failAfter=12;
  const [ddl]=await cx.query("SHOW CREATE TABLE `subledger_opening_items`");
  assert.match(ddl[0]["Create Table"],/`origin` ENUM\('ONBOARDING','HISTORICAL_MIGRATION'\) COLLATE utf8mb4_unicode_ci NOT NULL/);
  assert.match(ddl[0]["Create Table"],/`reference` VARCHAR\(120\) COLLATE utf8mb4_unicode_ci NOT NULL/);
  await assert.rejects(runner.migrate(cx,options),/synthetic DDL interruption/);
  cx.failAfter=Infinity;await runner.migrate(cx,options);
  assert.deepEqual(await runner.plan(cx),[]);assert.equal((await runner.migrate(cx,options)).applied,0);
});

test("effective charset/collation and every substantive column difference reject before DDL",async()=>{
  for(const change of [
    cx=>cx.tableCollations.set("subledger_opening_items","utf8mb4_bin"),
    cx=>cx.databaseDefaults={charset:"latin1",collation:"latin1_swedish_ci"},
    ...[
      "origin ENUM('ONBOARDING','HISTORICAL_MIGRATION') COLLATE utf8mb4_bin NOT NULL",
      "origin ENUM('ONBOARDING','HISTORICAL_MIGRATION') CHARACTER SET ascii COLLATE utf8mb4_unicode_ci NOT NULL",
      "origin ENUM('onboarding','HISTORICAL_MIGRATION') COLLATE utf8mb4_unicode_ci NOT NULL",
      "origin ENUM('HISTORICAL_MIGRATION','ONBOARDING') COLLATE utf8mb4_unicode_ci NOT NULL",
      "origin ENUM('ONBOARDING','HISTORICAL_MIGRATION') COLLATE utf8mb4_unicode_ci NULL",
      "reference VARCHAR(121) COLLATE utf8mb4_unicode_ci NOT NULL",
      "entry_kind ENUM('ORIGINAL','REVERSAL') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'original'"
    ].map(bad=>cx=>{const columns=cx.tables.get("subledger_opening_items"),name=bad.split(" ")[0];columns.splice(columns.findIndex(c=>c.startsWith(name+" ")),1,bad);})
  ]){const cx=new Schema();cx.explicitInheritedCollation=true;change(cx);await assert.rejects(runner.migrate(cx,options),e=>/CONFLICT|INCOMPATIBLE/.test(e.code));assert.equal(cx.writes.length,0);}
});

test("applied ASCII token columns cannot silently change charset or collation",async()=>{
  const cx=new Schema();await runner.migrate(cx,options);const count=cx.writes.length;
  const columns=cx.tables.get("annual_subledger_allocations"),i=columns.findIndex(c=>c.startsWith("idempotency_key "));
  columns[i]=columns[i].replace("ascii COLLATE ascii_bin","utf8mb4 COLLATE utf8mb4_bin");
  await assert.rejects(runner.migrate(cx,options),{code:"ANNUAL_MIGRATION_SCHEMA_CONFLICT"});assert.equal(cx.writes.length,count);
});

test("same-named MySQL FK support indexes neither replace nor hide incompatible constraints",async()=>{
  const cx=new Schema();cx.explicitInheritedCollation=true;await runner.migrate(cx,options);
  const columns=cx.tables.get("subledger_opening_items"),i=columns.findIndex(c=>c.startsWith("CONSTRAINT fk_annual_opening_invoice "));
  const exact=columns[i];columns.splice(i,1);columns.push("KEY fk_annual_opening_invoice(original_invoice_id,company_id,original_financial_year_id)");
  const planned=await runner.plan(cx);assert.equal(planned.length,1);assert.match(planned[0],/^ALTER TABLE subledger_opening_items ADD CONSTRAINT fk_annual_opening_invoice/);
  columns.push(exact.replace("REFERENCES invoices", "REFERENCES bills"));const count=cx.writes.length;
  await assert.rejects(runner.migrate(cx,options),{code:"ANNUAL_MIGRATION_SCHEMA_CONFLICT"});assert.equal(cx.writes.length,count);
});

test("MySQL charset-prefixed debit/credit CHECK literals preserve exact accounting direction",()=>{
  for(const value of ["DEBIT","CREDIT"]){
    const plain=`CONSTRAINT x CHECK (direction='${value}')`,rendered=`CONSTRAINT \`x\` CHECK ((\`direction\` = _utf8mb4'${value}'))`;
    assert.equal(runner.norm(plain),runner.norm(rendered));
    assert.notEqual(runner.norm(plain),runner.norm(rendered.replace(value,value.toLowerCase())));
  }
});
