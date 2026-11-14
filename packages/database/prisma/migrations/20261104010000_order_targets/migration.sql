-- D111: company order-amount targets (overall / product-wise).
CREATE TABLE "order_target" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "product_id" TEXT,
    "amount" DECIMAL(20,2) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "show_on_dashboard" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_target_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "order_target_kind_check" CHECK ("kind" IN ('overall', 'product')),
    CONSTRAINT "order_target_status_check" CHECK ("status" IN ('active', 'archived')),
    CONSTRAINT "order_target_product_kind_check" CHECK (
      ("kind" = 'overall' AND "product_id" IS NULL)
      OR ("kind" = 'product' AND "product_id" IS NOT NULL)
    ),
    CONSTRAINT "order_target_dates_check" CHECK ("start_date" <= "end_date"),
    CONSTRAINT "order_target_amount_check" CHECK ("amount" > 0)
);

CREATE INDEX "order_target_company_id_status_idx" ON "order_target"("company_id", "status");
CREATE INDEX "order_target_company_id_show_on_dashboard_idx" ON "order_target"("company_id", "show_on_dashboard");

ALTER TABLE "order_target" ADD CONSTRAINT "order_target_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_target" ADD CONSTRAINT "order_target_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
