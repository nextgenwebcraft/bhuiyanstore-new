-- D105: store piece count on rebate claim money entries so history can show quantity.
ALTER TABLE "money_entry" ADD COLUMN "pieces" NUMERIC(20,2);
