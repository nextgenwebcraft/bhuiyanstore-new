-- PLAN §9 Phase G: staff/SR money accounts (allocation, explicit offsets), payroll runs and damage cases.

-- Money entries: two explicit offset kinds, named allocation parts and the posting payroll run.
ALTER TABLE "money_entry" DROP CONSTRAINT "money_entry_kind";
ALTER TABLE "money_entry" ADD CONSTRAINT "money_entry_kind" CHECK ("kind" IN (
    'marketDueNew', 'marketDueCollected', 'srIncentive', 'expense', 'staffAdvance', 'staffLoan',
    'staffShortage', 'staffRepayment', 'staffExcess', 'staffCostPaid', 'staffCreditPaid',
    'salaryAccrual', 'salaryRecovery', 'salaryPaid', 'srLoan', 'srRepayment', 'srOwed',
    'srPayment', 'staffOffset', 'srOffset', 'supplierDeposit'
));

ALTER TABLE "money_entry"
    ADD COLUMN "alloc_advance" DECIMAL(20,2),
    ADD COLUMN "alloc_loan" DECIMAL(20,2),
    ADD COLUMN "alloc_shortage" DECIMAL(20,2),
    ADD COLUMN "payroll_run_id" TEXT;

ALTER TABLE "money_entry" ADD CONSTRAINT "money_entry_allocation" CHECK (
    ("alloc_advance" IS NULL AND "alloc_loan" IS NULL AND "alloc_shortage" IS NULL)
    OR (
        "kind" IN ('staffRepayment', 'staffOffset', 'salaryRecovery')
        AND "alloc_advance" >= 0 AND "alloc_loan" >= 0 AND "alloc_shortage" >= 0
        AND "alloc_advance" + "alloc_loan" + "alloc_shortage" = "amount"
    )
);

-- CreateTable
CREATE TABLE "payroll_run" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "pay_date" DATE,
    "note" TEXT NOT NULL DEFAULT '',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "paid_by_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "reversed_by_id" TEXT,
    "reversed_at" TIMESTAMP(3),

    CONSTRAINT "payroll_run_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payroll_run_month" CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    CONSTRAINT "payroll_run_date_in_month" CHECK (to_char("date", 'YYYY-MM') = "month"),
    CONSTRAINT "payroll_run_status" CHECK ("status" IN ('draft', 'approved', 'paid', 'reversed')),
    CONSTRAINT "payroll_run_version_positive" CHECK ("version" > 0),
    CONSTRAINT "payroll_run_approved" CHECK ("status" = 'draft' OR "approved_at" IS NOT NULL OR "status" = 'reversed'),
    CONSTRAINT "payroll_run_paid" CHECK (("status" = 'paid') <= ("paid_at" IS NOT NULL AND "pay_date" IS NOT NULL)),
    CONSTRAINT "payroll_run_pay_after_accrual" CHECK ("pay_date" IS NULL OR "pay_date" >= "date"),
    CONSTRAINT "payroll_run_reversal" CHECK (("status" = 'reversed') = ("reversed_at" IS NOT NULL))
);

-- CreateTable
CREATE TABLE "payroll_line" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "salary" DECIMAL(20,2) NOT NULL,
    "recover_advance" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "recover_loan" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "recover_shortage" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "owed_advance" DECIMAL(20,2),
    "owed_loan" DECIMAL(20,2),
    "owed_shortage" DECIMAL(20,2),
    "override" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "payroll_line_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payroll_line_override_reason" CHECK (NOT "override" OR length(trim("reason")) > 0),
    CONSTRAINT "payroll_line_amounts" CHECK (
        "salary" >= 0 AND "recover_advance" >= 0 AND "recover_loan" >= 0 AND "recover_shortage" >= 0
        AND "recover_advance" + "recover_loan" + "recover_shortage" <= "salary"
    )
);

-- CreateTable
CREATE TABLE "damage_case" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "case_number" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "origin" TEXT NOT NULL,
    "staff_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "note" TEXT NOT NULL DEFAULT '',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "damage_case_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "damage_case_origin" CHECK ("origin" IN ('buyerExchange', 'ownedStock')),
    CONSTRAINT "damage_case_status" CHECK ("status" IN ('open', 'cancelled')),
    CONSTRAINT "damage_case_number" CHECK (length(trim("case_number")) > 0)
);

-- CreateTable
CREATE TABLE "damage_case_line" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,

    CONSTRAINT "damage_case_line_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "damage_case_line_quantity" CHECK ("quantity" > 0 AND "quantity" = trunc("quantity"))
);

-- CreateTable
CREATE TABLE "damage_event" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "line_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "from_stock" BOOLEAN NOT NULL DEFAULT false,
    "unit_cost" DECIMAL(20,6),
    "reference" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'posted',
    "created_by_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversed_by_id" TEXT,
    "reversed_at" TIMESTAMP(3),

    CONSTRAINT "damage_event_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "damage_event_kind" CHECK ("kind" IN (
        'buyerReplacement', 'companyDispatch', 'companyAccept', 'companyReject', 'companyReplacement', 'writeOff'
    )),
    CONSTRAINT "damage_event_quantity" CHECK ("quantity" > 0 AND "quantity" = trunc("quantity")),
    CONSTRAINT "damage_event_from_stock" CHECK (NOT "from_stock" OR "kind" = 'buyerReplacement'),
    CONSTRAINT "damage_event_unit_cost" CHECK (("kind" = 'companyReplacement') = ("unit_cost" IS NOT NULL) AND ("unit_cost" IS NULL OR "unit_cost" >= 0)),
    CONSTRAINT "damage_event_status" CHECK ("status" IN ('posted', 'reversed')),
    CONSTRAINT "damage_event_reversal" CHECK (("status" = 'reversed') = ("reversed_at" IS NOT NULL))
);

-- One live run per company and month; reversed runs stay as history.
CREATE UNIQUE INDEX "payroll_run_live_unique" ON "payroll_run"("company_id", "month") WHERE "status" <> 'reversed';

-- CreateIndex
CREATE INDEX "payroll_run_company_id_month_idx" ON "payroll_run"("company_id", "month");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_line_run_id_staff_id_key" ON "payroll_line"("run_id", "staff_id");

-- CreateIndex
CREATE INDEX "money_entry_payroll_run_id_idx" ON "money_entry"("payroll_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "damage_case_company_id_case_number_key" ON "damage_case"("company_id", "case_number");

-- CreateIndex
CREATE INDEX "damage_case_company_id_date_idx" ON "damage_case"("company_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "damage_case_line_case_id_product_id_key" ON "damage_case_line"("case_id", "product_id");

-- CreateIndex
CREATE INDEX "damage_event_company_id_date_idx" ON "damage_event"("company_id", "date");

-- CreateIndex
CREATE INDEX "damage_event_case_id_idx" ON "damage_event"("case_id");

-- AddForeignKey
ALTER TABLE "money_entry" ADD CONSTRAINT "money_entry_payroll_run_id_fkey" FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_run" ADD CONSTRAINT "payroll_run_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_line" ADD CONSTRAINT "payroll_line_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_line" ADD CONSTRAINT "payroll_line_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_case" ADD CONSTRAINT "damage_case_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_case" ADD CONSTRAINT "damage_case_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_case_line" ADD CONSTRAINT "damage_case_line_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "damage_case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_case_line" ADD CONSTRAINT "damage_case_line_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_event" ADD CONSTRAINT "damage_event_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_event" ADD CONSTRAINT "damage_event_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "damage_case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_event" ADD CONSTRAINT "damage_event_line_id_fkey" FOREIGN KEY ("line_id") REFERENCES "damage_case_line"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
