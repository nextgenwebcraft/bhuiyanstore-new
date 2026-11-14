-- D38: shop opening dues. A `shop_due` line names its shop; party_key = shop id.
ALTER TABLE "opening_balance_line" ADD COLUMN "shop_id" TEXT;
CREATE INDEX "opening_balance_line_shop_id_idx" ON "opening_balance_line"("shop_id");
ALTER TABLE "opening_balance_line" ADD CONSTRAINT "opening_balance_line_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "opening_balance_line" DROP CONSTRAINT "opening_balance_line_kind";
ALTER TABLE "opening_balance_line" ADD CONSTRAINT "opening_balance_line_kind" CHECK ("kind" IN (
    'market_due', 'shop_due', 'advance', 'loan', 'shortage', 'credit', 'salary_payable',
    'sr_loan', 'owed_to_sr', 'company_payable', 'company_advance', 'cash'
));
ALTER TABLE "opening_balance_line" DROP CONSTRAINT "opening_balance_line_party";
ALTER TABLE "opening_balance_line" ADD CONSTRAINT "opening_balance_line_party" CHECK (
    ("kind" = 'cash' AND "cash_account_id" IS NOT NULL AND "staff_id" IS NULL AND "shop_id" IS NULL) OR
    ("kind" IN ('company_payable', 'company_advance') AND "staff_id" IS NULL AND "cash_account_id" IS NULL AND "shop_id" IS NULL) OR
    ("kind" = 'market_due' AND "cash_account_id" IS NULL AND "shop_id" IS NULL) OR
    ("kind" = 'shop_due' AND "shop_id" IS NOT NULL AND "staff_id" IS NULL AND "cash_account_id" IS NULL) OR
    ("kind" NOT IN ('cash', 'company_payable', 'company_advance', 'market_due', 'shop_due') AND "staff_id" IS NOT NULL AND "cash_account_id" IS NULL AND "shop_id" IS NULL)
);

-- Setup checklist: opening sections the owner has reviewed; a save that changes a section drops it.
ALTER TABLE "opening_session" ADD COLUMN "confirmed_sections" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Salary master: the monthly salary of a role assignment (payroll default).
ALTER TABLE "staff_assignment" ADD COLUMN "monthly_salary" DECIMAL(20,2);
ALTER TABLE "staff_assignment" ADD CONSTRAINT "staff_assignment_monthly_salary" CHECK ("monthly_salary" IS NULL OR "monthly_salary" >= 0);

-- D16: free goods from the company (stock in, no bill).
ALTER TABLE "stock_entry" DROP CONSTRAINT "stock_entry_kind";
ALTER TABLE "stock_entry" ADD CONSTRAINT "stock_entry_kind" CHECK ("kind" IN ('order', 'receipt', 'damage', 'incentive'));

-- D39: cash the DSR handed over at day end (shown against the expected cash, never posted).
ALTER TABLE "dsr_day" ADD COLUMN "cash_handed_over" DECIMAL(20,2);
ALTER TABLE "dsr_day" ADD CONSTRAINT "dsr_day_cash_handed_over" CHECK ("cash_handed_over" IS NULL OR "cash_handed_over" >= 0);

-- D40: a DSR's own login.
ALTER TABLE "staff" ADD COLUMN "user_id" TEXT;
CREATE UNIQUE INDEX "staff_user_id_key" ON "staff"("user_id");
ALTER TABLE "staff" ADD CONSTRAINT "staff_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- D40: shops a DSR added from the field panel.
ALTER TABLE "shop" ADD COLUMN "added_by_staff_id" TEXT;
ALTER TABLE "shop" ADD CONSTRAINT "shop_added_by_staff_id_fkey" FOREIGN KEY ("added_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- D40: entries a posted DSR day created (shop due/collection; exchange damage custody).
ALTER TABLE "money_entry" ADD COLUMN "dsr_day_id" TEXT;
CREATE INDEX "money_entry_dsr_day_id_idx" ON "money_entry"("dsr_day_id");
ALTER TABLE "money_entry" ADD CONSTRAINT "money_entry_dsr_day_id_fkey" FOREIGN KEY ("dsr_day_id") REFERENCES "dsr_day"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "damage_case" ADD COLUMN "dsr_day_id" TEXT;
CREATE INDEX "damage_case_dsr_day_id_idx" ON "damage_case"("dsr_day_id");
ALTER TABLE "damage_case" ADD CONSTRAINT "damage_case_dsr_day_id_fkey" FOREIGN KEY ("dsr_day_id") REFERENCES "dsr_day"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- D40: one shop visit by a DSR (field panel). Editable until the office posts the DSR's day.
CREATE TABLE "field_visit" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "cash_received" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "due_collected" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'open',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "field_visit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "field_visit_status" CHECK ("status" IN ('open', 'locked')),
    CONSTRAINT "field_visit_amounts" CHECK ("cash_received" >= 0 AND "due_collected" >= 0),
    CONSTRAINT "field_visit_version_positive" CHECK ("version" > 0)
);
CREATE INDEX "field_visit_company_id_date_idx" ON "field_visit"("company_id", "date");
CREATE INDEX "field_visit_staff_id_date_idx" ON "field_visit"("staff_id", "date");
ALTER TABLE "field_visit" ADD CONSTRAINT "field_visit_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "field_visit" ADD CONSTRAINT "field_visit_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "field_visit" ADD CONSTRAINT "field_visit_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "field_visit_line" (
    "id" TEXT NOT NULL,
    "visit_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "pieces_per_carton" INTEGER NOT NULL,
    "unit_price" DECIMAL(20,6) NOT NULL,
    "delivered" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "exchanged" DECIMAL(20,6) NOT NULL DEFAULT 0,

    CONSTRAINT "field_visit_line_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "field_visit_line_pack_positive" CHECK ("pieces_per_carton" > 0),
    CONSTRAINT "field_visit_line_price" CHECK ("unit_price" >= 0),
    CONSTRAINT "field_visit_line_pieces" CHECK (
        "delivered" >= 0 AND "delivered" = trunc("delivered") AND
        "exchanged" >= 0 AND "exchanged" = trunc("exchanged") AND
        ("delivered" > 0 OR "exchanged" > 0)
    )
);
CREATE UNIQUE INDEX "field_visit_line_visit_id_product_id_key" ON "field_visit_line"("visit_id", "product_id");
ALTER TABLE "field_visit_line" ADD CONSTRAINT "field_visit_line_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "field_visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "field_visit_line" ADD CONSTRAINT "field_visit_line_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
