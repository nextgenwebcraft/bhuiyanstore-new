-- Sheet money from before sheets owned their entries that no backfill rule could place (two SR
-- sheets on one date): put it on Hasan's sheet for now; adjusted by hand afterwards. No-op on any
-- other database.
UPDATE "money_entry"
SET "sheet_staff_id" = 'cmvml8dj0001m08jjdy5dasof'
WHERE "company_id" = 'cmvml8dbz000008jjwlffqlye'
  AND "sheet_staff_id" IS NULL
  AND "dsr_day_id" IS NULL
  AND "payroll_run_id" IS NULL
  AND "kind" IN ('marketDueNew', 'marketDueCollected', 'staffCostPaid', 'staffAdvance',
                 'staffShortage', 'staffRepayment', 'staffAbsent', 'srLoan', 'srRepayment',
                 'expense');
