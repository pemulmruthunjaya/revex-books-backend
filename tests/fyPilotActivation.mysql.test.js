"use strict";
// AUTHORED ONLY: requires separately authorized disposable schema preparation.
// Never install schema or seed anything implicitly from the activation runner.
const test=require("node:test"),assert=require("node:assert/strict");
const runner=require("../scripts/activate-fy-pilot");
test("isolated Company 9 activation: persisted rollback, retries, contention and exact no-journal cutover",{skip:process.env.FY_PILOT_MYSQL_PROOF!=="DISPOSABLE_LOOPBACK_ONLY"},async()=>{
  const e=process.env;
  assert.equal(e.FY_PILOT_MYSQL_HOST,"127.0.0.1");assert.equal(e.FY_PILOT_MYSQL_PORT,"3407");
  assert.match(e.FY_PILOT_MYSQL_DATABASE||"",/^fy_pilot_proof_[a-f0-9]{32}$/);assert.match(e.FY_PILOT_MYSQL_USER||"",/^fy_pilot_test_[a-f0-9]{16}$/);assert.match(e.FY_PILOT_MYSQL_PASSWORD||"",/^[a-f0-9]{64}$/);
  const config={host:"127.0.0.1",port:3407,user:e.FY_PILOT_MYSQL_USER,password:e.FY_PILOT_MYSQL_PASSWORD,database:e.FY_PILOT_MYSQL_DATABASE,dateStrings:true,supportBigNumbers:true,bigNumberStrings:true,multipleStatements:false};
  const mysql=require("mysql2/promise"),a=await mysql.createConnection(config);let b;
  try {
    const [[id]]=await a.query("SELECT VERSION() version,@@port port,DATABASE() db,CURRENT_USER() user,@@hostname hostname");
    assert.equal(id.version,"9.7.2");assert.equal(Number(id.port),3306);assert.equal(id.db,config.database);assert.equal(id.user,`${config.user}@%`);
    const grants=(await a.query("SHOW GRANTS"))[0].map(row=>Object.values(row)[0]);
    assert.deepEqual(grants.sort(),[`GRANT USAGE ON *.* TO \`${config.user}\`@\`%\``,`GRANT SELECT, INSERT, UPDATE, DELETE, TRIGGER ON \`${config.database.replace(/_/g,"\\_")}\`.* TO \`${config.user}\`@\`%\``].sort());
    b=await mysql.createConnection(config);
    const options={confirmation:runner.CONFIRMATION,transactionOwnership:"EXCLUSIVE_IDLE_CONNECTION",idempotencyKey:"11111111-1111-4111-8111-111111111111",identity:{host:config.host,port:3407,database:config.database,hostname:id.hostname,version:"9.7.2",serverPort:3306}};
    // Operator seeds only synthetic Company 9, native owner 19 + membership,
    // exact OPEN/default FY and the eight approved zero accounts, all contracts
    // already installed. A real company/database is never an allowed target.
    for(const table of ["iv_operations","iv_records","system_account_role_assignments","journal_entries","journal_entry_details","opening_balance_events","products"]){const [[n]]=await a.query(`SELECT COUNT(*) n FROM ${table}`);assert.equal(Number(n.n),0);}
    const baseline=async()=>Promise.all(["accounts","companies","users","financial_years","user_company_memberships"].map(async t=>(await a.query(`SELECT * FROM ${t} ORDER BY 1`))[0]));
    const before=await baseline();
    const originalAP=before[0].filter(row=>String(row.company_id)==="9"&&row.account_code==="2000");
    assert.equal(originalAP.length,1);
    // A real incompatible prerequisite rejects without provisioning any row.
    await a.query("UPDATE accounts SET status=0 WHERE company_id=9 AND account_code='2000'");
    await assert.rejects(runner.activate(a,options),{code:"FY_PILOT_ACCOUNTS_MISMATCH"});
    for(const table of ["iv_operations","system_account_role_assignments"]){const [[n]]=await a.query(`SELECT COUNT(*) n FROM ${table}`);assert.equal(Number(n.n),0);}
    // Same owned physical connection; explicitly assigning updated_at suppresses
    // its automatic ON UPDATE timestamp, including when the original is NULL.
    const [restored]=await a.query("UPDATE accounts SET status=?,updated_at=? WHERE id=? AND company_id=9 AND account_code='2000'",[originalAP[0].status,originalAP[0].updated_at,originalAP[0].id]);
    assert.equal(restored.affectedRows,1);
    const [restoredAP]=await a.query("SELECT * FROM accounts WHERE id=? AND company_id=9 AND account_code='2000'",[originalAP[0].id]);
    assert.deepEqual(restoredAP,originalAP);
    // Fail after real SQL writes, on the existing pinned physical connection.
    const proto=require("mysql2").Connection.prototype,original=proto.query;
    let inserts=0;
    proto.query=function(sql,args,done){if(this===a.connection&&sql.startsWith("INSERT INTO system_account_role_assignments")&&++inserts===3){return queueMicrotask(()=>done(Object.assign(Error("synthetic failure"),{code:"SYNTHETIC_FAILURE"})));}return original.call(this,sql,args,done);};
    try{await assert.rejects(runner.activate(a,options),{code:"FY_PILOT_ACTIVATION_REJECTED"});}finally{proto.query=original;}
    for(const table of ["iv_operations","system_account_role_assignments","journal_entries","journal_entry_details","iv_records"]){const [[n]]=await a.query(`SELECT COUNT(*) n FROM ${table}`);assert.equal(Number(n.n),0);}
    assert.deepEqual(await baseline(),before);
    // Two real connections contend on the same company lock. Exactly one wins
    // provisioning; the second returns the persisted receipt, without retry.
    const results=await Promise.all([runner.activate(a,options),runner.activate(b,options)]);
    assert.equal(results.filter(r=>r.replay).length,1);assert.equal(results.filter(r=>!r.replay).length,1);
    const [[ops]]=await a.query("SELECT COUNT(*) n FROM iv_operations WHERE company_id=9");assert.equal(Number(ops.n),7);
    const [[roles]]=await a.query("SELECT COUNT(*) n FROM system_account_role_assignments WHERE company_id=9");assert.equal(Number(roles.n),4);
    assert.equal((await runner.activate(a,options)).replay,true);
    await assert.rejects(runner.activate(a,{...options,idempotencyKey:"22222222-2222-4222-8222-222222222222"}),{code:"FY_PILOT_EXISTING_OR_PARTIAL_STATE"});
    for(const r of results){assert.deepEqual(r.cutover.openings,[]);assert.deepEqual(r.cutover.journals,[]);assert.equal(new Set(Object.values(r.mapping)).size,8);}
    for(const table of ["journal_entries","journal_entry_details","opening_balance_events","iv_records"]){const [[n]]=await a.query(`SELECT COUNT(*) n FROM ${table}`);assert.equal(Number(n.n),0);}
    assert.deepEqual(await baseline(),before);
  } finally {config.password=null;await b?.end();await a.end();}
});
