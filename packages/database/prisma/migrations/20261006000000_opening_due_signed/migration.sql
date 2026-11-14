-- D31: goods due from the company may be negative (more received than ordered).
ALTER TABLE "opening_stock_line" DROP CONSTRAINT "opening_stock_line_due";
ALTER TABLE "opening_stock_line" ADD CONSTRAINT "opening_stock_line_due"
    CHECK ("due_from_company" IS NULL OR "due_from_company" = trunc("due_from_company"));
