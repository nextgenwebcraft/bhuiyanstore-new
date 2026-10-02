"use client";

import type { DayProductRow, DayView } from "@bsd/contracts";
import { formatRate, t, type TranslationKey } from "@bsd/i18n";
import { PageHeader } from "@/components/page-header";
import { StatePanel } from "@/components/state-panel";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import {
  DateBar,
  DateHeading,
  DayGate,
  SectionTitle,
  cartonText,
  money,
  tableClass,
  tableShell,
  tdClass,
  tdNum,
  thClass,
  thNum,
  theadClass,
  useWorkingDate,
} from "./daily-kit";

type Column = {
  key: TranslationKey;
  cell: (row: DayProductRow) => string;
  /** Hidden when the actor can't see cost (or profit). */
  needs?: "cost" | "profit";
};

const qty = (field: keyof DayProductRow) => (row: DayProductRow) =>
  cartonText(row[field] as string, row.piecesPerCarton);
const amount = (field: keyof DayProductRow) => (row: DayProductRow) =>
  money(row[field] as string | null);
const rate = (field: keyof DayProductRow) => (row: DayProductRow) => {
  const value = row[field] as string | null;
  return value === null ? "—" : formatRate(value);
};

/** The workbook's day block, column by column (PLAN §2.2). */
const DAY_COLUMNS: Column[] = [
  { key: "day.column.ordered", cell: qty("ordered") },
  { key: "day.column.received", cell: qty("received") },
  { key: "day.column.issued", cell: qty("issued") },
  { key: "day.column.returned", cell: qty("returned") },
  { key: "day.column.delivered", cell: qty("delivered") },
  { key: "day.column.damaged", cell: qty("damaged") },
  { key: "day.column.sold", cell: qty("sold") },
  { key: "day.column.salePrice", cell: rate("salePrice") },
  { key: "day.column.sales", cell: amount("sales") },
  { key: "day.column.costPrice", cell: rate("costPrice"), needs: "cost" },
  { key: "day.column.cost", cell: amount("cost"), needs: "cost" },
  { key: "day.column.grossProfit", cell: amount("grossProfit"), needs: "profit" },
  { key: "day.column.receiptBill", cell: amount("receiptBill") },
  { key: "day.column.dueFromCompany", cell: qty("dueFromCompany") },
  { key: "day.column.stock", cell: qty("stock") },
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
    <div className={tableShell}>
      <table className={tableClass}>
        <thead className={theadClass}>
          <tr>
            <th scope="col" className={`${thClass} sticky left-0 bg-surface-muted`}>
              {t("godown.column.product")}
            </th>
            {shown.map((c) => (
              <th key={c.key} scope="col" className={`${thNum} whitespace-nowrap`}>
                {t(c.key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.products.map((row) => (
            <tr key={row.productId} className="border-t border-border">
              <th
                scope="row"
                className={`${tdClass} sticky left-0 bg-surface text-left font-medium`}
              >
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
    </div>
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

export function Warnings({
  view,
}: {
  view: {
    warnings: DayView["warnings"];
    products: readonly { productId: string; productName: string }[];
  };
}) {
  if (view.warnings.length === 0) return null;
  const names = new Map(view.products.map((p) => [p.productId, p.productName]));
  return (
    <StatePanel
      tone="warning"
      title={t("day.warnings")}
      hint={view.warnings
        .map((w) => {
          const label = t(`warning.${w.code}` as TranslationKey);
          const product = w.productId ? names.get(w.productId) : undefined;
          return product ? `${label} (${product})` : label;
        })
        .join(" · ")}
    />
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
          <Warnings view={view} />
          <ProductTable view={view} columns={DAY_COLUMNS} />
          <SectionTitle>{t("day.money.title")}</SectionTitle>
          <MoneyBlock view={view} />
        </div>
      )}
    </DayPage>
  );
}

const STOCK_COLUMNS: Column[] = [
  { key: "day.column.stock", cell: qty("stock") },
  { key: "day.column.dueFromCompany", cell: qty("dueFromCompany") },
  { key: "day.column.costPrice", cell: rate("costPrice"), needs: "cost" },
  { key: "day.column.salePrice", cell: rate("salePrice") },
  { key: "day.column.stockValue", cell: amount("stockValue"), needs: "cost" },
];

export function StockPage() {
  return (
    <DayPage path="inventory/stock" title="nav.inventory.stock" description="stock.description">
      {(view) => (
        <div className="flex flex-col gap-4">
          <Warnings view={view} />
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
                  <div className={tableShell}>
                    <table className={tableClass}>
                      <thead className={theadClass}>
                        <tr>
                          <th scope="col" className={thClass}>
                            {t("godown.column.product")}
                          </th>
                          <th scope="col" className={thNum}>
                            {t(`day.column.${kind}`)}
                          </th>
                          <th scope="col" className={thNum}>
                            {t("day.column.net")}
                          </th>
                          <th scope="col" className={thNum}>
                            {t("day.column.damaged")}
                          </th>
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
                              <td className={tdClass}>
                                {products.get(r.productId)?.productName ?? r.productId}
                              </td>
                              <td className={tdNum}>{cartonText(r[kind], size)}</td>
                              <td className={tdNum}>{cartonText(r.net, size)}</td>
                              <td className={tdNum}>{cartonText(r.damaged, size)}</td>
                              <td className={tdNum}>{money(r.amount)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              );
            })}
          </div>
        );
      }}
    </DayPage>
  );
}
