-- PLAN §9 Phase C: product packs and prices, suppliers, staff, configuration lists.

-- CreateTable
CREATE TABLE "product_pack" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "pieces_per_carton" INTEGER NOT NULL,
    "effective_from" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_pack_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_pack_pieces_positive" CHECK ("pieces_per_carton" > 0)
);

-- Carton size moves from product to its history; the existing size becomes the undated base pack.
INSERT INTO "product_pack" ("id", "product_id", "pieces_per_carton", "effective_from")
SELECT 'pack_' || "id", "id", "pieces_per_carton", NULL FROM "product";

-- AlterTable
ALTER TABLE "product" DROP COLUMN "pieces_per_carton";

-- CreateTable
CREATE TABLE "price_change" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "price" DECIMAL(20,6) NOT NULL,
    "effective_from" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_change_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "price_change_kind" CHECK ("kind" IN ('order', 'cost', 'sale')),
    CONSTRAINT "price_change_price_non_negative" CHECK ("price" >= 0)
);

-- CreateTable
CREATE TABLE "supplier" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "supplier_status" CHECK ("status" IN ('active', 'inactive'))
);

-- CreateTable
CREATE TABLE "staff" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "employer" TEXT NOT NULL,
    "phone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "staff_employer" CHECK ("employer" IN ('distributor', 'supplier')),
    CONSTRAINT "staff_status" CHECK ("status" IN ('active', 'inactive'))
);

-- CreateTable
CREATE TABLE "staff_assignment" (
    "id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "from" DATE NOT NULL,
    "to" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_assignment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "staff_assignment_period" CHECK ("to" IS NULL OR "to" >= "from")
);

-- CreateTable
CREATE TABLE "staff_role" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_role_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "staff_role_kind" CHECK ("kind" IN ('dsr', 'sr', 'general'))
);

-- CreateTable
CREATE TABLE "expense_category" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_account" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_entity_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_account_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cash_account_kind" CHECK ("kind" IN ('cash', 'bank', 'mobile'))
);

-- CreateIndex
CREATE UNIQUE INDEX "product_pack_product_id_effective_from_key" ON "product_pack"("product_id", "effective_from");

-- Only one undated base pack per product (NULLs are distinct in a plain unique index).
CREATE UNIQUE INDEX "product_pack_one_base" ON "product_pack"("product_id") WHERE "effective_from" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "price_change_product_id_kind_effective_from_key" ON "price_change"("product_id", "kind", "effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_company_id_name_key" ON "supplier"("company_id", "name");

-- CreateIndex
CREATE INDEX "staff_tenant_id_idx" ON "staff"("tenant_id");

-- CreateIndex
CREATE INDEX "staff_assignment_company_id_idx" ON "staff_assignment"("company_id");

-- CreateIndex
CREATE INDEX "staff_assignment_staff_id_idx" ON "staff_assignment"("staff_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_role_tenant_id_name_key" ON "staff_role"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "expense_category_tenant_id_name_key" ON "expense_category"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "cash_account_legal_entity_id_name_key" ON "cash_account"("legal_entity_id", "name");

-- AddForeignKey
ALTER TABLE "product_pack" ADD CONSTRAINT "product_pack_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_change" ADD CONSTRAINT "price_change_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff" ADD CONSTRAINT "staff_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignment" ADD CONSTRAINT "staff_assignment_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignment" ADD CONSTRAINT "staff_assignment_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignment" ADD CONSTRAINT "staff_assignment_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "staff_role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_role" ADD CONSTRAINT "staff_role_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_category" ADD CONSTRAINT "expense_category_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_account" ADD CONSTRAINT "cash_account_legal_entity_id_fkey" FOREIGN KEY ("legal_entity_id") REFERENCES "legal_entity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
