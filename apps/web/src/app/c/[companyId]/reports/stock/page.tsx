import { ReportPage } from "@/features/reports/report-page";

export default function StockReportRoute() {
  return (
    <ReportPage
      path="reports/stock"
      title="nav.reports.stock"
      description="report.description.stock"
      reports={["stock", "company-due", "damage", "cartons"]}
    />
  );
}
