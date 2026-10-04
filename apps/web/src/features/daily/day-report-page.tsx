"use client";

import type { DayProductRow, DayView, EngineWarningDto } from "@bsd/contracts";
import { formatAmount, formatRate, formatShortDate, t, type TranslationKey } from "@bsd/i18n";
import { PageHeader } from "@/components/page-header";
import { StatePanel } from "@/components/state-panel";
import { useProducts, useStaff } from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
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
import { groupWarnings } from "./warning-groups";

type Column = {
  key: TranslationKey;
  cell: (row: DayProductRow) => React.ReactNode;
  /** A quantity shown as cartons/pieces; its header says so. */
  quantity?: true;
  /** Hidden when the actor can't see cost (or profit). */
  needs?: "cost" | "profit";
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
  { key: "day.column.sales", cell: amount("sales") },
  { key: "day.column.costPrice", cell: rate("costPrice"), needs: "cost" },
  { key: "day.column.cost", cell: amount("cost"), needs: "cost" },
  { key: "day.column.grossProfit", cell: amount("grossProfit"), needs: "profit" },
  { key: "day.column.receiptBill", cell: amount("receiptBill") },
  qty("day.column.dueFromCompany", "dueFromCompany"),
  qty("day.column.stock", "stock"),
  { key: "day.column.stockValue", cell: amount("stockValue"), needs: "cost" },
];

function visible(columns: Column[], view: DayView) {
  return columns.filter(
    (c) => !c.needs || (c.needs === "cost" ? view.canSeeCost : view.canSeeProfit),
  );
}

function ProductTable({ view, columns }: { view: DayView; columns: Column[] }) {
  const shown = visible(columns, view);
  if (view.products.length === 0) return <StatePanel title={t("product.empty")} />;
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

const NAMES_SHOWN = 8;

/** Product or people names, the first few in full and the rest as a count. */
function nameList(ids: string[], names: Map<string, string>, unit: TranslationKey): string {
  const known = ids.map((id) => names.get(id)).filter((n): n is string => Boolean(n));
  if (known.length === 0) return `${formatAmount(String(ids.length))} ${t(unit)}`;
  const shown = known.slice(0, NAMES_SHOWN).join(", ");
  const rest = ids.length - Math.min(known.length, NAMES_SHOWN);
  return rest > 0 ? `${shown} ${t("warning.andMore")} ${formatAmount(String(rest))}` : shown;
}

/** The engine's warnings, one line per kind with the days and the products or people affected. */
export function Warnings({ warnings }: { warnings: readonly EngineWarningDto[] }) {
  const { company } = useCurrentWorkspace();
  const products = useProducts(company.id);
  const staff = useStaff(company.id);
  if (warnings.length === 0) return null;
  const productNames = new Map((products.data ?? []).map((p) => [p.id, p.name]));
  const staffNames = new Map((staff.data ?? []).map((s) => [s.id, s.name]));
  const groups = groupWarnings(warnings);

  return (
    <section
      role="status"
      className="flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning/5 p-5 shadow-card"
    >
      <h2 className="flex items-center gap-2.5 text-base font-semibold">
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-warning" />
        {t("day.warnings")}
      </h2>
      <ul className="flex flex-col gap-2.5 pl-4.5">
        {groups.map((g) => (
          <li key={g.code} className="text-sm">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">{t(`warning.${g.code}` as TranslationKey)}</span>
              <span className="text-xs text-text-muted tabular-nums">
                {formatAmount(String(g.days))} {t("warning.days")}
                {g.days > 1
                  ? ` · ${formatShortDate(g.firstDate)} – ${formatShortDate(g.lastDate)}`
                  : ` · ${formatShortDate(g.firstDate)}`}
              </span>
            </div>
            {g.productIds.length > 0 ? (
              <p className="mt-0.5 text-text-muted">
                {nameList(g.productIds, productNames, "warning.products")}
              </p>
            ) : null}
            {g.staffIds.length > 0 ? (
              <p className="mt-0.5 text-text-muted">
                {nameList(g.staffIds, staffNames, "warning.people")}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
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
          <Warnings warnings={view.warnings} />
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
  { key: "day.column.stockValue", cell: amount("stockValue"), needs: "cost" },
];

export function StockPage() {
  return (
    <DayPage path="inventory/stock" title="nav.inventory.stock" description="stock.description">
      {(view) => (
        <div className="flex flex-col gap-4">
          <Warnings warnings={view.warnings} />
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
                <section key={staffId}>
                  <h2 className="mb-2 text-sm font-semibold">{staffName}</h2>
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
