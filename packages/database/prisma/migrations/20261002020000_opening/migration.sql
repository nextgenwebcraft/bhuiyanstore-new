-- PLAN §9 Phase D: opening balances (one session per company, stock and typed balance lines).

-- CreateTable
CREATE TABLE "opening_session" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 0,
    "cutoff_date" DATE,
    "source_file_name" TEXT,
    "source_sheet" TEXT,
    "source_hash" TEXT,
    "source_imported_at" TIMESTAMP(3),
    "source_report" JSONB,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "activated_by_id" TEXT,
    "activated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "opening_session_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "opening_session_status" CHECK ("status" IN ('draft', 'approved', 'active')),
    CONSTRAINT "opening_session_version_non_negative" CHECK ("version" >= 0),
    CONSTRAINT "opening_session_active_complete" CHECK (
        "status" <> 'active' OR ("cutoff_date" IS NOT NULL AND "activated_at" IS NOT NULL)
    )
);

-- CreateTable
CREATE TABLE "opening_stock_line" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "pieces" DECIMAL(20,6),
    "unit_cost" DECIMAL(20,6),
    "sale_price" DECIMAL(20,6),
    "order_price" DECIMAL(20,6),
    "due_from_company" DECIMAL(20,6),
    "note" TEXT NOT NULL DEFAULT '',
    "source" JSONB,

    CONSTRAINT "opening_stock_line_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "opening_stock_line_pieces" CHECK ("pieces" IS NULL OR ("pieces" >= 0 AND "pieces" = trunc("pieces"))),
    CONSTRAINT "opening_stock_line_due" CHECK ("due_from_company" IS NULL OR ("due_from_company" >= 0 AND "due_from_company" = trunc("due_from_company"))),
    CONSTRAINT "opening_stock_line_prices" CHECK (
        ("unit_cost" IS NULL OR "unit_cost" >= 0) AND
        ("sale_price" IS NULL OR "sale_price" >= 0) AND
        ("order_price" IS NULL OR "order_price" >= 0)
    )
);

-- CreateTable
CREATE TABLE "opening_balance_line" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "staff_id" TEXT,
    "cash_account_id" TEXT,
    "party_key" TEXT NOT NULL,
    "amount" DECIMAL(20,2),
    "source_amount" DECIMAL(20,6),
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "opening_balance_line_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "opening_balance_line_kind" CHECK ("kind" IN (
        'market_due', 'advance', 'loan', 'shortage', 'credit', 'salary_payable',
        'sr_loan', 'owed_to_sr', 'company_payable', 'company_advance', 'cash'
    )),
    CONSTRAINT "opening_balance_line_amount_non_negative" CHECK ("amount" IS NULL OR "amount" >= 0),
    CONSTRAINT "opening_balance_line_party" CHECK (
        ("kind" = 'cash' AND "cash_account_id" IS NOT NULL AND "staff_id" IS NULL) OR
        ("kind" IN ('company_payable', 'company_advance') AND "staff_id" IS NULL AND "cash_account_id" IS NULL) OR
        ("kind" = 'market_due' AND "cash_account_id" IS NULL) OR
        ("kind" NOT IN ('cash', 'company_payable', 'company_advance', 'market_due') AND "staff_id" IS NOT NULL AND "cash_account_id" IS NULL)
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "opening_session_company_id_key" ON "opening_session"("company_id");

-- CreateIndex
CREATE INDEX "opening_session_tenant_id_idx" ON "opening_session"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "opening_stock_line_session_id_product_id_key" ON "opening_stock_line"("session_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "opening_balance_line_session_id_kind_party_key_key" ON "opening_balance_line"("session_id", "kind", "party_key");

-- CreateIndex
CREATE INDEX "opening_balance_line_cash_account_id_idx" ON "opening_balance_line"("cash_account_id");

-- AddForeignKey
ALTER TABLE "opening_session" ADD CONSTRAINT "opening_session_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_stock_line" ADD CONSTRAINT "opening_stock_line_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "opening_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_stock_line" ADD CONSTRAINT "opening_stock_line_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_balance_line" ADD CONSTRAINT "opening_balance_line_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "opening_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_balance_line" ADD CONSTRAINT "opening_balance_line_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opening_balance_line" ADD CONSTRAINT "opening_balance_line_cash_account_id_fkey" FOREIGN KEY ("cash_account_id") REFERENCES "cash_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
