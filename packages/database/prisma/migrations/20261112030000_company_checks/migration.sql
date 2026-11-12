-- D129: company cheques — register bank+number, charge order bills, repay against check (not company payable).
CREATE TABLE "company_check" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "check_number" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_check_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "company_check_company_id_bank_name_check_number_key" ON "company_check"("company_id", "bank_name", "check_number");

CREATE INDEX "company_check_company_id_idx" ON "company_check"("company_id");

CREATE TABLE "company_check_charge" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "company_check_id" TEXT NOT NULL,
    "stock_entry_id" TEXT NOT NULL,
    "order_group" TEXT,
    "amount" DECIMAL(20,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'posted',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversed_at" TIMESTAMP(3),

    CONSTRAINT "company_check_charge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "company_check_charge_stock_entry_id_key" ON "company_check_charge"("stock_entry_id");

CREATE INDEX "company_check_charge_company_check_id_idx" ON "company_check_charge"("company_check_id");

CREATE INDEX "company_check_charge_company_id_status_idx" ON "company_check_charge"("company_id", "status");

CREATE TABLE "company_check_payment" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "company_check_id" TEXT NOT NULL,
    "money_entry_id" TEXT NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'posted',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversed_at" TIMESTAMP(3),

    CONSTRAINT "company_check_payment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "company_check_payment_money_entry_id_key" ON "company_check_payment"("money_entry_id");

CREATE INDEX "company_check_payment_company_check_id_idx" ON "company_check_payment"("company_check_id");

CREATE INDEX "company_check_payment_company_id_date_idx" ON "company_check_payment"("company_id", "date");

ALTER TABLE "stock_entry" ADD COLUMN "company_check_id" TEXT;

CREATE INDEX "stock_entry_company_check_id_idx" ON "stock_entry"("company_check_id");

ALTER TABLE "company_check" ADD CONSTRAINT "company_check_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "company_check_charge" ADD CONSTRAINT "company_check_charge_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "company_check_charge" ADD CONSTRAINT "company_check_charge_company_check_id_fkey" FOREIGN KEY ("company_check_id") REFERENCES "company_check"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "company_check_charge" ADD CONSTRAINT "company_check_charge_stock_entry_id_fkey" FOREIGN KEY ("stock_entry_id") REFERENCES "stock_entry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "company_check_payment" ADD CONSTRAINT "company_check_payment_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "company_check_payment" ADD CONSTRAINT "company_check_payment_company_check_id_fkey" FOREIGN KEY ("company_check_id") REFERENCES "company_check"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "company_check_payment" ADD CONSTRAINT "company_check_payment_money_entry_id_fkey" FOREIGN KEY ("money_entry_id") REFERENCES "money_entry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_entry" ADD CONSTRAINT "stock_entry_company_check_id_fkey" FOREIGN KEY ("company_check_id") REFERENCES "company_check"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
