"use client";

import type { ReportRange, ReportTable } from "@bsd/contracts";
import { formatBusinessDate, formatCount, labelOf, t } from "@bsd/i18n";
import { useState } from "react";
import { presetRange } from "@/components/calendar-math";
import { DateRangePicker } from "@/components/date-picker";
import { PageHeader } from "@/components/page-header";
import { Pager } from "@/components/pager";
import { QueryError } from "@/components/query-error";
import { SummarySkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { useReport } from "@/data/queries";
import { money } from "@/components/data-table";
import { NavGate } from "@/features/shell/nav-gate";
import { PrintButton } from "@/features/shell/print";
import { PageWarnings } from "@/features/shell/notifications";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { useToday } from "@/lib/today";

const PATH = "finance/company-account";

/** "All time" (D48): the server moves the start up to the go-live cutoff and lifts the day limit. */
const ALL_TIME_FROM = "2000-01-01";

/** Statement rows per screen page (D63); print and PDF always take every row. */
const PAGE_SIZE = 25;

/** The summary figures, in this order, as one compact strip above the statement. */
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

function cellText(kind: ReportTable["columns"][number]["kind"], key: string, value: string | null) {
  if (value === null || value === "") return "-";
  if (kind === "money") return money(value);
  if (kind === "label") return labelOf(value);
  if (key === "date") return formatBusinessDate(value);
  return value;
}

/** The statement grid: a ruled frame. An empty cell shows a dash. */
function StatementTable({ table }: { table: ReportTable }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <colgroup>
          {table.columns.map((column) => (
            <col key={column.key} className={`statement-col-${column.key}`} />
          ))}
        </colgroup>
        <thead>
          <tr className="bg-surface-muted">
            {table.columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={`border border-border px-2.5 py-2 text-xs font-semibold whitespace-nowrap ${
                  column.kind === "money" ? "text-right" : "text-left"
                }`}
              >
                {labelOf(column.label)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, index) => (
            <tr key={index}>
              {table.columns.map((column) => (
                <td
                  key={column.key}
                  className={`border border-border px-2.5 py-1.5 ${
                    column.kind === "money" ? "text-right whitespace-nowrap tabular-nums" : ""
                  } ${column.key === "companyBalance" ? "font-semibold" : ""}`}
                >
                  {cellText(column.kind, column.key, row.cells[column.key] ?? null)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Statement({
  companyName,
  period,
  table,
}: {
  companyName: string;
  period: string;
  table: ReportTable;
}) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(table.rows.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const rows = table.rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  return (
    <section className="statement-sheet overflow-hidden rounded-lg border-2 border-border-strong bg-surface">
      <div className="border-b-2 border-border-strong px-4 py-4 text-center">
        <p className="text-lg font-semibold tracking-tight">{companyName}</p>
        <p className="mt-0.5 text-sm font-medium">{labelOf(table.title)}</p>
        <p className="mt-1 text-xs text-text-muted">{period}</p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3 border-b border-border px-4 py-2 print:hidden">
        <p className="mr-auto text-xs text-text-muted">{t("companyAccount.pdfHint")}</p>
        <PrintButton />
      </div>
      <div className="print:hidden">
        <StatementTable table={{ ...table, rows }} />
        <div className="border-t border-border px-4 py-3">
          <Pager page={current} pages={pages} onChange={setPage} />
        </div>
      </div>
      <div className="hidden print:block">
        <StatementTable table={table} />
      </div>
    </section>
  );
}

function Account({
  companyId,
  companyName,
  range,
  allTime,
}: {
  companyId: string;
  companyName: string;
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
        <p className="text-xs text-text-muted print:hidden">
          {t("report.coversFrom")} {formatBusinessDate(data.from)} – {formatBusinessDate(data.to)}
        </p>
      ) : null}
      <div className="print:hidden">
        <PageWarnings warnings={data.warnings} />
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-border print:hidden">
        <dl className="grid grid-cols-2 gap-px sm:grid-cols-3 lg:grid-cols-5">
          {columns.map((c) => {
            const current = c.key === "balance";
            const pieces =
              c.key === "undeliveredValue"
                ? `${formatCount(cells.undeliveredPieces ?? "0")} ${t("common.pieces")}`
                : null;
            return (
              <div
                key={c.key}
                className={`bg-surface px-3 py-2 ${current ? "bg-brand/8" : ""}`}
                title={
                  current
                    ? t("companyAccount.balanceHint")
                    : c.key === "undeliveredValue"
                      ? t("companyAccount.undeliveredHint")
                      : undefined
                }
              >
                <dt className="text-[11px] leading-snug text-text-muted">{labelOf(c.label)}</dt>
                <dd className="mt-0.5 text-sm leading-tight font-semibold tabular-nums">
                  {money(cells[c.key] ?? null)}
                </dd>
                {pieces ? (
                  <dd className="text-[11px] leading-tight text-text-subtle">{pieces}</dd>
                ) : null}
              </div>
            );
          })}
        </dl>
      </div>
      <Statement
        key={`${data.from}|${data.to}`}
        companyName={companyName}
        period={`${formatBusinessDate(data.from)} – ${formatBusinessDate(data.to)}`}
        table={statement}
      />
    </div>
  );
}

/**
 * The company statement (D33, D48, D63, D82). Summary cards stay on screen. Print is the
 * statement alone: company name, then every movement in the selected range.
 */
export function CompanyAccountPage() {
  const { company } = useCurrentWorkspace();
  const today = useToday();
  const [picked, setRange] = useState(() => presetRange("thisMonth", today));
  const [allTime, setAllTime] = useState(false);
  const range = allTime ? { from: ALL_TIME_FROM, to: today } : picked;
  return (
    <NavGate path={PATH}>
      <div className="print:hidden">
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
            </>
          }
        />
      </div>
      <Account companyId={company.id} companyName={company.name} range={range} allTime={allTime} />
    </NavGate>
  );
}
