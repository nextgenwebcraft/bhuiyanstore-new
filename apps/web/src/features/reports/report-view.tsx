"use client";

import type { Report, ReportId, ReportRange, ReportTable } from "@bsd/contracts";
import { Decimal } from "@bsd/domain";
import {
  labelOf,
  t,
  toBengaliDigits,
  formatBusinessDate,
  formatCount,
  formatRate,
  roundForDisplay,
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

type Column = ReportTable["columns"][number];
type Cells = ReportTable["rows"][number]["cells"];

function cellText(
  kind: Column["kind"],
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
      return formatCount(value);
    case "label":
      return labelOf(value);
    case "text":
      return key === "date" ? formatBusinessDate(value) : toBengaliDigits(roundForDisplay(value));
  }
}

const numeric = (kind: string) => kind !== "text" && kind !== "label";

/** Leading columns written once per run of equal values (a date over its DSRs, a DSR over its products). */
const GROUP_KEYS = new Set(["date", "staff"]);

function groupDepth(columns: readonly Column[]): number {
  let depth = 0;
  while (GROUP_KEYS.has(columns[depth]?.key ?? "")) depth += 1;
  return depth;
}

const tableTitle = (title: string) => `report.table.${title}`;

export type RowAction = (row: ReportTable["rows"][number]) => React.ReactNode;

export function ReportTableView({
  table,
  heading = true,
  summary = true,
  rowAction,
}: {
  table: ReportTable;
  heading?: boolean;
  /** Row count and column totals as cards above the table. */
  summary?: boolean;
  /** A last cell per row (a row menu). */
  rowAction?: RowAction | undefined;
}) {
  const only = table.rows.length === 1 ? table.rows[0] : undefined;
  if (only && !rowAction && table.columns.every((c) => numeric(c.kind))) {
    return (
      <section className="flex flex-col gap-2">
        {heading ? <h2 className="text-sm font-semibold">{labelOf(table.title)}</h2> : null}
        <TableSummary
          label={labelOf(table.title)}
          items={table.columns.map((c) => ({
            label: labelOf(c.label),
            value: cellText(c.kind, c.key, only.cells[c.key] ?? null, only.piecesPerCarton),
          }))}
        />
      </section>
    );
  }

  const listing =
    summary && heading && table.rows.length > 0 && !table.columns.some((c) => c.kind === "label");
  const items: SummaryItem[] = listing
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
  const depth = groupDepth(table.columns);
  const sameAsAbove = (index: number, upTo: number) => {
    const above = table.rows[index - 1];
    const row = table.rows[index];
    return (
      above !== undefined &&
      row !== undefined &&
      table.columns.slice(0, upTo + 1).every((c) => above.cells[c.key] === row.cells[c.key])
    );
  };
  return (
    <section className="flex flex-col gap-2">
      {heading ? <h2 className="text-sm font-semibold">{labelOf(table.title)}</h2> : null}
      <TableSummary label={t("table.summary")} items={items} />
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
                {rowAction ? (
                  <th scope="col" className={thClass}>
                    <span className="sr-only">{t("common.actions")}</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, index) => (
                <tr
                  key={index}
                  className={
                    index > 0 && depth > 0 && !sameAsAbove(index, 0)
                      ? "border-t-2 border-border-strong"
                      : "border-t border-border"
                  }
                >
                  {table.columns.map((c, i) => (
                    <td
                      key={c.key}
                      className={`${numeric(c.kind) ? tdNum : tdClass} whitespace-nowrap ${i === 0 ? stickyCell : ""} ${i < depth ? "font-medium" : ""}`}
                    >
                      {i < depth && sameAsAbove(index, i)
                        ? ""
                        : cellText(c.kind, c.key, row.cells[c.key] ?? null, row.piecesPerCarton)}
                    </td>
                  ))}
                  {rowAction ? (
                    <td className={`${tdClass} text-right print:hidden`}>{rowAction(row)}</td>
                  ) : null}
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
                  {rowAction ? <td className="print:hidden" /> : null}
                </tr>
              </tfoot>
            ) : null}
          </table>
        </TableScroller>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- folding blocks

function useFolds(keys: readonly string[]) {
  const [open, setOpen] = useState<ReadonlySet<string>>(
    () => new Set(keys.length === 1 ? keys : []),
  );
  return {
    isOpen: (key: string) => open.has(key),
    toggle: (key: string) =>
      setOpen((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      }),
    openAll: () => setOpen(new Set(keys)),
    closeAll: () => setOpen(new Set()),
  };
}

function FoldHeading({
  title,
  onOpenAll,
  onCloseAll,
}: {
  title: string;
  onOpenAll: () => void;
  onCloseAll: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="flex gap-2 print:hidden">
        <Button onClick={onOpenAll}>{t("report.person.openAll")}</Button>
        <Button onClick={onCloseAll}>{t("report.person.closeAll")}</Button>
      </div>
    </div>
  );
}

function Fold({
  expanded,
  onToggle,
  title,
  meta,
  figures,
  children,
}: {
  expanded: boolean;
  onToggle: () => void;
  title: string;
  meta?: React.ReactNode;
  figures: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-left hover:bg-surface-hover"
      >
        <Icon
          name="chevronDown"
          className={`size-4 text-text-muted transition-transform ${expanded ? "" : "-rotate-90"}`}
        />
        <span className="font-medium">{title}</span>
        {meta}
        <span className="ml-auto flex flex-wrap items-center justify-end gap-x-6 gap-y-1">
          {figures}
        </span>
      </button>
      {expanded ? (
        <div className="flex flex-col gap-3 border-t border-border p-3">{children}</div>
      ) : null}
    </li>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "error" | undefined;
}) {
  return (
    <span className="flex flex-col items-end leading-tight">
      <span className="text-[11px] text-text-muted">{label}</span>
      <span className={`font-semibold tabular-nums ${tone === "error" ? "text-error" : ""}`}>
        {value}
      </span>
    </span>
  );
}

/**
 * The DSR × product sales list as one folding block per DSR: its total from the engine's person
 * totals in the header, its products inside, so a long list reads one person at a time.
 */
export function PersonSales({ totals, products }: { totals: ReportTable; products: ReportTable }) {
  const people = totals.rows.map((r) => r.cells.staff ?? "");
  const folds = useFolds(people);
  const columns = products.columns.filter((c) => c.key !== "staff");
  const amount = totals.columns.find((c) => c.key === "amount");

  return (
    <section className="flex flex-col gap-3">
      <FoldHeading
        title={labelOf(products.title)}
        onOpenAll={folds.openAll}
        onCloseAll={folds.closeAll}
      />
      {totals.rows.length === 0 ? (
        <EmptyListNote textKey="report.empty" />
      ) : (
        <>
          <TableSummary
            label={t("table.summary")}
            items={[{ label: t("report.summary.dsrs"), value: formatCount(people.length) }]}
          />
          <ul className="flex flex-col gap-2">
            {totals.rows.map((person) => {
              const name = person.cells.staff ?? "";
              const rows = products.rows.filter((r) => r.cells.staff === name);
              return (
                <Fold
                  key={name}
                  expanded={folds.isOpen(name)}
                  onToggle={() => folds.toggle(name)}
                  title={name}
                  meta={
                    <span className="text-xs text-text-muted">
                      {formatCount(rows.length)} {t("report.person.products")}
                    </span>
                  }
                  figures={
                    <Figure
                      label={amount ? labelOf(amount.label) : ""}
                      value={money(person.cells.amount ?? null)}
                    />
                  }
                >
                  <ReportTableView
                    heading={false}
                    table={{ ...products, columns, rows, totals: null }}
                  />
                </Fold>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

const HEADER_FIGURES = ["sales", "expectedCash", "handedOver", "difference"] as const;
const INNER_FIGURES = ["marketDueNew", "marketDueCollected", "costPaid"] as const;

/**
 * The DSR day report as one block per DSR and day: the cash check in the header, dues, costs and
 * the product lines inside. Dates head their DSRs instead of repeating on every row.
 */
export function DsrDays({ cash, products }: { cash: ReportTable; products: ReportTable }) {
  const keyOf = (cells: Cells) => `${cells.date ?? ""}|${cells.staff ?? ""}`;
  const folds = useFolds(cash.rows.map((r) => keyOf(r.cells)));
  const dates = [...new Set(cash.rows.map((r) => r.cells.date ?? ""))];
  const people = new Set(cash.rows.map((r) => r.cells.staff ?? ""));
  const mismatches = cash.rows.filter((r) => r.cells.flag).length;
  const productColumns = products.columns.filter((c) => !GROUP_KEYS.has(c.key));
  const figure = (cells: Cells, key: string) => {
    const column = cash.columns.find((c) => c.key === key);
    if (!column) return null;
    const value = cells[key] ?? null;
    return {
      label: labelOf(column.label),
      value: cellText(column.kind, key, value, undefined),
      short: key === "difference" && value !== null && !new Decimal(value).isZero(),
    };
  };

  return (
    <section className="flex flex-col gap-3">
      <FoldHeading
        title={t("report.table.dsrDays")}
        onOpenAll={folds.openAll}
        onCloseAll={folds.closeAll}
      />
      {cash.rows.length === 0 ? (
        <EmptyListNote textKey="report.empty" />
      ) : (
        <>
          <TableSummary
            label={t("table.summary")}
            items={[
              { label: t("report.summary.dsrs"), value: formatCount(people.size) },
              ...(dates.length > 1
                ? [{ label: t("report.summary.days"), value: formatCount(dates.length) }]
                : []),
              ...(mismatches > 0
                ? [
                    {
                      label: t("report.summary.mismatches"),
                      value: formatCount(mismatches),
                      emphasis: true,
                    },
                  ]
                : []),
            ]}
          />
          {dates.map((date) => (
            <div key={date} className="flex flex-col gap-2">
              {dates.length > 1 ? (
                <h3 className="flex items-center gap-2 pt-1 text-sm font-semibold text-text-muted">
                  <Icon name="calendar" className="size-4" />
                  {formatBusinessDate(date)}
                </h3>
              ) : null}
              <ul className="flex flex-col gap-2">
                {cash.rows
                  .filter((r) => r.cells.date === date)
                  .map((row) => {
                    const key = keyOf(row.cells);
                    const lines = products.rows.filter((p) => keyOf(p.cells) === key);
                    const inner = INNER_FIGURES.flatMap((k) => {
                      const f = figure(row.cells, k);
                      return f ? [{ label: f.label, value: f.value }] : [];
                    });
                    return (
                      <Fold
                        key={key}
                        expanded={folds.isOpen(key)}
                        onToggle={() => folds.toggle(key)}
                        title={row.cells.staff ?? ""}
                        meta={
                          row.cells.flag ? (
                            <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs text-warning">
                              {t("report.summary.mismatches")}
                            </span>
                          ) : null
                        }
                        figures={HEADER_FIGURES.map((k) => {
                          const f = figure(row.cells, k);
                          return f ? (
                            <Figure
                              key={k}
                              label={f.label}
                              value={f.value}
                              tone={f.short ? "error" : undefined}
                            />
                          ) : null;
                        })}
                      >
                        {row.cells.flag ? (
                          <p className="text-xs text-warning">{labelOf(row.cells.flag)}</p>
                        ) : null}
                        <TableSummary label={t("table.summary")} items={inner} />
                        <ReportTableView
                          heading={false}
                          table={{
                            ...products,
                            columns: productColumns,
                            rows: lines,
                            totals: null,
                          }}
                        />
                      </Fold>
                    );
                  })}
              </ul>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- report bodies

type ReportQuery = ReturnType<typeof useReport>;

/** The report, or what stands in for it: loading, error, no opening, before the cutoff. */
function reportState(
  query: ReportQuery,
  range: ReportRange,
): { data: Report } | { node: React.ReactNode } {
  if (range.from > range.to)
    return { node: <StatePanel tone="error" title={t("validation.period.endBeforeStart")} /> };
  if (query.isPending) return { node: <TableSkeleton rows={8} columns={7} title /> };
  if (query.isError) {
    return { node: <QueryError error={query.error} onRetry={() => void query.refetch()} /> };
  }
  const data = query.data;
  if (!data.cutoffDate) {
    return {
      node: (
        <StatePanel
          tone="warning"
          title={t("daily.noOpening.title")}
          hint={t("daily.noOpening.hint")}
        />
      ),
    };
  }
  if (data.tables.length === 0) {
    return {
      node: (
        <StatePanel
          tone="warning"
          title={t("daily.beforeCutoff.title")}
          hint={`${t("daily.beforeCutoff.hint")} ${formatBusinessDate(data.cutoffDate)}`}
        />
      ),
    };
  }
  return { data };
}

function ReportNotes({ data, range }: { data: Report; range: ReportRange }) {
  return (
    <>
      {data.from !== range.from || data.to !== range.to ? (
        <p className="text-xs text-text-muted">
          {t("report.coversFrom")} {formatBusinessDate(data.from)} – {formatBusinessDate(data.to)}
        </p>
      ) : null}
      <PageWarnings warnings={data.warnings} />
    </>
  );
}

const findTable = (data: Report | undefined, title: string) =>
  data?.tables.find((x) => x.title === tableTitle(title));

function withoutColumns(table: ReportTable, hideColumns: readonly string[]): ReportTable {
  if (hideColumns.length === 0) return table;
  const drop = new Set(hideColumns);
  const columns = table.columns.filter((c) => !drop.has(c.key) && !drop.has(c.label));
  if (columns.length === table.columns.length) return table;
  const keys = new Set(columns.map((c) => c.key));
  return {
    ...table,
    columns,
    rows: table.rows.map((row) => ({
      ...row,
      cells: Object.fromEntries(Object.entries(row.cells).filter(([k]) => keys.has(k))),
    })),
    totals: table.totals
      ? Object.fromEntries(Object.entries(table.totals).filter(([k]) => keys.has(k)))
      : null,
  };
}

/** One report over a range: its tables, or why there is none (no opening, before the cutoff). */
export function ReportBody({
  companyId,
  report,
  range,
  hide = [],
  hideColumns = [],
  rowActions = {},
}: {
  companyId: string;
  report: ReportId;
  range: ReportRange;
  /** Table names (e.g. `companyPayable`) another report on the same screen already shows. */
  hide?: readonly string[];
  /** Column keys or labels to drop (D112 DSR staff balances). */
  hideColumns?: readonly string[];
  /** A row menu per table name (e.g. `staffBalances`). */
  rowActions?: Readonly<Record<string, RowAction>>;
}) {
  const state = reportState(useReport(companyId, report, range), range);
  if ("node" in state) return state.node;
  const data = state.data;
  const personTotals = findTable(data, "personTotals");
  const personProducts = findTable(data, "personProducts");
  const dsrCash = findTable(data, "dsrDaily");
  const dsrProducts = findTable(data, "dsrDailyProducts");
  const grouped = new Set<ReportTable | undefined>(
    [
      ...(personTotals && personProducts ? [personTotals, personProducts] : []),
      ...(dsrCash && dsrProducts ? [dsrCash, dsrProducts] : []),
      ...hide.map((title) => findTable(data, title)),
    ].filter(Boolean),
  );
  return (
    <div className="flex flex-col gap-6">
      <ReportNotes data={data} range={range} />
      {dsrCash && dsrProducts ? <DsrDays cash={dsrCash} products={dsrProducts} /> : null}
      {personTotals && personProducts ? (
        <PersonSales totals={personTotals} products={personProducts} />
      ) : null}
      {data.tables
        .filter((table) => !grouped.has(table))
        .map((table) => (
          <ReportTableView
            key={table.title}
            table={withoutColumns(table, hideColumns)}
            rowAction={rowActions[table.title.replace(/^report\.table\./, "")]}
          />
        ))}
    </div>
  );
}

/** Sales by product with the profit columns joined on, one row per product. */
function salesWithProfit(sales: ReportTable, profit: ReportTable | undefined): ReportTable {
  if (!profit) return sales;
  const extra = profit.columns.filter((c) => !sales.columns.some((s) => s.key === c.key));
  const byProduct = new Map(profit.rows.map((r) => [r.cells.product ?? "", r.cells]));
  return {
    title: tableTitle("salesProfitByProduct"),
    columns: [...sales.columns, ...extra],
    rows: sales.rows.map((row) => {
      const cells = byProduct.get(row.cells.product ?? "");
      return {
        ...row,
        cells: {
          ...row.cells,
          ...Object.fromEntries(extra.map((c) => [c.key, cells?.[c.key] ?? null])),
        },
      };
    }),
    totals: sales.totals || profit.totals ? { ...profit.totals, ...sales.totals } : null,
  };
}

/**
 * The sales and profit reports as one product table (sales, commission, cost, profit side by
 * side), then the profit statement, then sales by day when the range has more than one day.
 */
export function SalesProfitBody({
  companyId,
  range,
  withProfit,
  productOnly = false,
}: {
  companyId: string;
  range: ReportRange;
  withProfit: boolean;
  /** Only the sales and profit by product table (D60 dashboard): no profit statement or by day. */
  productOnly?: boolean;
}) {
  const salesQuery = useReport(companyId, "sales", range);
  const profitQuery = useReport(companyId, "profit", range, withProfit);
  const sales = reportState(salesQuery, range);
  if ("node" in sales) return sales.node;
  const profit = withProfit ? reportState(profitQuery, range) : undefined;
  if (profit && "node" in profit) return profit.node;
  const byProduct = findTable(sales.data, "salesByProduct");
  const byDay = findTable(sales.data, "salesByDay");
  const statement = findTable(profit?.data, "profitSummary");
  return (
    <div className="flex flex-col gap-6">
      <ReportNotes data={sales.data} range={range} />
      {byProduct ? (
        <ReportTableView
          table={salesWithProfit(byProduct, findTable(profit?.data, "profitByProduct"))}
        />
      ) : null}
      {statement && !productOnly ? <ReportTableView table={statement} /> : null}
      {byDay && byDay.rows.length > 1 && !productOnly ? (
        <ReportTableView table={byDay} summary={false} />
      ) : null}
    </div>
  );
}
