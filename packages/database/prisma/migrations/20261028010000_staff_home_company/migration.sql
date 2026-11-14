-- D93 (owner 2026-10-28): every staff member has one home company (salary is paid company-wise).
-- The master panel's আমাদের স্টাফ now sets it explicitly on hire; a company's own staff create
-- defaults it to that company. Existing staff are all backfilled to one real company for now; the
-- owner edits each one later.
ALTER TABLE "staff" ADD COLUMN "company_id" TEXT;

UPDATE "staff" SET "company_id" = 'cmvml8dbz000008jjwlffqlye' WHERE "company_id" IS NULL;

ALTER TABLE "staff" ALTER COLUMN "company_id" SET NOT NULL;

CREATE INDEX "staff_company_id_idx" ON "staff"("company_id");

ALTER TABLE "staff" ADD CONSTRAINT "staff_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
