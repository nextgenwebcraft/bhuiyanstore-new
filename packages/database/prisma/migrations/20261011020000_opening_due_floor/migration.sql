-- D46: goods due from the company floors at 0; the opening view contract now rejects negatives,
-- so legacy negative opening values are clamped.
UPDATE "opening_stock_line" SET "due_from_company" = 0 WHERE "due_from_company" < 0;
