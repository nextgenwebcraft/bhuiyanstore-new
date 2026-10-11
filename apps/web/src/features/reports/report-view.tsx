"use client";

import type { ReportId, ReportRange, ReportTable } from "@bsd/contracts";
import {
  labelOf,
  t,
  toBengaliDigits,
  formatBusinessDate,
  formatCount,
  formatRate,
} from "@bsd/i18n";
import { EmptyListNote } from "@/components/empty-list-note";
import { useState } from "react";
import { Button } from "@/components/button";
import { Icon } from "@/components/icons";
import { QueryError } from "@/components/query-error";
import { TableSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { TableSummary, type SummaryItem } from "@/components/table-summary";
import { useReport } from "@/data/queries";
import {
  CartonQty,
  ColumnHead,
  money,
  stickyCell,
  stickyHead,
  tableClass,
  tdClass,
  tdNum,
  thClass,
  thNum,
  theadClass,
} from "@/components/data-table";
import { TableScroller } from "@/components/table-scroller";
import { PageWarnings } from "@/features/shell/notifications";

function cellText(
  kind: ReportTable["columns"][number]["kind"],
  key: string,
  value: string | null,
  piecesPerCarton: string | undefined,
): React.ReactNode {
  if (value === null) return "—";
  switch (kind) {
    case "money":
      return money(value);
    case "rate":
      return formatRate(value);
    case "quantity":
      return <CartonQty pieces={value} piecesPerCarton={piecesPerCarton ?? "1"} />;
    case "cartons":
      return toBengaliDigits(value);
    case "label":
      return labelOf(value);
    case "text":
      return key === "date" ? formatBusinessDate(value) : toBengaliDigits(value);
  }
}

export function ReportTableView({
  table,
  heading = true,
}: {
  table: ReportTable;
  heading?: boolean;
}) {
  const numeric = (kind: string) => kind !== "text" && kind !== "label";
  const listing =
    heading && table.rows.length > 0 && !table.columns.some((c) => c.kind === "label");
  const summary: SummaryItem[] = listing
    ? [
        { label: t("table.summary.rows"), value: formatCount(table.rows.length) },
        ...table.columns.flatMap((c) => {
          const value = table.totals?.[c.key];
          return value === undefined || value === null
            ? []
            : [{ label: labelOf(c.label), value: cellText(c.kind, c.key, value, undefined) }];
        }),
      ]
    : [];
  return (
    <section className="flex flex-col gap-2">
      {heading ? <h2 className="text-sm font-semibold">{labelOf(table.title)}</h2> : null}
      <TableSummary label={t("table.summary")} items={summary} />
      {table.rows.length === 0 ? (
        <EmptyListNote textKey="report.empty" />
      ) : (
        <TableScroller>
          <table className={tableClass}>
            <thead className={theadClass}>
              <tr>
                {table.columns.map((c, i) =>
                  numeric(c.kind) && i > 0 ? (
                    <ColumnHead
                      key={c.key}
                      label={labelOf(c.label)}
                      quantity={c.kind === "quantity"}
                    />
                  ) : (
                    <th
                      key={c.key}
                      scope="col"
                      className={`${numeric(c.kind) ? thNum : thClass} whitespace-nowrap ${i === 0 ? stickyHead : ""}`}
                    >
                      {labelOf(c.label)}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, index) => (
                <tr key={index} className="border-t border-border">
                  {table.columns.map((c, i) => (
                    <td
                      key={c.key}
                      className={`${numeric(c.kind) ? tdNum : tdClass} whitespace-nowrap ${i === 0 ? stickyCell : ""}`}
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
                      <td
                        key={c.key}
                        className={`${numeric(c.kind) ? tdNum : tdClass} ${i === 0 ? stickyCell : ""}`}
                      >
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
        </TableScroller>
      )}
    </section>
  );
}

/**
 * The DSR × product sales list as one folding block per DSR: its total from the engine's person
 * totals in the header, its products inside, so a long list reads one person at a time.
 */
export function PersonSales({ totals, products }: { totals: ReportTable; products: ReportTable }) {
  const people = totals.rows.map((r) => r.cells.staff ?? "");
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set(people.length === 1 ? people : []),
  );
  const columns = products.columns.filter((c) => c.key !== "staff");
  const toggle = (name: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{labelOf(products.title)}</h2>
        <div className="flex gap-2">
          <Button onClick={() => setOpen(new Set(people))}>{t("report.person.openAll")}</Button>
          <Button onClick={() => setOpen(new Set())}>{t("report.person.closeAll")}</Button>
        </div>
      </div>
      {totals.rows.length === 0 ? (
        <EmptyListNote textKey="report.empty" />
      ) : (
        <ul className="flex flex-col gap-2">
          {totals.rows.map((person) => {
            const name = person.cells.staff ?? "";
            const rows = products.rows.filter((r) => r.cells.staff === name);
            const expanded = open.has(name);
            return (
              <li
                key={name}
                className="overflow-hidden rounded-xl border border-border bg-surface shadow-card"
              >
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => toggle(name)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-hover"
                >
                  <Icon
                    name="chevronDown"
                    className={`size-4 text-text-muted transition-transform ${expanded ? "" : "-rotate-90"}`}
                  />
                  <span className="font-medium">{name}</span>
                  <span className="text-xs text-text-muted">
                    {formatCount(rows.length)} {t("report.person.products")}
                  </span>
                  <span className="ml-auto font-semibold tabular-nums">
                    {money(person.cells.amount ?? null)}
                  </span>
                </button>
                {expanded ? (
                  <div className="border-t border-border p-3">
                    <ReportTableView
                      heading={false}
                      table={{ ...products, columns, rows, totals: null }}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** One report over a range: its tables, or why there is none (no opening, before the cutoff). */
export function ReportBody({
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
  if (query.isPending) return <TableSkeleton rows={8} columns={7} title />;
  if (query.isError) return <QueryError error={query.error} onRetry={() => void query.refetch()} />;
  const data = query.data;
  const personTotals = data.tables.find((x) => x.title === "report.table.personTotals");
  const personProducts = data.tables.find((x) => x.title === "report.table.personProducts");
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
    <div className="flex flex-col gap-6">
      {data.from !== range.from || data.to !== range.to ? (
        <p className="text-xs text-text-muted">
          {t("report.coversFrom")} {formatBusinessDate(data.from)} – {formatBusinessDate(data.to)}
        </p>
      ) : null}
      <PageWarnings warnings={data.warnings} />
      {personTotals && personProducts ? (
        <PersonSales totals={personTotals} products={personProducts} />
      ) : null}
      {data.tables
        .filter((table) => table !== personTotals && table !== personProducts)
        .map((table) => (
          <ReportTableView key={table.title} table={table} />
        ))}
    </div>
  );
}
