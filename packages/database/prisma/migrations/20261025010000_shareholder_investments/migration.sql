-- Replaces the units/দান-basis model (D76/D77) with per-company invest amounts, owner request
-- 2026-10-25: no more fractional units or per-company দান override.
DROP TABLE "company_share_policy";

DROP TABLE "shareholder_holding";

CREATE TABLE "shareholder_investment" (
    "id" TEXT NOT NULL,
    "shareholder_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "from_month" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shareholder_investment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shareholder_investment_amount_check" CHECK ("amount" >= 0)
);

CREATE UNIQUE INDEX "shareholder_investment_shareholder_id_company_id_from_mon_key" ON "shareholder_investment"("shareholder_id", "company_id", "from_month");

ALTER TABLE "shareholder_investment" ADD CONSTRAINT "shareholder_investment_shareholder_id_fkey" FOREIGN KEY ("shareholder_id") REFERENCES "shareholder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "shareholder_investment" ADD CONSTRAINT "shareholder_investment_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
