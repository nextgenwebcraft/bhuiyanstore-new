-- D33: the company may credit an incentive in money and return money for damaged goods; both
-- lower what we owe the company.

ALTER TABLE "money_entry" DROP CONSTRAINT "money_entry_kind";
ALTER TABLE "money_entry" ADD CONSTRAINT "money_entry_kind" CHECK ("kind" IN (
    'marketDueNew', 'marketDueCollected', 'srIncentive', 'expense', 'staffAdvance', 'staffLoan',
    'staffShortage', 'staffRepayment', 'staffExcess', 'staffCostPaid', 'staffCreditPaid',
    'salaryAccrual', 'salaryRecovery', 'salaryPaid', 'srLoan', 'srRepayment', 'srOwed',
    'srPayment', 'staffOffset', 'srOffset', 'supplierDeposit', 'companyIncentive'
));

ALTER TABLE "damage_event" DROP CONSTRAINT "damage_event_kind";
ALTER TABLE "damage_event" ADD CONSTRAINT "damage_event_kind" CHECK ("kind" IN (
    'buyerReplacement', 'companyDispatch', 'companyAccept', 'companyReject', 'companyReplacement',
    'writeOff', 'companyRefund'
));

ALTER TABLE "damage_event" DROP CONSTRAINT "damage_event_unit_cost";
ALTER TABLE "damage_event" ADD CONSTRAINT "damage_event_unit_cost" CHECK (
    ("kind" IN ('companyReplacement', 'companyRefund')) = ("unit_cost" IS NOT NULL)
    AND ("unit_cost" IS NULL OR "unit_cost" >= 0)
);
