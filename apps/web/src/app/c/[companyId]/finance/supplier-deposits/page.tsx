import { MoneyEntriesPage } from "@/features/daily/money-page";

export default function SupplierDepositsRoute() {
  return (
    <MoneyEntriesPage
      path="finance/supplier-deposits"
      title="finance.supplierDeposit"
      description="money.description.supplierDeposit"
      kinds={["supplierDeposit"]}
    />
  );
}
