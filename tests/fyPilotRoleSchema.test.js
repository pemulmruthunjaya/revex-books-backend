"use strict";
const test=require("node:test"), assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {assertReady}=require("../services/fyPilotRoleSchema");
const sql=fs.readFileSync(path.join(__dirname,"../db/migrations/2026-09-12-financial-year-close-foundation.sql"),"utf8");
function fixture(){
  const definition=sql.match(/CREATE TABLE IF NOT EXISTS system_account_role_assignments \(([\s\S]*?)\) ENGINE=InnoDB/)[1];
  const columns=[];
  const types={id:"bigint unsigned",company_id:"int",role:"enum('OPENING_BALANCE_EQUITY','RETAINED_EARNINGS','ACCOUNTS_RECEIVABLE','ACCOUNTS_PAYABLE','CUSTOMER_CREDITS','VENDOR_ADVANCES','CASH','BANK','INVENTORY','INPUT_TAX','OUTPUT_TAX')",account_id:"int",effective_from_financial_year_id:"bigint unsigned",effective_to_financial_year_id:"bigint unsigned",protected_at:"timestamp(6)",protected_by_close_run_id:"bigint unsigned",created_by:"int",created_at:"timestamp(6)",updated_at:"timestamp(6)",singleton_active_role:"varchar(40)"};
  for(const [COLUMN_NAME,COLUMN_TYPE]of Object.entries(types))columns.push({COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE:["effective_to_financial_year_id","protected_at","protected_by_close_run_id","singleton_active_role"].includes(COLUMN_NAME)?"YES":"NO",COLUMN_DEFAULT:["created_at","updated_at"].includes(COLUMN_NAME)?"CURRENT_TIMESTAMP(6)":null,EXTRA:COLUMN_NAME==="id"?"auto_increment":COLUMN_NAME==="singleton_active_role"?"STORED GENERATED":COLUMN_NAME==="created_at"?"DEFAULT_GENERATED":COLUMN_NAME==="updated_at"?"DEFAULT_GENERATED on update CURRENT_TIMESTAMP(6)":"",GENERATION_EXPRESSION:COLUMN_NAME==="singleton_active_role"?"(case when ((`role` not in (_utf8mb4'CASH',_utf8mb4'BANK')) and (`effective_to_financial_year_id` is null)) then `role` else NULL end)":""});
  const foreign=[];for(const [,CONSTRAINT_NAME,fields,REFERENCED_TABLE_NAME,refs]of definition.matchAll(/CONSTRAINT (\w+)\s+FOREIGN KEY \(([^)]+)\)\s+REFERENCES (\w+)\(([^)]+)\)/g))fields.split(",").forEach((f,i)=>foreign.push({CONSTRAINT_NAME,COLUMN_NAME:f.trim(),REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME:refs.split(",")[i].trim(),local_reference:1,UPDATE_RULE:"RESTRICT",DELETE_RULE:"NO ACTION"}));
  const indexes=[];for(const [INDEX_NAME,fields]of Object.entries({PRIMARY:"id",uq_system_account_roles_id_company:"id,company_id",uq_system_account_roles_assignment:"company_id,role,account_id,effective_from_financial_year_id",uq_system_account_roles_singleton_active:"company_id,singleton_active_role"}))fields.split(",").forEach(COLUMN_NAME=>indexes.push({INDEX_NAME,COLUMN_NAME,NON_UNIQUE:0,SUB_PART:null,EXPRESSION:null}));
  const triggers=[...sql.matchAll(/CREATE TRIGGER IF NOT EXISTS (trg_system_account_roles_\w+)\s+BEFORE (\w+) ON system_account_role_assignments\s+FOR EACH ROW\s+(BEGIN[\s\S]*?END)\$\$/g)].map(([,TRIGGER_NAME,EVENT_MANIPULATION,ACTION_STATEMENT])=>({TRIGGER_NAME,EVENT_MANIPULATION,ACTION_STATEMENT,ACTION_TIMING:"BEFORE",ACTION_ORIENTATION:"ROW"}));
  const native=[{Table:"system_account_role_assignments","Create Table":"CREATE TABLE `system_account_role_assignments` (\n  `singleton_active_role` varchar(40) COLLATE utf8mb4_unicode_ci GENERATED ALWAYS AS ("+columns[11].GENERATION_EXPRESSION+") STORED,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"}];
  return {columns,foreign,indexes,triggers,native,writes:0,async query(s){if(s==="SHOW CREATE TABLE `system_account_role_assignments`")return [this.native];if(!s.startsWith("SELECT ")){this.writes++;throw Error("write prohibited");}return [s.includes("COLUMNS")?this.columns:s.includes("KEY_COLUMN_USAGE")?this.foreign:s.includes("STATISTICS")?this.indexes:this.triggers];}};
}
test("annual-role schema accepts native MySQL inherited defaults and generated expression",async()=>{await assertReady(fixture());});
function observedFixture(){const f=fixture();f.columns[11].GENERATION_EXPRESSION=f.columns[11].GENERATION_EXPRESSION.replace("_utf8mb4'CASH'","_latin1\\'CASH\\'").replace("_utf8mb4'BANK'","_latin1\\'BANK\\'");return f;}
test("observed escaped latin1 metadata requires exact independent native utf8mb4 corroboration",async()=>{const f=observedFixture();await assertReady(f);assert.equal(f.writes,0);});
function observedUtf8mb4Fixture(){const f=observedFixture();f.columns[11].GENERATION_EXPRESSION=f.columns[11].GENERATION_EXPRESSION.replaceAll("_latin1","_utf8mb4");return f;}
test("observed escaped utf8mb4 metadata requires exact independent native STORED corroboration",async()=>{const f=observedUtf8mb4Fixture();await assertReady(f);assert.equal(f.writes,0);});
for(const [label,change]of Object.entries({
  changedLiteral:f=>f.columns[11].GENERATION_EXPRESSION=f.columns[11].GENERATION_EXPRESSION.replace("CASH","CASHX"),
  changedRoleSet:f=>f.columns[11].GENERATION_EXPRESSION=f.columns[11].GENERATION_EXPRESSION.replace("BANK","INVENTORY"),
  changedOperator:f=>f.columns[11].GENERATION_EXPRESSION=f.columns[11].GENERATION_EXPRESSION.replace(" and "," or "),
  missingNative:f=>f.native=[],
  mismatchingNative:f=>f.native[0]["Create Table"]=f.native[0]["Create Table"].replace("'BANK'","'BANKX'"),
  mismatchingCollation:f=>f.native[0]["Create Table"]=f.native[0]["Create Table"].replace("COLLATE utf8mb4_unicode_ci GENERATED","COLLATE utf8mb4_bin GENERATED"),
  virtualNative:f=>f.native[0]["Create Table"]=f.native[0]["Create Table"].replace("STORED","VIRTUAL"),
}))test(`escaped utf8mb4 metadata with ${label} rejects before writes`,async()=>{const f=observedUtf8mb4Fixture();change(f);await assert.rejects(assertReady(f),{code:"FY_PILOT_ROLE_SCHEMA_INCOMPATIBLE"});assert.equal(f.writes,0);});
for(const [label,change]of Object.entries({
  nativeLiteral:f=>f.native[0]["Create Table"]=f.native[0]["Create Table"].replace("'CASH'","'CASHX'"),
  nativeOperator:f=>f.native[0]["Create Table"]=f.native[0]["Create Table"].replace(" and "," or "),
  nativeRoleSet:f=>f.native[0]["Create Table"]=f.native[0]["Create Table"].replace("'BANK'","'INVENTORY'"),
  nativeGrouping:f=>f.native[0]["Create Table"]=f.native[0]["Create Table"].replace("')) and (","' and ("),
  nativeCollation:f=>f.native[0]["Create Table"]=f.native[0]["Create Table"].replace("COLLATE utf8mb4_unicode_ci GENERATED","COLLATE utf8mb4_bin GENERATED"),
  nativeType:f=>f.native[0]["Create Table"]=f.native[0]["Create Table"].replace("varchar(40)","varchar(41)"),
  nativeVirtual:f=>f.native[0]["Create Table"]=f.native[0]["Create Table"].replace("STORED","VIRTUAL"),
  nativeIntroducer:f=>f.native[0]["Create Table"]=f.native[0]["Create Table"].replaceAll("_utf8mb4","_latin1"),
  missingNative:f=>f.native=[],
  changedMetadataLiteral:f=>f.columns[11].GENERATION_EXPRESSION=f.columns[11].GENERATION_EXPRESSION.replace("CASH","CA SH"),
  unescapedLatin1:f=>f.columns[11].GENERATION_EXPRESSION=f.columns[11].GENERATION_EXPRESSION.replaceAll("\\'","'"),
  unknownIntroducer:f=>f.columns[11].GENERATION_EXPRESSION=f.columns[11].GENERATION_EXPRESSION.replaceAll("_latin1","_ascii"),
}))test(`observed metadata with ${label} rejects before writes`,async()=>{const f=observedFixture();change(f);await assert.rejects(assertReady(f),{code:"FY_PILOT_ROLE_SCHEMA_INCOMPATIBLE"});assert.equal(f.writes,0);});
for(const [label,rows]of Object.entries({global:[{COLUMN_NAME:"role"}],composite:[{COLUMN_NAME:"company_id"},{COLUMN_NAME:"role"}],functional:[{COLUMN_NAME:null,EXPRESSION:"upper(`role`)"}],generated:[{COLUMN_NAME:"singleton_active_role"}]}))test(`unexpected ${label} uniqueness rejects with zero writes`,async()=>{
  const f=fixture();f.indexes.push(...rows.map(row=>({INDEX_NAME:"unexpected_unique",COLUMN_NAME:null,NON_UNIQUE:0,SUB_PART:null,EXPRESSION:null,...row})));
  await assert.rejects(assertReady(f),{code:"FY_PILOT_ROLE_SCHEMA_INCOMPATIBLE"});assert.equal(f.writes,0);
});
for(const [label,change]of Object.entries({wrongType:f=>f.columns[1].COLUMN_TYPE="bigint",wrongDefault:f=>f.columns[3].COLUMN_DEFAULT="1",generatedMeaning:f=>f.columns[11].GENERATION_EXPRESSION=f.columns[11].GENERATION_EXPRESSION.replace(" and "," or "),foreignSchema:f=>f.foreign[0].local_reference=0,foreignAction:f=>f.foreign[0].DELETE_RULE="CASCADE",missingFK:f=>f.foreign.pop(),missingIndex:f=>f.indexes.pop(),functionalKey:f=>f.indexes[0].EXPRESSION="id+0",missingTrigger:f=>f.triggers.pop(),changedTrigger:f=>f.triggers[0].ACTION_STATEMENT="BEGIN END"}))test(`annual-role ${label} fails without writes`,async()=>{const f=fixture();change(f);await assert.rejects(assertReady(f),{code:"FY_PILOT_ROLE_SCHEMA_INCOMPATIBLE"});assert.equal(f.writes,0);});
