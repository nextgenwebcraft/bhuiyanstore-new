import { StaffAccountsPage } from "@/features/accounts/accounts-page";

export default function StaffAccountsRoute() {
  return (
    <StaffAccountsPage
      path="dsr/accounts"
      title="nav.dsrStaff.accounts"
      kind="distributor"
      statementPath="dsr/statement"
    />
  );
}
