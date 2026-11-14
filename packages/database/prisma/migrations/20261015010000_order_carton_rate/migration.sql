-- D57: an order carries a carton rate and free goods. `free_pieces`, `carton_rate` and the carton
-- size snapshot are used only by kind 'order'; the order's bill is pieces x carton_rate /
-- pieces_per_carton and the received batch costs the bill / (paid + free pieces).
ALTER TABLE "stock_entry" ADD COLUMN "free_pieces" DECIMAL(20,6);
ALTER TABLE "stock_entry" ADD COLUMN "carton_rate" DECIMAL(20,2);
ALTER TABLE "stock_entry" ADD COLUMN "pieces_per_carton" INTEGER;

-- Paid pieces may be 0 only on an order that brings free pieces (free-only order).
ALTER TABLE "stock_entry" DROP CONSTRAINT "stock_entry_pieces_whole_positive";
ALTER TABLE "stock_entry" ADD CONSTRAINT "stock_entry_pieces_whole_positive" CHECK (
    "pieces" = trunc("pieces")
    AND ("pieces" > 0 OR ("kind" = 'order' AND "free_pieces" IS NOT NULL AND "free_pieces" > 0))
);
ALTER TABLE "stock_entry" ADD CONSTRAINT "stock_entry_order_terms" CHECK (
    ("kind" = 'order' OR ("free_pieces" IS NULL AND "carton_rate" IS NULL AND "pieces_per_carton" IS NULL))
    AND ("free_pieces" IS NULL OR ("free_pieces" >= 0 AND "free_pieces" = trunc("free_pieces")))
    AND ("carton_rate" IS NULL OR "carton_rate" >= 0)
    AND ("pieces_per_carton" IS NULL OR "pieces_per_carton" > 0)
);
