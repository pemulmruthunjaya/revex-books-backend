"use strict";
// Authored only. Separately authorized execution requires a fresh empty,
// disposable database on the exact isolated target. Preserve it after results.
const test=require("node:test"),assert=require("node:assert/strict");
test("guarded MySQL annual migration interrupted DDL, prerequisite rejection and resume",{skip:process.env.ANNUAL_MIGRATION_MYSQL_ENABLED!=="1"},async()=>{
  const url=new URL(process.env.ANNUAL_MIGRATION_MYSQL_URL||"invalid:");
  if(url.protocol!=="mysql:"||url.hostname!=="127.0.0.1"||url.port!=="3407"||url.search||url.hash||!/^\/annual_migration_proof_[a-f0-9]{32}$/.test(url.pathname)||!url.username||decodeURIComponent(url.username).toLowerCase()==="root")throw new Error("ISOLATED_ANNUAL_TARGET_REQUIRED");
  const cx=await require("mysql2/promise").createConnection({host:url.hostname,port:3407,user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),database:url.pathname.slice(1)});
  const runner=require("../db/migrations/2026-10-04-annual-subledger-carry-forward"),{Schema}=require("./helpers/annualMigrationSchemaFixture");
  const options={confirmation:"APPLY_ANNUAL_CARRY_FORWARD_V1"};
  try{
    const [[identity]]=await cx.query("SELECT VERSION() version,@@port port,DATABASE() db,CURRENT_USER() user");
    assert.equal(identity.version,"9.7.2");assert.equal(identity.port,3306);assert.equal(identity.db,url.pathname.slice(1));assert.ok(!identity.user.toLowerCase().startsWith("root@"));
    const [grants]=await cx.query("SHOW GRANTS");assert.ok(!grants.some(r=>Object.values(r).some(s=>/SUPER|ALL PRIVILEGES ON \*\.\*/i.test(s))));
    const [[empty]]=await cx.query("SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()");assert.equal(empty.n,0);
    // Only synthetic prerequisite structure, no customer rows or application connection.
    const base=new Schema();for(const [table,clauses] of base.tables)await cx.query(`CREATE TABLE \`${table}\` (${clauses.join(",")}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${base.tableCollations.get(table)||"utf8mb4_bin"}`);
    let writes=0;
    const interrupted={async query(sql,args){if(/^(ALTER|CREATE)/.test(sql)){if(writes===12)throw new Error("controlled interruption");writes++;}return cx.query(sql,args);}};
    await assert.rejects(runner.migrate(interrupted,options),/controlled interruption/);assert.equal(writes,12);
    await cx.query("ALTER TABLE subledger_opening_items DROP COLUMN migration_batch_reference");
    let rejectedWrites=0;const observed={async query(sql,args){if(/^(ALTER|CREATE)/.test(sql))rejectedWrites++;return cx.query(sql,args);}};
    await assert.rejects(runner.migrate(observed,options),{code:"ANNUAL_MIGRATION_TRIGGER_PREREQUISITE_MISSING"});assert.equal(rejectedWrites,0);
    await cx.query("ALTER TABLE subledger_opening_items ADD migration_batch_reference VARCHAR(120) NULL");
    // Deliberate separate resumption within the authorized test, not an error retry.
    const resumed=await runner.migrate(cx,options);assert.ok(resumed.applied>0);
    const [ddl]=await cx.query("SHOW CREATE TABLE subledger_opening_items");assert.match(ddl[0]["Create Table"],/CHECK/i);
    assert.deepEqual(await runner.plan(cx),[]);assert.equal((await runner.migrate(cx,options)).applied,0);
    await cx.query("ALTER TABLE subledger_opening_items MODIFY migration_batch_reference VARCHAR(119) NULL");
    await assert.rejects(runner.migrate(observed,options),{code:"ANNUAL_MIGRATION_TRIGGER_PREREQUISITE_INCOMPATIBLE"});assert.equal(rejectedWrites,0);
  }finally{await cx.end();} // no automatic cleanup or repeat execution
});
