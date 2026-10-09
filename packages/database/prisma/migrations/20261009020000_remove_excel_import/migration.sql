-- D36: Excel import removed; openings and months are entered in the app only.
DROP TABLE "import_job";

ALTER TABLE "opening_session"
    DROP COLUMN "source_file_name",
    DROP COLUMN "source_sheet",
    DROP COLUMN "source_hash",
    DROP COLUMN "source_imported_at",
    DROP COLUMN "source_report";

ALTER TABLE "opening_stock_line" DROP COLUMN "source";

ALTER TABLE "opening_balance_line" DROP COLUMN "source_amount";
