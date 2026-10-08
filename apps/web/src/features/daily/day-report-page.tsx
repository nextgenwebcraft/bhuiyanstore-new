"use client";

import type { DayProductRow, DayView } from "@bsd/contracts";
import { sumAmounts, sumQuantities } from "@bsd/domain";
import { formatRate, t, type TranslationKey } from "@bsd/i18n";
import { PageHeader } from "@/components/page-header";
import { StatePanel } from "@/components/state-panel";
import { TableSummary, type SummaryItem } from "@/components/table-summary";
import { NavGate } from "@/features/shell/nav-gate";
import { PageWarnings } from "@/features/shell/notifications";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import {
  DateBar,
  DateHeading,
  DayGate,
  CartonQty,
  ColumnHead,
  SectionTitle,
  TableScroller,
  money,
  quantity,
  stickyCell,
  stickyHead,
  tableClass,
  tdClass,
  tdNum,
  thClass,
  thNum,
  theadClass,
  useWorkingDate,
} from "./daily-kit";

type Column = {
  key: TranslationKey;
  cell: (row: DayProductRow) => React.ReactNode;
  /** A quantity shown as cartons/pieces; its header says so. */
  quantity?: true;
  /** Hidden when the actor can't see cost (or profit). */
  needs?: "cost" | "profit";
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

/** The workbook's day block, column by column (PLAN §2.2). */
const DAY_COLUMNS: Column[] = [
  qty("day.column.ordered", "ordered"),
  qty("day.column.received", "received"),
  qty("day.column.issued", "issued"),
  qty("day.column.returned", "returned"),
  qty("day.column.delivered", "delivered"),
  qty("day.column.damaged", "damaged"),
  qty("day.column.sold", "sold"),
  { key: "day.column.salePrice", cell: rate("salePrice") },
  { key: "day.column.sales", cell: amount("sales"), total: "sales" },
  { key: "day.column.costPrice", cell: rate("costPrice"), needs: "cost" },
  { key: "day.column.cost", cell: amount("cost"), needs: "cost", total: "cost" },
  {
    key: "day.column.grossProfit",
    cell: amount("grossProfit"),
    needs: "profit",
    total: "grossProfit",
  },
  { key: "day.column.receiptBill", cell: amount("receiptBill"), total: "receiptBill" },
  qty("day.column.dueFromCompany", "dueFromCompany"),
  qty("day.column.stock", "stock"),
  { key: "day.column.stockValue", cell: amount("stockValue"), needs: "cost", total: "stockValue" },
];

function visible(columns: Column[], view: DayView) {
  return columns.filter(
    (c) => !c.needs || (c.needs === "cost" ? view.canSeeCost : view.canSeeProfit),
  );
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

const MONEY_LINES: { key: TranslationKey; field: keyof DayView["money"] }[] = [
  { key: "day.money.sales", field: "sales" },
  { key: "day.money.marketDueNew", field: "marketDueNew" },
  { key: "day.money.marketDueCollected", field: "marketDueCollected" },
  { key: "day.money.srIncentive", field: "srIncentive" },
  { key: "day.money.expenses", field: "expenses" },
  { key: "day.money.cashIn", field: "cashIn" },
  { key: "day.money.cashOut", field: "cashOut" },
  { key: "day.money.cashLeft", field: "cashLeft" },
  { key: "day.money.banked", field: "banked" },
];

function MoneyBlock({ view }: { view: DayView }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {MONEY_LINES.map((line) => (
        <div key={line.field} className="rounded-lg border border-border bg-surface p-3">
          <dt className="text-xs text-text-muted">{t(line.key)}</dt>
          <dd className="mt-1 font-semibold tabular-nums">{money(view.money[line.field])}</dd>
        </div>
      ))}
      <div className="rounded-lg border border-border bg-surface p-3">
        <dt className="text-xs text-text-muted">{t("money.marketOutstanding")}</dt>
        <dd className="mt-1 font-semibold tabular-nums">{money(view.marketDueOutstanding)}</dd>
      </div>
    </dl>
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
        actions={<DateBar date={date} onChange={setDate} />}
      />
      <DateHeading date={date} />
      <DayGate companyId={company.id} date={date}>
        {children}
      </DayGate>
    </NavGate>
  );
}

export function DayReportPage() {
  return (
    <DayPage path="reports/operations" title="nav.reports.operations" description="day.description">
      {(view) => (
        <div className="flex flex-col gap-4">
          <PageWarnings warnings={view.warnings} />
          <ProductTable view={view} columns={DAY_COLUMNS} />
          <SectionTitle>{t("day.money.title")}</SectionTitle>
          <MoneyBlock view={view} />
        </div>
      )}
    </DayPage>
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

/** Samari (issued) or firot (returned) per DSR, from the engine's person rows. */
export function PersonsPage({ kind }: { kind: "issued" | "returned" }) {
  const path = kind === "issued" ? "sales/samari" : "sales/firot";
  return (
    <DayPage
      path={path}
      title={kind === "issued" ? "sales.samari" : "sales.firot"}
      description={
        kind === "issued" ? "persons.description.issued" : "persons.description.returned"
      }
    >
      {(view) => {
        const products = new Map(view.products.map((p) => [p.productId, p]));
        const staff = [...new Map(view.persons.map((p) => [p.staffId, p.staffName])).entries()];
        const rows = view.persons.filter((p) => p[kind] !== "0");
        if (rows.length === 0) return <StatePanel title={t("persons.empty")} />;
        return (
          <div className="flex flex-col gap-6">
            {staff.map(([staffId, staffName]) => {
              const own = rows.filter((r) => r.staffId === staffId);
              if (own.length === 0) return null;
              return (
                <section key={staffId} className="flex flex-col gap-2">
                  <h2 className="text-sm font-semibold">{staffName}</h2>
                  <TableSummary
                    label={t("table.summary")}
                    items={[
                      { label: t("table.summary.products"), value: quantity(String(own.length)) },
                      {
                        label: `${t(`day.column.${kind}`)} (${t("godown.column.pieces")})`,
                        value: quantity(sumQuantities(own.map((r) => r[kind]))),
                      },
                      {
                        label: `${t("day.column.damaged")} (${t("godown.column.pieces")})`,
                        value: quantity(sumQuantities(own.map((r) => r.damaged))),
                      },
                      {
                        label: t("day.column.sales"),
                        value: money(sumAmounts(own.map((r) => r.amount))),
                        emphasis: true,
                      },
                    ]}
                  />
                  <TableScroller>
                    <table className={tableClass}>
                      <thead className={theadClass}>
                        <tr>
                          <th scope="col" className={`${thClass} ${stickyHead}`}>
                            {t("godown.column.product")}
                          </th>
                          <ColumnHead label={t(`day.column.${kind}`)} quantity />
                          <ColumnHead label={t("day.column.net")} quantity />
                          <ColumnHead label={t("day.column.damaged")} quantity />
                          <th scope="col" className={thNum}>
                            {t("day.column.sales")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {own.map((r) => {
                          const size = products.get(r.productId)?.piecesPerCarton ?? "1";
                          return (
                            <tr key={r.productId} className="border-t border-border">
                              <td className={`${tdClass} ${stickyCell}`}>
                                {products.get(r.productId)?.productName ?? r.productId}
                              </td>
                              <td className={tdNum}>
                                <CartonQty pieces={r[kind]} piecesPerCarton={size} />
                              </td>
                              <td className={tdNum}>
                                <CartonQty pieces={r.net} piecesPerCarton={size} />
                              </td>
                              <td className={tdNum}>
                                <CartonQty pieces={r.damaged} piecesPerCarton={size} />
                              </td>
                              <td className={tdNum}>{money(r.amount)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </TableScroller>
                </section>
              );
            })}
          </div>
        );
      }}
    </DayPage>
  );
}
