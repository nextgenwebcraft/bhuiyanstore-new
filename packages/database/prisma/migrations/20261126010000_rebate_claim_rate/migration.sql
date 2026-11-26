-- D105: per-piece rate on rebate claim money entries; amount = pieces x unit_rate.
ALTER TABLE "money_entry" ADD COLUMN "unit_rate" NUMERIC(20,6);
