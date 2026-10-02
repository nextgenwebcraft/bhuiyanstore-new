import { MoneyEntriesPage } from "@/features/daily/money-page";

export default function SrSettlementsRoute() {
  return (
    <MoneyEntriesPage
      path="sr-accounts/settlements"
      title="nav.srAccounts.settlements"
      description="money.description.sr"
      kinds={["srLoan", "srRepayment", "srOwed", "srPayment", "srOffset"]}
    />
  );
}
