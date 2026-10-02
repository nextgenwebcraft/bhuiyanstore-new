import { StaffAccountsPage } from "@/features/accounts/accounts-page";

export default function SrAccountsRoute() {
  return (
    <StaffAccountsPage
      path="sr-accounts/representatives"
      title="nav.srAccounts.representatives"
      kind="sr"
      statementPath="sr-accounts/statement"
    />
  );
}
