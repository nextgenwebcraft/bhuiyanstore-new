-- D71: firot and damage a DSR sends after the office posted the day; waits for approval.
CREATE TABLE "field_day_report" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),

    CONSTRAINT "field_day_report_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "field_day_report_status" CHECK ("status" IN ('pending', 'approved', 'rejected')),
    CONSTRAINT "field_day_report_version_positive" CHECK ("version" > 0)
);
CREATE INDEX "field_day_report_company_id_date_idx" ON "field_day_report"("company_id", "date");
-- At most one pending report per DSR and date.
CREATE UNIQUE INDEX "field_day_report_pending_key" ON "field_day_report"("company_id", "staff_id", "date") WHERE "status" = 'pending';
ALTER TABLE "field_day_report" ADD CONSTRAINT "field_day_report_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "field_day_report" ADD CONSTRAINT "field_day_report_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "field_day_report_line" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "returned" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "damaged" DECIMAL(20,6) NOT NULL DEFAULT 0,

    CONSTRAINT "field_day_report_line_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "field_day_report_line_pieces" CHECK (
        "returned" >= 0 AND "returned" = trunc("returned") AND
        "damaged" >= 0 AND "damaged" = trunc("damaged")
    )
);
CREATE UNIQUE INDEX "field_day_report_line_report_id_product_id_key" ON "field_day_report_line"("report_id", "product_id");
ALTER TABLE "field_day_report_line" ADD CONSTRAINT "field_day_report_line_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "field_day_report"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "field_day_report_line" ADD CONSTRAINT "field_day_report_line_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
