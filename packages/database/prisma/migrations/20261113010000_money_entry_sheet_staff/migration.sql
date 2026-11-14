-- Daily-sheet money (shop due, staff/SR cash, operating cost) belongs to the SR sheet it was
-- entered on. Before this, every entry of a date showed on (and was charged to) every SR sheet.
ALTER TABLE "money_entry" ADD COLUMN "sheet_staff_id" TEXT;

CREATE INDEX "money_entry_sheet_staff_id_idx" ON "money_entry"("sheet_staff_id");

-- Backfill hand-entered sheet money. 1) the SR's own cash entries go to that SR's live sheet.
UPDATE "money_entry" e
SET "sheet_staff_id" = d."staff_id"
FROM "dsr_day" d
WHERE e."sheet_staff_id" IS NULL
  AND e."dsr_day_id" IS NULL
  AND e."payroll_run_id" IS NULL
  AND e."kind" IN ('marketDueNew', 'marketDueCollected', 'staffCostPaid', 'staffAdvance',
                   'staffShortage', 'staffRepayment', 'staffAbsent', 'srLoan', 'srRepayment')
  AND d."company_id" = e."company_id"
  AND d."date" = e."date"
  AND d."status" <> 'reversed'
  AND d."staff_id" = e."staff_id";

-- 2) a DSR who sold on exactly one live sheet that date: that sheet.
UPDATE "money_entry" e
SET "sheet_staff_id" = pick."staff_id"
FROM (
  SELECT m."id" AS entry_id, MIN(d."staff_id") AS staff_id
  FROM "money_entry" m
  JOIN "dsr_day" d
    ON d."company_id" = m."company_id" AND d."date" = m."date" AND d."status" <> 'reversed'
  JOIN "dsr_line" l ON l."dsr_day_id" = d."id" AND l."dsr_staff_id" = m."staff_id"
  WHERE m."sheet_staff_id" IS NULL
    AND m."dsr_day_id" IS NULL
    AND m."payroll_run_id" IS NULL
    AND m."kind" IN ('marketDueNew', 'marketDueCollected', 'staffCostPaid', 'staffAdvance',
                     'staffShortage', 'staffRepayment', 'staffAbsent', 'srLoan', 'srRepayment')
  GROUP BY m."id"
  HAVING COUNT(DISTINCT d."id") = 1
) pick
WHERE e."id" = pick.entry_id;

-- 3) anything left (including operating cost) on a date with exactly one live sheet.
UPDATE "money_entry" e
SET "sheet_staff_id" = only_sheet."staff_id"
FROM (
  SELECT "company_id", "date", MIN("staff_id") AS staff_id
  FROM "dsr_day"
  WHERE "status" <> 'reversed'
  GROUP BY "company_id", "date"
  HAVING COUNT(*) = 1
) only_sheet
WHERE e."sheet_staff_id" IS NULL
  AND e."dsr_day_id" IS NULL
  AND e."payroll_run_id" IS NULL
  AND e."kind" IN ('marketDueNew', 'marketDueCollected', 'staffCostPaid', 'staffAdvance',
                   'staffShortage', 'staffRepayment', 'staffAbsent', 'srLoan', 'srRepayment',
                   'expense')
  AND only_sheet."company_id" = e."company_id"
  AND only_sheet."date" = e."date";
