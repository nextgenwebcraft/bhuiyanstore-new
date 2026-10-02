"use client";

import type { ReportId, ReportRange, ReportTable } from "@bsd/contracts";
import { businessDateOf } from "@bsd/domain";
import {
  formatBusinessDate,
  formatRate,
  labelOf,
  t,
  toBengaliDigits,
  type TranslationKey,
} from "@bsd/i18n";
import { useState } from "react";
import { Button } from "@/components/button";
import { inputClass } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { ListSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { describeError } from "@/data/ports/service-error";
import { useReport } from "@/data/queries";
import { useService } from "@/data/service-context";
import { Warnings } from "@/features/daily/day-report-page";
import {
  cartonText,
  money,
  tableClass,
  tableShell,
  tdClass,
  tdNum,
  thClass,
  thNum,
  theadClass,
} from "@/features/daily/daily-kit";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { downloadBlob } from "@/lib/download";

function cellText(
  kind: ReportTable["columns"][number]["kind"],
  key: string,
  value: string | null,
  piecesPerCarton: string | undefined,
): string {
  if (value === null) return "—";
  switch (kind) {
    case "money":
      return money(value);
    case "rate":
      return formatRate(value);
    case "quantity":
      return cartonText(value, piecesPerCarton ?? "1");
    case "cartons":
      return toBengaliDigits(value);
    case "label":
      return labelOf(value);
    case "text":
      return key === "date" ? formatBusinessDate(value) : toBengaliDigits(value);
  }
}

export function ReportTableView({ table }: { table: ReportTable }) {
  const numeric = (kind: string) => kind !== "text" && kind !== "label";
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">{labelOf(table.title)}</h2>
      {table.rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-text-muted">
          {t("report.empty")}
        </p>
      ) : (
        <div className={tableShell}>
          <table className={tableClass}>
            <thead className={theadClass}>
              <tr>
                {table.columns.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    className={`${numeric(c.kind) ? thNum : thClass} whitespace-nowrap`}
                  >
                    {labelOf(c.label)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, index) => (
                <tr key={index} className="border-t border-border">
                  {table.columns.map((c) => (
                    <td
                      key={c.key}
                      className={`${numeric(c.kind) ? tdNum : tdClass} whitespace-nowrap`}
                    >
                      {cellText(c.kind, c.key, row.cells[c.key] ?? null, row.piecesPerCarton)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {table.totals ? (
              <tfoot>
                <tr className="border-t-2 border-border font-semibold">
                  {table.columns.map((c, i) => {
                    const value = table.totals?.[c.key] ?? null;
                    return (
                      <td key={c.key} className={numeric(c.kind) ? tdNum : tdClass}>
                        {i === 0
                          ? t("common.total")
                          : value === null
                            ? ""
                            : cellText(c.kind, c.key, value, undefined)}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      )}
    </section>
  );
}

const reportLabel = (id: ReportId) => t(`report.name.${id}` as TranslationKey);

function defaultRange(): ReportRange {
  const today = businessDateOf(new Date());
  return { from: `${today.slice(0, 7)}-01`, to: today };
}

function Report({
  companyId,
  report,
  range,
}: {
  companyId: string;
  report: ReportId;
  range: ReportRange;
}) {
  const query = useReport(companyId, report, range);
  if (range.from > range.to)
    return <StatePanel tone="error" title={t("validation.period.endBeforeStart")} />;
  if (query.isPending) return <ListSkeleton />;
  if (query.isError) return <QueryError error={query.error} onRetry={() => void query.refetch()} />;
  const data = query.data;
  if (!data.cutoffDate) {
    return (
      <StatePanel
        tone="warning"
        title={t("daily.noOpening.title")}
        hint={t("daily.noOpening.hint")}
      />
    );
  }
  if (data.tables.length === 0) {
    return (
      <StatePanel
        tone="warning"
        title={t("daily.beforeCutoff.title")}
        hint={`${t("daily.beforeCutoff.hint")} ${formatBusinessDate(data.cutoffDate)}`}
      />
    );
  }
  return (
    <div className={`flex flex-col gap-6 ${query.isPlaceholderData ? "opacity-60" : ""}`}>
      {data.from !== range.from || data.to !== range.to ? (
        <p className="text-xs text-text-muted">
          {t("report.coversFrom")} {formatBusinessDate(data.from)} – {formatBusinessDate(data.to)}
        </p>
      ) : null}
      <Warnings view={{ warnings: data.warnings, products: [] }} />
      {data.tables.map((table) => (
        <ReportTableView key={table.title} table={table} />
      ))}
    </div>
  );
}

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
  const service = useService();
  const allowed = reports.filter((id) => {
    if (id === "profit") {
      return (
        permissions.includes("inventory.cost_view") && permissions.includes("report.profit_view")
      );
    }
    if (id === "staff-balances") return permissions.includes("finance.view");
    return true;
  });
  const [selected, setReport] = useState<ReportId>(reports[0]);
  const report = allowed.includes(selected) ? selected : (allowed[0] ?? selected);
  const [range, setRange] = useState(defaultRange);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const canExport = permissions.includes("report.export");

  async function exportAs(format: "csv" | "xlsx") {
    setError(undefined);
    setBusy(true);
    try {
      const { file, fileName } = await service.downloadReport(company.id, report, range, format);
      downloadBlob(file, fileName);
    } catch (e) {
      setError(describeError(e, []).form);
    } finally {
      setBusy(false);
    }
  }

  return (
    <NavGate path={path}>
      <PageHeader
        title={t(title)}
        description={t(description)}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="report-from">
              {t("common.from")}
            </label>
            <input
              id="report-from"
              type="date"
              value={range.from}
              onChange={(event) =>
                event.target.value && setRange({ ...range, from: event.target.value })
              }
              className={`${inputClass} w-auto text-sm`}
            />
            <span aria-hidden>–</span>
            <label className="sr-only" htmlFor="report-to">
              {t("common.to")}
            </label>
            <input
              id="report-to"
              type="date"
              value={range.to}
              onChange={(event) =>
                event.target.value && setRange({ ...range, to: event.target.value })
              }
              className={`${inputClass} w-auto text-sm`}
            />
            {canExport ? (
              <>
                <Button disabled={busy} onClick={() => void exportAs("csv")}>
                  {t("report.exportCsv")}
                </Button>
                <Button disabled={busy} onClick={() => void exportAs("xlsx")}>
                  {t("report.exportExcel")}
                </Button>
              </>
            ) : null}
          </div>
        }
      />
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
      {error ? <StatePanel tone="error" title={error} /> : null}
      <Report companyId={company.id} report={report} range={range} />
    </NavGate>
  );
}
