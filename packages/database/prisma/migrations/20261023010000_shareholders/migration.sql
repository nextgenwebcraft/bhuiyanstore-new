-- D76: shareholders, their units from a month, and each company's দান basis.
CREATE TABLE "shareholder" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shareholder_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shareholder_name_check" CHECK (char_length(btrim("name")) > 0)
);

CREATE UNIQUE INDEX "shareholder_tenant_id_name_key" ON "shareholder"("tenant_id", "name");

ALTER TABLE "shareholder" ADD CONSTRAINT "shareholder_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "shareholder_holding" (
    "id" TEXT NOT NULL,
    "shareholder_id" TEXT NOT NULL,
    "from_month" TEXT NOT NULL,
    "units" DECIMAL(20,5) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shareholder_holding_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shareholder_holding_units_check" CHECK ("units" >= 0)
);

CREATE UNIQUE INDEX "shareholder_holding_shareholder_id_from_month_key" ON "shareholder_holding"("shareholder_id", "from_month");

ALTER TABLE "shareholder_holding" ADD CONSTRAINT "shareholder_holding_shareholder_id_fkey" FOREIGN KEY ("shareholder_id") REFERENCES "shareholder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "company_share_policy" (
    "company_id" TEXT NOT NULL,
    "dan_basis" TEXT NOT NULL DEFAULT 'net',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_share_policy_pkey" PRIMARY KEY ("company_id"),
    CONSTRAINT "company_share_policy_dan_basis_check" CHECK ("dan_basis" IN ('net', 'profit'))
);

ALTER TABLE "company_share_policy" ADD CONSTRAINT "company_share_policy_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
