-- Cash and bank book (D52): the account a money entry moves, and the receiving account of a
-- transfer. Nullable: an entry without an account moves the company's default account (resolved
-- when read), so every entry posted before this migration keeps working unchanged.
ALTER TABLE "money_entry" ADD COLUMN "cash_account_id" TEXT;
ALTER TABLE "money_entry" ADD COLUMN "to_cash_account_id" TEXT;

ALTER TABLE "money_entry"
    ADD CONSTRAINT "money_entry_cash_account_id_fkey"
    FOREIGN KEY ("cash_account_id") REFERENCES "cash_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "money_entry"
    ADD CONSTRAINT "money_entry_to_cash_account_id_fkey"
    FOREIGN KEY ("to_cash_account_id") REFERENCES "cash_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "money_entry_cash_account_id_idx" ON "money_entry"("cash_account_id");
CREATE INDEX "money_entry_to_cash_account_id_idx" ON "money_entry"("to_cash_account_id");

-- The new kind, and the transfer's shape: both accounts named and different; no receiving account
-- on any other kind.
ALTER TABLE "money_entry" DROP CONSTRAINT "money_entry_kind";
ALTER TABLE "money_entry" ADD CONSTRAINT "money_entry_kind" CHECK ("kind" IN (
    'marketDueNew', 'marketDueCollected', 'srIncentive', 'expense', 'staffAdvance', 'staffLoan',
    'staffShortage', 'staffRepayment', 'staffExcess', 'staffCostPaid', 'staffCreditPaid',
    'salaryAccrual', 'salaryRecovery', 'salaryPaid', 'srLoan', 'srRepayment', 'srOwed',
    'srPayment', 'staffOffset', 'srOffset', 'supplierDeposit', 'companyIncentive', 'cashTransfer'
));
ALTER TABLE "money_entry" ADD CONSTRAINT "money_entry_transfer_accounts" CHECK (
    ("kind" = 'cashTransfer') = ("to_cash_account_id" IS NOT NULL)
    AND ("kind" <> 'cashTransfer' OR ("cash_account_id" IS NOT NULL AND "cash_account_id" <> "to_cash_account_id"))
);
