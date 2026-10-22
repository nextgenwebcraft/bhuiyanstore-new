"use client";

import type { ReportRange, ReportTable } from "@bsd/contracts";
import { formatBusinessDate, formatCount, labelOf, t } from "@bsd/i18n";
import { useState } from "react";
import { Button } from "@/components/button";
import { presetRange } from "@/components/calendar-math";
import { DateRangePicker } from "@/components/date-picker";
import { PageHeader } from "@/components/page-header";
import { Pager } from "@/components/pager";
import { QueryError } from "@/components/query-error";
import { SummarySkeleton } from "@/components/skeleton";
import { StatTile } from "@/components/stat-tile";
import { StatePanel } from "@/components/state-panel";
import { useReport } from "@/data/queries";
import { money } from "@/components/data-table";
import { ReportTableView } from "@/features/reports/report-view";
import { NavGate } from "@/features/shell/nav-gate";
import { PrintButton, PrintHeader } from "@/features/shell/print";
import { PageWarnings } from "@/features/shell/notifications";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { useToday } from "@/lib/today";

const PATH = "finance/company-account";

/** "All time" (D48): the server moves the start up to the go-live cutoff and lifts the day limit. */
const ALL_TIME_FROM = "2000-01-01";

/** Statement rows per screen page (D63); print and PDF always take every row. */
const PAGE_SIZE = 25;

/** The summary figures shown as cards, in this order. */
const CARDS = [
  "balance",
  "totalCash",
  "damageBalance",
  "incentiveBalance",
  "undeliveredValue",
  "deposits",
  "orders",
  "incentives",
  "damageRefunds",
  "investments",
];

function PagedStatement({ table }: { table: ReportTable }) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(table.rows.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = table.rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  return (
    <>
      <div className="flex flex-col gap-3 print:hidden">
        <ReportTableView table={{ ...table, rows }} />
        <Pager page={current} pages={pages} onChange={setPage} />
      </div>
      <div className="hidden print:block">
        <ReportTableView table={table} summary={false} />
      </div>
    </>
  );
}

function Account({
  companyId,
  range,
  allTime,
}: {
  companyId: string;
  range: ReportRange;
  allTime: boolean;
}) {
  const query = useReport(companyId, "company-account", range);
  if (range.from > range.to)
    return <StatePanel tone="error" title={t("validation.period.endBeforeStart")} />;
  if (query.isPending) return <SummarySkeleton stats={6} rows={8} />;
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
  if (!summary || !statement) {
    return (
      <StatePanel
        tone="warning"
        title={t("daily.beforeCutoff.title")}
        hint={`${t("daily.beforeCutoff.hint")} ${formatBusinessDate(data.cutoffDate)}`}
      />
    );
  }
  const cells = summary.rows[0]?.cells ?? {};
  const columns = CARDS.flatMap((key) => summary.columns.filter((c) => c.key === key));
  return (
    <div className="flex flex-col gap-6">
      {allTime || data.from !== range.from ? (
        <p className="text-xs text-text-muted">
          {t("report.coversFrom")} {formatBusinessDate(data.from)} – {formatBusinessDate(data.to)}
        </p>
      ) : null}
      <PageWarnings warnings={data.warnings} />
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {columns.map((c) => {
          const current = c.key === "balance";
          return (
            <div key={c.key} className={current ? "sm:col-span-2" : undefined}>
              <StatTile
                label={labelOf(c.label)}
                value={money(cells[c.key] ?? null)}
                emphasis={current}
                large={current}
                {...(current
                  ? { hint: t("companyAccount.balanceHint") }
                  : c.key === "undeliveredValue"
                    ? {
                        hint: `${formatCount(cells.undeliveredPieces ?? "0")} ${t("common.pieces")} · ${t("companyAccount.undeliveredHint")}`,
                      }
                    : {})}
              />
            </div>
          );
        })}
      </dl>
      <PagedStatement key={`${data.from}|${data.to}`} table={statement} />
    </div>
  );
}

/**
 * The company statement (D33, D48, D63): every movement with the company — deposits, money
 * incentives, damage deposits, orders by the balance part that paid them, excess receipts and
 * investments — paginated on screen, every row on print and PDF.
 */
export function CompanyAccountPage() {
  const { company } = useCurrentWorkspace();
  const today = useToday();
  const [picked, setRange] = useState(() => presetRange("thisMonth", today));
  const [allTime, setAllTime] = useState(false);
  const range = allTime ? { from: ALL_TIME_FROM, to: today } : picked;
  return (
    <NavGate path={PATH}>
      <PageHeader
        title={t("nav.finance.companyAccount")}
        description={t("companyAccount.description")}
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
            <Button
              className="print:hidden"
              title={t("companyAccount.pdfHint")}
              onClick={() => window.print()}
            >
              {t("companyAccount.pdf")}
            </Button>
          </>
        }
      />
      <PrintHeader title={t("nav.finance.companyAccount")} from={range.from} to={range.to} />
      <p className="mb-4 text-xs text-text-muted print:hidden">{t("companyAccount.pdfHint")}</p>
      <Account companyId={company.id} range={range} allTime={allTime} />
    </NavGate>
  );
}
