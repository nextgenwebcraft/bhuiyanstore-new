import { MoneyEntriesPage } from "@/features/daily/money-page";

export default function SrIncentivesRoute() {
  return (
    <MoneyEntriesPage
      path="sr-accounts/incentives"
      title="sr.incentivePayment"
      description="money.description.srIncentive"
      kinds={["srIncentive"]}
    />
  );
}
