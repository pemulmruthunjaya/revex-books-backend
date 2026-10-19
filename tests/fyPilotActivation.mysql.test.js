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
    // Production-shaped, synthetic provisioning evidence; no external identities,
    // mailbox access or business transactions. Schema is operator-prepared.
    const [[fy]]=await a.query("SELECT id,code,DATE_FORMAT(start_date,'%Y-%m-%d') start_date,DATE_FORMAT(end_date,'%Y-%m-%d') end_date FROM financial_years WHERE company_id=9");
    await a.query("INSERT INTO plans(id,code,name,price,is_active,default_trial_days) VALUES(2,'PLAN_2','Pro',0,1,14)");
    await a.query("INSERT INTO business_profiles(id,company_id,name,email,created_at) VALUES(3,9,'RevEx FY Pilot','pilot.owner@revexbooks.com','2026-10-16 06:23:21')");
    await a.query("INSERT INTO company_subscriptions(id,company_id,plan_id,status,billing_cycle,trial_duration_days,trial_start_at,trial_end_at,current_period_start_at,current_period_end_at) VALUES(9,9,2,'trialing','none',14,'2026-10-16 06:23:21','2026-10-30 06:23:21','2026-10-16 06:23:21','2026-10-30 06:23:21')");
    await a.query("INSERT INTO subscription_periods(id,subscription_id,company_id,plan_id,period_type,billing_cycle,starts_at,ends_at,status) VALUES(11,9,9,2,'trial','none','2026-10-16 06:23:21','2026-10-30 06:23:21','active')");
    const audit=async(id,path,status,body,resource=null)=>a.query("INSERT INTO audit_logs(id,company_id,user_id,module_key,action,method,path,resource_id,status_code,details) VALUES(?,9,19,?,'create','POST',?,?,?,?)",[id,path==='/api/accounts'?'accounting':'system',path,resource,status,JSON.stringify({params:{},body})]);
    await audit(139,'/api/financial-years',201,{code:fy.code,start_date:fy.start_date,end_date:fy.end_date,status:'DRAFT'});
    await audit(140,`/api/financial-years/${fy.id}/transitions`,200,{target_status:'OPEN'},String(fy.id));
    await audit(141,`/api/financial-years/${fy.id}/default`,200,{},String(fy.id));
    const [masters]=await a.query("SELECT account_code,account_name,account_type,CAST(opening_balance AS CHAR) opening_balance FROM accounts WHERE company_id=9 ORDER BY account_code");
    for(let i=0;i<masters.length;i++)await audit(142+i,'/api/accounts',201,masters[i]);
    const baseline=async()=>Promise.all(["accounts","companies","users","financial_years","user_company_memberships","business_profiles","company_subscriptions","subscription_periods","audit_logs","plans"].map(async t=>(await a.query(`SELECT * FROM ${t} ORDER BY 1`))[0]));
    const before=await baseline();
    const rejectWithoutWrites=async(code)=>{
      const proto=require('mysql2').Connection.prototype,original=proto.query;let writes=0;
      proto.query=function(sql,args,done){if(this===a.connection&&/^(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i.test(sql))writes++;return original.call(this,sql,args,done);};
      try{await assert.rejects(runner.activate(a,options),{code});assert.equal(writes,0);}finally{proto.query=original;}
    };
    await a.query("UPDATE audit_logs SET path='/api/invoices' WHERE id=142");
    await rejectWithoutWrites('FY_PILOT_SETUP_EVIDENCE_MISMATCH');
    await a.query("UPDATE audit_logs SET path='/api/accounts' WHERE id=142");
    await a.query("UPDATE subscription_periods SET status='scheduled',updated_at=updated_at WHERE id=11");
    await rejectWithoutWrites('FY_PILOT_SETUP_EVIDENCE_MISMATCH');
    await a.query("UPDATE subscription_periods SET status='active',updated_at=? WHERE id=11",[before[7][0].updated_at]);
    await a.query("INSERT INTO business_profiles(id,company_id,name,email,created_at) SELECT 4,company_id,name,email,created_at FROM business_profiles WHERE id=3");
    await rejectWithoutWrites('FY_PILOT_SETUP_EVIDENCE_MISMATCH');
    await a.query("DELETE FROM business_profiles WHERE id=4");
    await a.query("INSERT INTO unknown_pilot_history(id,company_id) VALUES(1,9)");
    await rejectWithoutWrites('FY_PILOT_HISTORY_EXISTS');
    await a.query("DELETE FROM unknown_pilot_history WHERE id=1");
    await a.query("INSERT INTO expenses(id,company_id,title,amount,expense_date) VALUES(1,9,'Synthetic prohibited expense',1,'2026-10-17')");
    await rejectWithoutWrites('FY_PILOT_HISTORY_EXISTS');
    await a.query("DELETE FROM expenses WHERE id=1");
    assert.deepEqual(await baseline(),before);
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
