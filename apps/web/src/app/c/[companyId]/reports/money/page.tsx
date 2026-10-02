import { ReportPage } from "@/features/reports/report-page";

export default function MoneyReportRoute() {
  return (
    <ReportPage
      path="reports/money"
      title="nav.reports.money"
      description="report.description.money"
      reports={["sales", "profit", "market-due", "daily-cash"]}
    />
  );
}
