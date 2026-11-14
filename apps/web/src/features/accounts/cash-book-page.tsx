"use client";

import type { ReportRange } from "@bsd/contracts";
import { formatBusinessDate, t } from "@bsd/i18n";
import { useState } from "react";
import { presetRange } from "@/components/calendar-math";
import { money } from "@/components/data-table";
import { DateRangePicker } from "@/components/date-picker";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { SummarySkeleton } from "@/components/skeleton";
import { StatTile } from "@/components/stat-tile";
import { StatePanel } from "@/components/state-panel";
import { useReport } from "@/data/queries";
import { ReportTableView } from "@/features/reports/report-view";
import { NavGate } from "@/features/shell/nav-gate";
import { PageWarnings } from "@/features/shell/notifications";
import { PrintButton, PrintHeader } from "@/features/shell/print";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { useToday } from "@/lib/today";

const PATH = "finance/cash-book";

/** "All time" (D52): the server moves the start up to the go-live cutoff and lifts the day limit. */
const ALL_TIME_FROM = "2000-01-01";

function Book({ companyId, range }: { companyId: string; range: ReportRange }) {
  const query = useReport(companyId, "cash-book", range);
  if (range.from > range.to) {
    return <StatePanel tone="error" title={t("validation.period.endBeforeStart")} />;
  }
  if (query.isPending) return <SummarySkeleton stats={4} rows={8} />;
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
  const [summary, statement] = data.tables;
  const cells = summary?.rows[0]?.cells;
  if (!cells || !statement) {
    return (
      <StatePanel
        tone="warning"
        title={t("daily.beforeCutoff.title")}
        hint={`${t("daily.beforeCutoff.hint")} ${formatBusinessDate(data.cutoffDate)}`}
      />
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <p className="text-xs text-text-muted">
        {t("report.coversFrom")} {formatBusinessDate(data.from)} – {formatBusinessDate(data.to)}
      </p>
      <PageWarnings warnings={data.warnings} />
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={t("report.column.opening")} value={money(cells.opening ?? null)} />
        <StatTile label={t("report.column.cashIn")} value={money(cells.cashIn ?? null)} />
        <StatTile label={t("report.column.cashOut")} value={money(cells.cashOut ?? null)} />
        <StatTile
          label={t("report.column.closing")}
          value={money(cells.closing ?? null)}
          emphasis
        />
      </dl>
      <ReportTableView table={statement} />
    </div>
  );
}

/** The cash book (D72: all money is cash): opening, money in and out, closing and a statement. */
export function CashBookPage() {
  const { company } = useCurrentWorkspace();
  const today = useToday();
  const [picked, setRange] = useState(() => presetRange("thisMonth", today));
  const [allTime, setAllTime] = useState(false);
  const range = allTime ? { from: ALL_TIME_FROM, to: today } : picked;
  return (
    <NavGate path={PATH}>
      <PageHeader
        title={t("nav.finance.cashBook")}
        description={t("cashBook.description")}
        actions={
          <>
            <button
              type="button"
              aria-pressed={allTime}
              onClick={() => setAllTime((on) => !on)}
              className={`inline-flex min-h-(--touch-target) items-center justify-center rounded-lg border px-4 text-sm font-medium transition-colors ${
                allTime
                  ? "border-brand bg-brand font-semibold text-brand-foreground shadow-card"
                  : "border-border bg-surface text-text shadow-card hover:border-border-strong hover:bg-surface-hover"
              }`}
            >
              {t("companyAccount.period.allTime")}
            </button>
            <DateRangePicker
              value={picked}
              onChange={(next) => {
                setAllTime(false);
                setRange(next);
              }}
              max={today}
            />
            <PrintButton />
          </>
        }
      />
      <PrintHeader title={t("nav.finance.cashBook")} from={range.from} to={range.to} />
      <Book companyId={company.id} range={range} />
    </NavGate>
  );
}
