import { ReportPage } from "@/features/reports/report-page";

export default function StaffReportRoute() {
  return (
    <ReportPage
      path="reports/staff"
      title="nav.reports.staff"
      description="report.description.staff"
      reports={["dsr-daily", "person-sales", "staff-balances"]}
    />
  );
}
