-- D41: shop commission per DSR line (taka); lowers the line's sales.
ALTER TABLE "dsr_line" ADD COLUMN "commission" DECIMAL(20,2) NOT NULL DEFAULT 0;
ALTER TABLE "dsr_line" ADD CONSTRAINT "dsr_line_commission_nonnegative" CHECK ("commission" >= 0);

-- D42: SR loan and repayment type (direct cash loan or product commission advance).
-- Entries made before the type existed were direct cash loans.
ALTER TABLE "money_entry" ADD COLUMN "sr_loan_type" TEXT;
UPDATE "money_entry" SET "sr_loan_type" = 'cash' WHERE "kind" IN ('srLoan', 'srRepayment');
ALTER TABLE "money_entry" ADD CONSTRAINT "money_entry_sr_loan_type_check" CHECK (
  CASE
    WHEN "kind" IN ('srLoan', 'srRepayment') THEN "sr_loan_type" IN ('cash', 'commission')
    ELSE "sr_loan_type" IS NULL
  END
);
