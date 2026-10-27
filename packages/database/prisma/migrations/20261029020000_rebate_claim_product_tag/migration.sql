-- D105 (owner 2026-10-29): a new money kind, rebateClaim (রিবেট ক্লেইম), same effect as
-- companyIncentive (lowers what we owe the company, no cash); and a product tag on
-- companyIncentive/rebateClaim entries (optional) so the company statement shows which product
-- each one was for.
ALTER TABLE "money_entry" DROP CONSTRAINT "money_entry_kind";
ALTER TABLE "money_entry" ADD CONSTRAINT "money_entry_kind" CHECK ("kind" IN (
    'marketDueNew', 'marketDueCollected', 'srIncentive', 'expense', 'staffAdvance', 'staffLoan',
    'staffShortage', 'staffRepayment', 'staffExcess', 'staffCostPaid', 'staffCreditPaid',
    'staffAbsent', 'salaryAccrual', 'salaryRecovery', 'salaryPaid', 'srLoan', 'srRepayment',
    'srOwed', 'srPayment', 'staffOffset', 'srOffset', 'supplierDeposit', 'companyIncentive',
    'cashTransfer', 'rebateClaim'
));

ALTER TABLE "money_entry" ADD COLUMN "product_id" TEXT;

CREATE INDEX "money_entry_product_id_idx" ON "money_entry"("product_id");

ALTER TABLE "money_entry" ADD CONSTRAINT "money_entry_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
