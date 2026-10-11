"use client";

import { canViewReport, type ReportId } from "@bsd/contracts";
import { t, type TranslationKey } from "@bsd/i18n";
import { useState } from "react";
import { Button } from "@/components/button";
import { presetRange } from "@/components/calendar-math";
import { DateRangePicker } from "@/components/date-picker";
import { PageHeader } from "@/components/page-header";
import { StatePanel } from "@/components/state-panel";
import { NavGate } from "@/features/shell/nav-gate";
import { PrintButton, PrintHeader } from "@/features/shell/print";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { useToday } from "@/lib/today";
import { ReportBody } from "./report-view";
import { ReportExportButtons, useReportDownload } from "./report-export";

const reportLabel = (id: ReportId) => t(`report.name.${id}` as TranslationKey);

export function ReportPage({
  path,
  title,
  description,
  reports,
}: {
  path: string;
  title: TranslationKey;
  description: TranslationKey;
  reports: [ReportId, ...ReportId[]];
}) {
  const { company, permissions } = useCurrentWorkspace();
  const allowed = reports.filter((id) => canViewReport(id, permissions));
  const [selected, setReport] = useState<ReportId>(reports[0]);
  const report = allowed.includes(selected) ? selected : (allowed[0] ?? selected);
  const today = useToday();
  const [range, setRange] = useState(() => presetRange("thisMonth", today));
  const download = useReportDownload(company.id, report, range);
  const canExport = permissions.includes("report.export");

  return (
    <NavGate path={path}>
      <PageHeader
        title={t(title)}
        description={t(description)}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <DateRangePicker value={range} onChange={setRange} max={today} />
            {canExport ? (
              <ReportExportButtons exportAs={download.exportAs} busy={download.busy} />
            ) : null}
            <PrintButton />
          </div>
        }
      />
      <PrintHeader title={`${t(title)} — ${reportLabel(report)}`} from={range.from} to={range.to} />
      {allowed.length > 1 ? (
        <div role="tablist" className="mb-4 flex flex-wrap gap-2">
          {allowed.map((id) => (
            <Button
              key={id}
              role="tab"
              aria-selected={id === report}
              variant={id === report ? "primary" : "secondary"}
              onClick={() => setReport(id)}
            >
              {reportLabel(id)}
            </Button>
          ))}
        </div>
      ) : null}
      {download.error ? <StatePanel tone="error" title={download.error} /> : null}
      <ReportBody companyId={company.id} report={report} range={range} />
    </NavGate>
  );
}
