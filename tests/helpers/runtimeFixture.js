const fs = require("node:fs/promises");
const path = require("node:path");

const applyRuntimeFixture = async (harness) => {
  const schema = await fs.readFile(path.join(__dirname, "..", "fixtures", "runtime-schema.sql"), "utf8");
  await harness.apply(schema);
  harness.adminApply(`DELIMITER $$
    CREATE TRIGGER trg_fy_no_overlap_insert BEFORE INSERT ON financial_years FOR EACH ROW
    BEGIN
      IF EXISTS (SELECT 1 FROM financial_years fy WHERE fy.company_id=NEW.company_id AND NEW.start_date<=fy.end_date AND NEW.end_date>=fy.start_date) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Financial year dates overlap an existing financial year';
      END IF;
    END$$
    DELIMITER ;`);
  await harness.apply(`
    INSERT INTO companies VALUES (301,'Synthetic Primary'),(302,'Synthetic Secondary');
    INSERT INTO users VALUES (401,301,'Synthetic Owner');
    INSERT INTO user_company_memberships VALUES (401,301,1);
    INSERT INTO customers VALUES (501,301,'Synthetic Customer','9999999999',30,'Synthetic Shipping','Synthetic Billing');
    INSERT INTO vendors VALUES (601,301,'Synthetic Vendor','Active');
    INSERT INTO products VALUES (701,301,'Synthetic Product',100,150,80,18);
    INSERT INTO accounts(id,account_code,account_name,account_type,status,company_id) VALUES
      (801,'CASH-TEST','Synthetic Cash','ASSET',1,301),(802,'BANK-TEST','Synthetic Bank','ASSET',1,301);
    INSERT INTO invoice_settings VALUES (301,'SYN-',1);
    INSERT INTO financial_years(company_id,code,name,start_date,end_date,status,is_default) VALUES
      (301,'FY2024-25','FY 2024-25','2024-04-01','2025-03-31','OPEN',0),
      (301,'FY2026-27','FY 2026-27','2026-04-01','2027-03-31','OPEN',1),
      (302,'FY2026-27','FY 2026-27','2026-04-01','2027-03-31','OPEN',1);
  `);
};

module.exports = { applyRuntimeFixture };
