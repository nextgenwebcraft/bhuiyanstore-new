-- D79: শর্ট is a label on the SR loan, the same balance and cash as a cash advance.
ALTER TABLE "money_entry" DROP CONSTRAINT "money_entry_sr_loan_type_check";
ALTER TABLE "money_entry" ADD CONSTRAINT "money_entry_sr_loan_type_check" CHECK (
  CASE
    WHEN "kind" IN ('srLoan', 'srRepayment') THEN "sr_loan_type" IN ('cash', 'commission', 'shortage')
    ELSE "sr_loan_type" IS NULL
  END
);
