-- D35: shops the company distributes to; market due entries name their shop.
CREATE TABLE "shop" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "owner_name" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "area" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "due_limit" DECIMAL(20,2),
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shop_due_limit_check" CHECK ("due_limit" IS NULL OR "due_limit" >= 0),
    CONSTRAINT "shop_status_check" CHECK ("status" IN ('active', 'inactive'))
);

CREATE UNIQUE INDEX "shop_company_id_name_key" ON "shop"("company_id", "name");

ALTER TABLE "shop" ADD CONSTRAINT "shop_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "money_entry" ADD COLUMN "shop_id" TEXT;

CREATE INDEX "money_entry_shop_id_idx" ON "money_entry"("shop_id");

ALTER TABLE "money_entry" ADD CONSTRAINT "money_entry_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
