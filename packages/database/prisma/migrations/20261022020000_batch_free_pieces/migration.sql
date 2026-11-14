-- D68 amended: an order's free pieces go into the order's own batch, at its prices.

ALTER TABLE "stock_entry" DROP CONSTRAINT "stock_entry_free_batch_id_fkey";
DROP INDEX "stock_entry_free_batch_id_idx";
ALTER TABLE "stock_entry" DROP COLUMN "free_batch_id";

ALTER TABLE "product_batch" DROP COLUMN "free";
