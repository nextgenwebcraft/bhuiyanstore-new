-- D68: explicit product batches (order lots); receipts and DSR lines name their batch.

CREATE TABLE "product_batch" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'order',
    "free" BOOLEAN NOT NULL DEFAULT false,
    "cost_price" DECIMAL(20,6) NOT NULL,
    "sale_price" DECIMAL(20,6) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_batch_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_batch_source" CHECK ("source" IN ('order', 'opening')),
    CONSTRAINT "product_batch_prices" CHECK ("cost_price" >= 0 AND "sale_price" >= 0)
);

CREATE UNIQUE INDEX "product_batch_product_id_seq_key" ON "product_batch"("product_id", "seq");
CREATE INDEX "product_batch_company_id_idx" ON "product_batch"("company_id");

ALTER TABLE "product_batch" ADD CONSTRAINT "product_batch_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_entry"
    ADD COLUMN "batch_id" TEXT,
    ADD COLUMN "free_batch_id" TEXT,
    ADD COLUMN "cost_price" DECIMAL(20,6),
    ADD COLUMN "sale_price" DECIMAL(20,6);

CREATE INDEX "stock_entry_batch_id_idx" ON "stock_entry"("batch_id");
CREATE INDEX "stock_entry_free_batch_id_idx" ON "stock_entry"("free_batch_id");

ALTER TABLE "stock_entry" ADD CONSTRAINT "stock_entry_batch_id_fkey"
    FOREIGN KEY ("batch_id") REFERENCES "product_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_entry" ADD CONSTRAINT "stock_entry_free_batch_id_fkey"
    FOREIGN KEY ("free_batch_id") REFERENCES "product_batch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "dsr_line"
    ADD COLUMN "batch_key" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "batch_seq" INTEGER,
    ADD COLUMN "cost_price" DECIMAL(20,6),
    ADD COLUMN "sale_price" DECIMAL(20,6);

DROP INDEX "dsr_line_dsr_day_id_product_id_key";
CREATE UNIQUE INDEX "dsr_line_dsr_day_id_product_id_batch_key_key"
    ON "dsr_line"("dsr_day_id", "product_id", "batch_key");
