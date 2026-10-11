"use client";

import type { DayProductRow, DayView } from "@bsd/contracts";
import { sumAmounts } from "@bsd/domain";
import { formatRate, t, type TranslationKey } from "@bsd/i18n";
import { PageHeader } from "@/components/page-header";
import { StatePanel } from "@/components/state-panel";
import { TableSummary, type SummaryItem } from "@/components/table-summary";
import { NavGate } from "@/features/shell/nav-gate";
import { PrintButton, PrintHeader } from "@/features/shell/print";
import { PageWarnings } from "@/features/shell/notifications";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { DateBar, DateHeading, DayGate, useWorkingDate } from "./daily-kit";
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

function ProductTable({ view, columns }: { view: DayView; columns: Column[] }) {
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
      <ProductGrid view={view} shown={shown} />
    </>
  );
}

function ProductGrid({ view, shown }: { view: DayView; shown: Column[] }) {
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
            <tr key={row.productId} className="border-t border-border">
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
  { key: "day.column.costPrice", cell: rate("costPrice"), needs: "cost" },
  { key: "day.column.salePrice", cell: rate("salePrice") },
  { key: "day.column.stockValue", cell: amount("stockValue"), needs: "cost", total: "stockValue" },
];

export function StockPage() {
  return (
    <DayPage path="inventory/stock" title="nav.inventory.stock" description="stock.description">
      {(view) => (
        <div className="flex flex-col gap-4">
          <PageWarnings warnings={view.warnings} />
          <ProductTable view={view} columns={STOCK_COLUMNS} />
        </div>
      )}
    </DayPage>
  );
}
