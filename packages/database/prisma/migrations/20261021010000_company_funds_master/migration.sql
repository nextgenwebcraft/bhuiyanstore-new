-- D63: ড্যামেজ জমা is a stock entry of kind 'damageDeposit' at a rate per piece; an order may name
-- the company balance parts that pay it first (damage, incentive) and orders posted together share
-- a group.
ALTER TABLE "stock_entry" ADD COLUMN "unit_price" DECIMAL(20,6);
ALTER TABLE "stock_entry" ADD COLUMN "fund_from" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "stock_entry" ADD COLUMN "order_group" TEXT;

ALTER TABLE "stock_entry" DROP CONSTRAINT "stock_entry_kind";
ALTER TABLE "stock_entry" ADD CONSTRAINT "stock_entry_kind" CHECK (
    "kind" IN ('order', 'receipt', 'damage', 'incentive', 'damageDeposit')
);
ALTER TABLE "stock_entry" ADD CONSTRAINT "stock_entry_damage_deposit_price" CHECK (
    (("kind" = 'damageDeposit') = ("unit_price" IS NOT NULL))
    AND ("unit_price" IS NULL OR "unit_price" >= 0)
);
ALTER TABLE "stock_entry" ADD CONSTRAINT "stock_entry_order_funding" CHECK (
    ("kind" = 'order' OR (COALESCE(cardinality("fund_from"), 0) = 0 AND "order_group" IS NULL))
    AND ("fund_from" IS NULL OR "fund_from" <@ ARRAY['damage', 'incentive']::TEXT[])
);

-- D66: one hidden master company per tenant holds the tenant-level records (global staff, payroll,
-- staff money of non-DSR staff, its own opening).
ALTER TABLE "company" ADD COLUMN "is_master" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "company_tenant_master" ON "company"("tenant_id") WHERE "is_master";
