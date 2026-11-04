-- D115: product-wise order targets are carton quantity; one or many products per target.
CREATE TABLE "order_target_product" (
    "target_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,

    CONSTRAINT "order_target_product_pkey" PRIMARY KEY ("target_id","product_id")
);

CREATE INDEX "order_target_product_product_id_idx" ON "order_target_product"("product_id");

ALTER TABLE "order_target_product" ADD CONSTRAINT "order_target_product_target_id_fkey"
  FOREIGN KEY ("target_id") REFERENCES "order_target"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_target_product" ADD CONSTRAINT "order_target_product_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Move existing single-product links into the join table before dropping product_id.
INSERT INTO "order_target_product" ("target_id", "product_id")
SELECT "id", "product_id" FROM "order_target"
WHERE "kind" = 'product' AND "product_id" IS NOT NULL;

ALTER TABLE "order_target" DROP CONSTRAINT IF EXISTS "order_target_product_kind_check";
ALTER TABLE "order_target" DROP CONSTRAINT IF EXISTS "order_target_amount_check";
ALTER TABLE "order_target" DROP CONSTRAINT IF EXISTS "order_target_product_id_fkey";

ALTER TABLE "order_target" ADD COLUMN "quantity_cartons" DECIMAL(20,2);

-- Product targets: former taka amount becomes carton quantity (owner may re-enter if needed).
UPDATE "order_target"
SET "quantity_cartons" = "amount", "amount" = NULL
WHERE "kind" = 'product';

ALTER TABLE "order_target" ALTER COLUMN "amount" DROP NOT NULL;
ALTER TABLE "order_target" DROP COLUMN "product_id";

ALTER TABLE "order_target" ADD CONSTRAINT "order_target_metric_check" CHECK (
  ("kind" = 'overall' AND "amount" IS NOT NULL AND "amount" > 0 AND "quantity_cartons" IS NULL)
  OR ("kind" = 'product' AND "quantity_cartons" IS NOT NULL AND "quantity_cartons" > 0 AND "amount" IS NULL)
);
