-- Opening damage stock at go-live (nullable = unknown, same as saleable pieces).
ALTER TABLE "opening_stock_line" ADD COLUMN "damaged_pieces" DECIMAL(20, 6);
