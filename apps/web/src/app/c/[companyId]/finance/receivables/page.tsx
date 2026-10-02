import { ReportPage } from "@/features/reports/report-page";

export default function ReceivablesRoute() {
  return (
    <ReportPage
      path="finance/receivables"
      title="nav.finance.receivables"
      description="report.description.receivables"
      reports={["market-due"]}
    />
  );
}
