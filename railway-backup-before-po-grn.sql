-- MySQL dump 10.13  Distrib 8.0.44, for Win64 (x86_64)
--
-- Host: shinkansen.proxy.rlwy.net    Database: railway
-- ------------------------------------------------------
-- Server version	9.4.0

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `accounts`
--

DROP TABLE IF EXISTS `accounts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `accounts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `account_code` varchar(50) DEFAULT NULL,
  `account_name` varchar(255) NOT NULL,
  `account_type` enum('ASSET','LIABILITY','INCOME','EXPENSE','EQUITY') NOT NULL,
  `parent_account_id` int DEFAULT NULL,
  `opening_balance` decimal(15,2) DEFAULT '0.00',
  `balance_type` enum('DEBIT','CREDIT') DEFAULT 'DEBIT',
  `description` text,
  `status` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `company_id` int NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `account_code` (`account_code`),
  KEY `parent_account_id` (`parent_account_id`),
  KEY `idx_accounts_company_id` (`company_id`),
  CONSTRAINT `accounts_ibfk_1` FOREIGN KEY (`parent_account_id`) REFERENCES `accounts` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=25 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `accounts`
--

LOCK TABLES `accounts` WRITE;
/*!40000 ALTER TABLE `accounts` DISABLE KEYS */;
INSERT INTO `accounts` VALUES (1,'1000','Cash','ASSET',NULL,0.00,'DEBIT',NULL,1,'2026-05-12 11:01:47','2026-07-13 11:05:54',1),(2,'1001','Bank','ASSET',NULL,100.00,'DEBIT',NULL,1,'2026-05-12 11:01:47','2026-07-13 11:05:54',1),(3,'1002','Inventory','ASSET',NULL,0.00,'DEBIT',NULL,1,'2026-05-12 11:01:47','2026-07-13 11:05:54',1),(4,'2000','Accounts Payable','LIABILITY',NULL,0.00,'CREDIT',NULL,1,'2026-05-12 11:01:47','2026-07-13 11:05:54',1),(5,'2001','GST Payable','LIABILITY',NULL,0.00,'CREDIT',NULL,1,'2026-05-12 11:01:47','2026-07-13 11:05:54',1),(6,'3000','Capital','EQUITY',NULL,0.00,'CREDIT',NULL,1,'2026-05-12 11:01:47','2026-07-13 11:05:54',1),(7,'4000','Sales','INCOME',NULL,0.00,'CREDIT',NULL,1,'2026-05-12 11:01:47','2026-07-13 11:05:54',1),(8,'5000','Purchase','EXPENSE',NULL,0.00,'DEBIT',NULL,1,'2026-05-12 11:01:47','2026-07-13 11:05:54',1),(9,'5001','Salary Expense','EXPENSE',NULL,0.00,'DEBIT',NULL,1,'2026-05-12 11:01:47','2026-07-13 11:05:54',1),(10,'5002','Rent Expense','EXPENSE',NULL,0.00,'DEBIT',NULL,1,'2026-05-12 11:01:47','2026-07-13 11:05:54',1),(11,'5005','Internet Expense','EXPENSE',NULL,0.00,'DEBIT',NULL,1,'2026-05-16 22:37:53','2026-07-13 11:05:54',1),(13,'5006','Telephone Expense','EXPENSE',NULL,0.00,'DEBIT',NULL,1,'2026-05-16 22:44:11','2026-07-13 11:05:54',1),(16,'5007','Telephone Expense','EXPENSE',NULL,0.00,'DEBIT',NULL,1,'2026-05-17 15:26:55','2026-07-13 11:05:54',1),(18,'5008','Telephone Expense','EXPENSE',NULL,0.00,'DEBIT',NULL,1,'2026-05-17 15:29:05','2026-07-13 11:05:54',1),(19,'5010','Telephone Expense','EXPENSE',NULL,0.00,'DEBIT',NULL,1,'2026-05-17 15:46:54','2026-07-13 11:05:54',1),(20,'0001','Cash','ASSET',NULL,100.00,'DEBIT',NULL,1,'2026-07-18 01:02:52','2026-07-18 01:02:52',4),(21,'0002','Bank','ASSET',NULL,20000.00,'DEBIT',NULL,1,'2026-07-18 01:03:14','2026-07-18 01:03:14',4),(22,'0003','Creditors','LIABILITY',NULL,10000.00,'CREDIT',NULL,1,'2026-07-18 01:03:46','2026-07-18 01:04:01',4),(23,'0004','Salary','EXPENSE',NULL,41000.00,'DEBIT',NULL,1,'2026-07-18 01:04:54','2026-07-18 01:04:54',4),(24,'SYS-AR-4','Accounts Receivable','ASSET',NULL,0.00,'DEBIT','System ledger used by Receipt Entry',1,'2026-07-29 14:20:35','2026-07-29 14:20:35',4);
/*!40000 ALTER TABLE `accounts` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `audit_logs`
--

DROP TABLE IF EXISTS `audit_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `company_id` int NOT NULL,
  `user_id` int DEFAULT NULL,
  `user_name` varchar(255) DEFAULT NULL,
  `user_role` varchar(50) DEFAULT NULL,
  `access_role` varchar(50) DEFAULT NULL,
  `module_key` varchar(80) NOT NULL,
  `action` varchar(30) NOT NULL,
  `method` varchar(10) NOT NULL,
  `path` varchar(500) NOT NULL,
  `resource_id` varchar(80) DEFAULT NULL,
  `status_code` int DEFAULT NULL,
  `ip_address` varchar(80) DEFAULT NULL,
  `user_agent` varchar(500) DEFAULT NULL,
  `details` longtext,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_audit_company_created` (`company_id`,`created_at`),
  KEY `idx_audit_user` (`user_id`),
  KEY `idx_audit_module` (`module_key`)
) ENGINE=InnoDB AUTO_INCREMENT=102 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `audit_logs`
--

LOCK TABLES `audit_logs` WRITE;
/*!40000 ALTER TABLE `audit_logs` DISABLE KEYS */;
INSERT INTO `audit_logs` VALUES (1,4,13,'Admin','owner','owner','purchase_orders','create','POST','/api/purchase-orders',NULL,201,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"vendor_id\":\"10\",\"po_date\":\"2026-07-17\",\"expected_date\":\"\",\"notes\":\"\",\"items\":[{\"product_id\":\"8\",\"mrp\":120,\"quantity\":10,\"price\":120,\"gst\":18}],\"po_number\":\"PO-0001\"}}','2026-07-17 10:57:21'),(2,4,13,'Admin','owner','owner','payroll','create','POST','/api/payroll/employees',NULL,201,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"name\":\"jay\",\"phone\":\"9898989898\",\"email\":\"abs@gmail.com\",\"designation\":\"Manager\",\"joining_date\":\"2026-01-15\",\"monthly_salary\":\"35000\",\"notes\":\"\"}}','2026-07-17 11:18:58'),(3,4,13,'Admin','owner','owner','customers','create','POST','/api/customers',NULL,201,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"name\":\"Bala Vamsi\",\"email\":null,\"phone\":null,\"address\":null}}','2026-07-18 00:48:21'),(4,4,13,'Admin','owner','owner','invoices','create','POST','/api/invoices',NULL,201,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"invoice_date\":\"2026-07-18\",\"customer_id\":11,\"customer_name\":\"Bala Vamsi\",\"items\":[{\"product_id\":17,\"name\":\"Induction Stove\",\"quantity\":1,\"unit_price\":3000,\"mrp\":3000,\"gst_rate\":\"18.00\"}]}}','2026-07-18 00:48:31'),(5,4,13,'Admin','owner','owner','invoices','create','POST','/api/invoices/47/payments','47',201,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36','{\"params\":{\"invoiceId\":\"47\"},\"body\":{\"amount\":3540,\"payment_date\":\"2026-07-18\",\"payment_method\":\"Cash\",\"reference_number\":\"INV-0011-paid\"}}','2026-07-18 00:48:59'),(6,4,13,'Admin','owner','owner','invoices','edit','PUT','/api/invoices/47/status','47',200,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36','{\"params\":{\"id\":\"47\"},\"body\":{\"status\":\"paid\"}}','2026-07-18 00:49:23'),(7,4,13,'Admin','owner','owner','invoices','edit','PUT','/api/invoices/47/status','47',200,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36','{\"params\":{\"id\":\"47\"},\"body\":{\"status\":\"paid\"}}','2026-07-18 00:49:28'),(8,4,13,'Admin','owner','owner','invoices','edit','PUT','/api/invoices/47/status','47',200,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36','{\"params\":{\"id\":\"47\"},\"body\":{\"status\":\"pending\"}}','2026-07-18 00:49:33'),(9,4,13,'Admin','owner','owner','invoices','edit','PUT','/api/invoices/47/status','47',200,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36','{\"params\":{\"id\":\"47\"},\"body\":{\"status\":\"paid\"}}','2026-07-18 00:49:40'),(10,4,13,'Admin','owner','owner','invoices','edit','PUT','/api/invoices/47/status','47',200,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36','{\"params\":{\"id\":\"47\"},\"body\":{\"status\":\"pending\"}}','2026-07-18 00:49:47'),(11,4,13,'Admin','owner','owner','invoices','edit','PUT','/api/invoices/40/status','40',200,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36','{\"params\":{\"id\":\"40\"},\"body\":{\"status\":\"pending\"}}','2026-07-18 00:49:53'),(12,4,13,'Admin','owner','owner','accounting','create','POST','/api/accounts',NULL,201,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"account_code\":\"0001\",\"account_name\":\"Cash\",\"account_type\":\"ASSET\",\"parent_account_id\":\"\",\"opening_balance\":\"100\",\"balance_type\":\"DEBIT\",\"description\":\"\"}}','2026-07-18 01:02:53'),(13,4,13,'Admin','owner','owner','accounting','create','POST','/api/accounts',NULL,201,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"account_code\":\"0002\",\"account_name\":\"Bank\",\"account_type\":\"ASSET\",\"parent_account_id\":\"\",\"opening_balance\":\"20000\",\"balance_type\":\"DEBIT\",\"description\":\"\"}}','2026-07-18 01:03:14'),(14,4,13,'Admin','owner','owner','accounting','create','POST','/api/accounts',NULL,201,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"account_code\":\"0003\",\"account_name\":\"Creditors\",\"account_type\":\"ASSET\",\"parent_account_id\":\"\",\"opening_balance\":\"10000\",\"balance_type\":\"CREDIT\",\"description\":\"\"}}','2026-07-18 01:03:47'),(15,4,13,'Admin','owner','owner','accounting','edit','PUT','/api/accounts/22','22',200,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36','{\"params\":{\"id\":\"22\"},\"body\":{\"account_code\":\"0003\",\"account_name\":\"Creditors\",\"account_type\":\"LIABILITY\",\"parent_account_id\":\"\",\"opening_balance\":\"10000.00\",\"balance_type\":\"CREDIT\",\"description\":\"\"}}','2026-07-18 01:04:01'),(16,4,13,'Admin','owner','owner','accounting','create','POST','/api/accounts',NULL,201,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"account_code\":\"0004\",\"account_name\":\"Salary\",\"account_type\":\"EXPENSE\",\"parent_account_id\":\"\",\"opening_balance\":\"41000\",\"balance_type\":\"DEBIT\",\"description\":\"\"}}','2026-07-18 01:04:54'),(17,4,13,'Admin','owner','owner','purchase_orders','create','POST','/api/purchase-orders',NULL,201,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"vendor_id\":\"9\",\"po_date\":\"2026-07-18\",\"expected_date\":\"\",\"notes\":\"\",\"items\":[{\"product_id\":\"16\",\"mrp\":1500,\"quantity\":5,\"price\":1300,\"gst\":18},{\"product_id\":\"15\",\"mrp\":50,\"quantity\":10,\"price\":30,\"gst\":5}],\"po_number\":\"PO-0002\"}}','2026-07-18 10:28:33'),(18,4,13,'Admin','owner','owner','purchase_orders','create','POST','/api/purchase-orders/2/convert-to-bill','2',201,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"2\"},\"body\":{\"bill_date\":\"2026-07-18\"}}','2026-07-18 11:20:15'),(19,4,13,'Admin','owner','owner','invoices','create','POST','/api/quotations',NULL,201,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"customer_id\":\"6\",\"customer_name\":\"c1\",\"quotation_date\":\"2026-07-18\",\"valid_until\":\"\",\"notes\":\"\",\"items\":[{\"product_id\":\"16\",\"hsn\":\"552567\",\"mrp\":1500,\"quantity\":1,\"price\":1500,\"discount\":0,\"gst\":18}],\"quotation_number\":\"QT-0001\"}}','2026-07-18 11:55:31'),(20,4,13,'Admin','owner','owner','accounting','create','POST','/api/receipt-entries',NULL,201,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"receipt_date\":\"2026-07-18\",\"received_in_account_id\":\"20\",\"received_from_account_id\":\"23\",\"amount\":500,\"narration\":\"\"}}','2026-07-18 13:02:08'),(21,4,13,'Admin','owner','owner','accounting','create','POST','/api/payment-entries',NULL,201,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"payment_date\":\"2026-07-18\",\"paid_from_account_id\":\"20\",\"paid_to_account_id\":\"23\",\"amount\":500,\"narration\":\"\"}}','2026-07-18 13:02:50'),(22,4,13,'Admin','owner','owner','invoices','create','POST','/api/invoices/44/payments','44',201,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"invoiceId\":\"44\"},\"body\":{\"amount\":2500,\"payment_date\":\"2026-07-19\",\"payment_method\":\"Cash\",\"reference_number\":\"INV-0008-partial\"}}','2026-07-19 08:02:30'),(23,4,13,'Admin','owner','owner','payroll','create','POST','/api/payroll/attendance/import',NULL,200,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"rows\":[{\"Employee Code\":\"EMP001\",\"Employee Name\":\"jay\",\"Payroll Month\":\"2026-07\",\"Working Days\":\"26\",\"Present Days\":\"24\",\"Absent Days\":\"2\",\"Working Hours\":\"192\",\"Overtime Hours\":\"4\",\"Allowances\":\"0\",\"Deductions\":\"0\",\"Salary Status\":\"Unpaid\",\"Payment Date\":\"\",\"Notes\":\"Imported from attendance machine\"},{\"Employee Code\":\"EMP002\",\"Employee Name\":\"Bobby\",\"Payroll Month\":\"2026-07\",\"Working Days\":\"26\",\"Present Days\":\"25\",\"Absent Days\":\"1\",\"Working Hours\":\"162\",\"Overtime Hours\":\"0\",\"Allowances\":\"0\",\"Deductions\":\"0\",\"Salary Status\":\"Paid\",\"Payment Date\":\"\",\"Notes\":\"\"},{\"Employee Code\":\"EMP003\",\"Employee Name\":\"Kumar\",\"Payroll Month\":\"2026-07\",\"Working Days\":\"28\",\"Present Days\":\"28\",\"Absent Days\":\"0\",\"Working Hours\":\"224\",\"Overtime Hours\":\"0\",\"Allowances\":\"0\",\"Deductions\":\"0\",\"Salary Status\":\"Paid\",\"Payment Date\":\"\",\"Notes\":\"\"}],\"fileName\":\"attendance-payroll-template-2026-07.xlsx\",\"payroll_month\":\"2026-07\",\"standard_hours_per_day\":8}}','2026-07-19 13:30:59'),(24,4,13,'Admin','owner','owner','payroll','create','POST','/api/payroll/attendance/import',NULL,200,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"rows\":[{\"Employee Code\":\"EMP001\",\"Employee Name\":\"jay\",\"Payroll Month\":\"2026-07\",\"Working Days\":\"26\",\"Present Days\":\"24\",\"Absent Days\":\"2\",\"Working Hours\":\"192\",\"Overtime Hours\":\"4\",\"Allowances\":\"0\",\"Deductions\":\"0\",\"Salary Status\":\"Unpaid\",\"Payment Date\":\"\",\"Notes\":\"Imported from attendance machine\"},{\"Employee Code\":\"EMP002\",\"Employee Name\":\"Bobby\",\"Payroll Month\":\"2026-07\",\"Working Days\":\"26\",\"Present Days\":\"25\",\"Absent Days\":\"1\",\"Working Hours\":\"162\",\"Overtime Hours\":\"0\",\"Allowances\":\"0\",\"Deductions\":\"0\",\"Salary Status\":\"Paid\",\"Payment Date\":\"\",\"Notes\":\"\"},{\"Employee Code\":\"EMP003\",\"Employee Name\":\"Kumar\",\"Payroll Month\":\"2026-07\",\"Working Days\":\"28\",\"Present Days\":\"28\",\"Absent Days\":\"0\",\"Working Hours\":\"224\",\"Overtime Hours\":\"0\",\"Allowances\":\"0\",\"Deductions\":\"0\",\"Salary Status\":\"Paid\",\"Payment Date\":\"\",\"Notes\":\"\"}],\"fileName\":\"attendance-payroll-template-2026-07.xlsx\",\"payroll_month\":\"2026-07\",\"standard_hours_per_day\":8}}','2026-07-19 13:32:24'),(25,4,13,'Admin','owner','owner','payroll','create','POST','/api/payroll/attendance/import',NULL,200,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"rows\":[{\"Employee Code\":\"EMP001\",\"Employee Name\":\"jay\",\"Payroll Month\":\"2026-07\",\"Working Days\":\"26\",\"Present Days\":\"24\",\"Absent Days\":\"2\",\"Working Hours\":\"192\",\"Overtime Hours\":\"4\",\"Allowances\":\"0\",\"Deductions\":\"0\",\"Salary Status\":\"Unpaid\",\"Payment Date\":\"\",\"Notes\":\"Imported from attendance machine\"},{\"Employee Code\":\"EMP002\",\"Employee Name\":\"Bobby\",\"Payroll Month\":\"2026-07\",\"Working Days\":\"26\",\"Present Days\":\"25\",\"Absent Days\":\"1\",\"Working Hours\":\"162\",\"Overtime Hours\":\"0\",\"Allowances\":\"0\",\"Deductions\":\"0\",\"Salary Status\":\"Paid\",\"Payment Date\":\"\",\"Notes\":\"\"},{\"Employee Code\":\"EMP003\",\"Employee Name\":\"Kumar\",\"Payroll Month\":\"2026-07\",\"Working Days\":\"28\",\"Present Days\":\"28\",\"Absent Days\":\"0\",\"Working Hours\":\"224\",\"Overtime Hours\":\"0\",\"Allowances\":\"0\",\"Deductions\":\"0\",\"Salary Status\":\"Paid\",\"Payment Date\":\"\",\"Notes\":\"\"}],\"fileName\":\"attendance-payroll-template-2026-07.xlsx\",\"payroll_month\":\"2026-07\",\"standard_hours_per_day\":8}}','2026-07-19 13:34:41'),(26,4,13,'Admin','owner','owner','payroll','edit','PUT','/api/payroll/employees/1','1',200,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"1\"},\"body\":{\"name\":\"jay\",\"employee_code\":\"EMP001\",\"phone\":\"9898989898\",\"email\":\"abs@gmail.com\",\"designation\":\"Manager\",\"joining_date\":\"2026-01-14\",\"monthly_salary\":\"35000.00\",\"status\":\"Active\",\"notes\":\"\"}}','2026-07-19 13:34:52'),(27,4,13,'Admin','owner','owner','payroll','create','POST','/api/payroll/employees',NULL,201,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"name\":\"Bobby\",\"employee_code\":\"EMP002\",\"phone\":\"0202020202\",\"email\":\"\",\"designation\":\"Exe\",\"joining_date\":\"2026-01-02\",\"monthly_salary\":\"15000\",\"notes\":\"\"}}','2026-07-19 13:35:53'),(28,4,13,'Admin','owner','owner','payroll','create','POST','/api/payroll/employees',NULL,201,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"name\":\"Kumar\",\"employee_code\":\"EMP003\",\"phone\":\"65656565656\",\"email\":\"\",\"designation\":\"Sr Exe\",\"joining_date\":\"2026-01-02\",\"monthly_salary\":\"25000\",\"notes\":\"\"}}','2026-07-19 13:36:47'),(29,4,13,'Admin','owner','owner','payroll','create','POST','/api/payroll/attendance/import',NULL,200,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"rows\":[{\"Employee Code\":\"EMP001\",\"Employee Name\":\"jay\",\"Payroll Month\":\"2026-07\",\"Working Days\":\"26\",\"Present Days\":\"24\",\"Absent Days\":\"2\",\"Working Hours\":\"192\",\"Overtime Hours\":\"4\",\"Allowances\":\"0\",\"Deductions\":\"0\",\"Salary Status\":\"Unpaid\",\"Payment Date\":\"\",\"Notes\":\"Imported from attendance machine\"},{\"Employee Code\":\"EMP002\",\"Employee Name\":\"Bobby\",\"Payroll Month\":\"2026-07\",\"Working Days\":\"26\",\"Present Days\":\"25\",\"Absent Days\":\"1\",\"Working Hours\":\"162\",\"Overtime Hours\":\"0\",\"Allowances\":\"0\",\"Deductions\":\"0\",\"Salary Status\":\"Paid\",\"Payment Date\":\"\",\"Notes\":\"\"},{\"Employee Code\":\"EMP003\",\"Employee Name\":\"Kumar\",\"Payroll Month\":\"2026-07\",\"Working Days\":\"28\",\"Present Days\":\"28\",\"Absent Days\":\"0\",\"Working Hours\":\"224\",\"Overtime Hours\":\"0\",\"Allowances\":\"0\",\"Deductions\":\"0\",\"Salary Status\":\"Paid\",\"Payment Date\":\"\",\"Notes\":\"\"}],\"fileName\":\"attendance-payroll-template-2026-07.xlsx\",\"payroll_month\":\"2026-07\",\"standard_hours_per_day\":8}}','2026-07-19 13:37:13'),(30,4,13,'Admin','owner','owner','payroll','create','POST','/api/payroll/attendance/import',NULL,200,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"rows\":[{\"Employee Code\":\"EMP001\",\"Employee Name\":\"jay\",\"Payroll Month\":\"2026-07\",\"Working Days\":\"26\",\"Present Days\":\"24\",\"Absent Days\":\"2\",\"Working Hours\":\"192\",\"Overtime Hours\":\"4\",\"Allowances\":\"0\",\"Deductions\":\"0\",\"Salary Status\":\"Unpaid\",\"Payment Date\":\"\",\"Notes\":\"Imported from attendance machine\"},{\"Employee Code\":\"EMP002\",\"Employee Name\":\"Bobby\",\"Payroll Month\":\"2026-07\",\"Working Days\":\"26\",\"Present Days\":\"25\",\"Absent Days\":\"1\",\"Working Hours\":\"162\",\"Overtime Hours\":\"0\",\"Allowances\":\"0\",\"Deductions\":\"0\",\"Salary Status\":\"Paid\",\"Payment Date\":\"\",\"Notes\":\"\"},{\"Employee Code\":\"EMP003\",\"Employee Name\":\"Kumar\",\"Payroll Month\":\"2026-07\",\"Working Days\":\"28\",\"Present Days\":\"28\",\"Absent Days\":\"0\",\"Working Hours\":\"224\",\"Overtime Hours\":\"0\",\"Allowances\":\"0\",\"Deductions\":\"0\",\"Salary Status\":\"Paid\",\"Payment Date\":\"\",\"Notes\":\"\"}],\"fileName\":\"attendance-payroll-template-2026-07.xlsx\",\"payroll_month\":\"2026-07\",\"standard_hours_per_day\":8}}','2026-07-19 13:38:26'),(31,4,13,'Admin','owner','owner','products','edit','PUT','/api/products/13','13',200,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"13\"},\"body\":{\"name\":\"Maggi Noodles\",\"sku\":\"\",\"barcode\":\"\",\"hsn\":\"190230\",\"category\":\"Cooking Food\",\"batch_no\":\"\",\"manufactured_date\":\"\",\"expiry_date\":\"\",\"unit\":\"PCS\",\"gst\":\"5\",\"purchase_price\":\"0.00\",\"sellingPrice\":\"50.00\",\"mrp\":\"60.00\",\"opening_stock\":\"0.00\",\"stock\":5,\"reorder_level\":\"0.00\",\"status\":\"Active\"}}','2026-07-19 14:54:08'),(32,4,13,'Admin','owner','owner','products','edit','PUT','/api/products/12','12',200,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"12\"},\"body\":{\"name\":\"Priya Mango pickle\",\"sku\":\"PICKLE002\",\"barcode\":\"\",\"hsn\":\"20019000\",\"category\":\"PICKLES\",\"batch_no\":\"\",\"manufactured_date\":\"\",\"expiry_date\":\"\",\"unit\":\"PCS\",\"gst\":\"12\",\"purchase_price\":\"0.00\",\"sellingPrice\":\"75.00\",\"mrp\":\"80.00\",\"opening_stock\":\"0.00\",\"stock\":6,\"reorder_level\":\"0.00\",\"status\":\"Active\"}}','2026-07-19 14:56:06'),(33,4,13,'Admin','owner','owner','products','edit','PUT','/api/products/11','11',200,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"11\"},\"body\":{\"name\":\"MTR Sambar powder\",\"sku\":\"MASALA003\",\"barcode\":\"\",\"hsn\":\"210610\",\"category\":\"Masala Pwder\",\"batch_no\":\"\",\"manufactured_date\":\"\",\"expiry_date\":\"\",\"unit\":\"PCS\",\"gst\":\"5\",\"purchase_price\":\"0.00\",\"sellingPrice\":\"10.00\",\"mrp\":\"15.00\",\"opening_stock\":\"0.00\",\"stock\":12,\"reorder_level\":\"0.00\",\"status\":\"Active\"}}','2026-07-19 14:58:44'),(34,4,13,'Admin','owner','owner','products','edit','PUT','/api/products/11','11',200,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"11\"},\"body\":{\"name\":\"MTR Sambar powder\",\"sku\":\"MASALA003\",\"barcode\":\"\",\"hsn\":\"210610\",\"category\":\"Masala Pwder\",\"batch_no\":\"\",\"manufactured_date\":\"\",\"expiry_date\":\"\",\"unit\":\"PCS\",\"gst\":\"5\",\"purchase_price\":\"0.00\",\"sellingPrice\":\"10.00\",\"mrp\":\"15.00\",\"opening_stock\":\"0.00\",\"stock\":12,\"reorder_level\":\"0.00\",\"status\":\"Active\"}}','2026-07-19 14:59:00'),(35,4,13,'Admin','owner','owner','products','edit','PUT','/api/products/10','10',200,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"10\"},\"body\":{\"name\":\"Sugar\",\"sku\":\"Kit0085\",\"barcode\":\"\",\"hsn\":\"170410\",\"category\":\"Grocery\",\"batch_no\":\"\",\"manufactured_date\":\"\",\"expiry_date\":\"\",\"unit\":\"PCS\",\"gst\":\"5\",\"purchase_price\":\"0.00\",\"sellingPrice\":\"78.00\",\"mrp\":\"80.00\",\"opening_stock\":\"0.00\",\"stock\":5,\"reorder_level\":\"0.00\",\"status\":\"Active\"}}','2026-07-19 15:00:34'),(36,4,13,'Admin','owner','owner','products','edit','PUT','/api/products/9','9',200,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"9\"},\"body\":{\"name\":\"Tea Powder\",\"sku\":\"TEA56\",\"barcode\":\"\",\"hsn\":\"210111\",\"category\":\"Kitchan \",\"batch_no\":\"\",\"manufactured_date\":\"\",\"expiry_date\":\"\",\"unit\":\"PCS\",\"gst\":\"18.00\",\"purchase_price\":\"0.00\",\"sellingPrice\":\"50.00\",\"mrp\":\"60.00\",\"opening_stock\":\"0.00\",\"stock\":18,\"reorder_level\":\"0.00\",\"status\":\"Active\"}}','2026-07-19 15:01:39'),(37,4,13,'Admin','owner','owner','products','edit','PUT','/api/products/8','8',200,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"8\"},\"body\":{\"name\":\"Oil\",\"sku\":\"OIL25\",\"barcode\":\"\",\"hsn\":\"15121110\",\"category\":\"Kitchan\",\"batch_no\":\"\",\"manufactured_date\":\"\",\"expiry_date\":\"\",\"unit\":\"PCS\",\"gst\":\"12\",\"purchase_price\":\"0.00\",\"sellingPrice\":\"110.00\",\"mrp\":\"120.00\",\"opening_stock\":\"15.00\",\"stock\":31,\"reorder_level\":\"0.00\",\"status\":\"Active\"}}','2026-07-19 15:04:00'),(38,4,13,'Admin','owner','owner','products','edit','PUT','/api/products/7','7',200,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"7\"},\"body\":{\"name\":\"shampoo\",\"sku\":\"Shampoo22\",\"barcode\":\"\",\"hsn\":\"190230\",\"category\":\"Shampoo\",\"batch_no\":\"\",\"manufactured_date\":\"\",\"expiry_date\":\"\",\"unit\":\"PCS\",\"gst\":\"12\",\"purchase_price\":\"0.00\",\"sellingPrice\":\"230.00\",\"mrp\":\"250.00\",\"opening_stock\":\"5.00\",\"stock\":2,\"reorder_level\":\"0.00\",\"status\":\"Active\"}}','2026-07-19 15:04:27'),(39,4,13,'Admin','owner','owner','system','create','POST','/api/backup/restore/preview',NULL,200,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"backup\":{\"metadata\":{\"app\":\"Billing SaaS\",\"backup_type\":\"company_full_backup\",\"company_id\":4,\"exported_at\":\"2026-07-19T17:23:43.980Z\",\"format_version\":1},\"data\":{\"company\":[{\"id\":4,\"name\":\"Test Company\",\"email\":\"auth@test.com\",\"phone\":null,\"address\":null,\"gst_number\":null,\"status\":\"active\",\"created_at\":\"2026-02-23T02:17:54.000Z\",\"updated_at\":\"2026-02-23T02:17:54.000Z\",\"logo_url\":null,\"plan_id\":null}],\"users\":[{\"id\":13,\"name\":\"Admin\",\"email\":\"auth@test.com\",\"created_at\":\"2026-02-23T02:17:54.000Z\",\"company_id\":4,\"role\":\"owner\",\"organization_id\":1,\"access_role\":\"sales\",\"permissions\":null,\"is_active\":1,\"last_login_at\":\"2026-07-19T11:24:59.000Z\"},{\"id\":17,\"name\":\"Dilip\",\"email\":\"dilip@test.com\",\"created_at\":\"2026-07-17T02:07:56.000Z\",\"company_id\":4,\"role\":\"staff\",\"organization_id\":null,\"access_role\":\"sales\",\"permissions\":null,\"is_active\":1,\"last_login_at\":null}],\"business_profiles\":[{\"id\":1,\"company_id\":4,\"name\":\"MJSS LLC\",\"gstin\":\"36A5622325V68\",\"address\":\"Hyderabad\",\"phone\":\"9988998899\",\"email\":\"\",\"logo\":null,\"created_at\":\"2026-07-13T08:13:31.000Z\"}],\"invoice_settings\":[{\"id\":2,\"company_id\":4,\"prefix\":\"INV\",\"current_number\":12,\"updated_at\":\"2026-07-17T19:18:29.000Z\"}],\"customers\":[{\"id\":2,\"name\":\"Sam\",\"email\":null,\"phone\":\"99999999999\",\"address\":\"Malakpet\",\"company_id\":4,\"created_at\":\"2026-07-13T06:43:31.000Z\"},{\"id\":3,\"name\":\"Sam\",\"email\":null,\"phone\":\"9999999999\",\"address\":\"Malakper\",\"company_id\":4,\"created_at\":\"2026-07-13T06:50:10.000Z\"},{\"id\":4,\"name\":\"Asher\",\"email\":null,\"phone\":\"8585454595\",\"address\":\"Andhara\",\"company_id\":4,\"created_at\":\"2026-07-13T08:18:17.000Z\"},{\"id\":5,\"name\":\"Kiran\",\"email\":null,\"phone\":\"0\",\"address\":null,\"company_id\":4,\"created_at\":\"2026-07-14T02:27:29.000Z\"},{\"id\":6,\"name\":\"c1\",\"email\":null,\"phone\":null,\"address\":null,\"company_id\":4,\"created_at\":\"2026-07-15T01:17:02.000Z\"},{\"id\":7,\"name\":\"C2\",\"email\":null,\"phone\":null,\"address\":null,\"company_id\":4,\"created_at\":\"2026-07-15T01:18:09.000Z\"},{\"id\":8,\"name\":\"Sam\",\"email\":null,\"phone\":null,\"address\":null,\"company_id\":4,\"created_at\":\"2026-07-16T00:59:23.000Z\"},{\"id\":9,\"name\":\"Anil\",\"email\":null,\"phone\":null,\"address\":null,\"company_id\":4,\"created_at\":\"2026-07-16T01:00:09.000Z\"},{\"id\":10,\"name\":\"Raj\",\"email\":null,\"phone\":null,\"address\":null,\"company_id\":4,\"created_at\":\"2026-07-16T01:00:53.000Z\"},{\"id\":11,\"name\":\"Bala Vamsi\",\"email\":null,\"phone\":null,\"address\":null,\"company_id\":4,\"created_at\":\"2026-07-17T19:18:20.000Z\"}],\"vendors\":[{\"id\":6,\"name\":\"Johns LLC\",\"phone\":\"99858566656\",\"email\":\"abc@gmail.com\",\"gst_number\":\"\",\"address\":\"hyderabad \",\"status\":\"Active\",\"created_at\":\"2026-07-13T05:48:09.000Z\",\"company_id\":4},{\"id\":7,\"name\":\"Venu Enterprises\",\"phone\":\"\",\"email\":\"\",\"gst_number\":\"\",\"address\":\"Chitoor\",\"status\":\"Active\",\"created_at\":\"2026-07-13T12:15:35.000Z\",\"company_id\":4},{\"id\":8,\"name\":\"PMJ TRaders\",\"phone\":\"9995595959\",\"email\":\"\",\"gst_number\":\"\",\"address\":\"Nellore\",\"status\":\"Active\",\"created_at\":\"2026-07-14T02:20:42.000Z\",\"company_id\":4},{\"id\":9,\"name\":\"PKD Traders\",\"phone\":\"8585858585\",\"email\":\"\",\"gst_number\":\"\",\"address\":\"Vijayawada\",\"status\":\"Active\",\"created_at\":\"2026-07-15T01:13:36.000Z\",\"company_id\":4},{\"id\":10,\"name\":\"Alpha enterprises\",\"phone\":\"2222222222\",\"email\":\"\",\"gst_number\":\"\",\"address\":\"Kukatpally\",\"status\":\"Active\",\"created_at\":\"2026-07-16T00:49:12.000Z\",\"company_id\":4}],\"products\":[{\"id\":7,\"name\":\"shampoo\",\"sellingPrice\":\"230.00\",\"stock\":2,\"created_at\":\"2026-07-13T05:38:05.000Z\",\"company_id\":4,\"mrp\":\"250.00\",\"sku\":\"Shampoo22\",\"barcode\":\"\",\"hsn\":\"190230\",\"category\":\"Shampoo\",\"unit\":\"PCS\",\"gst\":\"12.00\",\"purchase_price\":\"0.00\",\"opening_stock\":\"5.00\",\"reorder_level\":\"0.00\",\"status\":\"Active\",\"batch_no\":\"\",\"manufactured_date\":null,\"expiry_date\":null},{\"id\":8,\"name\":\"Oil\",\"sellingPrice\":\"110.00\",\"stock\":31,\"created_at\":\"2026-07-13T05:46:06.000Z\",\"company_id\":4,\"mrp\":\"120.00\",\"sku\":\"OIL25\",\"barcode\":\"\",\"hsn\":\"15121110\",\"category\":\"Kitchan\",\"unit\":\"PCS\",\"gst\":\"12.00\",\"purchase_price\":\"0.00\",\"opening_stock\":\"15.00\",\"reorder_level\":\"0.00\",\"status\":\"Active\",\"batch_no\":\"\",\"manufactured_date\":null,\"expiry_date\":null},{\"id\":9,\"name\":\"Tea Powder\",\"sellingPrice\":\"50.00\",\"stock\":18,\"created_at\":\"2026-07-13T21:46:23.000Z\",\"company_id\":4,\"mrp\":\"60.00\",\"sku\":\"TEA56\",\"barcode\":\"\",\"hsn\":\"210111\",\"category\":\"Kitchan\",\"unit\":\"PCS\",\"gst\":\"18.00\",\"purchase_price\":\"0.00\",\"opening_stock\":\"0.00\",\"reorder_level\":\"0.00\",\"status\":\"Active\",\"batch_no\":\"\",\"manufactured_date\":null,\"expiry_date\":null},{\"id\":10,\"name\":\"Sugar\",\"sellingPrice\":\"78.00\",\"stock\":5,\"created_at\":\"2026-07-13T21:47:26.000Z\",\"company_id\":4,\"mrp\":\"80.00\",\"sku\":\"Kit0085\",\"barcode\":\"\",\"hsn\":\"170410\",\"category\":\"Grocery\",\"unit\":\"PCS\",\"gst\":\"5.00\",\"purchase_price\":\"0.00\",\"opening_stock\":\"0.00\",\"reorder_level\":\"0.00\",\"status\":\"Active\",\"batch_no\":\"\",\"manufactured_date\":null,\"expiry_date\":null},{\"id\":11,\"name\":\"MTR Sambar powder\",\"sellingPrice\":\"10.00\",\"stock\":12,\"created_at\":\"2026-07-15T01:07:56.000Z\",\"company_id\":4,\"mrp\":\"15.00\",\"sku\":\"MASALA003\",\"barcode\":\"\",\"hsn\":\"210610\",\"category\":\"Masala Pwder\",\"unit\":\"PCS\",\"gst\":\"5.00\",\"purchase_price\":\"0.00\",\"opening_stock\":\"0.00\",\"reorder_level\":\"0.00\",\"status\":\"Active\",\"batch_no\":\"\",\"manufactured_date\":null,\"expiry_date\":null},{\"id\":12,\"name\":\"Priya Mango pickle\",\"sellingPrice\":\"75.00\",\"stock\":6,\"created_at\":\"2026-07-15T01:08:59.000Z\",\"company_id\":4,\"mrp\":\"80.00\",\"sku\":\"PICKLE002\",\"barcode\":\"\",\"hsn\":\"20019000\",\"category\":\"PICKLES\",\"unit\":\"PCS\",\"gst\":\"12.00\",\"purchase_price\":\"0.00\",\"opening_stock\":\"0.00\",\"reorder_level\":\"0.00\",\"status\":\"Active\",\"batch_no\":\"\",\"manufactured_date\":null,\"expiry_date\":null},{\"id\":13,\"name\":\"Maggi Noodles\",\"sellingPrice\":\"50.00\",\"stock\":5,\"created_at\":\"2026-07-15T01:12:20.000Z\",\"company_id\":4,\"mrp\":\"60.00\",\"sku\":\"\",\"barcode\":\"\",\"hsn\":\"190230\",\"category\":\"Cooking Food\",\"unit\":\"PCS\",\"gst\":\"5.00\",\"purchase_price\":\"0.00\",\"opening_stock\":\"0.00\",\"reorder_level\":\"0.00\",\"status\":\"Active\",\"batch_no\":\"\",\"manufactured_date\":null,\"expiry_date\":null},{\"id\":14,\"name\":\"Water Bottle\",\"sellingPrice\":\"50.00\",\"stock\":9,\"created_at\":\"2026-07-16T00:43:58.000Z\",\"company_id\":4,\"mrp\":\"60.00\",\"sku\":\"BT002\",\"barcode\":\"12345\",\"hsn\":\"55256\",\"category\":\"House Hold\",\"unit\":\"PCS\",\"gst\":\"5.00\",\"purchase_price\":\"12.00\",\"opening_stock\":\"0.00\",\"reorder_level\":\"5.00\",\"status\":\"Active\",\"batch_no\":\"\",\"manufactured_date\":null,\"expiry_date\":null},{\"id\":15,\"name\":\"Cups\",\"sellingPrice\":\"40.00\",\"stock\":20,\"created_at\":\"2026-07-16T00:46:19.000Z\",\"company_id\":4,\"mrp\":\"50.00\",\"sku\":\"Cup55\",\"barcode\":\"1234\",\"hsn\":\"552567\",\"category\":\"House Hold\",\"unit\":\"PCS\",\"gst\":\"5.00\",\"purchase_price\":\"30.00\",\"opening_stock\":\"0.00\",\"reorder_level\":\"5.00\",\"status\":\"Active\",\"batch_no\":\"\",\"manufactured_date\":null,\"expiry_date\":null},{\"id\":16,\"name\":\"5L Cooker\",\"sellingPrice\":\"1500.00\",\"stock\":11,\"created_at\":\"2026-07-16T00:52:56.000Z\",\"company_id\":4,\"mrp\":\"1500.00\",\"sku\":\"Cooker002\",\"barcode\":\"123456\",\"hsn\":\"552567\",\"category\":\"House Hold\",\"unit\":\"PCS\",\"gst\":\"18.00\",\"purchase_price\":\"1300.00\",\"opening_stock\":\"0.00\",\"reorder_level\":\"5.00\",\"status\":\"Active\",\"batch_no\":\"\",\"manufactured_date\":null,\"expiry_date\":null},{\"id\":17,\"name\":\"Induction Stove\",\"sellingPrice\":\"3000.00\",\"stock\":3,\"created_at\":\"2026-07-16T00:54:24.000Z\",\"company_id\":4,\"mrp\":\"3000.00\",\"sku\":\"Induc5525\",\"barcode\":\"1234567\",\"hsn\":\"552568\",\"category\":\"House Hold / Kitchen\",\"unit\":\"PCS\",\"gst\":\"18.00\",\"purchase_price\":\"2500.00\",\"opening_stock\":\"0.00\",\"reorder_level\":\"3.00\",\"status\":\"Active\",\"batch_no\":\"\",\"manufactured_date\":null,\"expiry_date\":null}],\"invoices\":[{\"id\":10,\"company_id\":4,\"created_by\":13,\"invoice_number\":\"INV-002\",\"invoice_date\":\"2026-02-22T18:30:00.000Z\",\"customer_id\":null,\"due_date\":null,\"customer_name\":\"Ramesh Kumar\",\"customer_email\":null,\"customer_phone\":null,\"subtotal\":\"5000.00\",\"tax_amount\":\"0.00\",\"total_amount\":\"5000.00\",\"status\":\"paid\",\"notes\":null,\"created_at\":\"2026-02-23T04:30:24.000Z\",\"updated_at\":\"2026-02-24T00:26:19.000Z\",\"tax_rate\":\"0.00\",\"cgst\":\"0.00\",\"sgst\":\"0.00\",\"igst\":\"0.00\"},{\"id\":39,\"company_id\":4,\"created_by\":13,\"invoice_number\":\"INV-0003\",\"invoice_date\":\"2026-07-12T18:30:00.000Z\",\"customer_id\":null,\"due_date\":null,\"customer_name\":\"Asher\",\"customer_email\":null,\"customer_phone\":null,\"subtotal\":\"560.00\",\"tax_amount\":\"100.80\",\"total_amount\":\"660.80\",\"status\":\"paid\",\"notes\":null,\"created_at\":\"2026-07-13T08:18:22.000Z\",\"updated_at\":\"2026-07-13T08:18:54.000Z\",\"tax_rate\":\"18.00\",\"cgst\":\"50.40\",\"sgst\":\"50.40\",\"igst\":\"0.00\"},{\"id\":40,\"company_id\":4,\"created_by\":13,\"invoice_number\":\"INV-0004\",\"invoice_date\":\"2026-07-12T18:30:00.000Z\",\"customer_id\":null,\"due_date\":null,\"customer_name\":\"Kiran\",\"customer_email\":null,\"customer_phone\":null,\"subtotal\":\"502.00\",\"tax_amount\":\"90.36\",\"total_amount\":\"592.36\",\"status\":\"pending\",\"notes\":null,\"created_at\":\"2026-07-14T02:28:41.000Z\",\"updated_at\":\"2026-07-17T19:19:53.000Z\",\"tax_rate\":\"18.00\",\"cgst\":\"45.18\",\"sgst\":\"45.18\",\"igst\":\"0.00\"},{\"id\":41,\"company_id\":4,\"created_by\":13,\"invoice_number\":\"INV-0005\",\"invoice_date\":\"2026-07-14T18:30:00.000Z\",\"customer_id\":null,\"due_date\":null,\"customer_name\":\"c1\",\"customer_email\":null,\"customer_phone\":null,\"subtotal\":\"175.00\",\"tax_amount\":\"31.50\",\"total_amount\":\"206.50\",\"status\":\"pending\",\"notes\":null,\"created_at\":\"2026-07-15T01:17:30.000Z\",\"updated_at\":\"2026-07-15T01:17:30.000Z\",\"tax_rate\":\"18.00\",\"cgst\":\"15.75\",\"sgst\":\"15.75\",\"igst\":\"0.00\"},{\"id\":42,\"company_id\":4,\"created_by\":13,\"invoice_number\":\"INV-0006\",\"invoice_date\":\"2026-07-14T18:30:00.000Z\",\"customer_id\":null,\"due_date\":null,\"customer_name\":\"C2\",\"customer_email\":null,\"customer_phone\":null,\"subtotal\":\"518.00\",\"tax_amount\":\"93.24\",\"total_amount\":\"611.24\",\"status\":\"pending\",\"notes\":null,\"created_at\":\"2026-07-15T01:18:44.000Z\",\"updated_at\":\"2026-07-15T01:18:44.000Z\",\"tax_rate\":\"18.00\",\"cgst\":\"46.62\",\"sgst\":\"46.62\",\"igst\":\"0.00\"},{\"id\":43,\"company_id\":4,\"created_by\":13,\"invoice_number\":\"INV-0007\",\"invoice_date\":\"2026-07-14T18:30:00.000Z\",\"customer_id\":null,\"due_date\":null,\"customer_name\":\"C2\",\"customer_email\":null,\"customer_phone\":null,\"subtotal\":\"75.00\",\"tax_amount\":\"13.50\",\"total_amount\":\"88.50\",\"status\":\"pending\",\"notes\":null,\"created_at\":\"2026-07-15T01:58:35.000Z\",\"updated_at\":\"2026-07-15T01:58:35.000Z\",\"tax_rate\":\"18.00\",\"cgst\":\"6.75\",\"sgst\":\"6.75\",\"igst\":\"0.00\"},{\"id\":44,\"company_id\":4,\"created_by\":13,\"invoice_number\":\"INV-0008\",\"invoice_date\":\"2026-07-15T18:30:00.000Z\",\"customer_id\":null,\"due_date\":null,\"customer_name\":\"Sam\",\"customer_email\":null,\"customer_phone\":null,\"subtotal\":\"3000.00\",\"tax_amount\":\"540.00\",\"total_amount\":\"3540.00\",\"status\":\"partial\",\"notes\":null,\"created_at\":\"2026-07-16T00:59:53.000Z\",\"updated_at\":\"2026-07-19T02:32:30.000Z\",\"tax_rate\":\"18.00\",\"cgst\":\"270.00\",\"sgst\":\"270.00\",\"igst\":\"0.00\"},{\"id\":45,\"company_id\":4,\"created_by\":13,\"invoice_number\":\"INV-0009\",\"invoice_date\":\"2026-07-15T18:30:00.000Z\",\"customer_id\":null,\"due_date\":null,\"customer_name\":\"Anil\",\"customer_email\":null,\"customer_phone\":null,\"subtotal\":\"1500.00\",\"tax_amount\":\"270.00\",\"total_amount\":\"1770.00\",\"status\":\"pending\",\"notes\":null,\"created_at\":\"2026-07-16T01:00:30.000Z\",\"updated_at\":\"2026-07-16T01:00:30.000Z\",\"tax_rate\":\"18.00\",\"cgst\":\"135.00\",\"sgst\":\"135.00\",\"igst\":\"0.00\"},{\"id\":46,\"company_id\":4,\"created_by\":13,\"invoice_number\":\"INV-0010\",\"invoice_date\":\"2026-07-15T18:30:00.000Z\",\"customer_id\":null,\"due_date\":null,\"customer_name\":\"Raj\",\"customer_email\":null,\"customer_phone\":null,\"subtotal\":\"180.00\",\"tax_amount\":\"9.00\",\"total_amount\":\"189.00\",\"status\":\"pending\",\"notes\":null,\"created_at\":\"2026-07-16T01:02:22.000Z\",\"updated_at\":\"2026-07-16T01:02:22.000Z\",\"tax_rate\":\"18.00\",\"cgst\":\"4.50\",\"sgst\":\"4.50\",\"igst\":\"0.00\"},{\"id\":47,\"company_id\":4,\"created_by\":13,\"invoice_number\":\"INV-0011\",\"invoice_date\":\"2026-07-17T18:30:00.000Z\",\"customer_id\":null,\"due_date\":null,\"customer_name\":\"Bala Vamsi\",\"customer_email\":null,\"customer_phone\":null,\"subtotal\":\"3000.00\",\"tax_amount\":\"540.00\",\"total_amount\":\"3540.00\",\"status\":\"pending\",\"notes\":null,\"created_at\":\"2026-07-17T19:18:30.000Z\",\"updated_at\":\"2026-07-17T19:19:46.000Z\",\"tax_rate\":\"18.00\",\"cgst\":\"270.00\",\"sgst\":\"270.00\",\"igst\":\"0.00\"}],\"invoice_items\":[{\"id\":12,\"invoice_id\":10,\"company_id\":4,\"item_name\":\"Website Development\",\"description\":null,\"quantity\":\"1.00\",\"unit_price\":\"5000.00\",\"total_price\":\"5000.00\",\"created_at\":\"2026-02-23T04:30:24.000Z\",\"gst_rate\":\"18.00\",\"mrp\":\"0.00\"},{\"id\":51,\"invoice_id\":39,\"company_id\":4,\"item_name\":\"Oil\",\"description\":null,\"quantity\":\"3.00\",\"unit_price\":\"110.00\",\"total_price\":\"389.40\",\"created_at\":\"2026-07-13T08:18:22.000Z\",\"gst_rate\":\"18.00\",\"mrp\":\"0.00\"},{\"id\":52,\"invoice_id\":39,\"company_id\":4,\"item_name\":\"shampoo\",\"description\":null,\"quantity\":\"1.00\",\"unit_price\":\"230.00\",\"total_price\":\"271.40\",\"created_at\":\"2026-07-13T08:18:22.000Z\",\"gst_rate\":\"18.00\",\"mrp\":\"0.00\"},{\"id\":56,\"invoice_id\":40,\"company_id\":4,\"item_name\":\"Oil\",\"description\":null,\"quantity\":\"2.00\",\"unit_price\":\"110.00\",\"total_price\":\"259.60\",\"created_at\":\"2026-07-14T03:23:40.000Z\",\"gst_rate\":\"18.00\",\"mrp\":\"0.00\"},{\"id\":57,\"invoice_id\":40,\"company_id\":4,\"item_name\":\"Tea Powder\",\"description\":null,\"quantity\":\"1.00\",\"unit_price\":\"52.00\",\"total_price\":\"61.36\",\"created_at\":\"2026-07-14T03:23:40.000Z\",\"gst_rate\":\"18.00\",\"mrp\":\"0.00\"},{\"id\":58,\"invoice_id\":40,\"company_id\":4,\"item_name\":\"shampoo\",\"description\":null,\"quantity\":\"1.00\",\"unit_price\":\"230.00\",\"total_price\":\"271.40\",\"created_at\":\"2026-07-14T03:23:40.000Z\",\"gst_rate\":\"18.00\",\"mrp\":\"0.00\"},{\"id\":59,\"invoice_id\":41,\"company_id\":4,\"item_name\":\"Maggi Noodles\",\"description\":null,\"quantity\":\"1.00\",\"unit_price\":\"50.00\",\"total_price\":\"59.00\",\"created_at\":\"2026-07-15T01:17:30.000Z\",\"gst_rate\":\"18.00\",\"mrp\":\"0.00\"},{\"id\":60,\"invoice_id\":41,\"company_id\":4,\"item_name\":\"Priya Mango pickle\",\"description\":null,\"quantity\":\"1.00\",\"unit_price\":\"75.00\",\"total_price\":\"88.50\",\"created_at\":\"2026-07-15T01:17:30.000Z\",\"gst_rate\":\"18.00\",\"mrp\":\"0.00\"},{\"id\":61,\"invoice_id\":41,\"company_id\":4,\"item_name\":\"Tea Powder\",\"description\":null,\"quantity\":\"1.00\",\"unit_price\":\"50.00\",\"total_price\":\"59.00\",\"created_at\":\"2026-07-15T01:17:31.000Z\",\"gst_rate\":\"18.00\",\"mrp\":\"0.00\"},{\"id\":62,\"invoice_id\":42,\"company_id\":4,\"item_name\":\"Sugar\",\"description\":null,\"quantity\":\"1.00\",\"unit_price\":\"78.00\",\"total_price\":\"92.04\",\"created_at\":\"2026-07-15T01:18:44.000Z\",\"gst_rate\":\"18.00\",\"mrp\":\"0.00\"},{\"id\":63,\"invoice_id\":42,\"company_id\":4,\"item_name\":\"Oil\",\"description\":null,\"quantity\":\"1.00\",\"unit_price\":\"110.00\",\"total_price\":\"129.80\",\"created_at\":\"2026-07-15T01:18:44.000Z\",\"gst_rate\":\"18.00\",\"mrp\":\"0.00\"},{\"id\":64,\"invoice_id\":42,\"company_id\":4,\"item_name\":\"shampoo\",\"description\":null,\"quantity\":\"1.00\",\"unit_price\":\"230.00\",\"total_price\":\"271.40\",\"created_at\":\"2026-07-15T01:18:45.000Z\",\"gst_rate\":\"18.00\",\"mrp\":\"0.00\"},{\"id\":65,\"invoice_id\":42,\"company_id\":4,\"item_name\":\"Maggi Noodles\",\"description\":null,\"quantity\":\"2.00\",\"unit_price\":\"50.00\",\"total_price\":\"118.00\",\"created_at\":\"2026-07-15T01:18:45.000Z\",\"gst_rate\":\"18.00\",\"mrp\":\"0.00\"},{\"id\":66,\"invoice_id\":43,\"company_id\":4,\"item_name\":\"Priya Mango pickle\",\"description\":null,\"quantity\":\"1.00\",\"unit_price\":\"75.00\",\"total_price\":\"88.50\",\"created_at\":\"2026-07-15T01:58:35.000Z\",\"gst_rate\":\"18.00\",\"mrp\":\"80.00\"},{\"id\":67,\"invoice_id\":44,\"company_id\":4,\"item_name\":\"Induction Stove\",\"description\":null,\"quantity\":\"1.00\",\"unit_price\":\"3000.00\",\"total_price\":\"3540.00\",\"created_at\":\"2026-07-16T00:59:53.000Z\",\"gst_rate\":\"18.00\",\"mrp\":\"3000.00\"},{\"id\":68,\"invoice_id\":45,\"company_id\":4,\"item_name\":\"5L Cooker\",\"description\":null,\"quantity\":\"1.00\",\"unit_price\":\"1500.00\",\"total_price\":\"1770.00\",\"created_at\":\"2026-07-16T01:00:30.000Z\",\"gst_rate\":\"18.00\",\"mrp\":\"1500.00\"},{\"id\":69,\"invoice_id\":46,\"company_id\":4,\"item_name\":\"Cups\",\"description\":null,\"quantity\":\"2.00\",\"unit_price\":\"40.00\",\"total_price\":\"84.00\",\"created_at\":\"2026-07-16T01:02:22.000Z\",\"gst_rate\":\"5.00\",\"mrp\":\"50.00\"},{\"id\":70,\"invoice_id\":46,\"company_id\":4,\"item_name\":\"Water Bottle\",\"description\":null,\"quantity\":\"2.00\",\"unit_price\":\"50.00\",\"total_price\":\"105.00\",\"created_at\":\"2026-07-16T01:02:22.000Z\",\"gst_rate\":\"5.00\",\"mrp\":\"60.00\"},{\"id\":71,\"invoice_id\":47,\"company_id\":4,\"item_name\":\"Induction Stove\",\"description\":null,\"quantity\":\"1.00\",\"unit_price\":\"3000.00\",\"total_price\":\"3540.00\",\"created_at\":\"2026-07-17T19:18:30.000Z\",\"gst_rate\":\"18.00\",\"mrp\":\"3000.00\"}],\"payments\":[{\"id\":4,\"invoice_id\":40,\"company_id\":4,\"amount\":\"200.00\",\"payment_date\":\"2026-07-13T18:30:00.000Z\",\"payment_method\":\"cash\",\"reference_number\":\"INV-0004-partial\",\"created_at\":\"2026-07-14T02:57:38.000Z\"},{\"id\":5,\"invoice_id\":47,\"company_id\":4,\"amount\":\"3540.00\",\"payment_date\":\"2026-07-17T18:30:00.000Z\",\"payment_method\":\"cash\",\"reference_number\":\"INV-0011-paid\",\"created_at\":\"2026-07-17T19:18:58.000Z\"},{\"id\":6,\"invoice_id\":44,\"company_id\":4,\"amount\":\"2500.00\",\"payment_date\":\"2026-07-18T18:30:00.000Z\",\"payment_method\":\"cash\",\"reference_number\":\"INV-0008-partial\",\"created_at\":\"2026-07-19T02:32:27.000Z\"}],\"bills\":[{\"id\":2,\"bill_number\":\"01\",\"bill_date\":\"2026-03-01T18:30:00.000Z\",\"due_date\":\"2026-03-03T18:30:00.000Z\",\"total_amount\":\"0.00\",\"status\":\"Unpaid\",\"company_id\":4,\"created_at\":\"2026-03-02T03:30:08.000Z\",\"vendor_id\":null,\"source_purchase_order_id\":null},{\"id\":5,\"bill_number\":\"266625\",\"bill_date\":\"2026-04-05T18:30:00.000Z\",\"due_date\":\"2026-04-05T18:30:00.000Z\",\"total_amount\":\"100.00\",\"status\":\"Unpaid\",\"company_id\":4,\"created_at\":\"2026-04-06T18:03:02.000Z\",\"vendor_id\":3,\"source_purchase_order_id\":null},{\"id\":6,\"bill_number\":\"25656\",\"bill_date\":\"2026-04-05T18:30:00.000Z\",\"due_date\":\"2026-04-06T18:30:00.000Z\",\"total_amount\":\"50000.00\",\"status\":\"Unpaid\",\"company_id\":4,\"created_at\":\"2026-04-06T18:03:51.000Z\",\"vendor_id\":3,\"source_purchase_order_id\":null},{\"id\":7,\"bill_number\":\"556586\",\"bill_date\":\"2026-03-30T18:30:00.000Z\",\"due_date\":\"2026-04-05T18:30:00.000Z\",\"total_amount\":\"37500.00\",\"status\":\"Unpaid\",\"company_id\":4,\"created_at\":\"2026-04-06T18:05:52.000Z\",\"vendor_id\":2,\"source_purchase_order_id\":null},{\"id\":8,\"bill_number\":\"585656\",\"bill_date\":\"2026-04-11T18:30:00.000Z\",\"due_date\":\"2026-04-12T18:30:00.000Z\",\"total_amount\":\"1180.00\",\"status\":\"Unpaid\",\"company_id\":4,\"created_at\":\"2026-04-12T14:42:09.000Z\",\"vendor_id\":5,\"source_purchase_order_id\":null},{\"id\":16,\"bill_number\":\"BILL-0001\",\"bill_date\":\"2026-07-11T18:30:00.000Z\",\"due_date\":\"2026-07-29T18:30:00.000Z\",\"total_amount\":\"1180.00\",\"status\":\"Unpaid\",\"company_id\":4,\"created_at\":\"2026-07-13T12:13:20.000Z\",\"vendor_id\":6,\"source_purchase_order_id\":null},{\"id\":18,\"bill_number\":\"BILL-0003\",\"bill_date\":\"2026-07-12T18:30:00.000Z\",\"due_date\":\"2026-07-29T18:30:00.000Z\",\"total_amount\":\"1357.00\",\"status\":\"Partial Paid\",\"company_id\":4,\"created_at\":\"2026-07-13T13:06:16.000Z\",\"vendor_id\":7,\"source_purchase_order_id\":null},{\"id\":19,\"bill_number\":\"BILL-0004\",\"bill_date\":\"2026-07-13T18:30:00.000Z\",\"due_date\":\"2026-07-29T18:30:00.000Z\",\"total_amount\":\"1085.60\",\"status\":\"Paid\",\"company_id\":4,\"created_at\":\"2026-07-13T21:49:45.000Z\",\"vendor_id\":6,\"source_purchase_order_id\":null},{\"id\":20,\"bill_number\":\"BILL-0005\",\"bill_date\":\"2026-07-13T18:30:00.000Z\",\"due_date\":\"2026-07-30T18:30:00.000Z\",\"total_amount\":\"472.00\",\"status\":\"Partial Paid\",\"company_id\":4,\"created_at\":\"2026-07-14T02:21:43.000Z\",\"vendor_id\":8,\"source_purchase_order_id\":null},{\"id\":21,\"bill_number\":\"BILL-0006\",\"bill_date\":\"2026-07-14T18:30:00.000Z\",\"due_date\":null,\"total_amount\":\"849.60\",\"status\":\"Partial Paid\",\"company_id\":4,\"created_at\":\"2026-07-15T01:15:11.000Z\",\"vendor_id\":9,\"source_purchase_order_id\":null},{\"id\":22,\"bill_number\":\"BILL-0007\",\"bill_date\":\"2026-07-14T18:30:00.000Z\",\"due_date\":null,\"total_amount\":\"460.20\",\"status\":\"Paid\",\"company_id\":4,\"created_at\":\"2026-07-15T01:16:05.000Z\",\"vendor_id\":9,\"source_purchase_order_id\":null},{\"id\":23,\"bill_number\":\"BILL-0008\",\"bill_date\":\"2026-07-14T18:30:00.000Z\",\"due_date\":null,\"total_amount\":\"287.92\",\"status\":\"Unpaid\",\"company_id\":4,\"created_at\":\"2026-07-15T02:01:26.000Z\",\"vendor_id\":8,\"source_purchase_order_id\":null},{\"id\":24,\"bill_number\":\"BILL-0009\",\"bill_date\":\"2026-07-15T18:30:00.000Z\",\"due_date\":null,\"total_amount\":\"441.00\",\"status\":\"Paid\",\"company_id\":4,\"created_at\":\"2026-07-16T00:50:34.000Z\",\"vendor_id\":10,\"source_purchase_order_id\":null},{\"id\":25,\"bill_number\":\"BILL-0010\",\"bill_date\":\"2026-07-15T18:30:00.000Z\",\"due_date\":null,\"total_amount\":\"25488.00\",\"status\":\"Partial Paid\",\"company_id\":4,\"created_at\":\"2026-07-16T00:55:50.000Z\",\"vendor_id\":10,\"source_purchase_order_id\":null},{\"id\":26,\"bill_number\":\"BILL-0011\",\"bill_date\":\"2026-07-17T18:30:00.000Z\",\"due_date\":null,\"total_amount\":\"7985.00\",\"status\":\"Unpaid\",\"company_id\":4,\"created_at\":\"2026-07-18T05:50:13.000Z\",\"vendor_id\":9,\"source_purchase_order_id\":2}],\"bill_items\":[{\"id\":3,\"bill_id\":2,\"product_id\":null,\"product_name\":\"laptop\",\"quantity\":10,\"price\":\"0.00\",\"total\":\"0.00\",\"gst_percent\":\"0.00\",\"cgst\":\"0.00\",\"sgst\":\"0.00\",\"mrp\":\"0.00\"},{\"id\":6,\"bill_id\":5,\"product_id\":null,\"product_name\":\"coffee bag\",\"quantity\":10,\"price\":\"10.00\",\"total\":\"100.00\",\"gst_percent\":\"0.00\",\"cgst\":\"0.00\",\"sgst\":\"0.00\",\"mrp\":\"0.00\"},{\"id\":7,\"bill_id\":6,\"product_id\":null,\"product_name\":\"Gas stove \",\"quantity\":10,\"price\":\"5000.00\",\"total\":\"50000.00\",\"gst_percent\":\"0.00\",\"cgst\":\"0.00\",\"sgst\":\"0.00\",\"mrp\":\"0.00\"},{\"id\":10,\"bill_id\":7,\"product_id\":null,\"product_name\":\"Iron Box\",\"quantity\":25,\"price\":\"1500.00\",\"total\":\"37500.00\",\"gst_percent\":\"0.00\",\"cgst\":\"0.00\",\"sgst\":\"0.00\",\"mrp\":\"0.00\"},{\"id\":11,\"bill_id\":8,\"product_id\":null,\"product_name\":\"Rice bag\",\"quantity\":10,\"price\":\"100.00\",\"total\":\"1180.00\",\"gst_percent\":\"18.00\",\"cgst\":\"90.00\",\"sgst\":\"90.00\",\"mrp\":\"0.00\"},{\"id\":22,\"bill_id\":18,\"product_id\":8,\"product_name\":\"Oil\",\"quantity\":10,\"price\":\"115.00\",\"total\":\"1357.00\",\"gst_percent\":\"18.00\",\"cgst\":\"103.50\",\"sgst\":\"103.50\",\"mrp\":\"0.00\"},{\"id\":23,\"bill_id\":19,\"product_id\":10,\"product_name\":\"Sugar\",\"quantity\":6,\"price\":\"70.00\",\"total\":\"495.60\",\"gst_percent\":\"18.00\",\"cgst\":\"37.80\",\"sgst\":\"37.80\",\"mrp\":\"0.00\"},{\"id\":24,\"bill_id\":19,\"product_id\":9,\"product_name\":\"Tea Powder\",\"quantity\":10,\"price\":\"50.00\",\"total\":\"590.00\",\"gst_percent\":\"18.00\",\"cgst\":\"45.00\",\"sgst\":\"45.00\",\"mrp\":\"0.00\"},{\"id\":25,\"bill_id\":20,\"product_id\":9,\"product_name\":\"Tea Powder\",\"quantity\":10,\"price\":\"40.00\",\"total\":\"472.00\",\"gst_percent\":\"18.00\",\"cgst\":\"36.00\",\"sgst\":\"36.00\",\"mrp\":\"0.00\"},{\"id\":26,\"bill_id\":16,\"product_id\":8,\"product_name\":\"Oil\",\"quantity\":10,\"price\":\"100.00\",\"total\":\"1180.00\",\"gst_percent\":\"18.00\",\"cgst\":\"90.00\",\"sgst\":\"90.00\",\"mrp\":\"0.00\"},{\"id\":27,\"bill_id\":21,\"product_id\":13,\"product_name\":\"Maggi Noodles\",\"quantity\":5,\"price\":\"70.00\",\"total\":\"413.00\",\"gst_percent\":\"18.00\",\"cgst\":\"31.50\",\"sgst\":\"31.50\",\"mrp\":\"0.00\"},{\"id\":28,\"bill_id\":21,\"product_id\":12,\"product_name\":\"Priya Mango pickle\",\"quantity\":5,\"price\":\"60.00\",\"total\":\"354.00\",\"gst_percent\":\"18.00\",\"cgst\":\"27.00\",\"sgst\":\"27.00\",\"mrp\":\"0.00\"},{\"id\":29,\"bill_id\":21,\"product_id\":11,\"product_name\":\"MTR Sambar powder\",\"quantity\":10,\"price\":\"7.00\",\"total\":\"82.60\",\"gst_percent\":\"18.00\",\"cgst\":\"6.30\",\"sgst\":\"6.30\",\"mrp\":\"0.00\"},{\"id\":30,\"bill_id\":22,\"product_id\":13,\"product_name\":\"Maggi Noodles\",\"quantity\":3,\"price\":\"70.00\",\"total\":\"247.80\",\"gst_percent\":\"18.00\",\"cgst\":\"18.90\",\"sgst\":\"18.90\",\"mrp\":\"0.00\"},{\"id\":31,\"bill_id\":22,\"product_id\":12,\"product_name\":\"Priya Mango pickle\",\"quantity\":3,\"price\":\"60.00\",\"total\":\"212.40\",\"gst_percent\":\"18.00\",\"cgst\":\"16.20\",\"sgst\":\"16.20\",\"mrp\":\"0.00\"},{\"id\":32,\"bill_id\":23,\"product_id\":11,\"product_name\":\"MTR Sambar powder\",\"quantity\":2,\"price\":\"7.00\",\"total\":\"16.52\",\"gst_percent\":\"18.00\",\"cgst\":\"1.26\",\"sgst\":\"1.26\",\"mrp\":\"15.00\"},{\"id\":33,\"bill_id\":23,\"product_id\":8,\"product_name\":\"Oil\",\"quantity\":2,\"price\":\"115.00\",\"total\":\"271.40\",\"gst_percent\":\"18.00\",\"cgst\":\"20.70\",\"sgst\":\"20.70\",\"mrp\":\"120.00\"},{\"id\":34,\"bill_id\":24,\"product_id\":14,\"product_name\":\"Water Bottle\",\"quantity\":10,\"price\":\"12.00\",\"total\":\"126.00\",\"gst_percent\":\"5.00\",\"cgst\":\"3.00\",\"sgst\":\"3.00\",\"mrp\":\"60.00\"},{\"id\":35,\"bill_id\":24,\"product_id\":15,\"product_name\":\"Cups\",\"quantity\":10,\"price\":\"30.00\",\"total\":\"315.00\",\"gst_percent\":\"5.00\",\"cgst\":\"7.50\",\"sgst\":\"7.50\",\"mrp\":\"50.00\"},{\"id\":36,\"bill_id\":25,\"product_id\":17,\"product_name\":\"Induction Stove\",\"quantity\":5,\"price\":\"2500.00\",\"total\":\"14750.00\",\"gst_percent\":\"18.00\",\"cgst\":\"1125.00\",\"sgst\":\"1125.00\",\"mrp\":\"3000.00\"},{\"id\":37,\"bill_id\":25,\"product_id\":16,\"product_name\":\"5L Cooker\",\"quantity\":7,\"price\":\"1300.00\",\"total\":\"10738.00\",\"gst_percent\":\"18.00\",\"cgst\":\"819.00\",\"sgst\":\"819.00\",\"mrp\":\"1500.00\"},{\"id\":38,\"bill_id\":26,\"product_id\":16,\"product_name\":\"5L Cooker\",\"quantity\":5,\"price\":\"1300.00\",\"total\":\"7670.00\",\"gst_percent\":\"18.00\",\"cgst\":\"585.00\",\"sgst\":\"585.00\",\"mrp\":\"1500.00\"},{\"id\":39,\"bill_id\":26,\"product_id\":15,\"product_name\":\"Cups\",\"quantity\":10,\"price\":\"30.00\",\"total\":\"315.00\",\"gst_percent\":\"5.00\",\"cgst\":\"7.50\",\"sgst\":\"7.50\",\"mrp\":\"50.00\"}],\"vendor_payments\":[{\"id\":3,\"vendor_id\":8,\"bill_id\":20,\"amount\":\"272.00\",\"payment_date\":\"2026-07-13T18:30:00.000Z\",\"payment_method\":\"Cash\",\"notes\":\"Partial payment for BILL-0005\",\"company_id\":4,\"created_at\":\"2026-07-14T02:22:06.000Z\"},{\"id\":4,\"vendor_id\":9,\"bill_id\":21,\"amount\":\"500.00\",\"payment_date\":\"2026-07-14T18:30:00.000Z\",\"payment_method\":\"Cash\",\"notes\":\"Partial payment for BILL-0006\",\"company_id\":4,\"created_at\":\"2026-07-15T01:16:21.000Z\"},{\"id\":5,\"vendor_id\":10,\"bill_id\":25,\"amount\":\"15000.00\",\"payment_date\":\"2026-07-15T18:30:00.000Z\",\"payment_method\":\"Cash\",\"notes\":\"Partial payment for BILL-0010\",\"company_id\":4,\"created_at\":\"2026-07-16T00:56:06.000Z\"}],\"delivery_challans\":[{\"id\":1,\"company_id\":4,\"type\":\"in\",\"challan_number\":\"DCIN-0001\",\"challan_date\":\"2026-07-15T18:30:00.000Z\",\"party_type\":\"vendor\",\"party_id\":10,\"party_name\":\"Alpha enterprises\",\"address\":\"Kukatpally\",\"transport\":\"Tata Ace\",\"vehicle_number\":\"TS059895\",\"notes\":null,\"status\":\"Created\",\"created_by\":13,\"created_at\":\"2026-07-16T01:15:58.000Z\"},{\"id\":2,\"company_id\":4,\"type\":\"out\",\"challan_number\":\"DCOUT-0001\",\"challan_date\":\"2026-07-15T18:30:00.000Z\",\"party_type\":\"customer\",\"party_id\":7,\"party_name\":\"C2\",\"address\":null,\"transport\":\"Vijay Cargo\",\"vehicle_number\":\"AP308562\",\"notes\":null,\"status\":\"Created\",\"created_by\":13,\"created_at\":\"2026-07-16T01:18:47.000Z\"}],\"delivery_challan_items\":[{\"id\":1,\"challan_id\":1,\"company_id\":4,\"product_id\":15,\"product_name\":\"Cups\",\"batch_no\":null,\"quantity\":\"5.00\",\"unit\":\"PCS\",\"created_at\":\"2026-07-16T01:15:58.000Z\"},{\"id\":2,\"challan_id\":1,\"company_id\":4,\"product_id\":14,\"product_name\":\"Water Bottle\",\"batch_no\":null,\"quantity\":\"2.00\",\"unit\":\"PCS\",\"created_at\":\"2026-07-16T01:15:59.000Z\"},{\"id\":3,\"challan_id\":2,\"company_id\":4,\"product_id\":14,\"product_name\":\"Water Bottle\",\"batch_no\":null,\"quantity\":\"1.00\",\"unit\":\"PCS\",\"created_at\":\"2026-07-16T01:18:48.000Z\"},{\"id\":4,\"challan_id\":2,\"company_id\":4,\"product_id\":15,\"product_name\":\"Cups\",\"batch_no\":null,\"quantity\":\"2.00\",\"unit\":\"PCS\",\"created_at\":\"2026-07-16T01:18:48.000Z\"}],\"product_returns\":[{\"id\":1,\"company_id\":4,\"type\":\"purchase\",\"return_number\":\"PRET-0001\",\"return_date\":\"2026-07-15T18:30:00.000Z\",\"party_type\":\"vendor\",\"party_id\":10,\"party_name\":\"Alpha enterprises\",\"reference_number\":\"5556\",\"subtotal\":\"60.00\",\"tax_amount\":\"3.00\",\"total_amount\":\"63.00\",\"notes\":\"Damage Receievd\",\"created_by\":13,\"created_at\":\"2026-07-16T00:58:16.000Z\"},{\"id\":2,\"company_id\":4,\"type\":\"sales\",\"return_number\":\"SRET-0001\",\"return_date\":\"2026-07-15T18:30:00.000Z\",\"party_type\":\"customer\",\"party_id\":10,\"party_name\":\"Raj\",\"reference_number\":null,\"subtotal\":\"40.00\",\"tax_amount\":\"2.00\",\"total_amount\":\"42.00\",\"notes\":null,\"created_by\":13,\"created_at\":\"2026-07-16T01:12:06.000Z\"}],\"return_items\":[{\"id\":1,\"return_id\":1,\"company_id\":4,\"product_id\":15,\"product_name\":\"Cups\",\"batch_no\":null,\"quantity\":\"2.00\",\"unit_price\":\"30.00\",\"mrp\":\"50.00\",\"gst_rate\":\"5.00\",\"total_price\":\"63.00\",\"created_at\":\"2026-07-16T00:58:16.000Z\"},{\"id\":2,\"return_id\":2,\"company_id\":4,\"product_id\":15,\"product_name\":\"Cups\",\"batch_no\":null,\"quantity\":\"1.00\",\"unit_price\":\"40.00\",\"mrp\":\"50.00\",\"gst_rate\":\"5.00\",\"total_price\":\"42.00\",\"created_at\":\"2026-07-16T01:12:06.000Z\"}],\"quotations\":[{\"id\":1,\"company_id\":4,\"customer_id\":6,\"customer_name\":\"c1\",\"quotation_number\":\"QT-0001\",\"quotation_date\":\"2026-07-17T18:30:00.000Z\",\"valid_until\":null,\"status\":\"Draft\",\"notes\":null,\"subtotal\":\"1500.00\",\"discount_amount\":\"0.00\",\"tax_amount\":\"270.00\",\"total_amount\":\"1770.00\",\"created_by\":13,\"created_at\":\"2026-07-18T06:25:30.000Z\",\"updated_at\":\"2026-07-18T06:25:30.000Z\"}],\"quotation_items\":[{\"id\":1,\"quotation_id\":1,\"product_id\":16,\"product_name\":\"5L Cooker\",\"hsn\":\"552567\",\"mrp\":\"1500.00\",\"quantity\":\"1.00\",\"price\":\"1500.00\",\"discount\":\"0.00\",\"gst_percent\":\"18.00\",\"cgst\":\"135.00\",\"sgst\":\"135.00\",\"total\":\"1770.00\"}],\"purchase_orders\":[{\"id\":1,\"company_id\":4,\"vendor_id\":10,\"po_number\":\"PO-0001\",\"po_date\":\"2026-07-16T18:30:00.000Z\",\"expected_date\":null,\"status\":\"Draft\",\"notes\":null,\"subtotal\":\"1200.00\",\"gst_amount\":\"216.00\",\"total_amount\":\"1416.00\",\"created_by\":13,\"created_at\":\"2026-07-17T05:27:20.000Z\",\"updated_at\":\"2026-07-17T05:27:20.000Z\"},{\"id\":2,\"company_id\":4,\"vendor_id\":9,\"po_number\":\"PO-0002\",\"po_date\":\"2026-07-17T18:30:00.000Z\",\"expected_date\":null,\"status\":\"Converted\",\"notes\":null,\"subtotal\":\"6800.00\",\"gst_amount\":\"1185.00\",\"total_amount\":\"7985.00\",\"created_by\":13,\"created_at\":\"2026-07-18T04:58:30.000Z\",\"updated_at\":\"2026-07-18T05:50:14.000Z\"}],\"purchase_order_items\":[{\"id\":1,\"purchase_order_id\":1,\"product_id\":8,\"product_name\":\"Oil\",\"mrp\":\"120.00\",\"quantity\":\"10.00\",\"price\":\"120.00\",\"gst_percent\":\"18.00\",\"cgst\":\"108.00\",\"sgst\":\"108.00\",\"total\":\"1416.00\"},{\"id\":2,\"purchase_order_id\":2,\"product_id\":16,\"product_name\":\"5L Cooker\",\"mrp\":\"1500.00\",\"quantity\":\"5.00\",\"price\":\"1300.00\",\"gst_percent\":\"18.00\",\"cgst\":\"585.00\",\"sgst\":\"585.00\",\"total\":\"7670.00\"},{\"id\":3,\"purchase_order_id\":2,\"product_id\":15,\"product_name\":\"Cups\",\"mrp\":\"50.00\",\"quantity\":\"10.00\",\"price\":\"30.00\",\"gst_percent\":\"5.00\",\"cgst\":\"7.50\",\"sgst\":\"7.50\",\"total\":\"315.00\"}],\"accounts\":[{\"id\":20,\"account_code\":\"0001\",\"account_name\":\"Cash\",\"account_type\":\"ASSET\",\"parent_account_id\":null,\"opening_balance\":\"100.00\",\"balance_type\":\"DEBIT\",\"description\":null,\"status\":1,\"created_at\":\"2026-07-17T19:32:52.000Z\",\"updated_at\":\"2026-07-17T19:32:52.000Z\",\"company_id\":4},{\"id\":21,\"account_code\":\"0002\",\"account_name\":\"Bank\",\"account_type\":\"ASSET\",\"parent_account_id\":null,\"opening_balance\":\"20000.00\",\"balance_type\":\"DEBIT\",\"description\":null,\"status\":1,\"created_at\":\"2026-07-17T19:33:14.000Z\",\"updated_at\":\"2026-07-17T19:33:14.000Z\",\"company_id\":4},{\"id\":22,\"account_code\":\"0003\",\"account_name\":\"Creditors\",\"account_type\":\"LIABILITY\",\"parent_account_id\":null,\"opening_balance\":\"10000.00\",\"balance_type\":\"CREDIT\",\"description\":null,\"status\":1,\"created_at\":\"2026-07-17T19:33:46.000Z\",\"updated_at\":\"2026-07-17T19:34:01.000Z\",\"company_id\":4},{\"id\":23,\"account_code\":\"0004\",\"account_name\":\"Salary\",\"account_type\":\"EXPENSE\",\"parent_account_id\":null,\"opening_balance\":\"41000.00\",\"balance_type\":\"DEBIT\",\"description\":null,\"status\":1,\"created_at\":\"2026-07-17T19:34:54.000Z\",\"updated_at\":\"2026-07-17T19:34:54.000Z\",\"company_id\":4}],\"journal_entries\":[{\"id\":10,\"journal_no\":\"RCPT-00001\",\"journal_date\":\"2026-07-17T18:30:00.000Z\",\"narration\":null,\"total_debit\":\"500.00\",\"total_credit\":\"500.00\",\"created_by\":null,\"status\":1,\"created_at\":\"2026-07-18T07:32:07.000Z\",\"updated_at\":\"2026-07-18T07:32:07.000Z\",\"company_id\":4},{\"id\":11,\"journal_no\":\"PAY-00011\",\"journal_date\":\"2026-07-17T18:30:00.000Z\",\"narration\":null,\"total_debit\":\"500.00\",\"total_credit\":\"500.00\",\"created_by\":null,\"status\":1,\"created_at\":\"2026-07-18T07:32:49.000Z\",\"updated_at\":\"2026-07-18T07:32:49.000Z\",\"company_id\":4}],\"receipt_entries\":[],\"payment_entries\":[],\"expenses\":[],\"payroll_employees\":[{\"id\":1,\"company_id\":4,\"name\":\"jay\",\"employee_code\":\"EMP001\",\"phone\":\"9898989898\",\"email\":\"abs@gmail.com\",\"designation\":\"Manager\",\"joining_date\":\"2026-01-13T18:30:00.000Z\",\"monthly_salary\":\"35000.00\",\"status\":\"Active\",\"notes\":null,\"created_by\":13,\"created_at\":\"2026-07-17T05:48:57.000Z\",\"updated_at\":\"2026-07-19T08:04:52.000Z\"},{\"id\":2,\"company_id\":4,\"name\":\"Bobby\",\"employee_code\":\"EMP002\",\"phone\":\"0202020202\",\"email\":null,\"designation\":\"Exe\",\"joining_date\":\"2026-01-01T18:30:00.000Z\",\"monthly_salary\":\"15000.00\",\"status\":\"Active\",\"notes\":null,\"created_by\":13,\"created_at\":\"2026-07-19T08:05:53.000Z\",\"updated_at\":\"2026-07-19T08:05:53.000Z\"},{\"id\":3,\"company_id\":4,\"name\":\"Kumar\",\"employee_code\":\"EMP003\",\"phone\":\"65656565656\",\"email\":null,\"designation\":\"Sr Exe\",\"joining_date\":\"2026-01-01T18:30:00.000Z\",\"monthly_salary\":\"25000.00\",\"status\":\"Active\",\"notes\":null,\"created_by\":13,\"created_at\":\"2026-07-19T08:06:46.000Z\",\"updated_at\":\"2026-07-19T08:06:46.000Z\"}],\"payroll_entries\":[{\"id\":1,\"company_id\":4,\"employee_id\":1,\"employee_name\":\"jay\",\"payroll_month\":\"2026-07\",\"payroll_date\":\"2026-06-30T18:30:00.000Z\",\"salary_mode\":\"Attendance Import\",\"working_days\":\"26.00\",\"present_days\":\"24.00\",\"absent_days\":\"2.00\",\"total_hours\":\"192.00\",\"overtime_hours\":\"4.00\",\"standard_hours\":\"208.00\",\"basic_salary\":\"32307.69\",\"allowances\":\"673.08\",\"deductions\":\"0.00\",\"net_amount\":\"32980.77\",\"status\":\"Unpaid\",\"payment_date\":null,\"notes\":\"Imported from attendance machine\",\"attendance_import_id\":5,\"created_by\":13,\"created_at\":\"2026-07-19T08:07:10.000Z\",\"updated_at\":\"2026-07-19T08:08:23.000Z\"},{\"id\":2,\"company_id\":4,\"employee_id\":2,\"employee_name\":\"Bobby\",\"payroll_month\":\"2026-07\",\"payroll_date\":\"2026-06-30T18:30:00.000Z\",\"salary_mode\":\"Attendance Import\",\"working_days\":\"26.00\",\"present_days\":\"25.00\",\"absent_days\":\"1.00\",\"total_hours\":\"162.00\",\"overtime_hours\":\"0.00\",\"standard_hours\":\"208.00\",\"basic_salary\":\"11682.69\",\"allowances\":\"0.00\",\"deductions\":\"0.00\",\"net_amount\":\"11682.69\",\"status\":\"Paid\",\"payment_date\":\"2026-07-18T18:30:00.000Z\",\"notes\":null,\"attendance_import_id\":5,\"created_by\":13,\"created_at\":\"2026-07-19T08:07:11.000Z\",\"updated_at\":\"2026-07-19T08:08:24.000Z\"},{\"id\":3,\"company_id\":4,\"employee_id\":3,\"employee_name\":\"Kumar\",\"payroll_month\":\"2026-07\",\"payroll_date\":\"2026-06-30T18:30:00.000Z\",\"salary_mode\":\"Attendance Import\",\"working_days\":\"28.00\",\"present_days\":\"28.00\",\"absent_days\":\"0.00\",\"total_hours\":\"224.00\",\"overtime_hours\":\"0.00\",\"standard_hours\":\"224.00\",\"basic_salary\":\"25000.00\",\"allowances\":\"0.00\",\"deductions\":\"0.00\",\"net_amount\":\"25000.00\",\"status\":\"Paid\",\"payment_date\":\"2026-07-18T18:30:00.000Z\",\"notes\":null,\"attendance_import_id\":5,\"created_by\":13,\"created_at\":\"2026-07-19T08:07:12.000Z\",\"updated_at\":\"2026-07-19T08:08:25.000Z\"}],\"payroll_attendance_imports\":[{\"id\":1,\"company_id\":4,\"payroll_month\":\"2026-07\",\"file_name\":\"attendance-payroll-template-2026-07.xlsx\",\"row_count\":3,\"created_count\":0,\"updated_count\":0,\"skipped_count\":3,\"standard_hours_per_day\":\"8.00\",\"created_by\":13,\"created_at\":\"2026-07-19T08:00:56.000Z\"},{\"id\":2,\"company_id\":4,\"payroll_month\":\"2026-07\",\"file_name\":\"attendance-payroll-template-2026-07.xlsx\",\"row_count\":3,\"created_count\":0,\"updated_count\":0,\"skipped_count\":3,\"standard_hours_per_day\":\"8.00\",\"created_by\":13,\"created_at\":\"2026-07-19T08:02:21.000Z\"},{\"id\":3,\"company_id\":4,\"payroll_month\":\"2026-07\",\"file_name\":\"attendance-payroll-template-2026-07.xlsx\",\"row_count\":3,\"created_count\":0,\"updated_count\":0,\"skipped_count\":3,\"standard_hours_per_day\":\"8.00\",\"created_by\":13,\"created_at\":\"2026-07-19T08:04:38.000Z\"},{\"id\":4,\"company_id\":4,\"payroll_month\":\"2026-07\",\"file_name\":\"attendance-payroll-template-2026-07.xlsx\",\"row_count\":3,\"created_count\":3,\"updated_count\":0,\"skipped_count\":0,\"standard_hours_per_day\":\"8.00\",\"created_by\":13,\"created_at\":\"2026-07-19T08:07:09.000Z\"},{\"id\":5,\"company_id\":4,\"payroll_month\":\"2026-07\",\"file_name\":\"attendance-payroll-template-2026-07.xlsx\",\"row_count\":3,\"created_count\":0,\"updated_count\":3,\"skipped_count\":0,\"standard_hours_per_day\":\"8.00\",\"created_by\":13,\"created_at\":\"2026-07-19T08:08:22.000Z\"}],\"payroll_attendance_lines\":[{\"id\":1,\"import_id\":1,\"company_id\":4,\"employee_id\":null,\"employee_code\":\"EMP001\",\"employee_name\":\"jay\",\"payroll_month\":\"2026-07\",\"working_days\":\"0.00\",\"present_days\":\"0.00\",\"absent_days\":\"0.00\",\"total_hours\":\"0.00\",\"overtime_hours\":\"0.00\",\"allowances\":\"0.00\",\"deductions\":\"0.00\",\"calculated_salary\":\"0.00\",\"status\":\"Skipped\",\"message\":\"Employee not found: EMP001\",\"created_at\":\"2026-07-19T08:00:57.000Z\"},{\"id\":2,\"import_id\":1,\"company_id\":4,\"employee_id\":null,\"employee_code\":\"EMP002\",\"employee_name\":\"Bobby\",\"payroll_month\":\"2026-07\",\"working_days\":\"0.00\",\"present_days\":\"0.00\",\"absent_days\":\"0.00\",\"total_hours\":\"0.00\",\"overtime_hours\":\"0.00\",\"allowances\":\"0.00\",\"deductions\":\"0.00\",\"calculated_salary\":\"0.00\",\"status\":\"Skipped\",\"message\":\"Employee not found: EMP002\",\"created_at\":\"2026-07-19T08:00:58.000Z\"},{\"id\":3,\"import_id\":1,\"company_id\":4,\"employee_id\":null,\"employee_code\":\"EMP003\",\"employee_name\":\"Kumar\",\"payroll_month\":\"2026-07\",\"working_days\":\"0.00\",\"present_days\":\"0.00\",\"absent_days\":\"0.00\",\"total_hours\":\"0.00\",\"overtime_hours\":\"0.00\",\"allowances\":\"0.00\",\"deductions\":\"0.00\",\"calculated_salary\":\"0.00\",\"status\":\"Skipped\",\"message\":\"Employee not found: EMP003\",\"created_at\":\"2026-07-19T08:00:58.000Z\"},{\"id\":4,\"import_id\":2,\"company_id\":4,\"employee_id\":null,\"employee_code\":\"EMP001\",\"employee_name\":\"jay\",\"payroll_month\":\"2026-07\",\"working_days\":\"0.00\",\"present_days\":\"0.00\",\"absent_days\":\"0.00\",\"total_hours\":\"0.00\",\"overtime_hours\":\"0.00\",\"allowances\":\"0.00\",\"deductions\":\"0.00\",\"calculated_salary\":\"0.00\",\"status\":\"Skipped\",\"message\":\"Employee not found: EMP001\",\"created_at\":\"2026-07-19T08:02:22.000Z\"},{\"id\":5,\"import_id\":2,\"company_id\":4,\"employee_id\":null,\"employee_code\":\"EMP002\",\"employee_name\":\"Bobby\",\"payroll_month\":\"2026-07\",\"working_days\":\"0.00\",\"present_days\":\"0.00\",\"absent_days\":\"0.00\",\"total_hours\":\"0.00\",\"overtime_hours\":\"0.00\",\"allowances\":\"0.00\",\"deductions\":\"0.00\",\"calculated_salary\":\"0.00\",\"status\":\"Skipped\",\"message\":\"Employee not found: EMP002\",\"created_at\":\"2026-07-19T08:02:23.000Z\"},{\"id\":6,\"import_id\":2,\"company_id\":4,\"employee_id\":null,\"employee_code\":\"EMP003\",\"employee_name\":\"Kumar\",\"payroll_month\":\"2026-07\",\"working_days\":\"0.00\",\"present_days\":\"0.00\",\"absent_days\":\"0.00\",\"total_hours\":\"0.00\",\"overtime_hours\":\"0.00\",\"allowances\":\"0.00\",\"deductions\":\"0.00\",\"calculated_salary\":\"0.00\",\"status\":\"Skipped\",\"message\":\"Employee not found: EMP003\",\"created_at\":\"2026-07-19T08:02:23.000Z\"},{\"id\":7,\"import_id\":3,\"company_id\":4,\"employee_id\":null,\"employee_code\":\"EMP001\",\"employee_name\":\"jay\",\"payroll_month\":\"2026-07\",\"working_days\":\"0.00\",\"present_days\":\"0.00\",\"absent_days\":\"0.00\",\"total_hours\":\"0.00\",\"overtime_hours\":\"0.00\",\"allowances\":\"0.00\",\"deductions\":\"0.00\",\"calculated_salary\":\"0.00\",\"status\":\"Skipped\",\"message\":\"Employee not found: EMP001\",\"created_at\":\"2026-07-19T08:04:39.000Z\"},{\"id\":8,\"import_id\":3,\"company_id\":4,\"employee_id\":null,\"employee_code\":\"EMP002\",\"employee_name\":\"Bobby\",\"payroll_month\":\"2026-07\",\"working_days\":\"0.00\",\"present_days\":\"0.00\",\"absent_days\":\"0.00\",\"total_hours\":\"0.00\",\"overtime_hours\":\"0.00\",\"allowances\":\"0.00\",\"deductions\":\"0.00\",\"calculated_salary\":\"0.00\",\"status\":\"Skipped\",\"message\":\"Employee not found: EMP002\",\"created_at\":\"2026-07-19T08:04:39.000Z\"},{\"id\":9,\"import_id\":3,\"company_id\":4,\"employee_id\":null,\"employee_code\":\"EMP003\",\"employee_name\":\"Kumar\",\"payroll_month\":\"2026-07\",\"working_days\":\"0.00\",\"present_days\":\"0.00\",\"absent_days\":\"0.00\",\"total_hours\":\"0.00\",\"overtime_hours\":\"0.00\",\"allowances\":\"0.00\",\"deductions\":\"0.00\",\"calculated_salary\":\"0.00\",\"status\":\"Skipped\",\"message\":\"Employee not found: EMP003\",\"created_at\":\"2026-07-19T08:04:40.000Z\"},{\"id\":10,\"import_id\":4,\"company_id\":4,\"employee_id\":1,\"employee_code\":\"EMP001\",\"employee_name\":\"jay\",\"payroll_month\":\"2026-07\",\"working_days\":\"26.00\",\"present_days\":\"24.00\",\"absent_days\":\"2.00\",\"total_hours\":\"192.00\",\"overtime_hours\":\"4.00\",\"allowances\":\"673.08\",\"deductions\":\"0.00\",\"calculated_salary\":\"32980.77\",\"status\":\"Imported\",\"message\":\"Overtime amount included: 673.08\",\"created_at\":\"2026-07-19T08:07:10.000Z\"},{\"id\":11,\"import_id\":4,\"company_id\":4,\"employee_id\":2,\"employee_code\":\"EMP002\",\"employee_name\":\"Bobby\",\"payroll_month\":\"2026-07\",\"working_days\":\"26.00\",\"present_days\":\"25.00\",\"absent_days\":\"1.00\",\"total_hours\":\"162.00\",\"overtime_hours\":\"0.00\",\"allowances\":\"0.00\",\"deductions\":\"0.00\",\"calculated_salary\":\"11682.69\",\"status\":\"Imported\",\"message\":null,\"created_at\":\"2026-07-19T08:07:11.000Z\"},{\"id\":12,\"import_id\":4,\"company_id\":4,\"employee_id\":3,\"employee_code\":\"EMP003\",\"employee_name\":\"Kumar\",\"payroll_month\":\"2026-07\",\"working_days\":\"28.00\",\"present_days\":\"28.00\",\"absent_days\":\"0.00\",\"total_hours\":\"224.00\",\"overtime_hours\":\"0.00\",\"allowances\":\"0.00\",\"deductions\":\"0.00\",\"calculated_salary\":\"25000.00\",\"status\":\"Imported\",\"message\":null,\"created_at\":\"2026-07-19T08:07:12.000Z\"},{\"id\":13,\"import_id\":5,\"company_id\":4,\"employee_id\":1,\"employee_code\":\"EMP001\",\"employee_name\":\"jay\",\"payroll_month\":\"2026-07\",\"working_days\":\"26.00\",\"present_days\":\"24.00\",\"absent_days\":\"2.00\",\"total_hours\":\"192.00\",\"overtime_hours\":\"4.00\",\"allowances\":\"673.08\",\"deductions\":\"0.00\",\"calculated_salary\":\"32980.77\",\"status\":\"Imported\",\"message\":\"Overtime amount included: 673.08\",\"created_at\":\"2026-07-19T08:08:23.000Z\"},{\"id\":14,\"import_id\":5,\"company_id\":4,\"employee_id\":2,\"employee_code\":\"EMP002\",\"employee_name\":\"Bobby\",\"payroll_month\":\"2026-07\",\"working_days\":\"26.00\",\"present_days\":\"25.00\",\"absent_days\":\"1.00\",\"total_hours\":\"162.00\",\"overtime_hours\":\"0.00\",\"allowances\":\"0.00\",\"deductions\":\"0.00\",\"calculated_salary\":\"11682.69\",\"status\":\"Imported\",\"message\":null,\"created_at\":\"2026-07-19T08:08:24.000Z\"},{\"id\":15,\"import_id\":5,\"company_id\":4,\"employee_id\":3,\"employee_code\":\"EMP003\",\"employee_name\":\"Kumar\",\"payroll_month\":\"2026-07\",\"working_days\":\"28.00\",\"present_days\":\"28.00\",\"absent_days\":\"0.00\",\"total_hours\":\"224.00\",\"overtime_hours\":\"0.00\",\"allowances\":\"0.00\",\"deductions\":\"0.00\",\"calculated_salary\":\"25000.00\",\"status\":\"Imported\",\"message\":null,\"created_at\":\"2026-07-19T08:08:25.000Z\"}],\"audit_logs\":[{\"id\":1,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"purchase_orders\",\"action\":\"create\",\"method\":\"POST\",\"path\":\"/api/purchase-orders\",\"resource_id\":null,\"status_code\":201,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{},\\\"body\\\":{\\\"vendor_id\\\":\\\"10\\\",\\\"po_date\\\":\\\"2026-07-17\\\",\\\"expected_date\\\":\\\"\\\",\\\"notes\\\":\\\"\\\",\\\"items\\\":[{\\\"product_id\\\":\\\"8\\\",\\\"mrp\\\":120,\\\"quantity\\\":10,\\\"price\\\":120,\\\"gst\\\":18}],\\\"po_number\\\":\\\"PO-0001\\\"}}\",\"created_at\":\"2026-07-17T05:27:21.000Z\"},{\"id\":2,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"payroll\",\"action\":\"create\",\"method\":\"POST\",\"path\":\"/api/payroll/employees\",\"resource_id\":null,\"status_code\":201,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{},\\\"body\\\":{\\\"name\\\":\\\"jay\\\",\\\"phone\\\":\\\"9898989898\\\",\\\"email\\\":\\\"abs@gmail.com\\\",\\\"designation\\\":\\\"Manager\\\",\\\"joining_date\\\":\\\"2026-01-15\\\",\\\"monthly_salary\\\":\\\"35000\\\",\\\"notes\\\":\\\"\\\"}}\",\"created_at\":\"2026-07-17T05:48:58.000Z\"},{\"id\":3,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"customers\",\"action\":\"create\",\"method\":\"POST\",\"path\":\"/api/customers\",\"resource_id\":null,\"status_code\":201,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{},\\\"body\\\":{\\\"name\\\":\\\"Bala Vamsi\\\",\\\"email\\\":null,\\\"phone\\\":null,\\\"address\\\":null}}\",\"created_at\":\"2026-07-17T19:18:21.000Z\"},{\"id\":4,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"invoices\",\"action\":\"create\",\"method\":\"POST\",\"path\":\"/api/invoices\",\"resource_id\":null,\"status_code\":201,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{},\\\"body\\\":{\\\"invoice_date\\\":\\\"2026-07-18\\\",\\\"customer_id\\\":11,\\\"customer_name\\\":\\\"Bala Vamsi\\\",\\\"items\\\":[{\\\"product_id\\\":17,\\\"name\\\":\\\"Induction Stove\\\",\\\"quantity\\\":1,\\\"unit_price\\\":3000,\\\"mrp\\\":3000,\\\"gst_rate\\\":\\\"18.00\\\"}]}}\",\"created_at\":\"2026-07-17T19:18:31.000Z\"},{\"id\":5,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"invoices\",\"action\":\"create\",\"method\":\"POST\",\"path\":\"/api/invoices/47/payments\",\"resource_id\":\"47\",\"status_code\":201,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{\\\"invoiceId\\\":\\\"47\\\"},\\\"body\\\":{\\\"amount\\\":3540,\\\"payment_date\\\":\\\"2026-07-18\\\",\\\"payment_method\\\":\\\"Cash\\\",\\\"reference_number\\\":\\\"INV-0011-paid\\\"}}\",\"created_at\":\"2026-07-17T19:18:59.000Z\"},{\"id\":6,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"invoices\",\"action\":\"edit\",\"method\":\"PUT\",\"path\":\"/api/invoices/47/status\",\"resource_id\":\"47\",\"status_code\":200,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{\\\"id\\\":\\\"47\\\"},\\\"body\\\":{\\\"status\\\":\\\"paid\\\"}}\",\"created_at\":\"2026-07-17T19:19:23.000Z\"},{\"id\":7,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"invoices\",\"action\":\"edit\",\"method\":\"PUT\",\"path\":\"/api/invoices/47/status\",\"resource_id\":\"47\",\"status_code\":200,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{\\\"id\\\":\\\"47\\\"},\\\"body\\\":{\\\"status\\\":\\\"paid\\\"}}\",\"created_at\":\"2026-07-17T19:19:28.000Z\"},{\"id\":8,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"invoices\",\"action\":\"edit\",\"method\":\"PUT\",\"path\":\"/api/invoices/47/status\",\"resource_id\":\"47\",\"status_code\":200,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{\\\"id\\\":\\\"47\\\"},\\\"body\\\":{\\\"status\\\":\\\"pending\\\"}}\",\"created_at\":\"2026-07-17T19:19:33.000Z\"},{\"id\":9,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"invoices\",\"action\":\"edit\",\"method\":\"PUT\",\"path\":\"/api/invoices/47/status\",\"resource_id\":\"47\",\"status_code\":200,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{\\\"id\\\":\\\"47\\\"},\\\"body\\\":{\\\"status\\\":\\\"paid\\\"}}\",\"created_at\":\"2026-07-17T19:19:40.000Z\"},{\"id\":10,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"invoices\",\"action\":\"edit\",\"method\":\"PUT\",\"path\":\"/api/invoices/47/status\",\"resource_id\":\"47\",\"status_code\":200,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{\\\"id\\\":\\\"47\\\"},\\\"body\\\":{\\\"status\\\":\\\"pending\\\"}}\",\"created_at\":\"2026-07-17T19:19:47.000Z\"},{\"id\":11,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"invoices\",\"action\":\"edit\",\"method\":\"PUT\",\"path\":\"/api/invoices/40/status\",\"resource_id\":\"40\",\"status_code\":200,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{\\\"id\\\":\\\"40\\\"},\\\"body\\\":{\\\"status\\\":\\\"pending\\\"}}\",\"created_at\":\"2026-07-17T19:19:53.000Z\"},{\"id\":12,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"accounting\",\"action\":\"create\",\"method\":\"POST\",\"path\":\"/api/accounts\",\"resource_id\":null,\"status_code\":201,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{},\\\"body\\\":{\\\"account_code\\\":\\\"0001\\\",\\\"account_name\\\":\\\"Cash\\\",\\\"account_type\\\":\\\"ASSET\\\",\\\"parent_account_id\\\":\\\"\\\",\\\"opening_balance\\\":\\\"100\\\",\\\"balance_type\\\":\\\"DEBIT\\\",\\\"description\\\":\\\"\\\"}}\",\"created_at\":\"2026-07-17T19:32:53.000Z\"},{\"id\":13,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"accounting\",\"action\":\"create\",\"method\":\"POST\",\"path\":\"/api/accounts\",\"resource_id\":null,\"status_code\":201,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{},\\\"body\\\":{\\\"account_code\\\":\\\"0002\\\",\\\"account_name\\\":\\\"Bank\\\",\\\"account_type\\\":\\\"ASSET\\\",\\\"parent_account_id\\\":\\\"\\\",\\\"opening_balance\\\":\\\"20000\\\",\\\"balance_type\\\":\\\"DEBIT\\\",\\\"description\\\":\\\"\\\"}}\",\"created_at\":\"2026-07-17T19:33:14.000Z\"},{\"id\":14,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"accounting\",\"action\":\"create\",\"method\":\"POST\",\"path\":\"/api/accounts\",\"resource_id\":null,\"status_code\":201,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{},\\\"body\\\":{\\\"account_code\\\":\\\"0003\\\",\\\"account_name\\\":\\\"Creditors\\\",\\\"account_type\\\":\\\"ASSET\\\",\\\"parent_account_id\\\":\\\"\\\",\\\"opening_balance\\\":\\\"10000\\\",\\\"balance_type\\\":\\\"CREDIT\\\",\\\"description\\\":\\\"\\\"}}\",\"created_at\":\"2026-07-17T19:33:47.000Z\"},{\"id\":15,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"accounting\",\"action\":\"edit\",\"method\":\"PUT\",\"path\":\"/api/accounts/22\",\"resource_id\":\"22\",\"status_code\":200,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{\\\"id\\\":\\\"22\\\"},\\\"body\\\":{\\\"account_code\\\":\\\"0003\\\",\\\"account_name\\\":\\\"Creditors\\\",\\\"account_type\\\":\\\"LIABILITY\\\",\\\"parent_account_id\\\":\\\"\\\",\\\"opening_balance\\\":\\\"10000.00\\\",\\\"balance_type\\\":\\\"CREDIT\\\",\\\"description\\\":\\\"\\\"}}\",\"created_at\":\"2026-07-17T19:34:01.000Z\"},{\"id\":16,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"accounting\",\"action\":\"create\",\"method\":\"POST\",\"path\":\"/api/accounts\",\"resource_id\":null,\"status_code\":201,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{},\\\"body\\\":{\\\"account_code\\\":\\\"0004\\\",\\\"account_name\\\":\\\"Salary\\\",\\\"account_type\\\":\\\"EXPENSE\\\",\\\"parent_account_id\\\":\\\"\\\",\\\"opening_balance\\\":\\\"41000\\\",\\\"balance_type\\\":\\\"DEBIT\\\",\\\"description\\\":\\\"\\\"}}\",\"created_at\":\"2026-07-17T19:34:54.000Z\"},{\"id\":17,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"purchase_orders\",\"action\":\"create\",\"method\":\"POST\",\"path\":\"/api/purchase-orders\",\"resource_id\":null,\"status_code\":201,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{},\\\"body\\\":{\\\"vendor_id\\\":\\\"9\\\",\\\"po_date\\\":\\\"2026-07-18\\\",\\\"expected_date\\\":\\\"\\\",\\\"notes\\\":\\\"\\\",\\\"items\\\":[{\\\"product_id\\\":\\\"16\\\",\\\"mrp\\\":1500,\\\"quantity\\\":5,\\\"price\\\":1300,\\\"gst\\\":18},{\\\"product_id\\\":\\\"15\\\",\\\"mrp\\\":50,\\\"quantity\\\":10,\\\"price\\\":30,\\\"gst\\\":5}],\\\"po_number\\\":\\\"PO-0002\\\"}}\",\"created_at\":\"2026-07-18T04:58:33.000Z\"},{\"id\":18,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"purchase_orders\",\"action\":\"create\",\"method\":\"POST\",\"path\":\"/api/purchase-orders/2/convert-to-bill\",\"resource_id\":\"2\",\"status_code\":201,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{\\\"id\\\":\\\"2\\\"},\\\"body\\\":{\\\"bill_date\\\":\\\"2026-07-18\\\"}}\",\"created_at\":\"2026-07-18T05:50:15.000Z\"},{\"id\":19,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"invoices\",\"action\":\"create\",\"method\":\"POST\",\"path\":\"/api/quotations\",\"resource_id\":null,\"status_code\":201,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{},\\\"body\\\":{\\\"customer_id\\\":\\\"6\\\",\\\"customer_name\\\":\\\"c1\\\",\\\"quotation_date\\\":\\\"2026-07-18\\\",\\\"valid_until\\\":\\\"\\\",\\\"notes\\\":\\\"\\\",\\\"items\\\":[{\\\"product_id\\\":\\\"16\\\",\\\"hsn\\\":\\\"552567\\\",\\\"mrp\\\":1500,\\\"quantity\\\":1,\\\"price\\\":1500,\\\"discount\\\":0,\\\"gst\\\":18}],\\\"quotation_number\\\":\\\"QT-0001\\\"}}\",\"created_at\":\"2026-07-18T06:25:31.000Z\"},{\"id\":20,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"accounting\",\"action\":\"create\",\"method\":\"POST\",\"path\":\"/api/receipt-entries\",\"resource_id\":null,\"status_code\":201,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{},\\\"body\\\":{\\\"receipt_date\\\":\\\"2026-07-18\\\",\\\"received_in_account_id\\\":\\\"20\\\",\\\"received_from_account_id\\\":\\\"23\\\",\\\"amount\\\":500,\\\"narration\\\":\\\"\\\"}}\",\"created_at\":\"2026-07-18T07:32:08.000Z\"},{\"id\":21,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"accounting\",\"action\":\"create\",\"method\":\"POST\",\"path\":\"/api/payment-entries\",\"resource_id\":null,\"status_code\":201,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{},\\\"body\\\":{\\\"payment_date\\\":\\\"2026-07-18\\\",\\\"paid_from_account_id\\\":\\\"20\\\",\\\"paid_to_account_id\\\":\\\"23\\\",\\\"amount\\\":500,\\\"narration\\\":\\\"\\\"}}\",\"created_at\":\"2026-07-18T07:32:50.000Z\"},{\"id\":22,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"invoices\",\"action\":\"create\",\"method\":\"POST\",\"path\":\"/api/invoices/44/payments\",\"resource_id\":\"44\",\"status_code\":201,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{\\\"invoiceId\\\":\\\"44\\\"},\\\"body\\\":{\\\"amount\\\":2500,\\\"payment_date\\\":\\\"2026-07-19\\\",\\\"payment_method\\\":\\\"Cash\\\",\\\"reference_number\\\":\\\"INV-0008-partial\\\"}}\",\"created_at\":\"2026-07-19T02:32:30.000Z\"},{\"id\":23,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"payroll\",\"action\":\"create\",\"method\":\"POST\",\"path\":\"/api/payroll/attendance/import\",\"resource_id\":null,\"status_code\":200,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{},\\\"body\\\":{\\\"rows\\\":[{\\\"Employee Code\\\":\\\"EMP001\\\",\\\"Employee Name\\\":\\\"jay\\\",\\\"Payroll Month\\\":\\\"2026-07\\\",\\\"Working Days\\\":\\\"26\\\",\\\"Present Days\\\":\\\"24\\\",\\\"Absent Days\\\":\\\"2\\\",\\\"Working Hours\\\":\\\"192\\\",\\\"Overtime Hours\\\":\\\"4\\\",\\\"Allowances\\\":\\\"0\\\",\\\"Deductions\\\":\\\"0\\\",\\\"Salary Status\\\":\\\"Unpaid\\\",\\\"Payment Date\\\":\\\"\\\",\\\"Notes\\\":\\\"Imported from attendance machine\\\"},{\\\"Employee Code\\\":\\\"EMP002\\\",\\\"Employee Name\\\":\\\"Bobby\\\",\\\"Payroll Month\\\":\\\"2026-07\\\",\\\"Working Days\\\":\\\"26\\\",\\\"Present Days\\\":\\\"25\\\",\\\"Absent Days\\\":\\\"1\\\",\\\"Working Hours\\\":\\\"162\\\",\\\"Overtime Hours\\\":\\\"0\\\",\\\"Allowances\\\":\\\"0\\\",\\\"Deductions\\\":\\\"0\\\",\\\"Salary Status\\\":\\\"Paid\\\",\\\"Payment Date\\\":\\\"\\\",\\\"Notes\\\":\\\"\\\"},{\\\"Employee Code\\\":\\\"EMP003\\\",\\\"Employee Name\\\":\\\"Kumar\\\",\\\"Payroll Month\\\":\\\"2026-07\\\",\\\"Working Days\\\":\\\"28\\\",\\\"Present Days\\\":\\\"28\\\",\\\"Absent Days\\\":\\\"0\\\",\\\"Working Hours\\\":\\\"224\\\",\\\"Overtime Hours\\\":\\\"0\\\",\\\"Allowances\\\":\\\"0\\\",\\\"Deductions\\\":\\\"0\\\",\\\"Salary Status\\\":\\\"Paid\\\",\\\"Payment Date\\\":\\\"\\\",\\\"Notes\\\":\\\"\\\"}],\\\"fileName\\\":\\\"attendance-payroll-template-2026-07.xlsx\\\",\\\"payroll_month\\\":\\\"2026-07\\\",\\\"standard_hours_per_day\\\":8}}\",\"created_at\":\"2026-07-19T08:00:59.000Z\"},{\"id\":24,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"payroll\",\"action\":\"create\",\"method\":\"POST\",\"path\":\"/api/payroll/attendance/import\",\"resource_id\":null,\"status_code\":200,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{},\\\"body\\\":{\\\"rows\\\":[{\\\"Employee Code\\\":\\\"EMP001\\\",\\\"Employee Name\\\":\\\"jay\\\",\\\"Payroll Month\\\":\\\"2026-07\\\",\\\"Working Days\\\":\\\"26\\\",\\\"Present Days\\\":\\\"24\\\",\\\"Absent Days\\\":\\\"2\\\",\\\"Working Hours\\\":\\\"192\\\",\\\"Overtime Hours\\\":\\\"4\\\",\\\"Allowances\\\":\\\"0\\\",\\\"Deductions\\\":\\\"0\\\",\\\"Salary Status\\\":\\\"Unpaid\\\",\\\"Payment Date\\\":\\\"\\\",\\\"Notes\\\":\\\"Imported from attendance machine\\\"},{\\\"Employee Code\\\":\\\"EMP002\\\",\\\"Employee Name\\\":\\\"Bobby\\\",\\\"Payroll Month\\\":\\\"2026-07\\\",\\\"Working Days\\\":\\\"26\\\",\\\"Present Days\\\":\\\"25\\\",\\\"Absent Days\\\":\\\"1\\\",\\\"Working Hours\\\":\\\"162\\\",\\\"Overtime Hours\\\":\\\"0\\\",\\\"Allowances\\\":\\\"0\\\",\\\"Deductions\\\":\\\"0\\\",\\\"Salary Status\\\":\\\"Paid\\\",\\\"Payment Date\\\":\\\"\\\",\\\"Notes\\\":\\\"\\\"},{\\\"Employee Code\\\":\\\"EMP003\\\",\\\"Employee Name\\\":\\\"Kumar\\\",\\\"Payroll Month\\\":\\\"2026-07\\\",\\\"Working Days\\\":\\\"28\\\",\\\"Present Days\\\":\\\"28\\\",\\\"Absent Days\\\":\\\"0\\\",\\\"Working Hours\\\":\\\"224\\\",\\\"Overtime Hours\\\":\\\"0\\\",\\\"Allowances\\\":\\\"0\\\",\\\"Deductions\\\":\\\"0\\\",\\\"Salary Status\\\":\\\"Paid\\\",\\\"Payment Date\\\":\\\"\\\",\\\"Notes\\\":\\\"\\\"}],\\\"fileName\\\":\\\"attendance-payroll-template-2026-07.xlsx\\\",\\\"payroll_month\\\":\\\"2026-07\\\",\\\"standard_hours_per_day\\\":8}}\",\"created_at\":\"2026-07-19T08:02:24.000Z\"},{\"id\":25,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"payroll\",\"action\":\"create\",\"method\":\"POST\",\"path\":\"/api/payroll/attendance/import\",\"resource_id\":null,\"status_code\":200,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{},\\\"body\\\":{\\\"rows\\\":[{\\\"Employee Code\\\":\\\"EMP001\\\",\\\"Employee Name\\\":\\\"jay\\\",\\\"Payroll Month\\\":\\\"2026-07\\\",\\\"Working Days\\\":\\\"26\\\",\\\"Present Days\\\":\\\"24\\\",\\\"Absent Days\\\":\\\"2\\\",\\\"Working Hours\\\":\\\"192\\\",\\\"Overtime Hours\\\":\\\"4\\\",\\\"Allowances\\\":\\\"0\\\",\\\"Deductions\\\":\\\"0\\\",\\\"Salary Status\\\":\\\"Unpaid\\\",\\\"Payment Date\\\":\\\"\\\",\\\"Notes\\\":\\\"Imported from attendance machine\\\"},{\\\"Employee Code\\\":\\\"EMP002\\\",\\\"Employee Name\\\":\\\"Bobby\\\",\\\"Payroll Month\\\":\\\"2026-07\\\",\\\"Working Days\\\":\\\"26\\\",\\\"Present Days\\\":\\\"25\\\",\\\"Absent Days\\\":\\\"1\\\",\\\"Working Hours\\\":\\\"162\\\",\\\"Overtime Hours\\\":\\\"0\\\",\\\"Allowances\\\":\\\"0\\\",\\\"Deductions\\\":\\\"0\\\",\\\"Salary Status\\\":\\\"Paid\\\",\\\"Payment Date\\\":\\\"\\\",\\\"Notes\\\":\\\"\\\"},{\\\"Employee Code\\\":\\\"EMP003\\\",\\\"Employee Name\\\":\\\"Kumar\\\",\\\"Payroll Month\\\":\\\"2026-07\\\",\\\"Working Days\\\":\\\"28\\\",\\\"Present Days\\\":\\\"28\\\",\\\"Absent Days\\\":\\\"0\\\",\\\"Working Hours\\\":\\\"224\\\",\\\"Overtime Hours\\\":\\\"0\\\",\\\"Allowances\\\":\\\"0\\\",\\\"Deductions\\\":\\\"0\\\",\\\"Salary Status\\\":\\\"Paid\\\",\\\"Payment Date\\\":\\\"\\\",\\\"Notes\\\":\\\"\\\"}],\\\"fileName\\\":\\\"attendance-payroll-template-2026-07.xlsx\\\",\\\"payroll_month\\\":\\\"2026-07\\\",\\\"standard_hours_per_day\\\":8}}\",\"created_at\":\"2026-07-19T08:04:41.000Z\"},{\"id\":26,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"payroll\",\"action\":\"edit\",\"method\":\"PUT\",\"path\":\"/api/payroll/employees/1\",\"resource_id\":\"1\",\"status_code\":200,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{\\\"id\\\":\\\"1\\\"},\\\"body\\\":{\\\"name\\\":\\\"jay\\\",\\\"employee_code\\\":\\\"EMP001\\\",\\\"phone\\\":\\\"9898989898\\\",\\\"email\\\":\\\"abs@gmail.com\\\",\\\"designation\\\":\\\"Manager\\\",\\\"joining_date\\\":\\\"2026-01-14\\\",\\\"monthly_salary\\\":\\\"35000.00\\\",\\\"status\\\":\\\"Active\\\",\\\"notes\\\":\\\"\\\"}}\",\"created_at\":\"2026-07-19T08:04:52.000Z\"},{\"id\":27,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"payroll\",\"action\":\"create\",\"method\":\"POST\",\"path\":\"/api/payroll/employees\",\"resource_id\":null,\"status_code\":201,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{},\\\"body\\\":{\\\"name\\\":\\\"Bobby\\\",\\\"employee_code\\\":\\\"EMP002\\\",\\\"phone\\\":\\\"0202020202\\\",\\\"email\\\":\\\"\\\",\\\"designation\\\":\\\"Exe\\\",\\\"joining_date\\\":\\\"2026-01-02\\\",\\\"monthly_salary\\\":\\\"15000\\\",\\\"notes\\\":\\\"\\\"}}\",\"created_at\":\"2026-07-19T08:05:53.000Z\"},{\"id\":28,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"payroll\",\"action\":\"create\",\"method\":\"POST\",\"path\":\"/api/payroll/employees\",\"resource_id\":null,\"status_code\":201,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{},\\\"body\\\":{\\\"name\\\":\\\"Kumar\\\",\\\"employee_code\\\":\\\"EMP003\\\",\\\"phone\\\":\\\"65656565656\\\",\\\"email\\\":\\\"\\\",\\\"designation\\\":\\\"Sr Exe\\\",\\\"joining_date\\\":\\\"2026-01-02\\\",\\\"monthly_salary\\\":\\\"25000\\\",\\\"notes\\\":\\\"\\\"}}\",\"created_at\":\"2026-07-19T08:06:47.000Z\"},{\"id\":29,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"payroll\",\"action\":\"create\",\"method\":\"POST\",\"path\":\"/api/payroll/attendance/import\",\"resource_id\":null,\"status_code\":200,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{},\\\"body\\\":{\\\"rows\\\":[{\\\"Employee Code\\\":\\\"EMP001\\\",\\\"Employee Name\\\":\\\"jay\\\",\\\"Payroll Month\\\":\\\"2026-07\\\",\\\"Working Days\\\":\\\"26\\\",\\\"Present Days\\\":\\\"24\\\",\\\"Absent Days\\\":\\\"2\\\",\\\"Working Hours\\\":\\\"192\\\",\\\"Overtime Hours\\\":\\\"4\\\",\\\"Allowances\\\":\\\"0\\\",\\\"Deductions\\\":\\\"0\\\",\\\"Salary Status\\\":\\\"Unpaid\\\",\\\"Payment Date\\\":\\\"\\\",\\\"Notes\\\":\\\"Imported from attendance machine\\\"},{\\\"Employee Code\\\":\\\"EMP002\\\",\\\"Employee Name\\\":\\\"Bobby\\\",\\\"Payroll Month\\\":\\\"2026-07\\\",\\\"Working Days\\\":\\\"26\\\",\\\"Present Days\\\":\\\"25\\\",\\\"Absent Days\\\":\\\"1\\\",\\\"Working Hours\\\":\\\"162\\\",\\\"Overtime Hours\\\":\\\"0\\\",\\\"Allowances\\\":\\\"0\\\",\\\"Deductions\\\":\\\"0\\\",\\\"Salary Status\\\":\\\"Paid\\\",\\\"Payment Date\\\":\\\"\\\",\\\"Notes\\\":\\\"\\\"},{\\\"Employee Code\\\":\\\"EMP003\\\",\\\"Employee Name\\\":\\\"Kumar\\\",\\\"Payroll Month\\\":\\\"2026-07\\\",\\\"Working Days\\\":\\\"28\\\",\\\"Present Days\\\":\\\"28\\\",\\\"Absent Days\\\":\\\"0\\\",\\\"Working Hours\\\":\\\"224\\\",\\\"Overtime Hours\\\":\\\"0\\\",\\\"Allowances\\\":\\\"0\\\",\\\"Deductions\\\":\\\"0\\\",\\\"Salary Status\\\":\\\"Paid\\\",\\\"Payment Date\\\":\\\"\\\",\\\"Notes\\\":\\\"\\\"}],\\\"fileName\\\":\\\"attendance-payroll-template-2026-07.xlsx\\\",\\\"payroll_month\\\":\\\"2026-07\\\",\\\"standard_hours_per_day\\\":8}}\",\"created_at\":\"2026-07-19T08:07:13.000Z\"},{\"id\":30,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"payroll\",\"action\":\"create\",\"method\":\"POST\",\"path\":\"/api/payroll/attendance/import\",\"resource_id\":null,\"status_code\":200,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{},\\\"body\\\":{\\\"rows\\\":[{\\\"Employee Code\\\":\\\"EMP001\\\",\\\"Employee Name\\\":\\\"jay\\\",\\\"Payroll Month\\\":\\\"2026-07\\\",\\\"Working Days\\\":\\\"26\\\",\\\"Present Days\\\":\\\"24\\\",\\\"Absent Days\\\":\\\"2\\\",\\\"Working Hours\\\":\\\"192\\\",\\\"Overtime Hours\\\":\\\"4\\\",\\\"Allowances\\\":\\\"0\\\",\\\"Deductions\\\":\\\"0\\\",\\\"Salary Status\\\":\\\"Unpaid\\\",\\\"Payment Date\\\":\\\"\\\",\\\"Notes\\\":\\\"Imported from attendance machine\\\"},{\\\"Employee Code\\\":\\\"EMP002\\\",\\\"Employee Name\\\":\\\"Bobby\\\",\\\"Payroll Month\\\":\\\"2026-07\\\",\\\"Working Days\\\":\\\"26\\\",\\\"Present Days\\\":\\\"25\\\",\\\"Absent Days\\\":\\\"1\\\",\\\"Working Hours\\\":\\\"162\\\",\\\"Overtime Hours\\\":\\\"0\\\",\\\"Allowances\\\":\\\"0\\\",\\\"Deductions\\\":\\\"0\\\",\\\"Salary Status\\\":\\\"Paid\\\",\\\"Payment Date\\\":\\\"\\\",\\\"Notes\\\":\\\"\\\"},{\\\"Employee Code\\\":\\\"EMP003\\\",\\\"Employee Name\\\":\\\"Kumar\\\",\\\"Payroll Month\\\":\\\"2026-07\\\",\\\"Working Days\\\":\\\"28\\\",\\\"Present Days\\\":\\\"28\\\",\\\"Absent Days\\\":\\\"0\\\",\\\"Working Hours\\\":\\\"224\\\",\\\"Overtime Hours\\\":\\\"0\\\",\\\"Allowances\\\":\\\"0\\\",\\\"Deductions\\\":\\\"0\\\",\\\"Salary Status\\\":\\\"Paid\\\",\\\"Payment Date\\\":\\\"\\\",\\\"Notes\\\":\\\"\\\"}],\\\"fileName\\\":\\\"attendance-payroll-template-2026-07.xlsx\\\",\\\"payroll_month\\\":\\\"2026-07\\\",\\\"standard_hours_per_day\\\":8}}\",\"created_at\":\"2026-07-19T08:08:26.000Z\"},{\"id\":31,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"products\",\"action\":\"edit\",\"method\":\"PUT\",\"path\":\"/api/products/13\",\"resource_id\":\"13\",\"status_code\":200,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{\\\"id\\\":\\\"13\\\"},\\\"body\\\":{\\\"name\\\":\\\"Maggi Noodles\\\",\\\"sku\\\":\\\"\\\",\\\"barcode\\\":\\\"\\\",\\\"hsn\\\":\\\"190230\\\",\\\"category\\\":\\\"Cooking Food\\\",\\\"batch_no\\\":\\\"\\\",\\\"manufactured_date\\\":\\\"\\\",\\\"expiry_date\\\":\\\"\\\",\\\"unit\\\":\\\"PCS\\\",\\\"gst\\\":\\\"5\\\",\\\"purchase_price\\\":\\\"0.00\\\",\\\"sellingPrice\\\":\\\"50.00\\\",\\\"mrp\\\":\\\"60.00\\\",\\\"opening_stock\\\":\\\"0.00\\\",\\\"stock\\\":5,\\\"reorder_level\\\":\\\"0.00\\\",\\\"status\\\":\\\"Active\\\"}}\",\"created_at\":\"2026-07-19T09:24:08.000Z\"},{\"id\":32,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"products\",\"action\":\"edit\",\"method\":\"PUT\",\"path\":\"/api/products/12\",\"resource_id\":\"12\",\"status_code\":200,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{\\\"id\\\":\\\"12\\\"},\\\"body\\\":{\\\"name\\\":\\\"Priya Mango pickle\\\",\\\"sku\\\":\\\"PICKLE002\\\",\\\"barcode\\\":\\\"\\\",\\\"hsn\\\":\\\"20019000\\\",\\\"category\\\":\\\"PICKLES\\\",\\\"batch_no\\\":\\\"\\\",\\\"manufactured_date\\\":\\\"\\\",\\\"expiry_date\\\":\\\"\\\",\\\"unit\\\":\\\"PCS\\\",\\\"gst\\\":\\\"12\\\",\\\"purchase_price\\\":\\\"0.00\\\",\\\"sellingPrice\\\":\\\"75.00\\\",\\\"mrp\\\":\\\"80.00\\\",\\\"opening_stock\\\":\\\"0.00\\\",\\\"stock\\\":6,\\\"reorder_level\\\":\\\"0.00\\\",\\\"status\\\":\\\"Active\\\"}}\",\"created_at\":\"2026-07-19T09:26:06.000Z\"},{\"id\":33,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"products\",\"action\":\"edit\",\"method\":\"PUT\",\"path\":\"/api/products/11\",\"resource_id\":\"11\",\"status_code\":200,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{\\\"id\\\":\\\"11\\\"},\\\"body\\\":{\\\"name\\\":\\\"MTR Sambar powder\\\",\\\"sku\\\":\\\"MASALA003\\\",\\\"barcode\\\":\\\"\\\",\\\"hsn\\\":\\\"210610\\\",\\\"category\\\":\\\"Masala Pwder\\\",\\\"batch_no\\\":\\\"\\\",\\\"manufactured_date\\\":\\\"\\\",\\\"expiry_date\\\":\\\"\\\",\\\"unit\\\":\\\"PCS\\\",\\\"gst\\\":\\\"5\\\",\\\"purchase_price\\\":\\\"0.00\\\",\\\"sellingPrice\\\":\\\"10.00\\\",\\\"mrp\\\":\\\"15.00\\\",\\\"opening_stock\\\":\\\"0.00\\\",\\\"stock\\\":12,\\\"reorder_level\\\":\\\"0.00\\\",\\\"status\\\":\\\"Active\\\"}}\",\"created_at\":\"2026-07-19T09:28:44.000Z\"},{\"id\":34,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"products\",\"action\":\"edit\",\"method\":\"PUT\",\"path\":\"/api/products/11\",\"resource_id\":\"11\",\"status_code\":200,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{\\\"id\\\":\\\"11\\\"},\\\"body\\\":{\\\"name\\\":\\\"MTR Sambar powder\\\",\\\"sku\\\":\\\"MASALA003\\\",\\\"barcode\\\":\\\"\\\",\\\"hsn\\\":\\\"210610\\\",\\\"category\\\":\\\"Masala Pwder\\\",\\\"batch_no\\\":\\\"\\\",\\\"manufactured_date\\\":\\\"\\\",\\\"expiry_date\\\":\\\"\\\",\\\"unit\\\":\\\"PCS\\\",\\\"gst\\\":\\\"5\\\",\\\"purchase_price\\\":\\\"0.00\\\",\\\"sellingPrice\\\":\\\"10.00\\\",\\\"mrp\\\":\\\"15.00\\\",\\\"opening_stock\\\":\\\"0.00\\\",\\\"stock\\\":12,\\\"reorder_level\\\":\\\"0.00\\\",\\\"status\\\":\\\"Active\\\"}}\",\"created_at\":\"2026-07-19T09:29:00.000Z\"},{\"id\":35,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"products\",\"action\":\"edit\",\"method\":\"PUT\",\"path\":\"/api/products/10\",\"resource_id\":\"10\",\"status_code\":200,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{\\\"id\\\":\\\"10\\\"},\\\"body\\\":{\\\"name\\\":\\\"Sugar\\\",\\\"sku\\\":\\\"Kit0085\\\",\\\"barcode\\\":\\\"\\\",\\\"hsn\\\":\\\"170410\\\",\\\"category\\\":\\\"Grocery\\\",\\\"batch_no\\\":\\\"\\\",\\\"manufactured_date\\\":\\\"\\\",\\\"expiry_date\\\":\\\"\\\",\\\"unit\\\":\\\"PCS\\\",\\\"gst\\\":\\\"5\\\",\\\"purchase_price\\\":\\\"0.00\\\",\\\"sellingPrice\\\":\\\"78.00\\\",\\\"mrp\\\":\\\"80.00\\\",\\\"opening_stock\\\":\\\"0.00\\\",\\\"stock\\\":5,\\\"reorder_level\\\":\\\"0.00\\\",\\\"status\\\":\\\"Active\\\"}}\",\"created_at\":\"2026-07-19T09:30:34.000Z\"},{\"id\":36,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"products\",\"action\":\"edit\",\"method\":\"PUT\",\"path\":\"/api/products/9\",\"resource_id\":\"9\",\"status_code\":200,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{\\\"id\\\":\\\"9\\\"},\\\"body\\\":{\\\"name\\\":\\\"Tea Powder\\\",\\\"sku\\\":\\\"TEA56\\\",\\\"barcode\\\":\\\"\\\",\\\"hsn\\\":\\\"210111\\\",\\\"category\\\":\\\"Kitchan \\\",\\\"batch_no\\\":\\\"\\\",\\\"manufactured_date\\\":\\\"\\\",\\\"expiry_date\\\":\\\"\\\",\\\"unit\\\":\\\"PCS\\\",\\\"gst\\\":\\\"18.00\\\",\\\"purchase_price\\\":\\\"0.00\\\",\\\"sellingPrice\\\":\\\"50.00\\\",\\\"mrp\\\":\\\"60.00\\\",\\\"opening_stock\\\":\\\"0.00\\\",\\\"stock\\\":18,\\\"reorder_level\\\":\\\"0.00\\\",\\\"status\\\":\\\"Active\\\"}}\",\"created_at\":\"2026-07-19T09:31:39.000Z\"},{\"id\":37,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"products\",\"action\":\"edit\",\"method\":\"PUT\",\"path\":\"/api/products/8\",\"resource_id\":\"8\",\"status_code\":200,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{\\\"id\\\":\\\"8\\\"},\\\"body\\\":{\\\"name\\\":\\\"Oil\\\",\\\"sku\\\":\\\"OIL25\\\",\\\"barcode\\\":\\\"\\\",\\\"hsn\\\":\\\"15121110\\\",\\\"category\\\":\\\"Kitchan\\\",\\\"batch_no\\\":\\\"\\\",\\\"manufactured_date\\\":\\\"\\\",\\\"expiry_date\\\":\\\"\\\",\\\"unit\\\":\\\"PCS\\\",\\\"gst\\\":\\\"12\\\",\\\"purchase_price\\\":\\\"0.00\\\",\\\"sellingPrice\\\":\\\"110.00\\\",\\\"mrp\\\":\\\"120.00\\\",\\\"opening_stock\\\":\\\"15.00\\\",\\\"stock\\\":31,\\\"reorder_level\\\":\\\"0.00\\\",\\\"status\\\":\\\"Active\\\"}}\",\"created_at\":\"2026-07-19T09:34:00.000Z\"},{\"id\":38,\"company_id\":4,\"user_id\":13,\"user_name\":\"Admin\",\"user_role\":\"owner\",\"access_role\":\"owner\",\"module_key\":\"products\",\"action\":\"edit\",\"method\":\"PUT\",\"path\":\"/api/products/7\",\"resource_id\":\"7\",\"status_code\":200,\"ip_address\":\"::1\",\"user_agent\":\"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36\",\"details\":\"{\\\"params\\\":{\\\"id\\\":\\\"7\\\"},\\\"body\\\":{\\\"name\\\":\\\"shampoo\\\",\\\"sku\\\":\\\"Shampoo22\\\",\\\"barcode\\\":\\\"\\\",\\\"hsn\\\":\\\"190230\\\",\\\"category\\\":\\\"Shampoo\\\",\\\"batch_no\\\":\\\"\\\",\\\"manufactured_date\\\":\\\"\\\",\\\"expiry_date\\\":\\\"\\\",\\\"unit\\\":\\\"PCS\\\",\\\"gst\\\":\\\"12\\\",\\\"purchase_price\\\":\\\"0.00\\\",\\\"sellingPrice\\\":\\\"230.00\\\",\\\"mrp\\\":\\\"250.00\\\",\\\"opening_stock\\\":\\\"5.00\\\",\\\"stock\\\":2,\\\"reorder_level\\\":\\\"0.00\\\",\\\"status\\\":\\\"Active\\\"}}\",\"created_at\":\"2026-07-19T09:34:27.000Z\"}],\"data_import_batches\":[{\"id\":1,\"company_id\":4,\"activity_type\":\"Export\",\"data_type\":\"full_backup\",\"file_name\":null,\"row_count\":125,\"created_count\":0,\"updated_count\":0,\"skipped_count\":0,\"affect_stock\":0,\"status\":\"Completed\",\"created_by\":13,\"created_at\":\"2026-07-19T05:00:57.000Z\",\"rolled_back_at\":null},{\"id\":2,\"company_id\":4,\"activity_type\":\"Export\",\"data_type\":\"products\",\"file_name\":null,\"row_count\":11,\"created_count\":0,\"updated_count\":0,\"skipped_count\":0,\"affect_stock\":0,\"status\":\"Completed\",\"created_by\":13,\"created_at\":\"2026-07-19T05:03:04.000Z\",\"rolled_back_at\":null}],\"data_import_changes\":[]},\"table_counts\":{\"company\":1,\"users\":2,\"business_profiles\":1,\"invoice_settings\":1,\"customers\":10,\"vendors\":5,\"products\":11,\"invoices\":10,\"invoice_items\":19,\"payments\":3,\"bills\":15,\"bill_items\":23,\"vendor_payments\":3,\"delivery_challans\":2,\"delivery_challan_items\":4,\"product_returns\":2,\"return_items\":2,\"quotations\":1,\"quotation_items\":1,\"purchase_orders\":2,\"purchase_order_items\":3,\"accounts\":4,\"journal_entries\":2,\"receipt_entries\":0,\"payment_entries\":0,\"expenses\":0,\"payroll_employees\":3,\"payroll_entries\":3,\"payroll_attendance_imports\":5,\"payroll_attendance_lines\":15,\"audit_logs\":38,\"data_import_batches\":2,\"data_import_changes\":0},\"skipped_tables\":[\"receipt_entries\",\"payment_entries\"]}}}','2026-07-19 17:52:24'),(40,4,13,'Admin','owner','owner','customers','create','POST','/api/customers',NULL,201,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"name\":\"krishna\",\"email\":\"krishna4450@gmail.com\",\"phone\":\"9676801453\",\"address\":\"123\"}}','2026-07-20 07:49:04'),(41,4,13,'Admin','owner','owner','invoices','create','POST','/api/invoices',NULL,201,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"invoice_date\":\"2026-07-20\",\"customer_id\":12,\"customer_name\":\"krishna\",\"items\":[{\"product_id\":14,\"name\":\"Water Bottle\",\"quantity\":1,\"unit_price\":50,\"mrp\":60,\"gst_rate\":\"5.00\"},{\"product_id\":16,\"name\":\"5L Cooker\",\"quantity\":1,\"unit_price\":1500,\"mrp\":1500,\"gst_rate\":\"18.00\"}]}}','2026-07-20 07:51:26'),(42,4,13,'Admin','owner','owner','invoices','create','POST','/api/invoices/48/payments','48',201,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"invoiceId\":\"48\"},\"body\":{\"amount\":1822.5,\"payment_date\":\"2026-07-20\",\"payment_method\":\"Cash\",\"reference_number\":\"INV-0012-paid\"}}','2026-07-20 07:53:33'),(43,4,13,'Admin','owner','owner','invoices','edit','PUT','/api/invoices/48/status','48',200,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"48\"},\"body\":{\"status\":\"paid\"}}','2026-07-20 07:54:37'),(44,4,13,'Admin','owner','owner','invoices','edit','PUT','/api/invoices/48/status','48',200,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"48\"},\"body\":{\"status\":\"paid\"}}','2026-07-20 07:54:43'),(45,4,13,'Admin','owner','owner','invoices','edit','PUT','/api/invoices/48/status','48',200,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"48\"},\"body\":{\"status\":\"paid\"}}','2026-07-20 07:54:49'),(46,4,13,'Admin','owner','owner','invoices','edit','PUT','/api/invoices/47/status','47',200,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"47\"},\"body\":{\"status\":\"paid\"}}','2026-07-20 07:54:56'),(47,4,13,'Admin','owner','owner','invoices','edit','PUT','/api/invoices/47/status','47',200,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"47\"},\"body\":{\"status\":\"paid\"}}','2026-07-20 07:55:03'),(48,4,13,'Admin','owner','owner','invoices','edit','PUT','/api/invoices/48/status','48',200,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"48\"},\"body\":{\"status\":\"paid\"}}','2026-07-20 07:55:16'),(49,4,13,'Admin','owner','owner','invoices','edit','PUT','/api/invoices/48/status','48',200,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"48\"},\"body\":{\"status\":\"paid\"}}','2026-07-20 07:55:39'),(50,4,13,'Admin','owner','owner','invoices','edit','PUT','/api/invoices/48/status','48',200,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"48\"},\"body\":{\"status\":\"pending\"}}','2026-07-20 07:55:46'),(51,4,13,'Admin','owner','owner','invoices','edit','PUT','/api/invoices/48/status','48',200,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"48\"},\"body\":{\"status\":\"paid\"}}','2026-07-20 07:55:51'),(52,4,13,'Admin','owner','owner','invoices','edit','PUT','/api/invoices/48/status','48',200,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"48\"},\"body\":{\"status\":\"pending\"}}','2026-07-20 07:56:28'),(53,4,13,'Admin','owner','owner','invoices','edit','PUT','/api/invoices/48/status','48',200,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"48\"},\"body\":{\"status\":\"paid\"}}','2026-07-20 07:56:49'),(54,4,13,'Admin','owner','owner','invoices','create','POST','/api/invoices/46/payments','46',201,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"invoiceId\":\"46\"},\"body\":{\"amount\":189,\"payment_date\":\"2026-07-20\",\"payment_method\":\"Cash\",\"reference_number\":\"INV-0010-paid\"}}','2026-07-20 07:57:07'),(55,4,13,'Admin','owner','owner','invoices','edit','PUT','/api/invoices/46/status','46',200,'::1','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"46\"},\"body\":{\"status\":\"paid\"}}','2026-07-20 07:57:15'),(56,4,13,'Admin','owner','owner','system','edit','PUT','/api/petty-cash/settings',NULL,200,'152.233.15.120','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"fund_name\":\"Main Petty Cash\",\"opening_balance\":\"10000\",\"current_balance\":0,\"imprest_limit\":\"7000\",\"manager_approval_limit\":\"7000\",\"currency_code\":\"\",\"is_active\":1}}','2026-07-27 06:15:06'),(57,4,13,'Admin','owner','owner','system','create','POST','/api/petty-cash/transactions',NULL,201,'152.233.15.123','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"transaction_date\":\"2026-07-27\",\"category\":\"Tea\",\"payee\":\"Cash\",\"description\":\"paid Tea expences\",\"amount\":\"350\",\"payment_method\":\"Cash\",\"reference_no\":\"7358\",\"transaction_type\":\"EXPENSE\"}}','2026-07-27 07:39:51'),(58,4,13,'Admin','owner','owner','system','create','POST','/api/petty-cash/transactions/1/submit','1',200,'152.233.15.123','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"1\"},\"body\":{}}','2026-07-27 07:39:51'),(59,4,13,'Admin','owner','owner','system','create','POST','/api/petty-cash/transactions/1/manager-approve','1',200,'152.233.15.123','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"1\"},\"body\":{}}','2026-07-27 07:40:10'),(60,4,13,'Admin','owner','owner','system','create','POST','/api/petty-cash/transactions/1/accounts-approve','1',200,'152.233.15.123','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"1\"},\"body\":{}}','2026-07-27 07:40:29'),(61,4,13,'Admin','owner','owner','system','create','POST','/api/petty-cash/transactions/1/post','1',200,'152.233.15.123','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"1\"},\"body\":{}}','2026-07-27 07:40:45'),(62,4,13,'Admin','owner','owner','system','create','POST','/api/petty-cash/transactions',NULL,201,'152.233.68.97','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"transaction_date\":\"2026-07-27\",\"category\":\"tea\",\"payee\":\"branch manager\",\"description\":\"petty cash\",\"amount\":\"500\",\"payment_method\":\"Cash\",\"reference_no\":\"16543\",\"transaction_type\":\"EXPENSE\"}}','2026-07-27 08:22:16'),(63,4,13,'Admin','owner','owner','system','create','POST','/api/petty-cash/transactions/2/submit','2',200,'152.233.68.97','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36','{\"params\":{\"id\":\"2\"},\"body\":{}}','2026-07-27 08:22:17'),(64,4,13,'Admin','owner','owner','system','create','POST','/api/petty-cash/transactions/2/manager-approve','2',200,'152.233.68.97','Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36','{\"params\":{\"id\":\"2\"},\"body\":{}}','2026-07-27 08:22:27'),(65,4,13,'Admin','owner','owner','invoices','create','POST','/api/invoices',NULL,201,'152.233.15.121','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"invoice_date\":\"2026-07-27\",\"customer_id\":7,\"customer_name\":\"C2\",\"items\":[{\"product_id\":16,\"name\":\"5L Cooker\",\"quantity\":1,\"unit_price\":1500,\"mrp\":1500,\"discount_type\":\"AMOUNT\",\"discount_value\":300,\"gst_rate\":\"18.00\"}]}}','2026-07-27 08:41:22'),(66,4,13,'Admin','owner','owner','system','create','POST','/api/petty-cash/transactions/2/accounts-approve','2',200,'152.233.68.98','Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36','{\"params\":{\"id\":\"2\"},\"body\":{}}','2026-07-27 13:50:50'),(67,4,13,'Admin','owner','owner','system','create','POST','/api/petty-cash/transactions/2/post','2',200,'152.233.68.98','Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36','{\"params\":{\"id\":\"2\"},\"body\":{}}','2026-07-27 13:50:52'),(68,4,13,'Admin','owner','owner','system','create','POST','/api/petty-cash/transactions',NULL,201,'152.233.15.120','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"transaction_date\":\"2026-07-27\",\"category\":\"Tea\",\"payee\":\"Vsmsi\",\"description\":\"hibhbhl\",\"amount\":\"100\",\"payment_method\":\"Cash\",\"reference_no\":\"\",\"transaction_type\":\"EXPENSE\"}}','2026-07-27 14:01:43'),(69,4,13,'Admin','owner','owner','system','create','POST','/api/petty-cash/transactions/3/submit','3',200,'152.233.15.120','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36','{\"params\":{\"id\":\"3\"},\"body\":{}}','2026-07-27 14:01:44'),(70,4,13,'Admin','owner','owner','system','create','POST','/api/petty-cash/transactions/3/manager-approve','3',200,'152.233.15.120','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36','{\"params\":{\"id\":\"3\"},\"body\":{}}','2026-07-27 14:02:02'),(71,4,13,'Admin','owner','owner','system','create','POST','/api/petty-cash/transactions/3/accounts-approve','3',200,'152.233.15.120','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36','{\"params\":{\"id\":\"3\"},\"body\":{}}','2026-07-27 14:02:10'),(72,4,13,'Admin','owner','owner','system','create','POST','/api/petty-cash/transactions/3/post','3',200,'152.233.15.120','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36','{\"params\":{\"id\":\"3\"},\"body\":{}}','2026-07-27 14:02:14'),(73,4,13,'Admin','owner','owner','accounting','create','POST','/api/receipt-entries',NULL,201,'152.233.68.97','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"receipt_date\":\"2026-07-29\",\"receipt_type\":\"CUSTOMER\",\"customer_id\":\"7\",\"invoice_id\":\"42\",\"received_in_account_id\":\"21\",\"received_from_account_id\":null,\"amount\":611.24,\"payment_mode\":\"Cash\",\"reference_number\":\"\",\"narration\":\"\",\"idempotency_key\":\"07184eae-181f-4727-93cc-8719e4356674\"}}','2026-07-29 14:20:36'),(74,4,13,'Admin','owner','owner','bills','create','POST','/api/bills',NULL,201,'152.233.68.98','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"vendor_id\":\"9\",\"bill_date\":\"2026-07-31\",\"due_date\":\"\",\"items\":[{\"product_id\":\"8\",\"name\":\"Oil\",\"mrp\":\"120.00\",\"qty\":\"5\",\"price\":\"115.00\",\"gst\":\"18\"}],\"bill_number\":\"BILL-0012\"}}','2026-07-31 23:33:49'),(75,4,13,'Admin','owner','owner','bills','create','POST','/api/bills',NULL,201,'152.233.68.97','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"vendor_id\":\"9\",\"bill_date\":\"2026-08-01\",\"due_date\":\"2026-08-08\",\"items\":[{\"product_id\":\"13\",\"name\":\"Maggi Noodles\",\"mrp\":\"60.00\",\"qty\":\"10\",\"price\":\"70.00\",\"gst\":\"12\"}],\"bill_number\":\"BILL-0013\"}}','2026-08-01 00:22:06'),(76,4,13,'Admin','owner','owner','bills','create','POST','/api/vendor-payments',NULL,201,'152.233.15.120','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"vendor_id\":9,\"bill_id\":28,\"amount\":784,\"payment_date\":\"2026-08-01\",\"payment_method\":\"Bank Transfer\",\"paid_from_account_id\":\"21\",\"reference_number\":\"5656259\",\"notes\":\"\",\"idempotency_key\":\"bd540cc9-076a-4127-941b-d618fb5bbb7a\"}}','2026-08-01 18:44:38'),(77,4,13,'Admin','owner','owner','bills','create','POST','/api/vendor-payments',NULL,201,'152.233.15.121','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"vendor_id\":9,\"bill_id\":27,\"amount\":678.5,\"payment_date\":\"2026-08-01\",\"payment_method\":\"Cheque\",\"paid_from_account_id\":\"21\",\"reference_number\":\"55699\",\"notes\":\"\",\"idempotency_key\":\"4ffbff97-da2d-4318-8ff6-203594ee718f\"}}','2026-08-01 18:53:00'),(78,4,13,'Admin','owner','owner','customers','create','POST','/api/customers',NULL,201,'152.233.68.97','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"name\":\"Sudhakar\",\"email\":\"abc@gmail.com\",\"phone\":\"9787878787\",\"address\":\"Borabanda\"}}','2026-08-01 21:10:09'),(79,4,13,'Admin','owner','owner','invoices','create','POST','/api/invoices',NULL,201,'152.233.68.97','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"invoice_date\":\"2026-08-01\",\"customer_id\":13,\"customer_name\":\"Sudhakar\",\"items\":[{\"product_id\":9,\"name\":\"Tea Powder\",\"quantity\":1,\"unit_price\":50,\"mrp\":60,\"discount_type\":\"PERCENT\",\"discount_value\":0,\"gst_rate\":\"18.00\"},{\"product_id\":11,\"name\":\"MTR Sambar powder\",\"quantity\":1,\"unit_price\":10,\"mrp\":15,\"discount_type\":\"PERCENT\",\"discount_value\":0,\"gst_rate\":\"5.00\"},{\"product_id\":8,\"name\":\"Oil\",\"quantity\":1,\"unit_price\":110,\"mrp\":120,\"discount_type\":\"PERCENT\",\"discount_value\":0,\"gst_rate\":\"18.00\"}]}}','2026-08-01 21:10:33'),(80,4,13,'Admin','owner','owner','invoices','create','POST','/api/invoices/50/payments','50',201,'152.233.68.97','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"invoiceId\":\"50\"},\"body\":{\"amount\":99.3,\"payment_date\":\"2026-08-01\",\"payment_method\":\"Cash\",\"reference_number\":\"INV-0014-partial\"}}','2026-08-01 21:13:30'),(81,4,13,'Admin','owner','owner','accounting','create','POST','/api/receipt-entries',NULL,201,'152.233.68.97','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"receipt_date\":\"2026-08-01\",\"receipt_type\":\"CUSTOMER\",\"customer_id\":\"13\",\"invoice_id\":\"50\",\"received_in_account_id\":\"21\",\"received_from_account_id\":null,\"amount\":100,\"payment_mode\":\"UPI\",\"reference_number\":\"88998858\",\"narration\":\"balance amount receievd\",\"idempotency_key\":\"f8a0d6c4-58b0-4042-8c37-350d8938e4a0\"}}','2026-08-01 21:15:27'),(82,4,13,'Admin','owner','owner','bills','create','POST','/api/vendor-payments',NULL,201,'152.233.68.98','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"vendor_id\":9,\"bill_id\":26,\"amount\":7985,\"payment_date\":\"2026-08-03\",\"payment_method\":\"UPI\",\"paid_from_account_id\":\"21\",\"reference_number\":\"55658555\",\"notes\":\"\",\"idempotency_key\":\"bf1196c2-6d8e-43cd-aca4-6746321dc002\"}}','2026-08-03 06:48:48'),(83,4,13,'Admin','owner','owner','bills','create','POST','/api/vendor-payments',NULL,201,'152.233.68.98','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"vendor_id\":9,\"bill_id\":21,\"amount\":349.6,\"payment_date\":\"2026-08-03\",\"payment_method\":\"Cash\",\"paid_from_account_id\":\"20\",\"reference_number\":\"\",\"notes\":\"\",\"idempotency_key\":\"3518c897-aa25-4c12-8d3d-cd451c5c1395\"}}','2026-08-03 06:49:15'),(84,4,13,'Admin','owner','owner','accounting','create','POST','/api/payment-entries',NULL,201,'152.233.15.123','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"payment_date\":\"2026-08-03\",\"paid_from_account_id\":\"21\",\"vendor_id\":\"10\",\"bill_id\":\"25\",\"amount\":5000,\"payment_method\":\"Bank Transfer\",\"reference_number\":\"\",\"notes\":\"\",\"idempotency_key\":\"eb45655b-3cda-4e6e-aa71-f690ed478f98\"}}','2026-08-03 16:07:27'),(85,4,13,'Admin','owner','owner','system','create','POST','/api/barcodes/profiles',NULL,201,'152.233.15.121','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"name\":\"Test Barcode\",\"label_width_mm\":50,\"label_height_mm\":25,\"dpi\":203,\"labels_per_row\":1,\"horizontal_gap_mm\":0,\"vertical_gap_mm\":0,\"margin_top_mm\":0,\"margin_bottom_mm\":0,\"margin_left_mm\":0,\"margin_right_mm\":0,\"paper_type\":\"thermal_roll\",\"is_default\":0}}','2026-08-09 16:09:29'),(86,4,13,'Admin','owner','owner','system','create','POST','/api/barcodes/products/12/barcode','12',200,'152.233.15.121','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"12\"},\"body\":{}}','2026-08-09 17:12:42'),(87,4,13,'Admin','owner','owner','system','create','POST','/api/barcodes/templates',NULL,201,'152.233.15.121','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"name\":\"Retail Standard\",\"label_width_mm\":50,\"label_height_mm\":25,\"template_json\":{\"elements\":[{\"id\":\"barcode\",\"type\":\"barcode\",\"x\":3,\"y\":8,\"w\":44,\"h\":12,\"showValue\":true,\"barcodeType\":\"CODE128\"},{\"id\":\"price\",\"type\":\"selling_price\",\"x\":2,\"y\":21,\"w\":46,\"h\":3,\"fontSize\":9,\"bold\":true,\"align\":\"center\"},{\"id\":\"sku-1786295580592\",\"type\":\"sku\",\"x\":2,\"y\":2,\"w\":20,\"h\":5,\"fontSize\":9,\"align\":\"left\"},{\"id\":\"sku-1786295582017\",\"type\":\"sku\",\"x\":2,\"y\":2,\"w\":20,\"h\":5,\"fontSize\":9,\"align\":\"left\"},{\"id\":\"sku-1786295582960\",\"type\":\"sku\",\"x\":2,\"y\":2,\"w\":20,\"h\":5,\"fontSize\":9,\"align\":\"left\"},{\"id\":\"product_name-1786295635440\",\"type\":\"product_name\",\"x\":2,\"y\":2,\"w\":20,\"h\":5,\"fontSize\":9,\"align\":\"left\"}]},\"is_default\":0}}','2026-08-09 17:17:42'),(88,4,13,'Admin','owner','owner','system','edit','PUT','/api/barcodes/templates/1','1',200,'152.233.15.121','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"1\"},\"body\":{\"name\":\"Retail Standard\",\"label_width_mm\":50,\"label_height_mm\":25,\"template_json\":{\"elements\":[{\"h\":12,\"w\":44,\"x\":3,\"y\":8,\"id\":\"barcode\",\"type\":\"barcode\",\"showValue\":true,\"barcodeType\":\"CODE128\"},{\"h\":3,\"w\":46,\"x\":2,\"y\":21,\"id\":\"price\",\"bold\":true,\"type\":\"selling_price\",\"align\":\"center\",\"fontSize\":9},{\"h\":5,\"w\":20,\"x\":2,\"y\":2,\"id\":\"sku-1786295580592\",\"type\":\"sku\",\"align\":\"left\",\"fontSize\":9},{\"h\":5,\"w\":20,\"x\":2,\"y\":2,\"id\":\"sku-1786295582017\",\"type\":\"sku\",\"align\":\"left\",\"fontSize\":9},{\"h\":5,\"w\":20,\"x\":2,\"y\":2,\"id\":\"sku-1786295582960\",\"type\":\"sku\",\"align\":\"left\",\"fontSize\":9},{\"h\":5,\"w\":20,\"x\":2,\"y\":2,\"id\":\"product_name-1786295635440\",\"type\":\"product_name\",\"align\":\"right\",\"fontSize\":9,\"bold\":false}]},\"is_default\":0}}','2026-08-09 17:32:31'),(89,4,13,'Admin','owner','owner','system','edit','PUT','/api/barcodes/templates/1','1',200,'152.233.15.121','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"1\"},\"body\":{\"name\":\"Retail Standard\",\"label_width_mm\":50,\"label_height_mm\":25,\"template_json\":{\"elements\":[{\"h\":12,\"w\":44,\"x\":3,\"y\":8,\"id\":\"barcode\",\"type\":\"barcode\",\"showValue\":true,\"barcodeType\":\"CODE128\"},{\"h\":3,\"w\":46,\"x\":2,\"y\":21,\"id\":\"price\",\"bold\":true,\"type\":\"selling_price\",\"align\":\"center\",\"fontSize\":9},{\"h\":5,\"w\":20,\"x\":2,\"y\":2,\"id\":\"sku-1786295580592\",\"type\":\"sku\",\"align\":\"left\",\"fontSize\":9},{\"h\":5,\"w\":20,\"x\":2,\"y\":2,\"id\":\"sku-1786295582017\",\"type\":\"sku\",\"align\":\"left\",\"fontSize\":9},{\"h\":5,\"w\":20,\"x\":2,\"y\":2,\"id\":\"sku-1786295582960\",\"type\":\"sku\",\"align\":\"left\",\"fontSize\":9},{\"h\":5,\"w\":20,\"x\":2,\"y\":2,\"id\":\"product_name-1786295635440\",\"type\":\"product_name\",\"align\":\"right\",\"fontSize\":9,\"bold\":false}]},\"is_default\":0}}','2026-08-09 17:32:45'),(90,4,13,'Admin','owner','owner','system','edit','PUT','/api/barcodes/templates/1','1',200,'152.233.15.121','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"1\"},\"body\":{\"name\":\"Retail Standard\",\"label_width_mm\":50,\"label_height_mm\":25,\"template_json\":{\"elements\":[{\"h\":12,\"w\":44,\"x\":3,\"y\":8,\"id\":\"barcode\",\"type\":\"barcode\",\"showValue\":true,\"barcodeType\":\"CODE128\"},{\"h\":3,\"w\":46,\"x\":2,\"y\":21,\"id\":\"price\",\"bold\":true,\"type\":\"selling_price\",\"align\":\"center\",\"fontSize\":9},{\"h\":5,\"w\":20,\"x\":2,\"y\":2,\"id\":\"sku-1786295580592\",\"type\":\"sku\",\"align\":\"left\",\"fontSize\":9},{\"h\":5,\"w\":20,\"x\":2,\"y\":2,\"id\":\"sku-1786295582017\",\"type\":\"sku\",\"align\":\"left\",\"fontSize\":9},{\"h\":5,\"w\":20,\"x\":2,\"y\":2,\"id\":\"sku-1786295582960\",\"type\":\"sku\",\"align\":\"left\",\"fontSize\":9},{\"h\":5,\"w\":20,\"x\":2,\"y\":2,\"id\":\"product_name-1786295635440\",\"type\":\"product_name\",\"align\":\"right\",\"fontSize\":9,\"bold\":false}]},\"is_default\":0}}','2026-08-09 17:32:56'),(91,4,13,'Admin','owner','owner','system','create','POST','/api/barcodes/templates',NULL,201,'152.233.15.121','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"name\":\"New Label Template\",\"label_width_mm\":50,\"label_height_mm\":25,\"template_json\":{\"elements\":[{\"id\":\"name\",\"type\":\"product_name\",\"x\":2,\"y\":2,\"w\":46,\"h\":5,\"fontSize\":10,\"bold\":true,\"align\":\"center\"},{\"id\":\"barcode\",\"type\":\"barcode\",\"x\":3,\"y\":8,\"w\":44,\"h\":12,\"showValue\":true,\"barcodeType\":\"CODE128\"},{\"id\":\"price\",\"type\":\"selling_price\",\"x\":2,\"y\":21,\"w\":46,\"h\":3,\"fontSize\":9,\"bold\":true,\"align\":\"center\"}]},\"is_default\":0}}','2026-08-09 17:33:21'),(92,4,13,'Admin','owner','owner','system','create','POST','/api/barcodes/products/11/barcode','11',200,'152.233.15.120','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"11\"},\"body\":{}}','2026-08-09 17:52:51'),(93,4,13,'Admin','owner','owner','system','create','POST','/api/barcodes/products/10/barcode','10',200,'152.233.15.120','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"10\"},\"body\":{}}','2026-08-09 17:52:58'),(94,4,13,'Admin','owner','owner','system','edit','PUT','/api/barcodes/templates/1','1',200,'152.233.15.120','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"1\"},\"body\":{\"name\":\"Retail Standard\",\"label_width_mm\":50,\"label_height_mm\":25,\"template_json\":{\"version\":2,\"elements\":[{\"h\":12,\"w\":44,\"x\":3,\"y\":8,\"id\":\"barcode\",\"type\":\"barcode\",\"showValue\":true,\"barcodeType\":\"CODE128\"},{\"h\":3,\"w\":22.89,\"x\":1.11,\"y\":20.44,\"id\":\"price\",\"bold\":true,\"type\":\"selling_price\",\"align\":\"center\",\"fontSize\":9},{\"h\":5,\"w\":20,\"x\":2,\"y\":2,\"id\":\"sku-1786295580592\",\"type\":\"sku\",\"align\":\"left\",\"fontSize\":9},{\"h\":5,\"w\":20,\"x\":2,\"y\":2,\"id\":\"sku-1786295582017\",\"type\":\"sku\",\"align\":\"left\",\"fontSize\":9},{\"h\":5,\"w\":20,\"x\":1.78,\"y\":1.78,\"id\":\"sku-1786295582960\",\"type\":\"sku\",\"align\":\"left\",\"fontSize\":9},{\"h\":5,\"w\":20,\"x\":23.56,\"y\":1.56,\"id\":\"product_name-1786295635440\",\"bold\":false,\"type\":\"product_name\",\"align\":\"right\",\"fontSize\":9},{\"id\":\"selling_price-1786299183228\",\"type\":\"selling_price\",\"x\":30,\"y\":19.56,\"w\":17.78,\"h\":4.56,\"fontSize\":9,\"align\":\"left\",\"zIndex\":6}]},\"is_default\":0}}','2026-08-09 18:16:19'),(95,4,13,'Admin','owner','owner','system','edit','PUT','/api/barcodes/templates/1','1',200,'152.233.15.120','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"1\"},\"body\":{\"name\":\"Retail Standard\",\"label_width_mm\":50,\"label_height_mm\":25,\"template_json\":{\"version\":2,\"elements\":[{\"h\":12,\"w\":44,\"x\":3,\"y\":8,\"id\":\"barcode\",\"type\":\"barcode\",\"showValue\":true,\"barcodeType\":\"CODE128\"},{\"h\":3,\"w\":22.89,\"x\":1.11,\"y\":20.44,\"id\":\"price\",\"bold\":true,\"type\":\"selling_price\",\"align\":\"center\",\"fontSize\":9},{\"h\":5,\"w\":20,\"x\":2,\"y\":2,\"id\":\"sku-1786295580592\",\"type\":\"sku\",\"align\":\"left\",\"fontSize\":9},{\"h\":5,\"w\":20,\"x\":2,\"y\":2,\"id\":\"sku-1786295582017\",\"type\":\"sku\",\"align\":\"left\",\"fontSize\":9},{\"h\":5,\"w\":20,\"x\":1.78,\"y\":1.78,\"id\":\"sku-1786295582960\",\"type\":\"sku\",\"align\":\"left\",\"fontSize\":9},{\"h\":5.89,\"w\":31.33,\"x\":16,\"y\":2.01,\"id\":\"product_name-1786295635440\",\"bold\":false,\"type\":\"product_name\",\"align\":\"right\",\"fontSize\":9},{\"h\":4.56,\"w\":17.78,\"x\":30,\"y\":19.56,\"id\":\"selling_price-1786299183228\",\"type\":\"selling_price\",\"align\":\"left\",\"zIndex\":6,\"fontSize\":9}]},\"is_default\":0}}','2026-08-09 18:17:19'),(96,4,13,'Admin','owner','owner','system','edit','PUT','/api/barcodes/templates/1','1',200,'152.233.15.120','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"1\"},\"body\":{\"name\":\"Retail Standard\",\"label_width_mm\":50,\"label_height_mm\":25,\"template_json\":{\"version\":2,\"elements\":[{\"h\":12,\"w\":44,\"x\":3,\"y\":8,\"id\":\"barcode\",\"type\":\"barcode\",\"showValue\":true,\"barcodeType\":\"CODE128\"},{\"h\":3,\"w\":22.89,\"x\":1.11,\"y\":20.44,\"id\":\"price\",\"bold\":true,\"type\":\"selling_price\",\"align\":\"center\",\"fontSize\":9},{\"h\":5,\"w\":20,\"x\":2,\"y\":2,\"id\":\"sku-1786295580592\",\"type\":\"sku\",\"align\":\"left\",\"fontSize\":9},{\"h\":5,\"w\":20,\"x\":2,\"y\":2,\"id\":\"sku-1786295582017\",\"type\":\"sku\",\"align\":\"left\",\"fontSize\":9},{\"h\":5,\"w\":20,\"x\":1.78,\"y\":1.78,\"id\":\"sku-1786295582960\",\"type\":\"sku\",\"align\":\"left\",\"fontSize\":9},{\"h\":5.89,\"w\":31.33,\"x\":16,\"y\":2.01,\"id\":\"product_name-1786295635440\",\"bold\":false,\"type\":\"product_name\",\"align\":\"right\",\"fontSize\":9},{\"h\":4.56,\"w\":17.78,\"x\":30,\"y\":19.56,\"id\":\"selling_price-1786299183228\",\"type\":\"selling_price\",\"align\":\"left\",\"zIndex\":6,\"fontSize\":9}]},\"is_default\":0}}','2026-08-09 18:26:16'),(97,4,13,'Admin','owner','owner','system','edit','PUT','/api/barcodes/templates/1','1',200,'152.233.15.120','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"1\"},\"body\":{\"name\":\"Retail Standard\",\"label_width_mm\":50,\"label_height_mm\":25,\"template_json\":{\"version\":2,\"elements\":[{\"h\":11.56,\"w\":46.44,\"x\":1.22,\"y\":8,\"id\":\"barcode\",\"type\":\"barcode\",\"showValue\":true,\"barcodeType\":\"CODE128\"},{\"h\":3,\"w\":22.89,\"x\":1.11,\"y\":20.44,\"id\":\"price\",\"bold\":true,\"type\":\"selling_price\",\"align\":\"center\",\"fontSize\":9},{\"h\":5,\"w\":20,\"x\":2,\"y\":2,\"id\":\"sku-1786295580592\",\"type\":\"sku\",\"align\":\"left\",\"fontSize\":9},{\"h\":5,\"w\":20,\"x\":2,\"y\":2,\"id\":\"sku-1786295582017\",\"type\":\"sku\",\"align\":\"left\",\"fontSize\":9},{\"h\":5,\"w\":20,\"x\":1.78,\"y\":1.78,\"id\":\"sku-1786295582960\",\"type\":\"sku\",\"align\":\"left\",\"fontSize\":9},{\"h\":5.89,\"w\":31.33,\"x\":16,\"y\":2.01,\"id\":\"product_name-1786295635440\",\"bold\":false,\"type\":\"product_name\",\"align\":\"right\",\"fontSize\":9},{\"h\":4.56,\"w\":17.78,\"x\":30,\"y\":19.56,\"id\":\"selling_price-1786299183228\",\"type\":\"selling_price\",\"align\":\"left\",\"zIndex\":6,\"fontSize\":9}]},\"is_default\":0}}','2026-08-09 18:28:38'),(98,4,13,'Admin','owner','owner','system','edit','PUT','/api/barcodes/templates/1','1',200,'152.233.15.120','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"1\"},\"body\":{\"name\":\"Retail Standard\",\"label_width_mm\":50,\"label_height_mm\":25,\"template_json\":{\"version\":2,\"elements\":[{\"h\":11.56,\"w\":46.44,\"x\":1.22,\"y\":8,\"id\":\"barcode\",\"type\":\"barcode\",\"showValue\":true,\"barcodeType\":\"CODE128\"},{\"h\":3,\"w\":22.89,\"x\":1.11,\"y\":20.44,\"id\":\"price\",\"bold\":true,\"type\":\"selling_price\",\"align\":\"center\",\"fontSize\":9},{\"h\":5,\"w\":20,\"x\":2,\"y\":2,\"id\":\"sku-1786295580592\",\"type\":\"sku\",\"align\":\"left\",\"fontSize\":9},{\"h\":5,\"w\":20,\"x\":2,\"y\":2,\"id\":\"sku-1786295582017\",\"type\":\"sku\",\"align\":\"left\",\"fontSize\":9},{\"h\":5,\"w\":20,\"x\":1.78,\"y\":1.78,\"id\":\"sku-1786295582960\",\"type\":\"sku\",\"align\":\"left\",\"fontSize\":9},{\"h\":5.89,\"w\":31.33,\"x\":16,\"y\":2.01,\"id\":\"product_name-1786295635440\",\"bold\":false,\"type\":\"product_name\",\"align\":\"right\",\"fontSize\":9},{\"h\":4.56,\"w\":17.78,\"x\":30,\"y\":19.56,\"id\":\"selling_price-1786299183228\",\"type\":\"selling_price\",\"align\":\"left\",\"zIndex\":6,\"fontSize\":9}]},\"is_default\":0}}','2026-08-09 18:30:50'),(99,4,13,'Admin','owner','owner','system','edit','PUT','/api/barcodes/templates/7','7',200,'152.233.15.120','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"7\"},\"body\":{\"name\":\"New Label Template\",\"label_width_mm\":50,\"label_height_mm\":25,\"template_json\":{\"version\":2,\"elements\":[{\"h\":5,\"w\":46,\"x\":2,\"y\":2,\"id\":\"name\",\"bold\":true,\"type\":\"product_name\",\"align\":\"center\",\"fontSize\":10},{\"h\":12,\"w\":44,\"x\":3,\"y\":8,\"id\":\"barcode\",\"type\":\"barcode\",\"showValue\":true,\"barcodeType\":\"CODE128\"},{\"h\":3,\"w\":46,\"x\":2,\"y\":21,\"id\":\"price\",\"bold\":true,\"type\":\"selling_price\",\"align\":\"center\",\"fontSize\":9}]},\"is_default\":0}}','2026-08-09 18:30:59'),(100,4,13,'Admin','owner','owner','system','edit','PUT','/api/barcodes/templates/1','1',200,'152.233.15.120','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{\"id\":\"1\"},\"body\":{\"name\":\"Retail Standard\",\"label_width_mm\":50,\"label_height_mm\":25,\"template_json\":{\"version\":2,\"elements\":[{\"h\":11.56,\"w\":46.44,\"x\":1.22,\"y\":8,\"id\":\"barcode\",\"type\":\"barcode\",\"showValue\":true,\"barcodeType\":\"CODE128\"},{\"h\":3,\"w\":22.89,\"x\":1.11,\"y\":20.44,\"id\":\"price\",\"bold\":true,\"type\":\"selling_price\",\"align\":\"center\",\"fontSize\":9},{\"h\":5,\"w\":20,\"x\":2,\"y\":2,\"id\":\"sku-1786295580592\",\"type\":\"sku\",\"align\":\"left\",\"fontSize\":9},{\"h\":5,\"w\":20,\"x\":2,\"y\":2,\"id\":\"sku-1786295582017\",\"type\":\"sku\",\"align\":\"left\",\"fontSize\":9},{\"h\":5,\"w\":20,\"x\":1.78,\"y\":1.78,\"id\":\"sku-1786295582960\",\"type\":\"sku\",\"align\":\"left\",\"fontSize\":9},{\"h\":5.89,\"w\":31.33,\"x\":16.22,\"y\":2.23,\"id\":\"product_name-1786295635440\",\"bold\":false,\"type\":\"product_name\",\"align\":\"right\",\"fontSize\":9},{\"h\":4.56,\"w\":17.78,\"x\":30,\"y\":19.56,\"id\":\"selling_price-1786299183228\",\"type\":\"selling_price\",\"align\":\"left\",\"zIndex\":6,\"fontSize\":9}]},\"is_default\":0}}','2026-08-09 18:37:39'),(101,4,13,'Admin','owner','owner','customers','create','POST','/api/customers',NULL,201,'152.233.15.120','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36','{\"params\":{},\"body\":{\"name\":\"Ramki\",\"email\":null,\"phone\":null,\"address\":null}}','2026-08-10 02:06:31');
/*!40000 ALTER TABLE `audit_logs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `auth_users`
--

DROP TABLE IF EXISTS `auth_users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `auth_users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `email` varchar(100) NOT NULL,
  `password` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `auth_users`
--

LOCK TABLES `auth_users` WRITE;
/*!40000 ALTER TABLE `auth_users` DISABLE KEYS */;
INSERT INTO `auth_users` VALUES (1,'Auth User','auth@test.com','123456','2026-02-01 19:47:10');
/*!40000 ALTER TABLE `auth_users` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `barcode_settings`
--

DROP TABLE IF EXISTS `barcode_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `barcode_settings` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint unsigned NOT NULL,
  `default_barcode_type` varchar(20) NOT NULL DEFAULT 'CODE128',
  `show_barcode_text` tinyint(1) NOT NULL DEFAULT '1',
  `barcode_height_mm` decimal(8,2) NOT NULL DEFAULT '12.00',
  `barcode_scale` decimal(8,2) NOT NULL DEFAULT '2.00',
  `barcode_rotation` smallint NOT NULL DEFAULT '0',
  `default_label_width_mm` decimal(8,2) NOT NULL DEFAULT '50.00',
  `default_label_height_mm` decimal(8,2) NOT NULL DEFAULT '25.00',
  `labels_per_row` int NOT NULL DEFAULT '1',
  `horizontal_gap_mm` decimal(8,2) NOT NULL DEFAULT '0.00',
  `vertical_gap_mm` decimal(8,2) NOT NULL DEFAULT '0.00',
  `margin_top_mm` decimal(8,2) NOT NULL DEFAULT '0.00',
  `margin_bottom_mm` decimal(8,2) NOT NULL DEFAULT '0.00',
  `margin_left_mm` decimal(8,2) NOT NULL DEFAULT '0.00',
  `margin_right_mm` decimal(8,2) NOT NULL DEFAULT '0.00',
  `paper_type` varchar(30) NOT NULL DEFAULT 'thermal_roll',
  `default_dpi` int NOT NULL DEFAULT '203',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_barcode_settings_company` (`company_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `barcode_settings`
--

LOCK TABLES `barcode_settings` WRITE;
/*!40000 ALTER TABLE `barcode_settings` DISABLE KEYS */;
/*!40000 ALTER TABLE `barcode_settings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `barcode_templates`
--

DROP TABLE IF EXISTS `barcode_templates`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `barcode_templates` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint unsigned NOT NULL,
  `name` varchar(150) NOT NULL,
  `label_width_mm` decimal(8,2) NOT NULL,
  `label_height_mm` decimal(8,2) NOT NULL,
  `template_json` json NOT NULL,
  `is_default` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_barcode_template_company_name` (`company_id`,`name`),
  KEY `idx_barcode_templates_company` (`company_id`)
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `barcode_templates`
--

LOCK TABLES `barcode_templates` WRITE;
/*!40000 ALTER TABLE `barcode_templates` DISABLE KEYS */;
INSERT INTO `barcode_templates` VALUES (1,4,'Retail Standard',50.00,25.00,'{\"version\": 2, \"elements\": [{\"h\": 11.56, \"w\": 46.44, \"x\": 1.22, \"y\": 8, \"id\": \"barcode\", \"type\": \"barcode\", \"showValue\": true, \"barcodeType\": \"CODE128\"}, {\"h\": 3, \"w\": 22.89, \"x\": 1.11, \"y\": 20.44, \"id\": \"price\", \"bold\": true, \"type\": \"selling_price\", \"align\": \"center\", \"fontSize\": 9}, {\"h\": 5, \"w\": 20, \"x\": 2, \"y\": 2, \"id\": \"sku-1786295580592\", \"type\": \"sku\", \"align\": \"left\", \"fontSize\": 9}, {\"h\": 5, \"w\": 20, \"x\": 2, \"y\": 2, \"id\": \"sku-1786295582017\", \"type\": \"sku\", \"align\": \"left\", \"fontSize\": 9}, {\"h\": 5, \"w\": 20, \"x\": 1.78, \"y\": 1.78, \"id\": \"sku-1786295582960\", \"type\": \"sku\", \"align\": \"left\", \"fontSize\": 9}, {\"h\": 5.89, \"w\": 31.33, \"x\": 16.22, \"y\": 2.23, \"id\": \"product_name-1786295635440\", \"bold\": false, \"type\": \"product_name\", \"align\": \"right\", \"fontSize\": 9}, {\"h\": 4.56, \"w\": 17.78, \"x\": 30, \"y\": 19.56, \"id\": \"selling_price-1786299183228\", \"type\": \"selling_price\", \"align\": \"left\", \"zIndex\": 6, \"fontSize\": 9}]}',0,'2026-08-09 17:17:42','2026-08-09 18:37:39'),(7,4,'New Label Template',50.00,25.00,'{\"version\": 2, \"elements\": [{\"h\": 5, \"w\": 46, \"x\": 2, \"y\": 2, \"id\": \"name\", \"bold\": true, \"type\": \"product_name\", \"align\": \"center\", \"fontSize\": 10}, {\"h\": 12, \"w\": 44, \"x\": 3, \"y\": 8, \"id\": \"barcode\", \"type\": \"barcode\", \"showValue\": true, \"barcodeType\": \"CODE128\"}, {\"h\": 3, \"w\": 46, \"x\": 2, \"y\": 21, \"id\": \"price\", \"bold\": true, \"type\": \"selling_price\", \"align\": \"center\", \"fontSize\": 9}]}',0,'2026-08-09 17:33:21','2026-08-09 18:30:59');
/*!40000 ALTER TABLE `barcode_templates` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `bill_items`
--

DROP TABLE IF EXISTS `bill_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bill_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `bill_id` int DEFAULT NULL,
  `product_id` int DEFAULT NULL,
  `product_name` varchar(255) DEFAULT NULL,
  `quantity` int DEFAULT NULL,
  `price` decimal(10,2) DEFAULT NULL,
  `total` decimal(10,2) DEFAULT NULL,
  `gst_percent` decimal(5,2) DEFAULT '0.00',
  `cgst` decimal(10,2) DEFAULT '0.00',
  `sgst` decimal(10,2) DEFAULT '0.00',
  `mrp` decimal(10,2) NOT NULL DEFAULT '0.00',
  PRIMARY KEY (`id`),
  KEY `bill_id` (`bill_id`),
  CONSTRAINT `bill_items_ibfk_1` FOREIGN KEY (`bill_id`) REFERENCES `bills` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=42 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `bill_items`
--

LOCK TABLES `bill_items` WRITE;
/*!40000 ALTER TABLE `bill_items` DISABLE KEYS */;
INSERT INTO `bill_items` VALUES (1,1,NULL,'Laptop',2,50000.00,100000.00,0.00,0.00,0.00,0.00),(2,1,NULL,'Mouse',5,500.00,2500.00,0.00,0.00,0.00,0.00),(3,2,NULL,'laptop',10,0.00,0.00,0.00,0.00,0.00,0.00),(4,3,NULL,'Cement',10,500.00,5000.00,0.00,0.00,0.00,0.00),(5,4,NULL,'Laptop',1,50000.00,50000.00,0.00,0.00,0.00,0.00),(6,5,NULL,'coffee bag',10,10.00,100.00,0.00,0.00,0.00,0.00),(7,6,NULL,'Gas stove ',10,5000.00,50000.00,0.00,0.00,0.00,0.00),(10,7,NULL,'Iron Box',25,1500.00,37500.00,0.00,0.00,0.00,0.00),(11,8,NULL,'Rice bag',10,100.00,1180.00,18.00,90.00,90.00,0.00),(12,9,2,'Notebook',15,30.00,531.00,18.00,40.50,40.50,0.00),(13,10,2,'Notebook',10,30.00,354.00,18.00,27.00,27.00,0.00),(14,11,2,'Notebook',10,30.00,354.00,18.00,27.00,27.00,0.00),(15,12,2,'Notebook',50,30.00,1770.00,18.00,135.00,135.00,0.00),(16,13,2,'Notebook',50,50.00,2950.00,18.00,225.00,225.00,0.00),(17,14,4,'shampoo',50,200.00,11800.00,18.00,900.00,900.00,0.00),(18,15,5,'Toothbrush',5,20.00,118.00,18.00,9.00,9.00,0.00),(22,18,8,'Oil',10,115.00,1357.00,18.00,103.50,103.50,0.00),(23,19,10,'Sugar',6,70.00,495.60,18.00,37.80,37.80,0.00),(24,19,9,'Tea Powder',10,50.00,590.00,18.00,45.00,45.00,0.00),(25,20,9,'Tea Powder',10,40.00,472.00,18.00,36.00,36.00,0.00),(26,16,8,'Oil',10,100.00,1180.00,18.00,90.00,90.00,0.00),(27,21,13,'Maggi Noodles',5,70.00,413.00,18.00,31.50,31.50,0.00),(28,21,12,'Priya Mango pickle',5,60.00,354.00,18.00,27.00,27.00,0.00),(29,21,11,'MTR Sambar powder',10,7.00,82.60,18.00,6.30,6.30,0.00),(30,22,13,'Maggi Noodles',3,70.00,247.80,18.00,18.90,18.90,0.00),(31,22,12,'Priya Mango pickle',3,60.00,212.40,18.00,16.20,16.20,0.00),(32,23,11,'MTR Sambar powder',2,7.00,16.52,18.00,1.26,1.26,15.00),(33,23,8,'Oil',2,115.00,271.40,18.00,20.70,20.70,120.00),(34,24,14,'Water Bottle',10,12.00,126.00,5.00,3.00,3.00,60.00),(35,24,15,'Cups',10,30.00,315.00,5.00,7.50,7.50,50.00),(36,25,17,'Induction Stove',5,2500.00,14750.00,18.00,1125.00,1125.00,3000.00),(37,25,16,'5L Cooker',7,1300.00,10738.00,18.00,819.00,819.00,1500.00),(38,26,16,'5L Cooker',5,1300.00,7670.00,18.00,585.00,585.00,1500.00),(39,26,15,'Cups',10,30.00,315.00,5.00,7.50,7.50,50.00),(40,27,8,'Oil',5,115.00,678.50,18.00,51.75,51.75,120.00),(41,28,13,'Maggi Noodles',10,70.00,784.00,12.00,42.00,42.00,60.00);
/*!40000 ALTER TABLE `bill_items` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `bills`
--

DROP TABLE IF EXISTS `bills`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `bills` (
  `id` int NOT NULL AUTO_INCREMENT,
  `bill_number` varchar(50) NOT NULL,
  `bill_date` date NOT NULL,
  `due_date` date DEFAULT NULL,
  `total_amount` decimal(10,2) DEFAULT '0.00',
  `paid_amount` decimal(15,2) NOT NULL DEFAULT '0.00',
  `due_amount` decimal(15,2) NOT NULL DEFAULT '0.00',
  `status` varchar(30) NOT NULL DEFAULT 'Unpaid',
  `company_id` int NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `vendor_id` int DEFAULT NULL,
  `source_purchase_order_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_vendor` (`vendor_id`),
  KEY `idx_bills_company_id` (`company_id`),
  CONSTRAINT `bills_ibfk_1` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`),
  CONSTRAINT `fk_vendor` FOREIGN KEY (`vendor_id`) REFERENCES `vendors` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=29 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `bills`
--

LOCK TABLES `bills` WRITE;
/*!40000 ALTER TABLE `bills` DISABLE KEYS */;
INSERT INTO `bills` VALUES (1,'BILL-001','2026-03-01','2026-03-10',102500.00,102500.00,0.00,'Paid',5,'2026-03-01 11:15:37',NULL,NULL),(2,'01','2026-03-02','2026-03-04',0.00,0.00,0.00,'Paid',4,'2026-03-02 09:00:08',NULL,NULL),(3,'BILL-002','2026-03-03','2026-03-10',5000.00,0.00,5000.00,'Unpaid',6,'2026-03-03 10:21:47',1,NULL),(4,'B1002','2026-03-05','2026-03-20',50000.00,0.00,50000.00,'Unpaid',7,'2026-03-05 07:42:01',1,NULL),(5,'266625','2026-04-06','2026-04-06',100.00,0.00,100.00,'Unpaid',4,'2026-04-06 23:33:02',3,NULL),(6,'25656','2026-04-06','2026-04-07',50000.00,0.00,50000.00,'Unpaid',4,'2026-04-06 23:33:51',3,NULL),(7,'556586','2026-03-31','2026-04-06',37500.00,0.00,37500.00,'Unpaid',4,'2026-04-06 23:35:52',2,NULL),(8,'585656','2026-04-12','2026-04-13',1180.00,0.00,1180.00,'Unpaid',4,'2026-04-12 20:12:09',5,NULL),(9,'2252','2026-04-24','2026-05-01',531.00,0.00,531.00,'Unpaid',1,'2026-04-27 02:31:52',5,NULL),(10,'2525','2026-04-25',NULL,354.00,0.00,354.00,'Unpaid',1,'2026-04-27 02:32:54',5,NULL),(11,'22563','2026-04-22','2026-05-08',354.00,0.00,354.00,'Unpaid',1,'2026-04-27 02:49:29',5,NULL),(12,'8685','2026-04-27',NULL,1770.00,0.00,1770.00,'Unpaid',1,'2026-04-27 02:56:34',5,NULL),(13,'5444568','2026-04-24','2026-04-29',2950.00,0.00,2950.00,'Unpaid',1,'2026-04-27 06:30:15',5,NULL),(14,'7859','2026-04-27','2026-05-01',11800.00,0.00,11800.00,'Unpaid',1,'2026-04-27 06:31:01',3,NULL),(15,'55658','2026-05-01','2026-05-06',118.00,0.00,118.00,'Unpaid',1,'2026-05-01 07:26:32',5,NULL),(16,'BILL-0001','2026-07-12','2026-07-30',1180.00,0.00,1180.00,'Unpaid',4,'2026-07-13 17:43:20',6,NULL),(18,'BILL-0003','2026-07-13','2026-07-30',1357.00,0.00,1357.00,'Unpaid',4,'2026-07-13 18:36:16',7,NULL),(19,'BILL-0004','2026-07-14','2026-07-30',1085.60,1085.60,0.00,'Paid',4,'2026-07-14 03:19:45',6,NULL),(20,'BILL-0005','2026-07-14','2026-07-31',472.00,272.00,200.00,'Partial Paid',4,'2026-07-14 07:51:43',8,NULL),(21,'BILL-0006','2026-07-15',NULL,849.60,849.60,0.00,'Paid',4,'2026-07-15 06:45:11',9,NULL),(22,'BILL-0007','2026-07-15',NULL,460.20,460.20,0.00,'Paid',4,'2026-07-15 06:46:05',9,NULL),(23,'BILL-0008','2026-07-15',NULL,287.92,0.00,287.92,'Unpaid',4,'2026-07-15 07:31:26',8,NULL),(24,'BILL-0009','2026-07-16',NULL,441.00,441.00,0.00,'Paid',4,'2026-07-16 06:20:34',10,NULL),(25,'BILL-0010','2026-07-16',NULL,25488.00,20000.00,5488.00,'Partial Paid',4,'2026-07-16 06:25:50',10,NULL),(26,'BILL-0011','2026-07-18',NULL,7985.00,7985.00,0.00,'Paid',4,'2026-07-18 11:20:13',9,2),(27,'BILL-0012','2026-07-31',NULL,678.50,678.50,0.00,'Paid',4,'2026-07-31 23:33:49',9,NULL),(28,'BILL-0013','2026-08-01','2026-08-08',784.00,784.00,0.00,'Paid',4,'2026-08-01 00:22:06',9,NULL);
/*!40000 ALTER TABLE `bills` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `branches`
--

DROP TABLE IF EXISTS `branches`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `branches` (
  `id` int NOT NULL AUTO_INCREMENT,
  `company_id` int NOT NULL,
  `name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `code` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `branch_type` enum('HEAD_OFFICE','BRANCH','STORE','WAREHOUSE') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'BRANCH',
  `phone` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(190) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `address` text COLLATE utf8mb4_unicode_ci,
  `city` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `state` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pincode` varchar(12) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `gstin` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_head_office` tinyint(1) NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_company_branch_code` (`company_id`,`code`),
  KEY `idx_branch_company_active` (`company_id`,`is_active`),
  KEY `fk_branch_creator` (`created_by`),
  CONSTRAINT `fk_branch_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`),
  CONSTRAINT `fk_branch_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `branches`
--

LOCK TABLES `branches` WRITE;
/*!40000 ALTER TABLE `branches` DISABLE KEYS */;
INSERT INTO `branches` VALUES (1,2,'Head Office','HO','HEAD_OFFICE',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,NULL,'2026-08-02 09:37:47','2026-08-02 09:37:47'),(2,3,'Head Office','HO','HEAD_OFFICE',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,NULL,'2026-08-02 09:37:47','2026-08-02 09:37:47'),(3,4,'Head Office','HO','HEAD_OFFICE',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,NULL,'2026-08-02 09:37:47','2026-08-02 09:37:47'),(4,5,'Head Office','HO','HEAD_OFFICE',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,NULL,'2026-08-02 09:37:47','2026-08-02 09:37:47'),(5,6,'Head Office','HO','HEAD_OFFICE',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,NULL,'2026-08-02 09:37:47','2026-08-02 09:37:47'),(6,7,'Head Office','HO','HEAD_OFFICE',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,NULL,'2026-08-02 09:37:47','2026-08-02 09:37:47'),(7,1,'Head Office','HO','HEAD_OFFICE',NULL,NULL,NULL,NULL,NULL,NULL,NULL,1,1,NULL,'2026-08-02 09:37:47','2026-08-02 09:37:47');
/*!40000 ALTER TABLE `branches` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `business_profiles`
--

DROP TABLE IF EXISTS `business_profiles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `business_profiles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `company_id` int NOT NULL,
  `name` varchar(255) DEFAULT NULL,
  `gstin` varchar(50) DEFAULT NULL,
  `address` text,
  `phone` varchar(20) DEFAULT NULL,
  `email` varchar(100) DEFAULT NULL,
  `logo` varchar(255) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `business_profiles`
--

LOCK TABLES `business_profiles` WRITE;
/*!40000 ALTER TABLE `business_profiles` DISABLE KEYS */;
INSERT INTO `business_profiles` VALUES (1,4,'MJSS LLC','36A5622325V68','Hyderabad','9988998899','',NULL,'2026-07-13 13:43:31');
/*!40000 ALTER TABLE `business_profiles` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `companies`
--

DROP TABLE IF EXISTS `companies`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `companies` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `email` varchar(255) DEFAULT NULL,
  `phone` varchar(50) DEFAULT NULL,
  `address` text,
  `gst_number` varchar(50) DEFAULT NULL,
  `status` enum('active','inactive') DEFAULT 'active',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `logo_url` varchar(255) DEFAULT NULL,
  `plan_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `plan_id` (`plan_id`),
  CONSTRAINT `companies_ibfk_1` FOREIGN KEY (`plan_id`) REFERENCES `plans` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `companies`
--

LOCK TABLES `companies` WRITE;
/*!40000 ALTER TABLE `companies` DISABLE KEYS */;
INSERT INTO `companies` VALUES (1,'Demo Traders','owner@demo.com',NULL,NULL,NULL,'active','2026-02-01 21:37:05','2026-02-28 15:33:28',NULL,3),(2,'Demo Traders','owner@demo.com',NULL,NULL,NULL,'active','2026-02-01 21:44:16','2026-02-01 21:44:16',NULL,NULL),(3,'Demo Traders','owner@demo.com',NULL,'Bangalore, Karnataka, India','29ABCDE1234F1Z5','active','2026-02-01 21:52:59','2026-02-09 02:03:46','assets/logo.png',NULL),(4,'Test Company','auth@test.com',NULL,NULL,NULL,'active','2026-02-23 07:47:54','2026-02-23 07:47:54',NULL,NULL),(5,'New Test Company','admin@gmail.com',NULL,NULL,NULL,'active','2026-03-01 11:06:30','2026-03-01 11:06:30',NULL,NULL),(6,'ABC Pvt Ltd','admin@test.com',NULL,NULL,NULL,'active','2026-03-03 09:43:55','2026-03-03 09:43:55',NULL,NULL),(7,'Billing Software','admin@billing.com',NULL,NULL,NULL,'active','2026-03-05 06:16:41','2026-03-05 06:16:41',NULL,NULL);
/*!40000 ALTER TABLE `companies` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `company_business_settings`
--

DROP TABLE IF EXISTS `company_business_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `company_business_settings` (
  `company_id` int NOT NULL,
  `business_types` json DEFAULT NULL,
  `industry_type` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `registration_type` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `state` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `city` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pincode` varchar(12) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pan_number` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `gst_registered` tinyint(1) NOT NULL DEFAULT '0',
  `e_invoicing_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `tds_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `tcs_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `signature` longtext COLLATE utf8mb4_unicode_ci,
  `additional_details` json DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`company_id`),
  CONSTRAINT `fk_business_settings_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `company_business_settings`
--

LOCK TABLES `company_business_settings` WRITE;
/*!40000 ALTER TABLE `company_business_settings` DISABLE KEYS */;
/*!40000 ALTER TABLE `company_business_settings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `company_settings`
--

DROP TABLE IF EXISTS `company_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `company_settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `company_name` varchar(255) DEFAULT NULL,
  `gstin` varchar(50) DEFAULT NULL,
  `address` text,
  `phone` varchar(20) DEFAULT NULL,
  `email` varchar(100) DEFAULT NULL,
  `logo` varchar(255) DEFAULT NULL,
  `bank_name` varchar(100) DEFAULT NULL,
  `account_number` varchar(50) DEFAULT NULL,
  `ifsc` varchar(20) DEFAULT NULL,
  `upi_id` varchar(100) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `company_settings`
--

LOCK TABLES `company_settings` WRITE;
/*!40000 ALTER TABLE `company_settings` DISABLE KEYS */;
/*!40000 ALTER TABLE `company_settings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `customer_advances`
--

DROP TABLE IF EXISTS `customer_advances`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `customer_advances` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint unsigned NOT NULL,
  `customer_id` bigint unsigned NOT NULL,
  `receipt_entry_id` bigint unsigned NOT NULL,
  `original_amount` decimal(15,2) NOT NULL,
  `unapplied_amount` decimal(15,2) NOT NULL,
  `status` enum('UNAPPLIED','PARTIALLY_APPLIED','APPLIED','CANCELLED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'UNAPPLIED',
  `created_by` bigint unsigned NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_customer_advance_receipt` (`company_id`,`receipt_entry_id`),
  KEY `idx_customer_advances_customer` (`company_id`,`customer_id`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `customer_advances`
--

LOCK TABLES `customer_advances` WRITE;
/*!40000 ALTER TABLE `customer_advances` DISABLE KEYS */;
/*!40000 ALTER TABLE `customer_advances` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `customer_bank_accounts`
--

DROP TABLE IF EXISTS `customer_bank_accounts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `customer_bank_accounts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `customer_id` int NOT NULL,
  `company_id` int NOT NULL,
  `account_holder_name` varchar(150) DEFAULT NULL,
  `bank_name` varchar(150) NOT NULL,
  `account_number` varchar(50) NOT NULL,
  `ifsc_code` varchar(11) DEFAULT NULL,
  `branch_name` varchar(150) DEFAULT NULL,
  `is_primary` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_customer_bank_customer` (`customer_id`),
  KEY `idx_customer_bank_company` (`company_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `customer_bank_accounts`
--

LOCK TABLES `customer_bank_accounts` WRITE;
/*!40000 ALTER TABLE `customer_bank_accounts` DISABLE KEYS */;
/*!40000 ALTER TABLE `customer_bank_accounts` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `customers`
--

DROP TABLE IF EXISTS `customers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `customers` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `email` varchar(255) DEFAULT NULL,
  `phone` varchar(50) DEFAULT NULL,
  `address` text,
  `company_id` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `gstin` varchar(15) DEFAULT NULL,
  `pan_number` varchar(10) DEFAULT NULL,
  `opening_balance` decimal(15,2) NOT NULL DEFAULT '0.00',
  `opening_balance_type` varchar(20) NOT NULL DEFAULT 'to_collect',
  `party_category` varchar(100) DEFAULT NULL,
  `billing_address` text,
  `shipping_address` text,
  `credit_period_days` int NOT NULL DEFAULT '30',
  `credit_limit` decimal(15,2) NOT NULL DEFAULT '0.00',
  `contact_person_name` varchar(150) DEFAULT NULL,
  `contact_person_dob` date DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `company_id` (`company_id`),
  CONSTRAINT `customers_ibfk_1` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=15 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `customers`
--

LOCK TABLES `customers` WRITE;
/*!40000 ALTER TABLE `customers` DISABLE KEYS */;
INSERT INTO `customers` VALUES (1,'ABC Customer','abc@test.com','9876543210','Bangalore',5,'2026-03-01 12:46:41',NULL,NULL,0.00,'to_collect',NULL,NULL,NULL,30,0.00,NULL,NULL),(2,'Sam',NULL,'99999999999','Malakpet',4,'2026-07-13 12:13:31',NULL,NULL,0.00,'to_collect',NULL,NULL,NULL,30,0.00,NULL,NULL),(3,'Sam',NULL,'9999999999','Malakper',4,'2026-07-13 12:20:10',NULL,NULL,0.00,'to_collect',NULL,NULL,NULL,30,0.00,NULL,NULL),(4,'Asher',NULL,'8585454595','Andhara',4,'2026-07-13 13:48:17',NULL,NULL,0.00,'to_collect',NULL,NULL,NULL,30,0.00,NULL,NULL),(5,'Kiran',NULL,'0',NULL,4,'2026-07-14 07:57:29',NULL,NULL,0.00,'to_collect',NULL,NULL,NULL,30,0.00,NULL,NULL),(6,'c1',NULL,NULL,NULL,4,'2026-07-15 06:47:02',NULL,NULL,0.00,'to_collect',NULL,NULL,NULL,30,0.00,NULL,NULL),(7,'C2',NULL,NULL,NULL,4,'2026-07-15 06:48:09',NULL,NULL,0.00,'to_collect',NULL,NULL,NULL,30,0.00,NULL,NULL),(8,'Sam',NULL,NULL,NULL,4,'2026-07-16 06:29:23',NULL,NULL,0.00,'to_collect',NULL,NULL,NULL,30,0.00,NULL,NULL),(9,'Anil',NULL,NULL,NULL,4,'2026-07-16 06:30:09',NULL,NULL,0.00,'to_collect',NULL,NULL,NULL,30,0.00,NULL,NULL),(10,'Raj',NULL,NULL,NULL,4,'2026-07-16 06:30:53',NULL,NULL,0.00,'to_collect',NULL,NULL,NULL,30,0.00,NULL,NULL),(11,'Bala Vamsi',NULL,NULL,NULL,4,'2026-07-18 00:48:20',NULL,NULL,0.00,'to_collect',NULL,NULL,NULL,30,0.00,NULL,NULL),(12,'krishna','krishna4450@gmail.com','9676801453','123',4,'2026-07-20 07:49:03',NULL,NULL,0.00,'to_collect',NULL,NULL,NULL,30,0.00,NULL,NULL),(13,'Sudhakar','abc@gmail.com','9787878787','Borabanda',4,'2026-08-01 21:10:08',NULL,NULL,0.00,'to_collect',NULL,'Borabanda','Borabanda',0,0.00,NULL,NULL),(14,'Ramki',NULL,NULL,NULL,4,'2026-08-10 02:06:31',NULL,NULL,0.00,'to_collect',NULL,NULL,NULL,0,0.00,NULL,NULL);
/*!40000 ALTER TABLE `customers` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `data_import_batches`
--

DROP TABLE IF EXISTS `data_import_batches`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `data_import_batches` (
  `id` int NOT NULL AUTO_INCREMENT,
  `company_id` int NOT NULL,
  `activity_type` varchar(20) NOT NULL,
  `data_type` varchar(80) NOT NULL,
  `file_name` varchar(255) DEFAULT NULL,
  `row_count` int NOT NULL DEFAULT '0',
  `created_count` int NOT NULL DEFAULT '0',
  `updated_count` int NOT NULL DEFAULT '0',
  `skipped_count` int NOT NULL DEFAULT '0',
  `affect_stock` tinyint(1) NOT NULL DEFAULT '0',
  `status` varchar(30) NOT NULL DEFAULT 'Completed',
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `rolled_back_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_data_import_batches_company` (`company_id`,`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `data_import_batches`
--

LOCK TABLES `data_import_batches` WRITE;
/*!40000 ALTER TABLE `data_import_batches` DISABLE KEYS */;
INSERT INTO `data_import_batches` VALUES (1,4,'Export','full_backup',NULL,125,0,0,0,0,'Completed',13,'2026-07-19 10:30:57',NULL),(2,4,'Export','products',NULL,11,0,0,0,0,'Completed',13,'2026-07-19 10:33:04',NULL),(3,4,'Export','full_backup',NULL,193,0,0,0,0,'Completed',13,'2026-07-19 17:27:06',NULL);
/*!40000 ALTER TABLE `data_import_batches` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `data_import_changes`
--

DROP TABLE IF EXISTS `data_import_changes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `data_import_changes` (
  `id` int NOT NULL AUTO_INCREMENT,
  `batch_id` int NOT NULL,
  `company_id` int NOT NULL,
  `table_name` varchar(80) NOT NULL,
  `record_id` int NOT NULL,
  `action` varchar(20) NOT NULL,
  `before_data` longtext,
  `after_data` longtext,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_data_import_changes_batch` (`batch_id`),
  KEY `idx_data_import_changes_company` (`company_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `data_import_changes`
--

LOCK TABLES `data_import_changes` WRITE;
/*!40000 ALTER TABLE `data_import_changes` DISABLE KEYS */;
/*!40000 ALTER TABLE `data_import_changes` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `delivery_challan_items`
--

DROP TABLE IF EXISTS `delivery_challan_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `delivery_challan_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `challan_id` int NOT NULL,
  `company_id` int NOT NULL,
  `product_id` int NOT NULL,
  `product_name` varchar(255) NOT NULL,
  `batch_no` varchar(100) DEFAULT NULL,
  `quantity` decimal(10,2) NOT NULL DEFAULT '0.00',
  `unit` varchar(30) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_delivery_challan_items_challan` (`challan_id`),
  KEY `idx_delivery_challan_items_company_product` (`company_id`,`product_id`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `delivery_challan_items`
--

LOCK TABLES `delivery_challan_items` WRITE;
/*!40000 ALTER TABLE `delivery_challan_items` DISABLE KEYS */;
INSERT INTO `delivery_challan_items` VALUES (1,1,4,15,'Cups',NULL,5.00,'PCS','2026-07-16 06:45:58'),(2,1,4,14,'Water Bottle',NULL,2.00,'PCS','2026-07-16 06:45:59'),(3,2,4,14,'Water Bottle',NULL,1.00,'PCS','2026-07-16 06:48:48'),(4,2,4,15,'Cups',NULL,2.00,'PCS','2026-07-16 06:48:48');
/*!40000 ALTER TABLE `delivery_challan_items` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `delivery_challans`
--

DROP TABLE IF EXISTS `delivery_challans`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `delivery_challans` (
  `id` int NOT NULL AUTO_INCREMENT,
  `company_id` int NOT NULL,
  `type` varchar(10) NOT NULL,
  `challan_number` varchar(50) NOT NULL,
  `challan_date` date NOT NULL,
  `party_type` varchar(20) NOT NULL,
  `party_id` int DEFAULT NULL,
  `party_name` varchar(255) NOT NULL,
  `address` text,
  `transport` varchar(255) DEFAULT NULL,
  `vehicle_number` varchar(100) DEFAULT NULL,
  `notes` text,
  `status` varchar(30) NOT NULL DEFAULT 'Created',
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_delivery_challan_company_number` (`company_id`,`challan_number`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `delivery_challans`
--

LOCK TABLES `delivery_challans` WRITE;
/*!40000 ALTER TABLE `delivery_challans` DISABLE KEYS */;
INSERT INTO `delivery_challans` VALUES (1,4,'in','DCIN-0001','2026-07-16','vendor',10,'Alpha enterprises','Kukatpally','Tata Ace','TS059895',NULL,'Created',13,'2026-07-16 06:45:58'),(2,4,'out','DCOUT-0001','2026-07-16','customer',7,'C2',NULL,'Vijay Cargo','AP308562',NULL,'Created',13,'2026-07-16 06:48:47');
/*!40000 ALTER TABLE `delivery_challans` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `expenses`
--

DROP TABLE IF EXISTS `expenses`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `expenses` (
  `id` int NOT NULL AUTO_INCREMENT,
  `title` varchar(255) NOT NULL,
  `category` varchar(100) DEFAULT NULL,
  `amount` decimal(10,2) NOT NULL,
  `expense_date` date NOT NULL,
  `notes` text,
  `company_id` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `company_id` (`company_id`),
  CONSTRAINT `expenses_ibfk_1` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `expenses`
--

LOCK TABLES `expenses` WRITE;
/*!40000 ALTER TABLE `expenses` DISABLE KEYS */;
/*!40000 ALTER TABLE `expenses` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `invoice_items`
--

DROP TABLE IF EXISTS `invoice_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `invoice_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `invoice_id` int NOT NULL,
  `company_id` int NOT NULL,
  `item_name` varchar(255) NOT NULL,
  `description` text,
  `quantity` decimal(10,2) NOT NULL DEFAULT '1.00',
  `unit_price` decimal(10,2) NOT NULL DEFAULT '0.00',
  `total_price` decimal(10,2) NOT NULL DEFAULT '0.00',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `gst_rate` decimal(5,2) DEFAULT '18.00',
  `mrp` decimal(10,2) NOT NULL DEFAULT '0.00',
  `discount_type` varchar(10) NOT NULL DEFAULT 'AMOUNT',
  `discount_value` decimal(12,2) NOT NULL DEFAULT '0.00',
  `discount_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  PRIMARY KEY (`id`),
  KEY `fk_item_invoice` (`invoice_id`),
  KEY `fk_item_company` (`company_id`),
  CONSTRAINT `fk_item_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_item_invoice` FOREIGN KEY (`invoice_id`) REFERENCES `invoices` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=78 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `invoice_items`
--

LOCK TABLES `invoice_items` WRITE;
/*!40000 ALTER TABLE `invoice_items` DISABLE KEYS */;
INSERT INTO `invoice_items` VALUES (2,1,3,'Website Development',NULL,1.00,25000.00,25000.00,'2026-02-07 02:59:10',18.00,0.00,'AMOUNT',0.00,0.00),(3,1,3,'Website Development','Full website build',1.00,25000.00,25000.00,'2026-02-07 03:09:30',18.00,0.00,'AMOUNT',0.00,0.00),(5,1,3,'Extra Work',NULL,1.00,5000.00,5000.00,'2026-02-07 05:07:18',18.00,0.00,'AMOUNT',0.00,0.00),(6,2,3,'Design Work',NULL,1.00,10000.00,10000.00,'2026-02-07 05:36:18',18.00,0.00,'AMOUNT',0.00,0.00),(7,3,3,'Design Work',NULL,1.00,10000.00,10000.00,'2026-02-09 00:32:10',18.00,0.00,'AMOUNT',0.00,0.00),(12,10,4,'Website Development',NULL,1.00,5000.00,5000.00,'2026-02-23 10:00:24',18.00,0.00,'AMOUNT',0.00,0.00),(13,14,1,'mobile s2',NULL,1.00,25000.00,25000.00,'2026-03-23 22:06:05',18.00,0.00,'AMOUNT',0.00,0.00),(14,14,1,'CPU',NULL,1.00,7000.00,7000.00,'2026-03-23 22:06:05',18.00,0.00,'AMOUNT',0.00,0.00),(16,16,1,'tea',NULL,1.00,30.00,30.00,'2026-03-24 04:42:47',18.00,0.00,'AMOUNT',0.00,0.00),(17,16,1,'sugar',NULL,1.00,110.00,110.00,'2026-03-24 04:42:47',18.00,0.00,'AMOUNT',0.00,0.00),(18,17,1,'CPU',NULL,1.00,7000.00,7000.00,'2026-03-24 08:04:09',18.00,0.00,'AMOUNT',0.00,0.00),(19,18,1,'CPU',NULL,1.00,7000.00,7000.00,'2026-03-29 18:28:23',18.00,0.00,'AMOUNT',0.00,0.00),(20,18,1,'tea',NULL,1.00,30.00,30.00,'2026-03-29 18:28:24',18.00,0.00,'AMOUNT',0.00,0.00),(21,19,1,'CPU',NULL,1.00,7000.00,7000.00,'2026-04-03 20:25:12',18.00,0.00,'AMOUNT',0.00,0.00),(22,20,1,'tea',NULL,1.00,30.00,31.50,'2026-04-03 20:57:39',5.00,0.00,'AMOUNT',0.00,0.00),(23,20,1,'mobile s2',NULL,1.00,25000.00,29500.00,'2026-04-03 20:57:40',18.00,0.00,'AMOUNT',0.00,0.00),(27,22,1,'Laptop',NULL,1.00,50000.00,59000.00,'2026-04-03 23:04:41',18.00,0.00,'AMOUNT',0.00,0.00),(28,21,1,'sugar',NULL,1.00,110.00,115.50,'2026-04-03 23:05:56',5.00,0.00,'AMOUNT',0.00,0.00),(29,23,1,'shampoo',NULL,1.00,300.00,354.00,'2026-04-22 23:02:42',18.00,0.00,'AMOUNT',0.00,0.00),(30,23,1,'Pencil',NULL,1.00,10.00,11.80,'2026-04-22 23:02:42',18.00,0.00,'AMOUNT',0.00,0.00),(31,24,1,'Notebook',NULL,100.00,50.00,5900.00,'2026-04-22 23:50:08',18.00,0.00,'AMOUNT',0.00,0.00),(36,27,1,'Notebook',NULL,100.00,50.00,5900.00,'2026-04-23 00:26:32',18.00,0.00,'AMOUNT',0.00,0.00),(37,27,1,'Pencil',NULL,250.00,10.00,2950.00,'2026-04-23 00:26:32',18.00,0.00,'AMOUNT',0.00,0.00),(38,28,1,'shampoo',NULL,10.00,300.00,3540.00,'2026-04-23 07:49:45',18.00,0.00,'AMOUNT',0.00,0.00),(39,29,1,'Notebook',NULL,10.00,50.00,590.00,'2026-04-23 08:07:57',18.00,0.00,'AMOUNT',0.00,0.00),(40,30,1,'Notebook',NULL,100.00,50.00,5900.00,'2026-04-23 09:25:09',18.00,0.00,'AMOUNT',0.00,0.00),(41,31,1,'Pencil',NULL,250.00,10.00,2950.00,'2026-04-23 09:43:54',18.00,0.00,'AMOUNT',0.00,0.00),(42,32,1,'Notebook',NULL,30.00,50.00,1770.00,'2026-04-26 00:07:47',18.00,0.00,'AMOUNT',0.00,0.00),(43,33,1,'Notebook',NULL,20.00,50.00,1180.00,'2026-04-26 00:21:22',18.00,0.00,'AMOUNT',0.00,0.00),(44,34,1,'Notebook',NULL,10.00,50.00,590.00,'2026-04-27 02:52:29',18.00,0.00,'AMOUNT',0.00,0.00),(45,35,1,'Pencil',NULL,150.00,10.00,1770.00,'2026-04-27 02:54:30',18.00,0.00,'AMOUNT',0.00,0.00),(46,36,1,'Notebook',NULL,1.00,50.00,59.00,'2026-05-02 10:12:31',18.00,0.00,'AMOUNT',0.00,0.00),(47,36,1,'shampoo',NULL,1.00,300.00,354.00,'2026-05-02 10:12:32',18.00,0.00,'AMOUNT',0.00,0.00),(48,37,1,'Notebook',NULL,1.00,50.00,59.00,'2026-06-09 09:22:23',18.00,0.00,'AMOUNT',0.00,0.00),(51,39,4,'Oil',NULL,3.00,110.00,389.40,'2026-07-13 13:48:22',18.00,0.00,'AMOUNT',0.00,0.00),(52,39,4,'shampoo',NULL,1.00,230.00,271.40,'2026-07-13 13:48:22',18.00,0.00,'AMOUNT',0.00,0.00),(56,40,4,'Oil',NULL,2.00,110.00,259.60,'2026-07-14 08:53:40',18.00,0.00,'AMOUNT',0.00,0.00),(57,40,4,'Tea Powder',NULL,1.00,52.00,61.36,'2026-07-14 08:53:40',18.00,0.00,'AMOUNT',0.00,0.00),(58,40,4,'shampoo',NULL,1.00,230.00,271.40,'2026-07-14 08:53:40',18.00,0.00,'AMOUNT',0.00,0.00),(59,41,4,'Maggi Noodles',NULL,1.00,50.00,59.00,'2026-07-15 06:47:30',18.00,0.00,'AMOUNT',0.00,0.00),(60,41,4,'Priya Mango pickle',NULL,1.00,75.00,88.50,'2026-07-15 06:47:30',18.00,0.00,'AMOUNT',0.00,0.00),(61,41,4,'Tea Powder',NULL,1.00,50.00,59.00,'2026-07-15 06:47:31',18.00,0.00,'AMOUNT',0.00,0.00),(62,42,4,'Sugar',NULL,1.00,78.00,92.04,'2026-07-15 06:48:44',18.00,0.00,'AMOUNT',0.00,0.00),(63,42,4,'Oil',NULL,1.00,110.00,129.80,'2026-07-15 06:48:44',18.00,0.00,'AMOUNT',0.00,0.00),(64,42,4,'shampoo',NULL,1.00,230.00,271.40,'2026-07-15 06:48:45',18.00,0.00,'AMOUNT',0.00,0.00),(65,42,4,'Maggi Noodles',NULL,2.00,50.00,118.00,'2026-07-15 06:48:45',18.00,0.00,'AMOUNT',0.00,0.00),(66,43,4,'Priya Mango pickle',NULL,1.00,75.00,88.50,'2026-07-15 07:28:35',18.00,80.00,'AMOUNT',0.00,0.00),(67,44,4,'Induction Stove',NULL,1.00,3000.00,3540.00,'2026-07-16 06:29:53',18.00,3000.00,'AMOUNT',0.00,0.00),(68,45,4,'5L Cooker',NULL,1.00,1500.00,1770.00,'2026-07-16 06:30:30',18.00,1500.00,'AMOUNT',0.00,0.00),(69,46,4,'Cups',NULL,2.00,40.00,84.00,'2026-07-16 06:32:22',5.00,50.00,'AMOUNT',0.00,0.00),(70,46,4,'Water Bottle',NULL,2.00,50.00,105.00,'2026-07-16 06:32:22',5.00,60.00,'AMOUNT',0.00,0.00),(71,47,4,'Induction Stove',NULL,1.00,3000.00,3540.00,'2026-07-18 00:48:30',18.00,3000.00,'AMOUNT',0.00,0.00),(72,48,4,'Water Bottle',NULL,1.00,50.00,52.50,'2026-07-20 07:51:25',5.00,60.00,'AMOUNT',0.00,0.00),(73,48,4,'5L Cooker',NULL,1.00,1500.00,1770.00,'2026-07-20 07:51:25',18.00,1500.00,'AMOUNT',0.00,0.00),(74,49,4,'5L Cooker',NULL,1.00,1500.00,1416.00,'2026-07-27 08:41:22',18.00,1500.00,'AMOUNT',300.00,300.00),(75,50,4,'Tea Powder',NULL,1.00,50.00,59.00,'2026-08-01 21:10:33',18.00,60.00,'PERCENT',0.00,0.00),(76,50,4,'MTR Sambar powder',NULL,1.00,10.00,10.50,'2026-08-01 21:10:33',5.00,15.00,'PERCENT',0.00,0.00),(77,50,4,'Oil',NULL,1.00,110.00,129.80,'2026-08-01 21:10:33',18.00,120.00,'PERCENT',0.00,0.00);
/*!40000 ALTER TABLE `invoice_items` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `invoice_settings`
--

DROP TABLE IF EXISTS `invoice_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `invoice_settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `company_id` int DEFAULT NULL,
  `prefix` varchar(20) DEFAULT 'INV',
  `current_number` int DEFAULT '1',
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `customization_json` json DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `invoice_settings`
--

LOCK TABLES `invoice_settings` WRITE;
/*!40000 ALTER TABLE `invoice_settings` DISABLE KEYS */;
INSERT INTO `invoice_settings` VALUES (1,1,'INV',18,'2026-06-09 09:22:22',NULL),(2,4,'INV',15,'2026-08-01 21:10:33',NULL);
/*!40000 ALTER TABLE `invoice_settings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `invoices`
--

DROP TABLE IF EXISTS `invoices`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `invoices` (
  `id` int NOT NULL AUTO_INCREMENT,
  `company_id` int NOT NULL,
  `created_by` int NOT NULL,
  `invoice_number` varchar(50) NOT NULL,
  `invoice_date` date NOT NULL,
  `customer_id` int DEFAULT NULL,
  `due_date` date DEFAULT NULL,
  `customer_name` varchar(255) NOT NULL,
  `customer_email` varchar(255) DEFAULT NULL,
  `customer_phone` varchar(20) DEFAULT NULL,
  `subtotal` decimal(10,2) NOT NULL DEFAULT '0.00',
  `discount_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tax_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `total_amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  `status` varchar(30) NOT NULL DEFAULT 'pending',
  `notes` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `tax_rate` decimal(5,2) NOT NULL DEFAULT '18.00',
  `cgst` decimal(10,2) DEFAULT '0.00',
  `sgst` decimal(10,2) DEFAULT '0.00',
  `igst` decimal(10,2) DEFAULT '0.00',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_invoice_number_per_company` (`company_id`,`invoice_number`),
  KEY `fk_invoice_user` (`created_by`),
  CONSTRAINT `fk_invoice_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_invoice_user` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=51 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `invoices`
--

LOCK TABLES `invoices` WRITE;
/*!40000 ALTER TABLE `invoices` DISABLE KEYS */;
INSERT INTO `invoices` VALUES (1,3,10,'INV-001','2025-02-07',NULL,NULL,'ABC Pvt Ltd',NULL,NULL,55000.00,0.00,9900.00,55000.01,'paid',NULL,'2026-02-07 02:56:04','2026-02-07 05:07:19',18.00,0.00,0.00,0.00),(2,3,10,'INV-002','2025-02-07',NULL,NULL,'XYZ Pvt Ltd',NULL,NULL,10000.00,0.00,1800.00,10000.00,'paid',NULL,'2026-02-07 05:35:16','2026-02-07 05:57:52',18.00,0.00,0.00,0.00),(3,3,10,'INV-003','2025-02-08',NULL,NULL,'Test Client',NULL,NULL,0.00,0.00,0.00,0.00,'draft',NULL,'2026-02-09 00:31:30','2026-02-09 00:31:30',18.00,0.00,0.00,0.00),(10,4,13,'INV-002','2026-02-23',NULL,NULL,'Ramesh Kumar',NULL,NULL,5000.00,0.00,0.00,5000.00,'paid',NULL,'2026-02-23 10:00:24','2026-02-24 05:56:19',0.00,0.00,0.00,0.00),(14,1,10,'INV-1502','2026-03-23',NULL,NULL,'text',NULL,NULL,32000.00,0.00,0.00,32000.00,'pending',NULL,'2026-03-23 22:06:05','2026-03-23 22:06:05',0.00,0.00,0.00,0.00),(16,1,10,'INV-1937','2026-03-24',NULL,NULL,'esther',NULL,NULL,140.00,0.00,0.00,140.00,'paid',NULL,'2026-03-24 04:42:46','2026-03-29 16:25:57',0.00,0.00,0.00,0.00),(17,1,10,'INV-1017','2026-03-24',NULL,NULL,'saketh',NULL,NULL,7000.00,0.00,0.00,7000.00,'paid',NULL,'2026-03-24 08:04:09','2026-03-29 16:24:52',0.00,0.00,0.00,0.00),(18,1,10,'INV-1789','2026-03-30',NULL,NULL,'kumar',NULL,NULL,7030.00,0.00,0.00,7030.00,'paid',NULL,'2026-03-29 18:28:23','2026-03-29 18:28:53',0.00,0.00,0.00,0.00),(19,1,10,'INV-0019','2026-04-03',NULL,NULL,'jay 1',NULL,NULL,7000.00,0.00,0.00,8260.00,'pending',NULL,'2026-04-03 20:25:12','2026-04-03 20:25:12',18.00,630.00,630.00,0.00),(20,1,10,'INV-0020','2026-04-03',NULL,NULL,'Bobby',NULL,NULL,25030.00,0.00,0.00,29531.50,'pending',NULL,'2026-04-03 20:57:39','2026-04-03 20:57:39',18.00,2250.75,2250.75,0.00),(21,1,10,'INV-0001','2026-04-02',NULL,NULL,'Chotu',NULL,NULL,110.00,0.00,5.50,115.50,'paid',NULL,'2026-04-03 21:42:33','2026-04-06 02:34:31',18.00,2.75,2.75,0.00),(22,1,10,'INV-0002','2026-04-01',NULL,NULL,'sravan',NULL,NULL,50000.00,0.00,9000.00,59000.00,'paid',NULL,'2026-04-03 22:11:35','2026-04-04 09:29:16',18.00,4500.00,4500.00,0.00),(23,1,10,'INV-0003','2026-04-22',NULL,NULL,'Sunny',NULL,NULL,310.00,0.00,55.80,365.80,'pending',NULL,'2026-04-22 23:02:42','2026-04-22 23:02:42',18.00,27.90,27.90,0.00),(24,1,10,'INV-0004','2026-04-22',NULL,NULL,'Jyothi',NULL,NULL,5000.00,0.00,900.00,5900.00,'pending',NULL,'2026-04-22 23:50:07','2026-04-22 23:50:07',18.00,450.00,450.00,0.00),(27,1,10,'INV-0007','2026-04-23',NULL,NULL,'Mitul patel',NULL,NULL,7500.00,0.00,1350.00,8850.00,'pending',NULL,'2026-04-23 00:26:32','2026-04-23 00:26:32',18.00,675.00,675.00,0.00),(28,1,10,'INV-0008','2026-04-23',NULL,NULL,'sritha',NULL,NULL,3000.00,0.00,540.00,3540.00,'pending',NULL,'2026-04-23 07:49:45','2026-04-23 07:49:45',18.00,270.00,270.00,0.00),(29,1,10,'INV-0009','2026-04-23',NULL,NULL,'Swathi',NULL,NULL,500.00,0.00,90.00,590.00,'pending',NULL,'2026-04-23 08:07:57','2026-04-23 08:07:57',18.00,45.00,45.00,0.00),(30,1,10,'INV-0010','2026-04-23',NULL,NULL,'Serah',NULL,NULL,5000.00,0.00,900.00,5900.00,'pending',NULL,'2026-04-23 09:25:09','2026-04-23 09:25:09',18.00,450.00,450.00,0.00),(31,1,10,'INV-0011','2026-04-23',NULL,NULL,'janki',NULL,NULL,2500.00,0.00,450.00,2950.00,'pending',NULL,'2026-04-23 09:43:53','2026-04-23 09:43:53',18.00,225.00,225.00,0.00),(32,1,10,'INV-0012','2026-04-26',NULL,NULL,'esther',NULL,NULL,1500.00,0.00,270.00,1770.00,'pending',NULL,'2026-04-26 00:07:47','2026-04-26 00:07:47',18.00,135.00,135.00,0.00),(33,1,10,'INV-0013','2026-04-26',NULL,NULL,'kumar',NULL,NULL,1000.00,0.00,180.00,1180.00,'pending',NULL,'2026-04-26 00:21:21','2026-04-26 00:21:21',18.00,90.00,90.00,0.00),(34,1,10,'INV-0014','2026-04-27',NULL,NULL,'Mark',NULL,NULL,500.00,0.00,90.00,590.00,'pending',NULL,'2026-04-27 02:52:29','2026-04-27 02:52:29',18.00,45.00,45.00,0.00),(35,1,10,'INV-0015','2026-04-27',NULL,NULL,'saritha',NULL,NULL,1500.00,0.00,270.00,1770.00,'pending',NULL,'2026-04-27 02:54:29','2026-04-27 02:54:29',18.00,135.00,135.00,0.00),(36,1,10,'INV-0016','2026-05-02',NULL,NULL,'krishan',NULL,NULL,350.00,0.00,63.00,413.00,'pending',NULL,'2026-05-02 10:12:31','2026-05-02 10:12:31',18.00,31.50,31.50,0.00),(37,1,10,'INV-0017','2026-06-09',NULL,NULL,'textbox',NULL,NULL,50.00,0.00,9.00,59.00,'pending',NULL,'2026-06-09 09:22:23','2026-06-09 09:22:23',18.00,4.50,4.50,0.00),(39,4,13,'INV-0003','2026-07-13',NULL,NULL,'Asher',NULL,NULL,560.00,0.00,100.80,660.80,'paid',NULL,'2026-07-13 13:48:22','2026-07-13 13:48:54',18.00,50.40,50.40,0.00),(40,4,13,'INV-0004','2026-07-13',NULL,NULL,'Kiran',NULL,NULL,502.00,0.00,90.36,592.36,'pending',NULL,'2026-07-14 07:58:41','2026-07-18 00:49:53',18.00,45.18,45.18,0.00),(41,4,13,'INV-0005','2026-07-15',NULL,NULL,'c1',NULL,NULL,175.00,0.00,31.50,206.50,'pending',NULL,'2026-07-15 06:47:30','2026-07-15 06:47:30',18.00,15.75,15.75,0.00),(42,4,13,'INV-0006','2026-07-15',NULL,NULL,'C2',NULL,NULL,518.00,0.00,93.24,611.24,'paid',NULL,'2026-07-15 06:48:44','2026-07-29 14:20:35',18.00,46.62,46.62,0.00),(43,4,13,'INV-0007','2026-07-15',NULL,NULL,'C2',NULL,NULL,75.00,0.00,13.50,88.50,'pending',NULL,'2026-07-15 07:28:35','2026-07-15 07:28:35',18.00,6.75,6.75,0.00),(44,4,13,'INV-0008','2026-07-16',NULL,NULL,'Sam',NULL,NULL,3000.00,0.00,540.00,3540.00,'partial',NULL,'2026-07-16 06:29:53','2026-07-19 08:02:30',18.00,270.00,270.00,0.00),(45,4,13,'INV-0009','2026-07-16',NULL,NULL,'Anil',NULL,NULL,1500.00,0.00,270.00,1770.00,'pending',NULL,'2026-07-16 06:30:30','2026-07-16 06:30:30',18.00,135.00,135.00,0.00),(46,4,13,'INV-0010','2026-07-16',NULL,NULL,'Raj',NULL,NULL,180.00,0.00,9.00,189.00,'paid',NULL,'2026-07-16 06:32:22','2026-07-20 07:57:06',18.00,4.50,4.50,0.00),(47,4,13,'INV-0011','2026-07-18',NULL,NULL,'Bala Vamsi',NULL,NULL,3000.00,0.00,540.00,3540.00,'paid',NULL,'2026-07-18 00:48:30','2026-07-20 07:54:56',18.00,270.00,270.00,0.00),(48,4,13,'INV-0012','2026-07-20',NULL,NULL,'krishna',NULL,NULL,1550.00,0.00,272.50,1822.50,'paid',NULL,'2026-07-20 07:51:25','2026-07-20 07:56:49',18.00,136.25,136.25,0.00),(49,4,13,'INV-0013','2026-07-27',NULL,NULL,'C2',NULL,NULL,1500.00,300.00,216.00,1416.00,'pending',NULL,'2026-07-27 08:41:22','2026-07-27 08:41:22',18.00,108.00,108.00,0.00),(50,4,13,'INV-0014','2026-08-01',NULL,NULL,'Sudhakar',NULL,NULL,170.00,0.00,29.30,199.30,'paid',NULL,'2026-08-01 21:10:33','2026-08-01 21:15:27',18.00,14.65,14.65,0.00);
/*!40000 ALTER TABLE `invoices` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `journal_entries`
--

DROP TABLE IF EXISTS `journal_entries`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `journal_entries` (
  `id` int NOT NULL AUTO_INCREMENT,
  `journal_no` varchar(50) DEFAULT NULL,
  `journal_date` date NOT NULL,
  `narration` text,
  `total_debit` decimal(15,2) DEFAULT '0.00',
  `total_credit` decimal(15,2) DEFAULT '0.00',
  `created_by` int DEFAULT NULL,
  `status` tinyint(1) DEFAULT '1',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `company_id` int NOT NULL,
  `vendor_id` int DEFAULT NULL,
  `source_type` varchar(50) DEFAULT NULL,
  `source_id` bigint DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `journal_no` (`journal_no`),
  UNIQUE KEY `uq_journal_source` (`company_id`,`source_type`,`source_id`),
  KEY `idx_journal_entries_company_id` (`company_id`)
) ENGINE=InnoDB AUTO_INCREMENT=19 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `journal_entries`
--

LOCK TABLES `journal_entries` WRITE;
/*!40000 ALTER TABLE `journal_entries` DISABLE KEYS */;
INSERT INTO `journal_entries` VALUES (1,'JRN-00001','2026-05-12','Office Rent Paid',5000.00,5000.00,NULL,1,'2026-05-20 08:09:44','2026-07-13 11:05:55',1,NULL,NULL,NULL),(2,'JRN-00002','2026-05-26','',3000.00,3000.00,NULL,1,'2026-05-26 07:30:09','2026-07-13 11:05:55',1,NULL,NULL,NULL),(3,'JRN-00003','2026-05-27','',200.00,200.00,NULL,1,'2026-05-27 10:27:20','2026-07-13 11:05:55',1,NULL,NULL,NULL),(4,'JRN-00004','2026-05-27','',10000.00,10000.00,NULL,1,'2026-05-27 10:36:14','2026-07-13 11:05:55',1,NULL,NULL,NULL),(5,'JRN-00005','2026-05-30','',3000.00,3000.00,NULL,1,'2026-05-30 08:25:44','2026-07-13 11:05:55',1,NULL,NULL,NULL),(6,'JRN-00006','2026-05-30','',100000.00,100000.00,NULL,1,'2026-05-30 12:21:24','2026-07-13 11:05:55',1,NULL,NULL,NULL),(7,'RCPT-00007','2026-05-31','Test Receipt',1000.00,1000.00,NULL,1,'2026-05-31 03:27:51','2026-07-13 11:05:55',1,NULL,NULL,NULL),(8,'PAY-00008','2026-05-31','Office Rent',500.00,500.00,NULL,1,'2026-05-31 10:36:21','2026-07-13 11:05:55',1,NULL,NULL,NULL),(10,'RCPT-00001','2026-07-18',NULL,500.00,500.00,NULL,1,'2026-07-18 13:02:07','2026-07-18 13:02:07',4,NULL,NULL,NULL),(11,'PAY-00011','2026-07-18',NULL,500.00,500.00,NULL,1,'2026-07-18 13:02:49','2026-07-18 13:02:49',4,NULL,NULL,NULL),(12,'RCPT-2026-000001','2026-07-29','CUSTOMER receipt',611.24,611.24,NULL,1,'2026-07-29 14:20:35','2026-07-29 14:20:35',4,NULL,NULL,NULL),(13,'VPAY-00008','2026-08-01','Vendor payment to PKD Traders against BILL-0013',784.00,784.00,NULL,1,'2026-08-01 18:44:38','2026-08-01 18:44:38',4,9,'vendor_payment',8),(14,'VPAY-00009','2026-08-01','Vendor payment to PKD Traders against BILL-0012',678.50,678.50,NULL,1,'2026-08-01 18:53:00','2026-08-01 18:53:00',4,9,'vendor_payment',9),(15,'RCPT-2026-000002','2026-08-01','balance amount receievd',100.00,100.00,NULL,1,'2026-08-01 21:15:27','2026-08-01 21:15:27',4,NULL,NULL,NULL),(16,'VPAY-00010','2026-08-03','Vendor payment to PKD Traders against BILL-0011',7985.00,7985.00,NULL,1,'2026-08-03 06:48:48','2026-08-03 06:48:48',4,9,'vendor_payment',10),(17,'VPAY-00011','2026-08-03','Vendor payment to PKD Traders against BILL-0006',349.60,349.60,NULL,1,'2026-08-03 06:49:15','2026-08-03 06:49:15',4,9,'vendor_payment',11),(18,'VPAY-00012','2026-08-03','Vendor payment to Alpha enterprises against BILL-0010',5000.00,5000.00,NULL,1,'2026-08-03 16:07:27','2026-08-03 16:07:27',4,10,'vendor_payment',12);
/*!40000 ALTER TABLE `journal_entries` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `journal_entry_details`
--

DROP TABLE IF EXISTS `journal_entry_details`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `journal_entry_details` (
  `id` int NOT NULL AUTO_INCREMENT,
  `journal_entry_id` int NOT NULL,
  `account_id` int NOT NULL,
  `debit` decimal(15,2) DEFAULT '0.00',
  `credit` decimal(15,2) DEFAULT '0.00',
  `description` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `journal_entry_id` (`journal_entry_id`),
  KEY `account_id` (`account_id`),
  CONSTRAINT `journal_entry_details_ibfk_1` FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries` (`id`) ON DELETE CASCADE,
  CONSTRAINT `journal_entry_details_ibfk_2` FOREIGN KEY (`account_id`) REFERENCES `accounts` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=35 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `journal_entry_details`
--

LOCK TABLES `journal_entry_details` WRITE;
/*!40000 ALTER TABLE `journal_entry_details` DISABLE KEYS */;
INSERT INTO `journal_entry_details` VALUES (1,1,10,5000.00,0.00,'Rent Expense','2026-05-20 08:09:44'),(2,1,1,0.00,5000.00,'Cash','2026-05-20 08:09:45'),(3,2,9,3000.00,0.00,NULL,'2026-05-26 07:30:09'),(4,2,9,0.00,3000.00,NULL,'2026-05-26 07:30:10'),(5,3,16,200.00,0.00,NULL,'2026-05-27 10:27:21'),(6,3,1,0.00,200.00,NULL,'2026-05-27 10:27:21'),(7,4,10,10000.00,0.00,NULL,'2026-05-27 10:36:14'),(8,4,2,0.00,10000.00,NULL,'2026-05-27 10:36:15'),(9,5,9,3000.00,0.00,NULL,'2026-05-30 08:25:44'),(10,5,2,0.00,3000.00,NULL,'2026-05-30 08:25:45'),(11,6,1,100000.00,0.00,NULL,'2026-05-30 12:21:25'),(12,6,6,0.00,100000.00,NULL,'2026-05-30 12:21:25'),(13,7,1,1000.00,0.00,'Test Receipt','2026-05-31 03:27:52'),(14,7,6,0.00,1000.00,'Test Receipt','2026-05-31 03:27:52'),(15,8,10,500.00,0.00,'Office Rent','2026-05-31 10:36:21'),(16,8,1,0.00,500.00,'Office Rent','2026-05-31 10:36:21'),(17,10,20,500.00,0.00,'Receipt Entry','2026-07-18 13:02:07'),(18,10,23,0.00,500.00,'Receipt Entry','2026-07-18 13:02:08'),(19,11,23,500.00,0.00,'Payment Entry','2026-07-18 13:02:49'),(20,11,20,0.00,500.00,'Payment Entry','2026-07-18 13:02:49'),(21,12,21,611.24,0.00,'RCPT-2026-000001','2026-07-29 14:20:35'),(22,12,24,0.00,611.24,'RCPT-2026-000001','2026-07-29 14:20:35'),(23,13,22,784.00,0.00,'Vendor payment to PKD Traders against BILL-0013','2026-08-01 18:44:38'),(24,13,21,0.00,784.00,'Vendor payment to PKD Traders against BILL-0013','2026-08-01 18:44:38'),(25,14,22,678.50,0.00,'Vendor payment to PKD Traders against BILL-0012','2026-08-01 18:53:00'),(26,14,21,0.00,678.50,'Vendor payment to PKD Traders against BILL-0012','2026-08-01 18:53:00'),(27,15,21,100.00,0.00,'RCPT-2026-000002','2026-08-01 21:15:27'),(28,15,24,0.00,100.00,'RCPT-2026-000002','2026-08-01 21:15:27'),(29,16,22,7985.00,0.00,'Vendor payment to PKD Traders against BILL-0011','2026-08-03 06:48:48'),(30,16,21,0.00,7985.00,'Vendor payment to PKD Traders against BILL-0011','2026-08-03 06:48:48'),(31,17,22,349.60,0.00,'Vendor payment to PKD Traders against BILL-0006','2026-08-03 06:49:15'),(32,17,20,0.00,349.60,'Vendor payment to PKD Traders against BILL-0006','2026-08-03 06:49:15'),(33,18,22,5000.00,0.00,'Vendor payment to Alpha enterprises against BILL-0010','2026-08-03 16:07:27'),(34,18,21,0.00,5000.00,'Vendor payment to Alpha enterprises against BILL-0010','2026-08-03 16:07:27');
/*!40000 ALTER TABLE `journal_entry_details` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `ledger_entries`
--

DROP TABLE IF EXISTS `ledger_entries`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ledger_entries` (
  `id` int NOT NULL AUTO_INCREMENT,
  `company_id` int NOT NULL,
  `entity_type` varchar(50) DEFAULT NULL,
  `entity_id` int DEFAULT NULL,
  `reference_type` varchar(50) DEFAULT NULL,
  `reference_id` int DEFAULT NULL,
  `debit` decimal(10,2) DEFAULT '0.00',
  `credit` decimal(10,2) DEFAULT '0.00',
  `transaction_date` date DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=15 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `ledger_entries`
--

LOCK TABLES `ledger_entries` WRITE;
/*!40000 ALTER TABLE `ledger_entries` DISABLE KEYS */;
INSERT INTO `ledger_entries` VALUES (1,7,'vendor',1,'bill',4,50000.00,0.00,'2026-03-05','2026-03-05 07:42:02'),(2,7,'vendor',1,'payment',2,0.00,5000.00,'2026-03-07','2026-03-05 07:50:39'),(3,4,'vendor',3,'bill',5,100.00,0.00,'2026-04-06','2026-04-06 23:33:02'),(4,4,'vendor',3,'bill',6,50000.00,0.00,'2026-04-06','2026-04-06 23:33:52'),(5,4,'vendor',2,'bill',7,37500.00,0.00,'2026-03-31','2026-04-06 23:35:52'),(6,4,'vendor',5,'bill',8,1180.00,0.00,'2026-04-12','2026-04-12 20:12:09'),(7,4,'vendor',8,'payment',3,0.00,272.00,'2026-07-14','2026-07-14 07:52:06'),(8,4,'vendor',9,'payment',4,0.00,500.00,'2026-07-15','2026-07-15 06:46:21'),(9,4,'vendor',10,'payment',5,0.00,15000.00,'2026-07-16','2026-07-16 06:26:06'),(10,4,'vendor',9,'vendor_payment',8,0.00,784.00,'2026-08-01','2026-08-01 18:44:38'),(11,4,'vendor',9,'vendor_payment',9,0.00,678.50,'2026-08-01','2026-08-01 18:53:00'),(12,4,'vendor',9,'vendor_payment',10,0.00,7985.00,'2026-08-03','2026-08-03 06:48:48'),(13,4,'vendor',9,'vendor_payment',11,0.00,349.60,'2026-08-03','2026-08-03 06:49:15'),(14,4,'vendor',10,'vendor_payment',12,0.00,5000.00,'2026-08-03','2026-08-03 16:07:27');
/*!40000 ALTER TABLE `ledger_entries` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `opening_balance_events`
--

DROP TABLE IF EXISTS `opening_balance_events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `opening_balance_events` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `company_id` int NOT NULL,
  `entity_type` enum('account','customer','vendor') COLLATE utf8mb4_unicode_ci NOT NULL,
  `entity_id` bigint NOT NULL,
  `sequence_no` int NOT NULL,
  `event_kind` enum('initial','adjustment') COLLATE utf8mb4_unicode_ci NOT NULL,
  `signed_delta` decimal(15,2) NOT NULL,
  `target_account_id` int NOT NULL,
  `journal_entry_id` int DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_opening_event_sequence` (`company_id`,`entity_type`,`entity_id`,`sequence_no`),
  UNIQUE KEY `uq_opening_event_journal` (`journal_entry_id`),
  KEY `idx_opening_event_company_target` (`company_id`,`target_account_id`),
  CONSTRAINT `fk_opening_event_journal` FOREIGN KEY (`journal_entry_id`) REFERENCES `journal_entries` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `opening_balance_events`
--

LOCK TABLES `opening_balance_events` WRITE;
/*!40000 ALTER TABLE `opening_balance_events` DISABLE KEYS */;
/*!40000 ALTER TABLE `opening_balance_events` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `organizations`
--

DROP TABLE IF EXISTS `organizations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `organizations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `plan_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `plan_id` (`plan_id`),
  CONSTRAINT `organizations_ibfk_1` FOREIGN KEY (`plan_id`) REFERENCES `plans` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `organizations`
--

LOCK TABLES `organizations` WRITE;
/*!40000 ALTER TABLE `organizations` DISABLE KEYS */;
INSERT INTO `organizations` VALUES (1,'My Billing Company',3);
/*!40000 ALTER TABLE `organizations` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `payments`
--

DROP TABLE IF EXISTS `payments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `invoice_id` int NOT NULL,
  `company_id` int NOT NULL,
  `amount` decimal(10,2) NOT NULL,
  `payment_date` date NOT NULL,
  `payment_method` enum('cash','upi','bank','card','cheque') NOT NULL,
  `reference_number` varchar(100) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `receipt_entry_id` bigint unsigned DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_payments_receipt_entry` (`receipt_entry_id`),
  KEY `fk_payment_invoice` (`invoice_id`),
  KEY `fk_payment_company` (`company_id`),
  CONSTRAINT `fk_payment_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_payment_invoice` FOREIGN KEY (`invoice_id`) REFERENCES `invoices` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=12 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `payments`
--

LOCK TABLES `payments` WRITE;
/*!40000 ALTER TABLE `payments` DISABLE KEYS */;
INSERT INTO `payments` VALUES (1,2,3,5000.00,'2025-02-07','upi','UPI12345','2026-02-07 05:54:31',NULL),(2,2,3,5000.00,'2025-02-07','cash',NULL,'2026-02-07 05:57:52',NULL),(4,40,4,200.00,'2026-07-14','cash','INV-0004-partial','2026-07-14 08:27:38',NULL),(5,47,4,3540.00,'2026-07-18','cash','INV-0011-paid','2026-07-18 00:48:58',NULL),(6,44,4,2500.00,'2026-07-19','cash','INV-0008-partial','2026-07-19 08:02:27',NULL),(7,48,4,1822.50,'2026-07-20','cash','INV-0012-paid','2026-07-20 07:53:32',NULL),(8,46,4,189.00,'2026-07-20','cash','INV-0010-paid','2026-07-20 07:57:06',NULL),(9,42,4,611.24,'2026-07-29','cash',NULL,'2026-07-29 14:20:35',1),(10,50,4,99.30,'2026-08-01','cash','INV-0014-partial','2026-08-01 21:13:30',NULL),(11,50,4,100.00,'2026-08-01','upi','88998858','2026-08-01 21:15:27',2);
/*!40000 ALTER TABLE `payments` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `payroll_attendance_imports`
--

DROP TABLE IF EXISTS `payroll_attendance_imports`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payroll_attendance_imports` (
  `id` int NOT NULL AUTO_INCREMENT,
  `company_id` int NOT NULL,
  `payroll_month` varchar(7) NOT NULL,
  `file_name` varchar(255) DEFAULT NULL,
  `row_count` int NOT NULL DEFAULT '0',
  `created_count` int NOT NULL DEFAULT '0',
  `updated_count` int NOT NULL DEFAULT '0',
  `skipped_count` int NOT NULL DEFAULT '0',
  `standard_hours_per_day` decimal(8,2) NOT NULL DEFAULT '8.00',
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_payroll_attendance_import_company` (`company_id`,`created_at`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `payroll_attendance_imports`
--

LOCK TABLES `payroll_attendance_imports` WRITE;
/*!40000 ALTER TABLE `payroll_attendance_imports` DISABLE KEYS */;
INSERT INTO `payroll_attendance_imports` VALUES (1,4,'2026-07','attendance-payroll-template-2026-07.xlsx',3,0,0,3,8.00,13,'2026-07-19 13:30:56'),(2,4,'2026-07','attendance-payroll-template-2026-07.xlsx',3,0,0,3,8.00,13,'2026-07-19 13:32:21'),(3,4,'2026-07','attendance-payroll-template-2026-07.xlsx',3,0,0,3,8.00,13,'2026-07-19 13:34:38'),(4,4,'2026-07','attendance-payroll-template-2026-07.xlsx',3,3,0,0,8.00,13,'2026-07-19 13:37:09'),(5,4,'2026-07','attendance-payroll-template-2026-07.xlsx',3,0,3,0,8.00,13,'2026-07-19 13:38:22');
/*!40000 ALTER TABLE `payroll_attendance_imports` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `payroll_attendance_lines`
--

DROP TABLE IF EXISTS `payroll_attendance_lines`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payroll_attendance_lines` (
  `id` int NOT NULL AUTO_INCREMENT,
  `import_id` int NOT NULL,
  `company_id` int NOT NULL,
  `employee_id` int DEFAULT NULL,
  `employee_code` varchar(80) DEFAULT NULL,
  `employee_name` varchar(255) DEFAULT NULL,
  `payroll_month` varchar(7) NOT NULL,
  `working_days` decimal(8,2) NOT NULL DEFAULT '0.00',
  `present_days` decimal(8,2) NOT NULL DEFAULT '0.00',
  `absent_days` decimal(8,2) NOT NULL DEFAULT '0.00',
  `total_hours` decimal(10,2) NOT NULL DEFAULT '0.00',
  `overtime_hours` decimal(10,2) NOT NULL DEFAULT '0.00',
  `allowances` decimal(12,2) NOT NULL DEFAULT '0.00',
  `deductions` decimal(12,2) NOT NULL DEFAULT '0.00',
  `calculated_salary` decimal(12,2) NOT NULL DEFAULT '0.00',
  `status` varchar(30) NOT NULL DEFAULT 'Imported',
  `message` text,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_payroll_attendance_lines_import` (`import_id`),
  KEY `idx_payroll_attendance_lines_company` (`company_id`,`payroll_month`)
) ENGINE=InnoDB AUTO_INCREMENT=16 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `payroll_attendance_lines`
--

LOCK TABLES `payroll_attendance_lines` WRITE;
/*!40000 ALTER TABLE `payroll_attendance_lines` DISABLE KEYS */;
INSERT INTO `payroll_attendance_lines` VALUES (1,1,4,NULL,'EMP001','jay','2026-07',0.00,0.00,0.00,0.00,0.00,0.00,0.00,0.00,'Skipped','Employee not found: EMP001','2026-07-19 13:30:57'),(2,1,4,NULL,'EMP002','Bobby','2026-07',0.00,0.00,0.00,0.00,0.00,0.00,0.00,0.00,'Skipped','Employee not found: EMP002','2026-07-19 13:30:58'),(3,1,4,NULL,'EMP003','Kumar','2026-07',0.00,0.00,0.00,0.00,0.00,0.00,0.00,0.00,'Skipped','Employee not found: EMP003','2026-07-19 13:30:58'),(4,2,4,NULL,'EMP001','jay','2026-07',0.00,0.00,0.00,0.00,0.00,0.00,0.00,0.00,'Skipped','Employee not found: EMP001','2026-07-19 13:32:22'),(5,2,4,NULL,'EMP002','Bobby','2026-07',0.00,0.00,0.00,0.00,0.00,0.00,0.00,0.00,'Skipped','Employee not found: EMP002','2026-07-19 13:32:23'),(6,2,4,NULL,'EMP003','Kumar','2026-07',0.00,0.00,0.00,0.00,0.00,0.00,0.00,0.00,'Skipped','Employee not found: EMP003','2026-07-19 13:32:23'),(7,3,4,NULL,'EMP001','jay','2026-07',0.00,0.00,0.00,0.00,0.00,0.00,0.00,0.00,'Skipped','Employee not found: EMP001','2026-07-19 13:34:39'),(8,3,4,NULL,'EMP002','Bobby','2026-07',0.00,0.00,0.00,0.00,0.00,0.00,0.00,0.00,'Skipped','Employee not found: EMP002','2026-07-19 13:34:39'),(9,3,4,NULL,'EMP003','Kumar','2026-07',0.00,0.00,0.00,0.00,0.00,0.00,0.00,0.00,'Skipped','Employee not found: EMP003','2026-07-19 13:34:40'),(10,4,4,1,'EMP001','jay','2026-07',26.00,24.00,2.00,192.00,4.00,673.08,0.00,32980.77,'Imported','Overtime amount included: 673.08','2026-07-19 13:37:10'),(11,4,4,2,'EMP002','Bobby','2026-07',26.00,25.00,1.00,162.00,0.00,0.00,0.00,11682.69,'Imported',NULL,'2026-07-19 13:37:11'),(12,4,4,3,'EMP003','Kumar','2026-07',28.00,28.00,0.00,224.00,0.00,0.00,0.00,25000.00,'Imported',NULL,'2026-07-19 13:37:12'),(13,5,4,1,'EMP001','jay','2026-07',26.00,24.00,2.00,192.00,4.00,673.08,0.00,32980.77,'Imported','Overtime amount included: 673.08','2026-07-19 13:38:23'),(14,5,4,2,'EMP002','Bobby','2026-07',26.00,25.00,1.00,162.00,0.00,0.00,0.00,11682.69,'Imported',NULL,'2026-07-19 13:38:24'),(15,5,4,3,'EMP003','Kumar','2026-07',28.00,28.00,0.00,224.00,0.00,0.00,0.00,25000.00,'Imported',NULL,'2026-07-19 13:38:25');
/*!40000 ALTER TABLE `payroll_attendance_lines` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `payroll_employees`
--

DROP TABLE IF EXISTS `payroll_employees`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payroll_employees` (
  `id` int NOT NULL AUTO_INCREMENT,
  `company_id` int NOT NULL,
  `name` varchar(255) NOT NULL,
  `employee_code` varchar(80) DEFAULT NULL,
  `phone` varchar(50) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `designation` varchar(150) DEFAULT NULL,
  `joining_date` date DEFAULT NULL,
  `monthly_salary` decimal(12,2) NOT NULL DEFAULT '0.00',
  `status` varchar(30) NOT NULL DEFAULT 'Active',
  `notes` text,
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_payroll_employee_company` (`company_id`),
  KEY `idx_payroll_employee_status` (`company_id`,`status`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `payroll_employees`
--

LOCK TABLES `payroll_employees` WRITE;
/*!40000 ALTER TABLE `payroll_employees` DISABLE KEYS */;
INSERT INTO `payroll_employees` VALUES (1,4,'jay','EMP001','9898989898','abs@gmail.com','Manager','2026-01-14',35000.00,'Active',NULL,13,'2026-07-17 11:18:57','2026-07-19 13:34:52'),(2,4,'Bobby','EMP002','0202020202',NULL,'Exe','2026-01-02',15000.00,'Active',NULL,13,'2026-07-19 13:35:53','2026-07-19 13:35:53'),(3,4,'Kumar','EMP003','65656565656',NULL,'Sr Exe','2026-01-02',25000.00,'Active',NULL,13,'2026-07-19 13:36:46','2026-07-19 13:36:46');
/*!40000 ALTER TABLE `payroll_employees` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `payroll_entries`
--

DROP TABLE IF EXISTS `payroll_entries`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payroll_entries` (
  `id` int NOT NULL AUTO_INCREMENT,
  `company_id` int NOT NULL,
  `employee_id` int NOT NULL,
  `employee_name` varchar(255) NOT NULL,
  `payroll_month` varchar(7) NOT NULL,
  `payroll_date` date NOT NULL,
  `salary_mode` varchar(40) NOT NULL DEFAULT 'Manual',
  `working_days` decimal(8,2) NOT NULL DEFAULT '0.00',
  `present_days` decimal(8,2) NOT NULL DEFAULT '0.00',
  `absent_days` decimal(8,2) NOT NULL DEFAULT '0.00',
  `total_hours` decimal(10,2) NOT NULL DEFAULT '0.00',
  `overtime_hours` decimal(10,2) NOT NULL DEFAULT '0.00',
  `standard_hours` decimal(10,2) NOT NULL DEFAULT '0.00',
  `basic_salary` decimal(12,2) NOT NULL DEFAULT '0.00',
  `allowances` decimal(12,2) NOT NULL DEFAULT '0.00',
  `deductions` decimal(12,2) NOT NULL DEFAULT '0.00',
  `net_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `status` varchar(30) NOT NULL DEFAULT 'Unpaid',
  `payment_date` date DEFAULT NULL,
  `notes` text,
  `attendance_import_id` int DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_payroll_employee_month` (`company_id`,`employee_id`,`payroll_month`),
  KEY `idx_payroll_entries_company_month` (`company_id`,`payroll_month`),
  KEY `idx_payroll_entries_status` (`company_id`,`status`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `payroll_entries`
--

LOCK TABLES `payroll_entries` WRITE;
/*!40000 ALTER TABLE `payroll_entries` DISABLE KEYS */;
INSERT INTO `payroll_entries` VALUES (1,4,1,'jay','2026-07','2026-07-01','Attendance Import',26.00,24.00,2.00,192.00,4.00,208.00,32307.69,673.08,0.00,32980.77,'Unpaid',NULL,'Imported from attendance machine',5,13,'2026-07-19 13:37:10','2026-07-19 13:38:23'),(2,4,2,'Bobby','2026-07','2026-07-01','Attendance Import',26.00,25.00,1.00,162.00,0.00,208.00,11682.69,0.00,0.00,11682.69,'Paid','2026-07-19',NULL,5,13,'2026-07-19 13:37:11','2026-07-19 13:38:24'),(3,4,3,'Kumar','2026-07','2026-07-01','Attendance Import',28.00,28.00,0.00,224.00,0.00,224.00,25000.00,0.00,0.00,25000.00,'Paid','2026-07-19',NULL,5,13,'2026-07-19 13:37:12','2026-07-19 13:38:25');
/*!40000 ALTER TABLE `payroll_entries` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `petty_cash_attachments`
--

DROP TABLE IF EXISTS `petty_cash_attachments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `petty_cash_attachments` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint unsigned NOT NULL,
  `transaction_id` bigint unsigned NOT NULL,
  `original_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `mime_type` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `size_bytes` int unsigned NOT NULL,
  `file_data` longblob NOT NULL,
  `uploaded_by` bigint unsigned NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_petty_cash_attachment_transaction` (`company_id`,`transaction_id`),
  KEY `fk_petty_cash_attachment_transaction` (`transaction_id`),
  CONSTRAINT `fk_petty_cash_attachment_transaction` FOREIGN KEY (`transaction_id`) REFERENCES `petty_cash_transactions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `petty_cash_attachments`
--

LOCK TABLES `petty_cash_attachments` WRITE;
/*!40000 ALTER TABLE `petty_cash_attachments` DISABLE KEYS */;
/*!40000 ALTER TABLE `petty_cash_attachments` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `petty_cash_settings`
--

DROP TABLE IF EXISTS `petty_cash_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `petty_cash_settings` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint unsigned NOT NULL,
  `fund_name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Main Petty Cash',
  `opening_balance` decimal(15,2) NOT NULL DEFAULT '0.00',
  `current_balance` decimal(15,2) NOT NULL DEFAULT '0.00',
  `imprest_limit` decimal(15,2) NOT NULL DEFAULT '0.00',
  `manager_approval_limit` decimal(15,2) NOT NULL DEFAULT '0.00',
  `currency_code` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'INR',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_petty_cash_settings_company` (`company_id`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `petty_cash_settings`
--

LOCK TABLES `petty_cash_settings` WRITE;
/*!40000 ALTER TABLE `petty_cash_settings` DISABLE KEYS */;
INSERT INTO `petty_cash_settings` VALUES (1,4,'Main Petty Cash',10000.00,9050.00,7000.00,7000.00,'INR',1,'2026-07-27 06:15:06','2026-07-27 14:02:14');
/*!40000 ALTER TABLE `petty_cash_settings` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `petty_cash_transactions`
--

DROP TABLE IF EXISTS `petty_cash_transactions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `petty_cash_transactions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint unsigned NOT NULL,
  `transaction_no` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `transaction_type` enum('EXPENSE','REPLENISHMENT') COLLATE utf8mb4_unicode_ci NOT NULL,
  `transaction_date` date NOT NULL,
  `category` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `payee` varchar(160) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount` decimal(15,2) NOT NULL,
  `payment_method` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reference_no` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('DRAFT','SUBMITTED','MANAGER_APPROVED','ACCOUNTS_APPROVED','POSTED','REJECTED') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'DRAFT',
  `created_by` bigint unsigned NOT NULL,
  `submitted_by` bigint unsigned DEFAULT NULL,
  `submitted_at` datetime DEFAULT NULL,
  `manager_approved_by` bigint unsigned DEFAULT NULL,
  `manager_approved_at` datetime DEFAULT NULL,
  `accounts_approved_by` bigint unsigned DEFAULT NULL,
  `accounts_approved_at` datetime DEFAULT NULL,
  `posted_by` bigint unsigned DEFAULT NULL,
  `posted_at` datetime DEFAULT NULL,
  `rejected_by` bigint unsigned DEFAULT NULL,
  `rejected_at` datetime DEFAULT NULL,
  `rejection_reason` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_petty_cash_transaction_no` (`company_id`,`transaction_no`),
  KEY `idx_petty_cash_company_status` (`company_id`,`status`),
  KEY `idx_petty_cash_company_date` (`company_id`,`transaction_date`),
  KEY `idx_petty_cash_creator` (`company_id`,`created_by`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `petty_cash_transactions`
--

LOCK TABLES `petty_cash_transactions` WRITE;
/*!40000 ALTER TABLE `petty_cash_transactions` DISABLE KEYS */;
INSERT INTO `petty_cash_transactions` VALUES (1,4,'PCE-2026-00001','EXPENSE','2026-07-27','Tea','Cash','paid Tea expences',350.00,'Cash','7358','POSTED',13,13,'2026-07-27 07:39:51',13,'2026-07-27 07:40:10',13,'2026-07-27 07:40:29',13,'2026-07-27 07:40:45',NULL,NULL,NULL,'2026-07-27 07:39:51','2026-07-27 07:40:45'),(2,4,'PCE-2026-00002','EXPENSE','2026-07-27','tea','branch manager','petty cash',500.00,'Cash','16543','POSTED',13,13,'2026-07-27 08:22:17',13,'2026-07-27 08:22:27',13,'2026-07-27 13:50:50',13,'2026-07-27 13:50:52',NULL,NULL,NULL,'2026-07-27 08:22:16','2026-07-27 13:50:52'),(3,4,'PCE-2026-00003','EXPENSE','2026-07-27','Tea','Vsmsi','hibhbhl',100.00,'Cash',NULL,'POSTED',13,13,'2026-07-27 14:01:44',13,'2026-07-27 14:02:02',13,'2026-07-27 14:02:10',13,'2026-07-27 14:02:14',NULL,NULL,NULL,'2026-07-27 14:01:43','2026-07-27 14:02:14');
/*!40000 ALTER TABLE `petty_cash_transactions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `petty_cash_user_permissions`
--

DROP TABLE IF EXISTS `petty_cash_user_permissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `petty_cash_user_permissions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint unsigned NOT NULL,
  `user_id` bigint unsigned NOT NULL,
  `can_create` tinyint(1) NOT NULL DEFAULT '0',
  `can_edit_own` tinyint(1) NOT NULL DEFAULT '0',
  `can_submit` tinyint(1) NOT NULL DEFAULT '0',
  `can_approve` tinyint(1) NOT NULL DEFAULT '0',
  `can_reject` tinyint(1) NOT NULL DEFAULT '0',
  `can_post` tinyint(1) NOT NULL DEFAULT '0',
  `can_view_all` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_petty_cash_permission_user` (`company_id`,`user_id`),
  KEY `idx_petty_cash_permission_company` (`company_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `petty_cash_user_permissions`
--

LOCK TABLES `petty_cash_user_permissions` WRITE;
/*!40000 ALTER TABLE `petty_cash_user_permissions` DISABLE KEYS */;
/*!40000 ALTER TABLE `petty_cash_user_permissions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `petty_cash_workflow_history`
--

DROP TABLE IF EXISTS `petty_cash_workflow_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `petty_cash_workflow_history` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint unsigned NOT NULL,
  `transaction_id` bigint unsigned NOT NULL,
  `action` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `from_status` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `to_status` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `comments` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `action_by` bigint unsigned NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_petty_cash_history_transaction` (`company_id`,`transaction_id`),
  KEY `fk_petty_cash_history_transaction` (`transaction_id`),
  CONSTRAINT `fk_petty_cash_history_transaction` FOREIGN KEY (`transaction_id`) REFERENCES `petty_cash_transactions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=16 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `petty_cash_workflow_history`
--

LOCK TABLES `petty_cash_workflow_history` WRITE;
/*!40000 ALTER TABLE `petty_cash_workflow_history` DISABLE KEYS */;
INSERT INTO `petty_cash_workflow_history` VALUES (1,4,1,'CREATE',NULL,'DRAFT',NULL,13,'2026-07-27 07:39:51'),(2,4,1,'SUBMIT','DRAFT','SUBMITTED',NULL,13,'2026-07-27 07:39:51'),(3,4,1,'MANAGER_APPROVE','SUBMITTED','MANAGER_APPROVED',NULL,13,'2026-07-27 07:40:10'),(4,4,1,'ACCOUNTS_APPROVE','MANAGER_APPROVED','ACCOUNTS_APPROVED',NULL,13,'2026-07-27 07:40:29'),(5,4,1,'POST','ACCOUNTS_APPROVED','POSTED',NULL,13,'2026-07-27 07:40:45'),(6,4,2,'CREATE',NULL,'DRAFT',NULL,13,'2026-07-27 08:22:16'),(7,4,2,'SUBMIT','DRAFT','SUBMITTED',NULL,13,'2026-07-27 08:22:17'),(8,4,2,'MANAGER_APPROVE','SUBMITTED','MANAGER_APPROVED',NULL,13,'2026-07-27 08:22:27'),(9,4,2,'ACCOUNTS_APPROVE','MANAGER_APPROVED','ACCOUNTS_APPROVED',NULL,13,'2026-07-27 13:50:50'),(10,4,2,'POST','ACCOUNTS_APPROVED','POSTED',NULL,13,'2026-07-27 13:50:52'),(11,4,3,'CREATE',NULL,'DRAFT',NULL,13,'2026-07-27 14:01:43'),(12,4,3,'SUBMIT','DRAFT','SUBMITTED',NULL,13,'2026-07-27 14:01:44'),(13,4,3,'MANAGER_APPROVE','SUBMITTED','MANAGER_APPROVED',NULL,13,'2026-07-27 14:02:02'),(14,4,3,'ACCOUNTS_APPROVE','MANAGER_APPROVED','ACCOUNTS_APPROVED',NULL,13,'2026-07-27 14:02:10'),(15,4,3,'POST','ACCOUNTS_APPROVED','POSTED',NULL,13,'2026-07-27 14:02:14');
/*!40000 ALTER TABLE `petty_cash_workflow_history` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `plans`
--

DROP TABLE IF EXISTS `plans`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `plans` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `price` decimal(10,2) NOT NULL,
  `dashboard` tinyint(1) DEFAULT '1',
  `sales` tinyint(1) DEFAULT '0',
  `purchases` tinyint(1) DEFAULT '0',
  `inventory` tinyint(1) DEFAULT '0',
  `contacts` tinyint(1) DEFAULT '0',
  `banking` tinyint(1) DEFAULT '0',
  `accounting` tinyint(1) DEFAULT '0',
  `reports` tinyint(1) DEFAULT '0',
  `automation` tinyint(1) DEFAULT '0',
  `integrations` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `plans`
--

LOCK TABLES `plans` WRITE;
/*!40000 ALTER TABLE `plans` DISABLE KEYS */;
INSERT INTO `plans` VALUES (1,'Basic',999.00,1,1,0,0,1,0,0,1,0,0),(2,'Pro',1999.00,1,1,1,1,1,1,0,1,0,0),(3,'Enterprise',4999.00,1,1,1,1,1,1,1,1,1,1);
/*!40000 ALTER TABLE `plans` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `printer_profiles`
--

DROP TABLE IF EXISTS `printer_profiles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `printer_profiles` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `company_id` bigint unsigned NOT NULL,
  `name` varchar(150) NOT NULL,
  `label_width_mm` decimal(8,2) NOT NULL,
  `label_height_mm` decimal(8,2) NOT NULL,
  `dpi` int NOT NULL DEFAULT '203',
  `labels_per_row` int NOT NULL DEFAULT '1',
  `horizontal_gap_mm` decimal(8,2) NOT NULL DEFAULT '0.00',
  `vertical_gap_mm` decimal(8,2) NOT NULL DEFAULT '0.00',
  `margin_top_mm` decimal(8,2) NOT NULL DEFAULT '0.00',
  `margin_bottom_mm` decimal(8,2) NOT NULL DEFAULT '0.00',
  `margin_left_mm` decimal(8,2) NOT NULL DEFAULT '0.00',
  `margin_right_mm` decimal(8,2) NOT NULL DEFAULT '0.00',
  `paper_type` varchar(30) NOT NULL DEFAULT 'thermal_roll',
  `is_default` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_printer_profile_company_name` (`company_id`,`name`),
  KEY `idx_printer_profiles_company` (`company_id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `printer_profiles`
--

LOCK TABLES `printer_profiles` WRITE;
/*!40000 ALTER TABLE `printer_profiles` DISABLE KEYS */;
INSERT INTO `printer_profiles` VALUES (1,4,'Test Barcode',50.00,25.00,203,1,0.00,0.00,0.00,0.00,0.00,0.00,'thermal_roll',0,'2026-08-09 16:09:29','2026-08-09 16:09:29');
/*!40000 ALTER TABLE `printer_profiles` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `product_returns`
--

DROP TABLE IF EXISTS `product_returns`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `product_returns` (
  `id` int NOT NULL AUTO_INCREMENT,
  `company_id` int NOT NULL,
  `type` varchar(20) NOT NULL,
  `return_number` varchar(50) NOT NULL,
  `return_date` date NOT NULL,
  `party_type` varchar(20) NOT NULL,
  `party_id` int DEFAULT NULL,
  `party_name` varchar(255) NOT NULL,
  `reference_number` varchar(100) DEFAULT NULL,
  `subtotal` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tax_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `notes` text,
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_product_returns_company_number` (`company_id`,`return_number`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `product_returns`
--

LOCK TABLES `product_returns` WRITE;
/*!40000 ALTER TABLE `product_returns` DISABLE KEYS */;
INSERT INTO `product_returns` VALUES (1,4,'purchase','PRET-0001','2026-07-16','vendor',10,'Alpha enterprises','5556',60.00,3.00,63.00,'Damage Receievd',13,'2026-07-16 06:28:16'),(2,4,'sales','SRET-0001','2026-07-16','customer',10,'Raj',NULL,40.00,2.00,42.00,NULL,13,'2026-07-16 06:42:06');
/*!40000 ALTER TABLE `product_returns` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `products`
--

DROP TABLE IF EXISTS `products`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `products` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `sellingPrice` decimal(10,2) NOT NULL,
  `stock` int DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `company_id` int NOT NULL,
  `mrp` decimal(10,2) NOT NULL DEFAULT '0.00',
  `sku` varchar(100) DEFAULT NULL,
  `barcode` varchar(100) DEFAULT NULL,
  `hsn` varchar(30) DEFAULT NULL,
  `category` varchar(100) DEFAULT NULL,
  `unit` varchar(30) NOT NULL DEFAULT 'PCS',
  `gst` decimal(5,2) NOT NULL DEFAULT '18.00',
  `purchase_price` decimal(10,2) NOT NULL DEFAULT '0.00',
  `opening_stock` decimal(10,2) NOT NULL DEFAULT '0.00',
  `reorder_level` decimal(10,2) NOT NULL DEFAULT '0.00',
  `status` varchar(20) NOT NULL DEFAULT 'Active',
  `batch_no` varchar(100) DEFAULT NULL,
  `manufactured_date` date DEFAULT NULL,
  `expiry_date` date DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_products_company_id` (`company_id`)
) ENGINE=InnoDB AUTO_INCREMENT=18 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `products`
--

LOCK TABLES `products` WRITE;
/*!40000 ALTER TABLE `products` DISABLE KEYS */;
INSERT INTO `products` VALUES (2,'Notebook',50.00,100,'2026-03-22 17:55:47',1,0.00,NULL,NULL,NULL,NULL,'PCS',18.00,0.00,0.00,0.00,'Active',NULL,NULL,NULL),(3,'Pencil',10.00,101,'2026-03-22 17:55:47',1,0.00,NULL,NULL,NULL,NULL,'PCS',18.00,0.00,0.00,0.00,'Active',NULL,NULL,NULL),(4,'shampoo',300.00,101,'2026-03-22 18:16:03',1,0.00,NULL,NULL,NULL,NULL,'PCS',18.00,0.00,0.00,0.00,'Active',NULL,NULL,NULL),(5,'Toothbrush',25.00,80,'2026-03-22 18:30:53',1,0.00,NULL,NULL,NULL,NULL,'PCS',18.00,0.00,0.00,0.00,'Active',NULL,NULL,NULL),(6,'Kissan Fresh Tomato Ketchup',112.00,22,'2026-03-27 01:29:49',1,0.00,NULL,NULL,NULL,NULL,'PCS',18.00,0.00,0.00,0.00,'Active',NULL,NULL,NULL),(7,'shampoo',230.00,2,'2026-07-13 11:08:05',4,250.00,'Shampoo22','','190230','Shampoo','PCS',12.00,0.00,5.00,0.00,'Active','',NULL,NULL),(8,'Oil',110.00,35,'2026-07-13 11:16:06',4,120.00,'OIL25','','15121110','Kitchan','PCS',18.00,115.00,15.00,0.00,'Active','',NULL,NULL),(9,'Tea Powder',50.00,17,'2026-07-14 03:16:23',4,60.00,'TEA56','','210111','Kitchan','PCS',18.00,0.00,0.00,0.00,'Active','',NULL,NULL),(10,'Sugar',78.00,5,'2026-07-14 03:17:26',4,80.00,'Kit0085','RVX000400000010','170410','Grocery','PCS',5.00,0.00,0.00,0.00,'Active','',NULL,NULL),(11,'MTR Sambar powder',10.00,11,'2026-07-15 06:37:56',4,15.00,'MASALA003','RVX000400000011','210610','Masala Pwder','PCS',5.00,0.00,0.00,0.00,'Active','',NULL,NULL),(12,'Priya Mango pickle',75.00,6,'2026-07-15 06:38:59',4,80.00,'PICKLE002','RVX000400000012','20019000','PICKLES','PCS',12.00,0.00,0.00,0.00,'Active','',NULL,NULL),(13,'Maggi Noodles',50.00,15,'2026-07-15 06:42:20',4,60.00,'','','190230','Cooking Food','PCS',12.00,70.00,0.00,0.00,'Active','',NULL,NULL),(14,'Water Bottle',50.00,8,'2026-07-16 06:13:58',4,60.00,'BT002','12345','55256','House Hold','PCS',5.00,12.00,0.00,5.00,'Active','',NULL,NULL),(15,'Cups',40.00,20,'2026-07-16 06:16:19',4,50.00,'Cup55','1234','552567','House Hold','PCS',5.00,30.00,0.00,5.00,'Active','',NULL,NULL),(16,'5L Cooker',1500.00,9,'2026-07-16 06:22:56',4,1500.00,'Cooker002','123456','552567','House Hold','PCS',18.00,1300.00,0.00,5.00,'Active','',NULL,NULL),(17,'Induction Stove',3000.00,3,'2026-07-16 06:24:24',4,3000.00,'Induc5525','1234567','552568','House Hold / Kitchen','PCS',18.00,2500.00,0.00,3.00,'Active','',NULL,NULL);
/*!40000 ALTER TABLE `products` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `purchase_order_items`
--

DROP TABLE IF EXISTS `purchase_order_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `purchase_order_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `purchase_order_id` int NOT NULL,
  `product_id` int NOT NULL,
  `product_name` varchar(255) NOT NULL,
  `mrp` decimal(10,2) NOT NULL DEFAULT '0.00',
  `quantity` decimal(12,2) NOT NULL DEFAULT '0.00',
  `price` decimal(12,2) NOT NULL DEFAULT '0.00',
  `gst_percent` decimal(5,2) NOT NULL DEFAULT '0.00',
  `cgst` decimal(12,2) NOT NULL DEFAULT '0.00',
  `sgst` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total` decimal(12,2) NOT NULL DEFAULT '0.00',
  PRIMARY KEY (`id`),
  KEY `idx_po_items_order` (`purchase_order_id`),
  KEY `idx_po_items_product` (`product_id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `purchase_order_items`
--

LOCK TABLES `purchase_order_items` WRITE;
/*!40000 ALTER TABLE `purchase_order_items` DISABLE KEYS */;
INSERT INTO `purchase_order_items` VALUES (1,1,8,'Oil',120.00,10.00,120.00,18.00,108.00,108.00,1416.00),(2,2,16,'5L Cooker',1500.00,5.00,1300.00,18.00,585.00,585.00,7670.00),(3,2,15,'Cups',50.00,10.00,30.00,5.00,7.50,7.50,315.00);
/*!40000 ALTER TABLE `purchase_order_items` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `purchase_orders`
--

DROP TABLE IF EXISTS `purchase_orders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `purchase_orders` (
  `id` int NOT NULL AUTO_INCREMENT,
  `company_id` int NOT NULL,
  `vendor_id` int NOT NULL,
  `po_number` varchar(100) NOT NULL,
  `po_date` date NOT NULL,
  `expected_date` date DEFAULT NULL,
  `status` varchar(30) NOT NULL DEFAULT 'Draft',
  `notes` text,
  `subtotal` decimal(12,2) NOT NULL DEFAULT '0.00',
  `gst_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_po_company_number` (`company_id`,`po_number`),
  KEY `idx_po_company_vendor` (`company_id`,`vendor_id`),
  KEY `idx_po_company_status` (`company_id`,`status`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `purchase_orders`
--

LOCK TABLES `purchase_orders` WRITE;
/*!40000 ALTER TABLE `purchase_orders` DISABLE KEYS */;
INSERT INTO `purchase_orders` VALUES (1,4,10,'PO-0001','2026-07-17',NULL,'Draft',NULL,1200.00,216.00,1416.00,13,'2026-07-17 10:57:20','2026-07-17 10:57:20'),(2,4,9,'PO-0002','2026-07-18',NULL,'Converted',NULL,6800.00,1185.00,7985.00,13,'2026-07-18 10:28:30','2026-07-18 11:20:14');
/*!40000 ALTER TABLE `purchase_orders` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `quotation_items`
--

DROP TABLE IF EXISTS `quotation_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `quotation_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `quotation_id` int NOT NULL,
  `product_id` int NOT NULL,
  `product_name` varchar(255) NOT NULL,
  `hsn` varchar(100) DEFAULT NULL,
  `mrp` decimal(10,2) NOT NULL DEFAULT '0.00',
  `quantity` decimal(12,2) NOT NULL DEFAULT '0.00',
  `price` decimal(12,2) NOT NULL DEFAULT '0.00',
  `discount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `gst_percent` decimal(5,2) NOT NULL DEFAULT '0.00',
  `cgst` decimal(12,2) NOT NULL DEFAULT '0.00',
  `sgst` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total` decimal(12,2) NOT NULL DEFAULT '0.00',
  PRIMARY KEY (`id`),
  KEY `idx_quotation_items_quote` (`quotation_id`),
  KEY `idx_quotation_items_product` (`product_id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `quotation_items`
--

LOCK TABLES `quotation_items` WRITE;
/*!40000 ALTER TABLE `quotation_items` DISABLE KEYS */;
INSERT INTO `quotation_items` VALUES (1,1,16,'5L Cooker','552567',1500.00,1.00,1500.00,0.00,18.00,135.00,135.00,1770.00);
/*!40000 ALTER TABLE `quotation_items` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `quotations`
--

DROP TABLE IF EXISTS `quotations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `quotations` (
  `id` int NOT NULL AUTO_INCREMENT,
  `company_id` int NOT NULL,
  `customer_id` int DEFAULT NULL,
  `customer_name` varchar(255) NOT NULL,
  `quotation_number` varchar(100) NOT NULL,
  `quotation_date` date NOT NULL,
  `valid_until` date DEFAULT NULL,
  `status` varchar(30) NOT NULL DEFAULT 'Draft',
  `notes` text,
  `subtotal` decimal(12,2) NOT NULL DEFAULT '0.00',
  `discount_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tax_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_quotation_company_number` (`company_id`,`quotation_number`),
  KEY `idx_quotation_company_customer` (`company_id`,`customer_name`),
  KEY `idx_quotation_company_status` (`company_id`,`status`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `quotations`
--

LOCK TABLES `quotations` WRITE;
/*!40000 ALTER TABLE `quotations` DISABLE KEYS */;
INSERT INTO `quotations` VALUES (1,4,6,'c1','QT-0001','2026-07-18',NULL,'Draft',NULL,1500.00,0.00,270.00,1770.00,13,'2026-07-18 11:55:30','2026-07-18 11:55:30');
/*!40000 ALTER TABLE `quotations` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `receipt_entries`
--

DROP TABLE IF EXISTS `receipt_entries`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `receipt_entries` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `receipt_number` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `receipt_date` date NOT NULL,
  `receipt_type` enum('CUSTOMER','OTHER','ADVANCE') COLLATE utf8mb4_unicode_ci NOT NULL,
  `customer_id` bigint unsigned DEFAULT NULL,
  `invoice_id` bigint unsigned DEFAULT NULL,
  `received_in_account_id` bigint unsigned NOT NULL,
  `received_from_account_id` bigint unsigned NOT NULL,
  `amount` decimal(15,2) NOT NULL,
  `payment_mode` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reference_number` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `narration` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `company_id` bigint unsigned NOT NULL,
  `created_by` bigint unsigned NOT NULL,
  `journal_entry_id` bigint unsigned DEFAULT NULL,
  `payment_id` bigint unsigned DEFAULT NULL,
  `advance_id` bigint unsigned DEFAULT NULL,
  `idempotency_key` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_receipt_company_number` (`company_id`,`receipt_number`),
  UNIQUE KEY `uq_receipt_company_idempotency` (`company_id`,`idempotency_key`),
  KEY `idx_receipt_company_date` (`company_id`,`receipt_date`),
  KEY `idx_receipt_customer` (`company_id`,`customer_id`),
  KEY `idx_receipt_invoice` (`company_id`,`invoice_id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `receipt_entries`
--

LOCK TABLES `receipt_entries` WRITE;
/*!40000 ALTER TABLE `receipt_entries` DISABLE KEYS */;
INSERT INTO `receipt_entries` VALUES (1,'RCPT-2026-000001','2026-07-29','CUSTOMER',7,42,21,24,611.24,'Cash',NULL,NULL,4,13,12,9,NULL,'07184eae-181f-4727-93cc-8719e4356674','2026-07-29 14:20:35'),(2,'RCPT-2026-000002','2026-08-01','CUSTOMER',13,50,21,24,100.00,'UPI','88998858','balance amount receievd',4,13,15,11,NULL,'f8a0d6c4-58b0-4042-8c37-350d8938e4a0','2026-08-01 21:15:27');
/*!40000 ALTER TABLE `receipt_entries` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `recurring_invoice_items`
--

DROP TABLE IF EXISTS `recurring_invoice_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `recurring_invoice_items` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `recurring_invoice_id` bigint unsigned NOT NULL,
  `product_id` bigint unsigned NOT NULL,
  `description` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `quantity` decimal(12,3) NOT NULL,
  `unit_price` decimal(15,2) NOT NULL,
  `tax_rate` decimal(5,2) NOT NULL DEFAULT '0.00',
  `amount` decimal(15,2) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_recurring_invoice_items_parent` (`recurring_invoice_id`),
  CONSTRAINT `fk_recurring_invoice_items_parent` FOREIGN KEY (`recurring_invoice_id`) REFERENCES `recurring_invoices` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `recurring_invoice_items`
--

LOCK TABLES `recurring_invoice_items` WRITE;
/*!40000 ALTER TABLE `recurring_invoice_items` DISABLE KEYS */;
/*!40000 ALTER TABLE `recurring_invoice_items` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `recurring_invoice_runs`
--

DROP TABLE IF EXISTS `recurring_invoice_runs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `recurring_invoice_runs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `recurring_invoice_id` bigint unsigned NOT NULL,
  `generated_invoice_id` bigint unsigned DEFAULT NULL,
  `scheduled_date` date NOT NULL,
  `status` enum('PROCESSING','SUCCESS','FAILED') COLLATE utf8mb4_unicode_ci NOT NULL,
  `error_message` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `company_id` bigint unsigned NOT NULL,
  `generated_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_recurring_invoice_run` (`recurring_invoice_id`,`scheduled_date`),
  KEY `idx_recurring_invoice_runs_company` (`company_id`,`recurring_invoice_id`),
  CONSTRAINT `fk_recurring_invoice_runs_parent` FOREIGN KEY (`recurring_invoice_id`) REFERENCES `recurring_invoices` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `recurring_invoice_runs`
--

LOCK TABLES `recurring_invoice_runs` WRITE;
/*!40000 ALTER TABLE `recurring_invoice_runs` DISABLE KEYS */;
/*!40000 ALTER TABLE `recurring_invoice_runs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `recurring_invoices`
--

DROP TABLE IF EXISTS `recurring_invoices`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `recurring_invoices` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `customer_id` bigint unsigned NOT NULL,
  `frequency` enum('daily','weekly','monthly','quarterly','yearly') COLLATE utf8mb4_unicode_ci NOT NULL,
  `repeat_every` int unsigned NOT NULL DEFAULT '1',
  `start_date` date NOT NULL,
  `end_date` date DEFAULT NULL,
  `next_invoice_date` date NOT NULL,
  `max_occurrences` int unsigned DEFAULT NULL,
  `generated_count` int unsigned NOT NULL DEFAULT '0',
  `auto_email` tinyint(1) NOT NULL DEFAULT '0',
  `status` enum('Draft','Active','Paused','Completed','Cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Draft',
  `notes` text COLLATE utf8mb4_unicode_ci,
  `company_id` bigint unsigned NOT NULL,
  `created_by` bigint unsigned NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_recurring_invoices_company_status` (`company_id`,`status`),
  KEY `idx_recurring_invoices_due` (`company_id`,`next_invoice_date`,`status`),
  KEY `idx_recurring_invoices_customer` (`company_id`,`customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `recurring_invoices`
--

LOCK TABLES `recurring_invoices` WRITE;
/*!40000 ALTER TABLE `recurring_invoices` DISABLE KEYS */;
/*!40000 ALTER TABLE `recurring_invoices` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `return_items`
--

DROP TABLE IF EXISTS `return_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `return_items` (
  `id` int NOT NULL AUTO_INCREMENT,
  `return_id` int NOT NULL,
  `company_id` int NOT NULL,
  `product_id` int NOT NULL,
  `product_name` varchar(255) NOT NULL,
  `batch_no` varchar(100) DEFAULT NULL,
  `quantity` decimal(10,2) NOT NULL DEFAULT '0.00',
  `unit_price` decimal(12,2) NOT NULL DEFAULT '0.00',
  `mrp` decimal(12,2) NOT NULL DEFAULT '0.00',
  `gst_rate` decimal(5,2) NOT NULL DEFAULT '0.00',
  `total_price` decimal(12,2) NOT NULL DEFAULT '0.00',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_return_items_return` (`return_id`),
  KEY `idx_return_items_company_product` (`company_id`,`product_id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `return_items`
--

LOCK TABLES `return_items` WRITE;
/*!40000 ALTER TABLE `return_items` DISABLE KEYS */;
INSERT INTO `return_items` VALUES (1,1,4,15,'Cups',NULL,2.00,30.00,50.00,5.00,63.00,'2026-07-16 06:28:16'),(2,2,4,15,'Cups',NULL,1.00,40.00,50.00,5.00,42.00,'2026-07-16 06:42:06');
/*!40000 ALTER TABLE `return_items` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `user_branch_memberships`
--

DROP TABLE IF EXISTS `user_branch_memberships`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_branch_memberships` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `company_id` int NOT NULL,
  `branch_id` int NOT NULL,
  `is_default` tinyint(1) NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_branch_membership` (`user_id`,`branch_id`),
  KEY `idx_user_branch_company` (`user_id`,`company_id`,`is_active`),
  KEY `fk_user_branch_company` (`company_id`),
  KEY `fk_user_branch_branch` (`branch_id`),
  CONSTRAINT `fk_user_branch_branch` FOREIGN KEY (`branch_id`) REFERENCES `branches` (`id`),
  CONSTRAINT `fk_user_branch_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`),
  CONSTRAINT `fk_user_branch_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user_branch_memberships`
--

LOCK TABLES `user_branch_memberships` WRITE;
/*!40000 ALTER TABLE `user_branch_memberships` DISABLE KEYS */;
INSERT INTO `user_branch_memberships` VALUES (1,10,3,2,1,1,'2026-08-02 09:40:09'),(2,11,3,2,1,1,'2026-08-02 09:40:09'),(3,13,4,3,1,1,'2026-08-02 09:40:09'),(4,17,4,3,1,1,'2026-08-02 09:40:09'),(5,14,5,4,1,1,'2026-08-02 09:40:09'),(6,15,6,5,1,1,'2026-08-02 09:40:09'),(7,16,7,6,1,1,'2026-08-02 09:40:09');
/*!40000 ALTER TABLE `user_branch_memberships` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `user_company_memberships`
--

DROP TABLE IF EXISTS `user_company_memberships`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_company_memberships` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `company_id` int NOT NULL,
  `membership_role` enum('owner','staff') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'staff',
  `is_default` tinyint(1) NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_company_membership` (`user_id`,`company_id`),
  KEY `idx_membership_company` (`company_id`,`is_active`),
  CONSTRAINT `fk_membership_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`),
  CONSTRAINT `fk_membership_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user_company_memberships`
--

LOCK TABLES `user_company_memberships` WRITE;
/*!40000 ALTER TABLE `user_company_memberships` DISABLE KEYS */;
INSERT INTO `user_company_memberships` VALUES (1,10,3,'owner',1,1,'2026-08-02 09:34:50','2026-08-02 09:34:50'),(2,11,3,'staff',1,1,'2026-08-02 09:34:50','2026-08-02 09:34:50'),(3,13,4,'owner',1,1,'2026-08-02 09:34:50','2026-08-02 09:34:50'),(4,17,4,'staff',1,1,'2026-08-02 09:34:50','2026-08-02 09:34:50'),(5,14,5,'owner',1,1,'2026-08-02 09:34:50','2026-08-02 09:34:50'),(6,15,6,'owner',1,1,'2026-08-02 09:34:50','2026-08-02 09:34:50'),(7,16,7,'owner',1,1,'2026-08-02 09:34:50','2026-08-02 09:34:50');
/*!40000 ALTER TABLE `user_company_memberships` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `email` varchar(255) DEFAULT NULL,
  `password` varchar(255) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `company_id` int DEFAULT NULL,
  `role` enum('owner','admin','staff') DEFAULT 'staff',
  `organization_id` int DEFAULT NULL,
  `access_role` varchar(30) NOT NULL DEFAULT 'sales',
  `permissions` longtext,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `last_login_at` datetime DEFAULT NULL,
  `must_change_password` tinyint(1) NOT NULL DEFAULT '0',
  `password_reset_token_hash` char(64) DEFAULT NULL,
  `password_reset_expires_at` datetime DEFAULT NULL,
  `password_changed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  KEY `fk_users_company` (`company_id`),
  KEY `organization_id` (`organization_id`),
  CONSTRAINT `fk_users_company` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE,
  CONSTRAINT `users_ibfk_1` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=18 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `users`
--

LOCK TABLES `users` WRITE;
/*!40000 ALTER TABLE `users` DISABLE KEYS */;
INSERT INTO `users` VALUES (10,'Demo Owner','owner@demo.com','$2b$10$TTVbP857WxxrOOl.ueLBSe5u6udxxHpNmET0I9MrMCir5IvQi0jeq','2026-02-01 21:53:00',3,'owner',1,'sales',NULL,1,NULL,0,NULL,NULL,NULL),(11,'Staff One','staff1@demo.com','$2b$10$f91/QsO9GLd3PwBWeie4Be/g3eWF6vVO5lIVVZW755vyu988MEZrm','2026-02-02 09:51:13',3,'staff',1,'sales',NULL,1,NULL,0,NULL,NULL,NULL),(13,'Admin','auth@test.com','$2b$10$AD4YCMM4UAc6mlmuulhToun2S6b7sOTufaTNJ8N6I2M2TDNett6Ka','2026-02-23 07:47:54',4,'owner',1,'sales',NULL,1,'2026-08-09 18:40:28',0,NULL,NULL,'2026-07-23 11:11:47'),(14,'Admin','admin@gmail.com','$2b$10$xHsYMnIxo/gDdsIwTHC3POJgSvncfTXy4A4V9Uv/AQUQw6xesYeVW','2026-03-01 11:06:31',5,'owner',NULL,'sales',NULL,1,NULL,0,NULL,NULL,NULL),(15,'Admin','admin@test.com','$2b$10$QornLwuuUSeMfFMv0IHMzu1ycas1AYur1KaT5R58M8n5kcYIUEhPm','2026-03-03 09:43:56',6,'owner',NULL,'sales',NULL,1,NULL,0,NULL,NULL,NULL),(16,'Admin','admin@billing.com','$2b$10$SdGspckO5w3PPStYTl1Xk.Nw7I3qzjCHdIgcQ0S1YSb5ffJQkFYmi','2026-03-05 06:16:42',7,'owner',NULL,'sales',NULL,1,NULL,0,NULL,NULL,NULL),(17,'Dilip','dilip@test.com','$2b$10$EZF5BH1SUJY6KfGT9VztzOgheWn81onlUnDQW28PFCyHhu74yV6FO','2026-07-17 07:37:56',4,'staff',NULL,'sales',NULL,1,NULL,0,NULL,NULL,NULL);
/*!40000 ALTER TABLE `users` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `vendor_bank_accounts`
--

DROP TABLE IF EXISTS `vendor_bank_accounts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `vendor_bank_accounts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `vendor_id` int NOT NULL,
  `company_id` int NOT NULL,
  `account_holder_name` varchar(150) DEFAULT NULL,
  `bank_name` varchar(150) NOT NULL,
  `account_number` varchar(50) NOT NULL,
  `ifsc_code` varchar(11) DEFAULT NULL,
  `branch_name` varchar(150) DEFAULT NULL,
  `is_primary` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_vendor_bank_vendor` (`vendor_id`),
  KEY `idx_vendor_bank_company` (`company_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `vendor_bank_accounts`
--

LOCK TABLES `vendor_bank_accounts` WRITE;
/*!40000 ALTER TABLE `vendor_bank_accounts` DISABLE KEYS */;
/*!40000 ALTER TABLE `vendor_bank_accounts` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `vendor_payments`
--

DROP TABLE IF EXISTS `vendor_payments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `vendor_payments` (
  `id` int NOT NULL AUTO_INCREMENT,
  `vendor_id` int NOT NULL,
  `bill_id` int DEFAULT NULL,
  `amount` decimal(10,2) NOT NULL,
  `payment_date` date DEFAULT NULL,
  `payment_method` varchar(50) DEFAULT NULL,
  `paid_from_account_id` int DEFAULT NULL,
  `reference_number` varchar(120) DEFAULT NULL,
  `notes` text,
  `company_id` int DEFAULT NULL,
  `created_by` int DEFAULT NULL,
  `journal_entry_id` bigint DEFAULT NULL,
  `idempotency_key` varchar(100) DEFAULT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'SUCCESS',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_vendor_payment_submission` (`company_id`,`idempotency_key`)
) ENGINE=InnoDB AUTO_INCREMENT=13 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `vendor_payments`
--

LOCK TABLES `vendor_payments` WRITE;
/*!40000 ALTER TABLE `vendor_payments` DISABLE KEYS */;
INSERT INTO `vendor_payments` VALUES (1,1,NULL,2000.00,'2026-03-04','UPI',NULL,NULL,'Advance payment',7,NULL,NULL,NULL,'SUCCESS','2026-03-05 06:25:44'),(2,1,NULL,5000.00,'2026-03-07','Cash',NULL,NULL,NULL,7,NULL,NULL,NULL,'SUCCESS','2026-03-05 07:50:38'),(3,8,20,272.00,'2026-07-14','Cash',NULL,NULL,'Partial payment for BILL-0005',4,NULL,NULL,NULL,'SUCCESS','2026-07-14 07:52:06'),(4,9,21,500.00,'2026-07-15','Cash',NULL,NULL,'Partial payment for BILL-0006',4,NULL,NULL,NULL,'SUCCESS','2026-07-15 06:46:21'),(5,10,25,15000.00,'2026-07-16','Cash',NULL,NULL,'Partial payment for BILL-0010',4,NULL,NULL,NULL,'SUCCESS','2026-07-16 06:26:06'),(8,9,28,784.00,'2026-08-01','Bank Transfer',21,'5656259',NULL,4,13,13,'bd540cc9-076a-4127-941b-d618fb5bbb7a','SUCCESS','2026-08-01 18:44:38'),(9,9,27,678.50,'2026-08-01','Cheque',21,'55699',NULL,4,13,14,'4ffbff97-da2d-4318-8ff6-203594ee718f','SUCCESS','2026-08-01 18:53:00'),(10,9,26,7985.00,'2026-08-03','UPI',21,'55658555',NULL,4,13,16,'bf1196c2-6d8e-43cd-aca4-6746321dc002','SUCCESS','2026-08-03 06:48:48'),(11,9,21,349.60,'2026-08-03','Cash',20,NULL,NULL,4,13,17,'3518c897-aa25-4c12-8d3d-cd451c5c1395','SUCCESS','2026-08-03 06:49:15'),(12,10,25,5000.00,'2026-08-03','Bank Transfer',21,NULL,NULL,4,13,18,'eb45655b-3cda-4e6e-aa71-f690ed478f98','SUCCESS','2026-08-03 16:07:27');
/*!40000 ALTER TABLE `vendor_payments` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `vendors`
--

DROP TABLE IF EXISTS `vendors`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `vendors` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `phone` varchar(20) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `gst_number` varchar(50) DEFAULT NULL,
  `address` text,
  `status` enum('Active','Inactive') DEFAULT 'Active',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `company_id` int NOT NULL,
  `pan_number` varchar(10) DEFAULT NULL,
  `opening_balance` decimal(15,2) NOT NULL DEFAULT '0.00',
  `opening_balance_type` varchar(20) NOT NULL DEFAULT 'to_pay',
  `party_category` varchar(100) DEFAULT NULL,
  `billing_address` text,
  `shipping_address` text,
  `credit_period_days` int NOT NULL DEFAULT '30',
  `credit_limit` decimal(15,2) NOT NULL DEFAULT '0.00',
  `contact_person_name` varchar(150) DEFAULT NULL,
  `contact_person_dob` date DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_vendors_company_id` (`company_id`)
) ENGINE=InnoDB AUTO_INCREMENT=11 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `vendors`
--

LOCK TABLES `vendors` WRITE;
/*!40000 ALTER TABLE `vendors` DISABLE KEYS */;
INSERT INTO `vendors` VALUES (1,'ABC Traders','9876543210','abc@test.com','29ABCDE1234F1Z5','Bangalore','Active','2026-03-03 08:27:47',1,NULL,0.00,'to_pay',NULL,NULL,NULL,30,0.00,NULL,NULL),(2,'ABC Traders','9876543210','abc@test.com','29ABCDE1234F1Z5','Bangalore','Active','2026-03-03 10:11:23',1,NULL,0.00,'to_pay',NULL,NULL,NULL,30,0.00,NULL,NULL),(3,'jay','5252525252','doo@email.com','36A3756B265858','hyderababd','Active','2026-03-09 01:40:47',1,NULL,0.00,'to_pay',NULL,NULL,NULL,30,0.00,NULL,NULL),(4,'Nani LLC','98989565956','xyz@gmail.com',',365aadck56feed','hyd','Active','2026-03-27 01:30:57',1,NULL,0.00,'to_pay',NULL,NULL,NULL,30,0.00,NULL,NULL),(5,'Lotus LLC','885898956','lotus785@gmail.com','36A336S12BSRC','hyderababd','Active','2026-04-12 20:09:12',1,NULL,0.00,'to_pay',NULL,NULL,NULL,30,0.00,NULL,NULL),(6,'Johns LLC','99858566656','abc@gmail.com','','hyderabad ','Active','2026-07-13 11:18:09',4,NULL,0.00,'to_pay',NULL,NULL,NULL,30,0.00,NULL,NULL),(7,'Venu Enterprises','','','','Chitoor','Active','2026-07-13 17:45:35',4,NULL,0.00,'to_pay',NULL,NULL,NULL,30,0.00,NULL,NULL),(8,'PMJ TRaders','9995595959','','','Nellore','Active','2026-07-14 07:50:42',4,NULL,0.00,'to_pay',NULL,NULL,NULL,30,0.00,NULL,NULL),(9,'PKD Traders','8585858585','','','Vijayawada','Active','2026-07-15 06:43:36',4,NULL,0.00,'to_pay',NULL,NULL,NULL,30,0.00,NULL,NULL),(10,'Alpha enterprises','2222222222','','','Kukatpally','Active','2026-07-16 06:19:12',4,NULL,0.00,'to_pay',NULL,NULL,NULL,30,0.00,NULL,NULL);
/*!40000 ALTER TABLE `vendors` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-08-10  8:29:43
