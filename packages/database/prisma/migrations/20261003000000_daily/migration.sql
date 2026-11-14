-- PLAN §9 Phase E: daily entry (stock entries, DSR day sheets, typed money entries) and month close.

-- CreateTable
CREATE TABLE "stock_entry" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "pieces" DECIMAL(20,6) NOT NULL,
    "supplier_id" TEXT,
    "reference" TEXT NOT NULL DEFAULT '',
    "lot" TEXT,
    "expiry" DATE,
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'posted',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversed_by_id" TEXT,
    "reversed_at" TIMESTAMP(3),

    CONSTRAINT "stock_entry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stock_entry_kind" CHECK ("kind" IN ('order', 'receipt', 'damage')),
    CONSTRAINT "stock_entry_pieces_whole_positive" CHECK ("pieces" > 0 AND "pieces" = trunc("pieces")),
    CONSTRAINT "stock_entry_status" CHECK ("status" IN ('posted', 'reversed')),
    CONSTRAINT "stock_entry_reversal" CHECK (("status" = 'reversed') = ("reversed_at" IS NOT NULL)),
    CONSTRAINT "stock_entry_lot_receipt_only" CHECK ("kind" = 'receipt' OR ("lot" IS NULL AND "expiry" IS NULL))
);

-- CreateTable
CREATE TABLE "dsr_day" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "market_due_new" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "market_due_collected" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "posted_by_id" TEXT,
    "posted_at" TIMESTAMP(3),
    "reversed_by_id" TEXT,
    "reversed_at" TIMESTAMP(3),

    CONSTRAINT "dsr_day_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "dsr_day_status" CHECK ("status" IN ('draft', 'posted', 'reversed')),
    CONSTRAINT "dsr_day_version_positive" CHECK ("version" > 0),
    CONSTRAINT "dsr_day_amounts_non_negative" CHECK ("market_due_new" >= 0 AND "market_due_collected" >= 0),
    CONSTRAINT "dsr_day_posted" CHECK ("status" = 'draft' OR "posted_at" IS NOT NULL),
    CONSTRAINT "dsr_day_reversal" CHECK (("status" = 'reversed') = ("reversed_at" IS NOT NULL))
);

-- CreateTable
CREATE TABLE "dsr_line" (
    "id" TEXT NOT NULL,
    "dsr_day_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "pieces_per_carton" INTEGER NOT NULL,
    "issued" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "returned" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "damaged" DECIMAL(20,6) NOT NULL DEFAULT 0,

    CONSTRAINT "dsr_line_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "dsr_line_pack_positive" CHECK ("pieces_per_carton" > 0),
    CONSTRAINT "dsr_line_pieces_whole" CHECK (
        "issued" >= 0 AND "returned" >= 0 AND "damaged" >= 0
        AND "issued" = trunc("issued") AND "returned" = trunc("returned") AND "damaged" = trunc("damaged")
    )
);

-- CreateTable
CREATE TABLE "dsr_price_split" (
    "id" TEXT NOT NULL,
    "line_id" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "unit_price" DECIMAL(20,6) NOT NULL,

    CONSTRAINT "dsr_price_split_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "dsr_price_split_values" CHECK ("quantity" > 0 AND "quantity" = trunc("quantity") AND "unit_price" >= 0)
);

-- CreateTable
CREATE TABLE "money_entry" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "staff_id" TEXT,
    "expense_category_id" TEXT,
    "reference" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'posted',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversed_by_id" TEXT,
    "reversed_at" TIMESTAMP(3),

    CONSTRAINT "money_entry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "money_entry_kind" CHECK ("kind" IN (
        'marketDueNew', 'marketDueCollected', 'srIncentive', 'expense', 'staffAdvance', 'staffLoan',
        'staffShortage', 'staffRepayment', 'staffExcess', 'staffCostPaid', 'staffCreditPaid',
        'salaryAccrual', 'salaryRecovery', 'salaryPaid', 'srLoan', 'srRepayment', 'srOwed',
        'srPayment', 'supplierDeposit'
    )),
    CONSTRAINT "money_entry_amount_positive" CHECK ("amount" > 0),
    CONSTRAINT "money_entry_status" CHECK ("status" IN ('posted', 'reversed')),
    CONSTRAINT "money_entry_reversal" CHECK (("status" = 'reversed') = ("reversed_at" IS NOT NULL))
);

-- CreateTable
CREATE TABLE "month_close" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "closing" JSONB NOT NULL,
    "closed_by_id" TEXT NOT NULL,
    "closed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "month_close_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "month_close_month" CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);

-- CreateIndex
CREATE INDEX "stock_entry_company_id_date_idx" ON "stock_entry"("company_id", "date");

-- CreateIndex
CREATE INDEX "dsr_day_company_id_date_idx" ON "dsr_day"("company_id", "date");

-- One live sheet per company, DSR and date (D03); reversed sheets stay as history.
CREATE UNIQUE INDEX "dsr_day_live_unique" ON "dsr_day"("company_id", "staff_id", "date") WHERE "status" <> 'reversed';

-- CreateIndex
CREATE UNIQUE INDEX "dsr_line_dsr_day_id_product_id_key" ON "dsr_line"("dsr_day_id", "product_id");

-- CreateIndex
CREATE INDEX "money_entry_company_id_date_idx" ON "money_entry"("company_id", "date");

-- CreateIndex
CREATE INDEX "money_entry_staff_id_idx" ON "money_entry"("staff_id");

-- CreateIndex
CREATE UNIQUE INDEX "month_close_company_id_month_key" ON "month_close"("company_id", "month");

-- AddForeignKey
ALTER TABLE "stock_entry" ADD CONSTRAINT "stock_entry_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_entry" ADD CONSTRAINT "stock_entry_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_entry" ADD CONSTRAINT "stock_entry_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dsr_day" ADD CONSTRAINT "dsr_day_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dsr_day" ADD CONSTRAINT "dsr_day_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dsr_line" ADD CONSTRAINT "dsr_line_dsr_day_id_fkey" FOREIGN KEY ("dsr_day_id") REFERENCES "dsr_day"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dsr_line" ADD CONSTRAINT "dsr_line_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dsr_price_split" ADD CONSTRAINT "dsr_price_split_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "dsr_line"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_entry" ADD CONSTRAINT "money_entry_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_entry" ADD CONSTRAINT "money_entry_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "money_entry" ADD CONSTRAINT "money_entry_expense_category_id_fkey" FOREIGN KEY ("expense_category_id") REFERENCES "expense_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "month_close" ADD CONSTRAINT "month_close_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
