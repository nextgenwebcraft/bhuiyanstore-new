import { MoneyEntriesPage } from "@/features/daily/money-page";

export default function ExpensesRoute() {
  return (
    <MoneyEntriesPage
      path="finance/expenses"
      title="nav.finance.expenses"
      description="money.description.expenses"
      kinds={["expense", "staffCostPaid"]}
    />
  );
}
