-- D122: each day-sheet line belongs to a selling DSR under the SR's day.
ALTER TABLE "dsr_line" ADD COLUMN "dsr_staff_id" TEXT;

UPDATE "dsr_line" AS l
SET "dsr_staff_id" = d."staff_id"
FROM "dsr_day" AS d
WHERE l."dsr_day_id" = d."id";

ALTER TABLE "dsr_line" ALTER COLUMN "dsr_staff_id" SET NOT NULL;

DROP INDEX "dsr_line_dsr_day_id_product_id_batch_key_key";
CREATE UNIQUE INDEX "dsr_line_dsr_day_id_dsr_staff_id_product_id_batch_key_key"
  ON "dsr_line"("dsr_day_id", "dsr_staff_id", "product_id", "batch_key");

CREATE INDEX "dsr_line_dsr_staff_id_idx" ON "dsr_line"("dsr_staff_id");

ALTER TABLE "dsr_line"
  ADD CONSTRAINT "dsr_line_dsr_staff_id_fkey"
  FOREIGN KEY ("dsr_staff_id") REFERENCES "staff"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
