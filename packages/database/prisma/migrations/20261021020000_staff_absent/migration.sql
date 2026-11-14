-- D67: absent fee, a record-only staff money kind that payroll takes off the month's salary.
ALTER TABLE "money_entry" DROP CONSTRAINT "money_entry_kind";
ALTER TABLE "money_entry" ADD CONSTRAINT "money_entry_kind" CHECK ("kind" IN (
    'marketDueNew', 'marketDueCollected', 'srIncentive', 'expense', 'staffAdvance', 'staffLoan',
    'staffShortage', 'staffRepayment', 'staffExcess', 'staffCostPaid', 'staffCreditPaid',
    'staffAbsent', 'salaryAccrual', 'salaryRecovery', 'salaryPaid', 'srLoan', 'srRepayment',
    'srOwed', 'srPayment', 'staffOffset', 'srOffset', 'supplierDeposit', 'companyIncentive',
    'cashTransfer'
));
