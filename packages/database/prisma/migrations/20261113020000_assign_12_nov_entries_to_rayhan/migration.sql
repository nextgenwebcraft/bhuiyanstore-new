-- 12 Nov 2026: the shop due (650) and DSR short (26) were entered on Rayhan's sheet. The DSR sold
-- on both Hasan's and Rayhan's sheets, so the backfill could not tell them apart. No-op elsewhere.
UPDATE "money_entry"
SET "sheet_staff_id" = 'cmvkub3dz000fkwgntymadhvv'
WHERE "id" IN ('cmwdk1thd000m08jzp69z2ydq', 'cmwdplic6000208l9arock0ta')
  AND "sheet_staff_id" IS NULL;
