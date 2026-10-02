import { MoneyEntriesPage } from "@/features/daily/money-page";

export default function StaffSettlementsRoute() {
  return (
    <MoneyEntriesPage
      path="dsr/settlements"
      title="nav.dsrStaff.settlements"
      description="money.description.staff"
      kinds={[
        "staffAdvance",
        "staffLoan",
        "staffShortage",
        "staffRepayment",
        "staffExcess",
        "staffCreditPaid",
        "staffOffset",
      ]}
    />
  );
}
