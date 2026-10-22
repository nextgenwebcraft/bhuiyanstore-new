"use client";

import type { BatchRow, DayProductRow, DayView } from "@bsd/contracts";
import { sumAmounts, toDecimal } from "@bsd/domain";
import { formatBusinessDate, formatRate, t, type TranslationKey } from "@bsd/i18n";
import { Fragment, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { StatePanel } from "@/components/state-panel";
import { TableSummary, type SummaryItem } from "@/components/table-summary";
import { NavGate } from "@/features/shell/nav-gate";
import { PrintButton, PrintHeader } from "@/features/shell/print";
import { PageWarnings } from "@/features/shell/notifications";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { batchName, DateBar, DateHeading, DayGate, isFreeAuto, useWorkingDate } from "./daily-kit";
import {
  columnVisible,
  type ColumnNeeds,
  CartonQty,
  ColumnHead,
  money,
  quantity,
  stickyCell,
  stickyHead,
  tableClass,
  tdClass,
  tdNum,
  thClass,
  theadClass,
} from "@/components/data-table";
import { TableScroller } from "@/components/table-scroller";

type Column = {
  key: TranslationKey;
  cell: (row: DayProductRow) => React.ReactNode;
  /** A quantity shown as cartons/pieces; its header says so. */
  quantity?: true;
  /** Hidden when the actor can't see cost (or profit). */
  needs?: ColumnNeeds;
  /** A money field whose day total is shown above the table. */
  total?: keyof DayProductRow;
};

const qty = (key: TranslationKey, field: keyof DayProductRow): Column => ({
  key,
  quantity: true,
  cell: (row) => <CartonQty pieces={row[field] as string} piecesPerCarton={row.piecesPerCarton} />,
});
const amount = (field: keyof DayProductRow) => (row: DayProductRow) =>
  money(row[field] as string | null);
const rate = (field: keyof DayProductRow) => (row: DayProductRow) => {
  const value = row[field] as string | null;
  return value === null ? "—" : formatRate(value);
};

function visible(columns: Column[], view: DayView) {
  return columns.filter((c) => columnVisible(c.needs, view));
}

/** Batches worth showing: the newest batch may be empty (D49). */
export const visibleBatches = (row: DayProductRow): BatchRow[] =>
  row.batches.filter((b) => !toDecimal(b.quantity).isZero());

/** A batch's figure under a product column; columns without one stay blank. */
const BATCH_CELLS: Partial<
  Record<TranslationKey, (b: BatchRow, row: DayProductRow) => React.ReactNode>
> = {
  "day.column.stock": (b, row) => (
    <CartonQty pieces={b.quantity} piecesPerCarton={row.piecesPerCarton} />
  ),
  "day.column.costPrice": (b) => (b.costPrice === null ? "—" : formatRate(b.costPrice)),
  "day.column.salePrice": (b) => formatRate(b.salePrice),
  "day.column.stockValue": (b) => money(b.value),
};

function BatchRows({ row, shown }: { row: DayProductRow; shown: Column[] }) {
  return visibleBatches(row).map((b) => (
    <tr key={`${row.productId}-${b.key}`} className="border-t border-border/50 text-text-muted">
      <th scope="row" className={`${tdClass} ${stickyCell} pl-6 text-left text-xs font-normal`}>
        <span className="font-medium">{batchName(b)}</span>
        {isFreeAuto(b.key, b.costPrice) ? (
          <span className="ml-1 rounded bg-success/10 px-1 text-success">{t("batch.free")}</span>
        ) : null}
        <div>
          {b.startDate === "opening" ? t("batch.openingStart") : formatBusinessDate(b.startDate)}
        </div>
      </th>
      {shown.map((c) => (
        <td key={c.key} className={`${tdNum} text-xs whitespace-nowrap`}>
          {BATCH_CELLS[c.key]?.(b, row) ?? null}
        </td>
      ))}
    </tr>
  ));
}

function ProductTable({
  view,
  columns,
  batches = false,
}: {
  view: DayView;
  columns: Column[];
  batches?: boolean;
}) {
  const shown = visible(columns, view);
  if (view.products.length === 0) return <StatePanel title={t("product.empty")} />;
  const summary: SummaryItem[] = [
    { label: t("table.summary.products"), value: quantity(String(view.products.length)) },
    ...shown.flatMap((c) => {
      const field = c.total;
      if (!field) return [];
      const values = view.products.map((p) => p[field] as string | null);
      if (values.some((v) => v === null)) return [];
      return [{ label: t(c.key), value: money(sumAmounts(values as string[])) }];
    }),
  ];
  return (
    <>
      <TableSummary label={t("table.summary")} items={summary} />
      <ProductGrid view={view} shown={shown} batches={batches} />
    </>
  );
}

function ProductGrid({
  view,
  shown,
  batches,
}: {
  view: DayView;
  shown: Column[];
  batches: boolean;
}) {
  return (
    <TableScroller>
      <table className={tableClass}>
        <thead className={theadClass}>
          <tr>
            <th scope="col" className={`${thClass} ${stickyHead}`}>
              {t("godown.column.product")}
            </th>
            {shown.map((c) => (
              <ColumnHead key={c.key} label={t(c.key)} quantity={c.quantity} />
            ))}
          </tr>
        </thead>
        <tbody>
          {view.products.map((row) => (
            <Fragment key={row.productId}>
              <tr className="border-t border-border">
                <th scope="row" className={`${tdClass} ${stickyCell} text-left font-medium`}>
                  {row.productName}
                  <div className="text-xs font-normal text-text-muted">{row.sku}</div>
                </th>
                {shown.map((c) => (
                  <td key={c.key} className={`${tdNum} whitespace-nowrap`}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
              {batches ? <BatchRows row={row} shown={shown} /> : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}

function DayPage({
  path,
  title,
  description,
  children,
}: {
  path: string;
  title: TranslationKey;
  description: TranslationKey;
  children: (view: DayView) => React.ReactNode;
}) {
  const { company } = useCurrentWorkspace();
  const [date, setDate] = useWorkingDate();
  return (
    <NavGate path={path}>
      <PageHeader
        title={t(title)}
        description={t(description)}
        actions={
          <>
            <DateBar date={date} onChange={setDate} />
            <PrintButton />
          </>
        }
      />
      <PrintHeader title={t(title)} from={date} />
      <DateHeading date={date} />
      <DayGate companyId={company.id} date={date}>
        {children}
      </DayGate>
    </NavGate>
  );
}

const STOCK_COLUMNS: Column[] = [
  qty("day.column.stock", "stock"),
  qty("day.column.dueFromCompany", "dueFromCompany"),
  qty("day.column.damagedStock", "damagedStock"),
  qty("day.column.damageAtCompany", "damageAtCompany"),
  { key: "day.column.costPrice", cell: rate("costPrice"), needs: "cost" },
  { key: "day.column.salePrice", cell: rate("salePrice") },
  { key: "day.column.stockValue", cell: amount("stockValue"), needs: "cost", total: "stockValue" },
];

const UNDELIVERED_COLUMNS: Column[] = [
  qty("day.column.dueFromCompany", "dueFromCompany"),
  {
    key: "undelivered.column.value",
    cell: amount("dueFromCompanyValue"),
    needs: "cost",
    total: "dueFromCompanyValue",
  },
];

/** Goods ordered from the company and not yet received at the end of the date (D64). */
export function UndeliveredPage() {
  return (
    <DayPage
      path="inventory/undelivered"
      title="nav.inventory.undelivered"
      description="undelivered.description"
    >
      {(view) => {
        const due = view.products.filter((p) => !toDecimal(p.dueFromCompany).isZero());
        return due.length === 0 ? (
          <StatePanel title={t("undelivered.empty")} />
        ) : (
          <ProductTable view={{ ...view, products: due }} columns={UNDELIVERED_COLUMNS} />
        );
      }}
    </DayPage>
  );
}

export function StockPage() {
  const [batches, setBatches] = useState(true);
  return (
    <DayPage path="inventory/stock" title="nav.inventory.stock" description="stock.description">
      {(view) => (
        <div className="flex flex-col gap-4">
          <PageWarnings warnings={view.warnings} />
          <label className="flex items-center gap-2 text-sm print:hidden">
            <input
              type="checkbox"
              checked={batches}
              onChange={(e) => setBatches(e.target.checked)}
            />
            {t("stock.batches.toggle")}
          </label>
          <ProductTable view={view} columns={STOCK_COLUMNS} batches={batches} />
        </div>
      )}
    </DayPage>
  );
}
