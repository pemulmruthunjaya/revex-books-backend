"use strict";
const runner=require("../../db/migrations/2026-10-04-annual-subledger-carry-forward");
class Schema {
  constructor(){
    this.tables=new Map();this.triggers=[];this.writes=[];this.failAfter=Infinity;
    this.databaseDefaults={charset:"utf8mb4",collation:"utf8mb4_0900_ai_ci"};
    this.tableCollations=new Map([["subledger_opening_items","utf8mb4_unicode_ci"]]);
    this.explicitInheritedCollation=false;
    for(const name of ["subledger_opening_items","financial_year_close_runs","invoices","bills","journal_entries","receipt_entries","vendor_payments","customers","vendors","users"]){
      const big=["subledger_opening_items","financial_year_close_runs","receipt_entries"].includes(name);
      this.tables.set(name,[`id ${big?"BIGINT UNSIGNED":"INT"} NOT NULL`,`company_id ${name==="receipt_entries"?"BIGINT UNSIGNED":"INT"} NOT NULL`,"financial_year_id BIGINT UNSIGNED NOT NULL","PRIMARY KEY(id)","UNIQUE KEY base_tenant(id,company_id)"]);
    }
    this.tables.get("subledger_opening_items").push("origin ENUM('ONBOARDING','HISTORICAL_MIGRATION') NOT NULL");
    this.tables.get("subledger_opening_items").push(
      "party_type ENUM('CUSTOMER','VENDOR') NOT NULL", "customer_id INT NULL", "vendor_id INT NULL",
      "entry_kind ENUM('ORIGINAL','REVERSAL') NOT NULL DEFAULT 'ORIGINAL'", "reversal_of_opening_item_id BIGINT UNSIGNED NULL",
      "reference VARCHAR(120) NOT NULL", "effective_date DATE NOT NULL", "due_date DATE NULL", "original_amount DECIMAL(15,2) NOT NULL",
      "direction ENUM('DEBIT','CREDIT') NOT NULL", "migration_batch_reference VARCHAR(120) NULL", "opening_journal_entry_id INT NULL",
      "source_identity VARCHAR(160) NOT NULL", "created_by INT NOT NULL"
    );
    this.tables.get("financial_year_close_runs").push("source_financial_year_id BIGINT UNSIGNED NOT NULL","destination_financial_year_id BIGINT UNSIGNED NOT NULL");
    this.tables.get("receipt_entries").push("journal_entry_id BIGINT UNSIGNED NULL");
  }
  async query(sql,args=[]){
    if(sql.includes("information_schema.SCHEMATA"))return [[this.databaseDefaults]];
    if(sql.includes("information_schema.TABLES"))return [[...this.tables.keys()].map(TABLE_NAME=>({TABLE_NAME,ENGINE:"InnoDB",TABLE_TYPE:"BASE TABLE"}))];
    if(sql.includes("information_schema.TRIGGERS"))return [this.triggers];
    if(sql.startsWith("SHOW CREATE TABLE")){
      const name=/`(\w+)`/.exec(sql)[1];
      const collation=this.tableCollations.get(name)||this.databaseDefaults.collation;
      const clauses=this.tables.get(name).map(c=> {
        if (/^CONSTRAINT \w+ CHECK/i.test(c)) return c.replace(/^(CONSTRAINT) (\w+)/i,"$1 `$2`").replace(/'(ANNUAL_CARRY_FORWARD|ORIGINAL|CUSTOMER|VENDOR|DEBIT|CREDIT)'/g,"_utf8mb4'$1'");
        if(this.explicitInheritedCollation && /^\w+\s+(?:ENUM|CHAR|VARCHAR)\(/i.test(c) && !/\b(?:COLLATE|CHARACTER SET)\b/i.test(c)) c=c.replace(/^(\w+\s+(?:ENUM|CHAR|VARCHAR)\([^)]*\))/i,`$1 COLLATE ${collation}`);
        return c.replace(/^(\w+) (?!(KEY|fk_|chk_))/i,(whole,word)=>["PRIMARY","UNIQUE","KEY","CONSTRAINT"].includes(word)?whole:`\`${word}\` `);
      });
      if(this.explicitInheritedCollation)for(const c of this.tables.get(name)){
        const fk=/^CONSTRAINT (\w+) FOREIGN KEY\s*\(([^)]+)\)/i.exec(c);
        if(fk)clauses.unshift(`KEY \`${fk[1]}\` (${fk[2].split(",").map(n=>`\`${n.trim()}\``).join(",")})`);
      }
      return [[{"Create Table":`CREATE TABLE \`${name}\` (\n  ${clauses.join(",\n  ")}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${collation}`}]];
    }
    if(this.writes.length===this.failAfter)throw new Error("synthetic DDL interruption");this.writes.push(sql);
    if(sql.startsWith("ALTER TABLE")){const [,name,op,clause]=/^ALTER TABLE (\w+) (ADD|MODIFY COLUMN) ([\s\S]*)$/.exec(sql);const list=this.tables.get(name);if(op==="MODIFY COLUMN")list.splice(list.findIndex(c=>c.startsWith("origin ")),1,clause);else list.push(clause);}
    else if(sql.startsWith("CREATE TABLE")){const name=/CREATE TABLE (\w+)/.exec(sql)[1];this.tables.set(name,runner.tableParts(sql));}
    else if(sql.startsWith("CREATE TRIGGER")){const [,TRIGGER_NAME,EVENT_MANIPULATION,EVENT_OBJECT_TABLE,ACTION_STATEMENT]=/^CREATE TRIGGER (\w+) BEFORE (\w+) ON (\w+) FOR EACH ROW\s*([\s\S]*)/.exec(sql);this.triggers.push({TRIGGER_NAME,EVENT_MANIPULATION,EVENT_OBJECT_TABLE,ACTION_TIMING:"BEFORE",ACTION_STATEMENT});}
    else throw new Error(`Unexpected DDL ${sql}`);
    return [{affectedRows:0}];
  }
}
module.exports={Schema};
