"use client";

import type { ReportId, ReportRange } from "@bsd/contracts";
import { t } from "@bsd/i18n";
import { Button } from "@/components/button";
import { useService } from "@/data/service-context";
import { useAsyncAction } from "@/lib/async-action";
import { downloadBlob } from "@/lib/download";

export type ExportFormat = "csv" | "xlsx";

/** Fetches a report file (the response needs the session cookie) and saves it. */
export function useReportDownload(companyId: string, report: ReportId, range: ReportRange) {
  const service = useService();
  const action = useAsyncAction();
  const exportAs = (format: ExportFormat) =>
    action.run(async () => {
      const { file, fileName } = await service.downloadReport(companyId, report, range, format);
      downloadBlob(file, fileName);
    });
  return { exportAs, busy: action.busy, error: action.error };
}

/** The CSV and Excel download buttons of a report. */
export function ReportExportButtons({
  exportAs,
  busy,
}: {
  exportAs: (format: ExportFormat) => unknown;
  busy: boolean;
}) {
  return (
    <>
      <Button disabled={busy} onClick={() => void exportAs("csv")}>
        {t("report.exportCsv")}
      </Button>
      <Button disabled={busy} onClick={() => void exportAs("xlsx")}>
        {t("report.exportExcel")}
      </Button>
    </>
  );
}
