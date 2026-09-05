const db = require("../db/connection");
const { requireFinancialYearForDate, rejectClientFinancialYear } = require("../services/financialYearService");

/**
 * GENERATE JOURNAL NUMBER
 */
const generateJournalNumber = async (company_id) => {

    try {

        const [rows] = await db.execute(`
            SELECT id
            FROM journal_entries
            WHERE company_id = ?
            ORDER BY id DESC
            LIMIT 1
        `, [company_id]);

        let nextId = 1;

        if (rows.length > 0) {
            nextId = rows[0].id + 1;
        }

        return "JRN-" + String(nextId).padStart(5, "0");

    } catch (error) {

        console.log("GENERATE JOURNAL ERROR:", error);

        throw error;

    }

};



/**
 * CREATE JOURNAL ENTRY
 */
exports.createJournalEntry = async (req, res) => {

    try {
        rejectClientFinancialYear(req.body);

        const {
            journal_date,
            narration,
            entries
        } = req.body;

        const company_id = req.user.company_id;

        /**
         * VALIDATION
         */
        if (!journal_date) {

            return res.status(400).json({
                success: false,
                message: "Journal date is required"
            });

        }

        if (!entries || entries.length < 2) {

            return res.status(400).json({
                success: false,
                message: "Minimum 2 journal rows required"
            });

        }

        /**
         * CALCULATE TOTALS
         */
        let totalDebit = 0;
        let totalCredit = 0;

        entries.forEach((item) => {

            totalDebit += Number(item.debit || 0);
            totalCredit += Number(item.credit || 0);

        });

        /**
         * DOUBLE ENTRY VALIDATION
         */
        if (totalDebit !== totalCredit) {

            return res.status(400).json({
                success: false,
                message: "Debit and Credit must be equal"
            });

        }

        /**
         * GENERATE JOURNAL NUMBER
         */
        const journalNo = await generateJournalNumber(company_id);
        const financialYear = await requireFinancialYearForDate(company_id, journal_date, db);

        /**
         * INSERT MASTER ENTRY
         */
        const [journalResult] = await db.execute(
            `
            INSERT INTO journal_entries (
                journal_no,
                journal_date,
                narration,
                total_debit,
                total_credit,
                company_id,
                financial_year_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
            [
                journalNo,
                journal_date,
                narration,
                totalDebit,
                totalCredit,
                company_id,
                financialYear.id
            ]
        );

        const journalId = journalResult.insertId;

        /**
         * INSERT DETAILS
         */
        for (const item of entries) {

            await db.execute(
                `
                INSERT INTO journal_entry_details (
                    journal_entry_id,
                    account_id,
                    debit,
                    credit,
                    description
                )
                VALUES (?, ?, ?, ?, ?)
                `,
                [
                    journalId,
                    item.account_id,
                    item.debit || 0,
                    item.credit || 0,
                    item.description || null
                ]
            );

        }

        /**
         * SUCCESS RESPONSE
         */
        res.status(201).json({
            success: true,
            message: "Journal entry created successfully",
            journal_id: journalId,
            journal_no: journalNo
        });

    } catch (error) {

        console.log("CREATE JOURNAL ERROR:", error);

        res.status(error.status || 500).json({
            success: false,
            message: error.message
        });

    }

};




/**
 * GET ALL JOURNAL ENTRIES
 */
exports.getAllJournalEntries = async (req, res) => {

    try {
        const companyId = req.user.company_id;
        const search = String(req.query.search || "").trim();
        const sourceType = String(req.query.source_type || "all").trim().toLowerCase();
        const dateFrom = String(req.query.date_from || "").trim();
        const dateTo = String(req.query.date_to || "").trim();
        const conditions = ["je.company_id = ?"];
        const params = [companyId];
        const effectiveSourceType = `CASE
            WHEN re.id IS NOT NULL AND re.receipt_type = 'CUSTOMER' THEN 'customer_receipt'
            WHEN re.id IS NOT NULL THEN 'receipt_entry'
            ELSE COALESCE(NULLIF(LOWER(je.source_type), ''), 'manual')
        END`;

        if (dateFrom) {
            conditions.push("je.journal_date >= ?");
            params.push(dateFrom);
        }
        if (dateTo) {
            conditions.push("je.journal_date <= ?");
            params.push(dateTo);
        }
        if (sourceType === "manual") {
            conditions.push(`${effectiveSourceType} = 'manual'`);
        } else if (sourceType === "automatic") {
            conditions.push(`${effectiveSourceType} <> 'manual'`);
        } else if (sourceType !== "all") {
            conditions.push(`${effectiveSourceType} = ?`);
            params.push(sourceType);
        }
        if (search) {
            conditions.push("(je.journal_no LIKE ? OR je.narration LIKE ?)");
            const term = `%${search}%`;
            params.push(term, term);
        }

        const [rows] = await db.execute(
            `SELECT je.id, je.journal_no, je.journal_date, je.narration,
                    je.total_debit, je.total_credit, ${effectiveSourceType} AS source_type, je.source_id,
                    CASE
                      WHEN ${effectiveSourceType} = 'manual' THEN 'manual'
                      ELSE 'automatic'
                    END AS source_category
             FROM journal_entries je
             LEFT JOIN receipt_entries re
               ON re.company_id = je.company_id
              AND re.journal_entry_id = je.id
             WHERE ${conditions.join(" AND ")}
             ORDER BY je.journal_date DESC, je.id DESC`,
            params
        );

        res.status(200).json({
            success: true,
            data: rows
        });

    } catch (error) {

        console.log("GET JOURNAL ERROR:", error);

        res.status(500).json({
            success: false,
            message: error.message
        });

    }

};




/**
 * GET SINGLE JOURNAL ENTRY
 */
exports.getSingleJournalEntry = async (req, res) => {

    try {

        const { id } = req.params;
        const company_id = req.user.company_id;

        /**
         * GET MASTER
         */
        const [journalRows] = await db.execute(
            `
            SELECT je.*,
                   CASE
                     WHEN re.id IS NOT NULL AND re.receipt_type = 'CUSTOMER' THEN 'customer_receipt'
                     WHEN re.id IS NOT NULL THEN 'receipt_entry'
                     ELSE COALESCE(NULLIF(LOWER(je.source_type), ''), 'manual')
                   END AS history_source_type
            FROM journal_entries je
            LEFT JOIN receipt_entries re
              ON re.company_id = je.company_id
             AND re.journal_entry_id = je.id
            WHERE je.id = ?
            AND je.company_id = ?
            `,
            [id, company_id]
        );

        if (!journalRows.length) {
            return res.status(404).json({
                success: false,
                message: "Journal entry not found"
            });
        }

        /**
         * GET DETAILS
         */
        const [detailRows] = await db.execute(
            `
            SELECT
                d.*,
                a.account_name,
                a.account_code
            FROM journal_entry_details d
            INNER JOIN journal_entries je
            ON je.id = d.journal_entry_id
            LEFT JOIN accounts a
            ON d.account_id = a.id
            AND a.company_id = je.company_id
            WHERE d.journal_entry_id = ?
            AND je.company_id = ?
            `,
            [id, company_id]
        );

        res.status(200).json({
            success: true,
            journal: {
                ...journalRows[0],
                source_type: journalRows[0].history_source_type,
                history_source_type: undefined
            },
            details: detailRows
        });

    } catch (error) {

        console.log("GET SINGLE JOURNAL ERROR:", error);

        res.status(500).json({
            success: false,
            message: error.message
        });

    }

};




/**
 * DELETE JOURNAL ENTRY
 */
exports.deleteJournalEntry = async (req, res) => {

    try {

        const { id } = req.params;
        const company_id = req.user.company_id;

        const [result] = await db.execute(
            `
            DELETE FROM journal_entries
            WHERE id = ?
            AND company_id = ?
            `,
            [id, company_id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "Journal entry not found"
            });
        }

        res.status(200).json({
            success: true,
            message: "Journal entry deleted successfully"
        });

    } catch (error) {

        console.log("DELETE JOURNAL ERROR:", error);

        res.status(500).json({
            success: false,
            message: error.message
        });

    }

};
