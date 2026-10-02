import { ReportPage } from "@/features/reports/report-page";

export default function PayablesRoute() {
  return (
    <ReportPage
      path="finance/payables"
      title="nav.finance.payables"
      description="report.description.payables"
      reports={["company-due"]}
    />
  );
}
