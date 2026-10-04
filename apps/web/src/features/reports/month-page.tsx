"use client";

import type { MonthView, ReportColumnKind, ReportTable } from "@bsd/contracts";
import { businessDateOf } from "@bsd/domain";
import { formatBusinessDate, labelOf, t, type TranslationKey } from "@bsd/i18n";
import { useState } from "react";
import { Button } from "@/components/button";
import { MonthPicker } from "@/components/date-picker";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { SummarySkeleton } from "@/components/skeleton";
import { StatTile } from "@/components/stat-tile";
import { StatePanel } from "@/components/state-panel";
import { describeError } from "@/data/ports/service-error";
import { useMonthCommand, useMonthView } from "@/data/queries";
import { Warnings } from "@/features/daily/day-report-page";
import { money } from "@/features/daily/daily-kit";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { ReportTableView } from "./report-page";

type Col = { key: string; kind: ReportColumnKind; needs?: "cost" | "profit" };

/** Shapes month-view rows for display; every value is already an engine figure. */
function display(
  title: string,
  columns: Col[],
  rows: { piecesPerCarton?: string; cells: Record<string, string | null> }[],
  totals: Record<string, string | null> | null,
  view: MonthView,
): ReportTable {
  const shown = columns.filter(
    (c) => !c.needs || (c.needs === "cost" ? view.canSeeCost : view.canSeeProfit),
  );
  return {
    title: `report.table.${title}`,
    columns: shown.map((c) => ({ key: c.key, label: `report.column.${c.key}`, kind: c.kind })),
    rows,
    totals,
  };
}

function productTable(view: MonthView): ReportTable {
  return display(
    "monthProducts",
    [
      { key: "product", kind: "text" },
      { key: "ordered", kind: "quantity" },
      { key: "received", kind: "quantity" },
      { key: "delivered", kind: "quantity" },
      { key: "damaged", kind: "quantity" },
      { key: "sold", kind: "quantity" },
      { key: "salesCartons", kind: "cartons" },
      { key: "salesTotal", kind: "money" },
      { key: "costTotal", kind: "money", needs: "cost" },
      { key: "profitTotal", kind: "money", needs: "profit" },
      { key: "closingStock", kind: "quantity" },
      { key: "closingValue", kind: "money", needs: "cost" },
      { key: "dueFromCompany", kind: "quantity" },
    ],
    view.products.map((p) => ({
      piecesPerCarton: p.piecesPerCarton,
      cells: { ...p, product: p.productName },
    })),
    {
      salesTotal: view.totals.salesTotal,
      costTotal: view.totals.costTotal,
      profitTotal: view.totals.profitTotal,
      closingValue: view.totals.closingValue,
    },
    view,
  );
}

const DAY_KEYS = [
  "sales",
  "marketDueNew",
  "marketDueCollected",
  "srIncentive",
  "expenses",
  "cashIn",
  "cashOut",
  "cashLeft",
  "banked",
] as const;

function dayTable(view: MonthView): ReportTable {
  return display(
    "dailyCash",
    [{ key: "date", kind: "text" }, ...DAY_KEYS.map((key) => ({ key, kind: "money" as const }))],
    view.days.map((d) => ({ cells: { ...d } })),
    { sales: view.totals.salesTotal, cashLeft: view.cashLeftTotal },
    view,
  );
}

function marketDueTable(view: MonthView): ReportTable {
  const m = view.marketDue;
  return display(
    "marketDue",
    [
      { key: "staff", kind: "text" },
      { key: "opening", kind: "money" },
      { key: "added", kind: "money" },
      { key: "collected", kind: "money" },
      { key: "closing", kind: "money" },
    ],
    m.byDsr.map((d) => ({ cells: { ...d, staff: d.staffName } })),
    { opening: m.opening, added: m.added, collected: m.collected, closing: m.closing },
    view,
  );
}

const BALANCE_KEYS = [
  "advance",
  "loan",
  "shortage",
  "credit",
  "salaryPayable",
  "srLoan",
  "owedToSr",
] as const;

function staffTable(view: MonthView): ReportTable {
  return display(
    "staffBalances",
    [
      { key: "staff", kind: "text" },
      ...BALANCE_KEYS.map((key) => ({ key, kind: "money" as const })),
      { key: "owesUs", kind: "money" },
      { key: "weOwe", kind: "money" },
    ],
    view.staff.map((s) => ({
      cells: { staff: s.staffName, ...s.closing, owesUs: s.owesUs, weOwe: s.weOwe },
    })),
    null,
    view,
  );
}

function lineTable(title: string, lines: [string, string][], view: MonthView): ReportTable {
  return display(
    title,
    [
      { key: "line", kind: "label" },
      { key: "amount", kind: "money" },
    ],
    lines.map(([line, amount]) => ({ cells: { line, amount } })),
    null,
    view,
  );
}

function profitTable(view: MonthView): ReportTable | null {
  const p = view.profit;
  if (!p) return null;
  return lineTable(
    "profitSummary",
    [
      ["report.line.gross", p.gross],
      ["report.line.salaries", p.salaries],
      ...p.expensesByCategory.map((e): [string, string] => [e.name, e.amount]),
      ["report.line.expenses", p.expenses],
      ["report.line.srIncentive", p.srIncentive],
      ["report.line.net", p.net],
      ["report.line.netWithoutIncentive", p.netWithoutIncentive],
    ],
    view,
  );
}

function payableTable(view: MonthView): ReportTable {
  const c = view.companyPayable;
  return lineTable(
    "companyPayable",
    [
      ["report.line.payableOpening", c.opening],
      ["report.line.payableReceipts", c.receipts],
      ["report.line.payableDeposits", c.deposits],
      ["report.line.payableClosing", c.closing],
    ],
    view,
  );
}

function StatusBadge({ status }: { status: MonthView["status"] }) {
  const tone =
    status === "closed"
      ? "border-success/30 bg-success/10 text-success"
      : status === "open"
        ? "border-brand/30 bg-brand/10 text-brand"
        : "border-border bg-surface-muted text-text-muted";
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${tone}`}>
      {t(`month.status.${status}` as TranslationKey)}
    </span>
  );
}

function MonthBody({ view }: { view: MonthView }) {
  if (view.status === "noOpening") {
    return (
      <StatePanel
        tone="warning"
        title={t("daily.noOpening.title")}
        hint={t("daily.noOpening.hint")}
      />
    );
  }
  if (view.status === "beforeOpening" || view.status === "future") {
    return view.cutoffDate ? (
      <StatePanel
        title={t(`month.status.${view.status}`)}
        hint={`${t("daily.beforeCutoff.hint")} ${formatBusinessDate(view.cutoffDate)}`}
      />
    ) : (
      <StatePanel title={t(`month.status.${view.status}`)} />
    );
  }
  const profit = profitTable(view);
  return (
    <div className="flex flex-col gap-6">
      {view.from && view.to ? (
        <p className="text-xs text-text-muted">
          {t("report.coversFrom")} {formatBusinessDate(view.from)} – {formatBusinessDate(view.to)}
        </p>
      ) : null}
      <Warnings warnings={view.warnings} />
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile
          label={t("report.column.salesTotal")}
          value={money(view.totals.salesTotal)}
          emphasis
        />
        {view.profit ? (
          <StatTile label={t("report.line.net")} value={money(view.profit.net)} emphasis />
        ) : null}
        <StatTile label={t("report.column.cashLeft")} value={money(view.cashLeftTotal)} />
        <StatTile label={t("month.tile.marketDue")} value={money(view.marketDue.closing)} />
        <StatTile
          label={t("report.line.payableClosing")}
          value={money(view.companyPayable.closing)}
        />
        {view.canSeeCost ? (
          <StatTile
            label={t("report.column.closingValue")}
            value={money(view.totals.closingValue)}
          />
        ) : null}
      </dl>
      <ReportTableView table={productTable(view)} />
      {profit ? <ReportTableView table={profit} /> : null}
      <ReportTableView table={payableTable(view)} />
      <ReportTableView table={marketDueTable(view)} />
      {view.staff.length > 0 ? <ReportTableView table={staffTable(view)} /> : null}
      <ReportTableView table={dayTable(view)} />
    </div>
  );
}

export function MonthPage({ path, title }: { path: string; title: TranslationKey }) {
  const { company } = useCurrentWorkspace();
  const [month, setMonth] = useState(() => businessDateOf(new Date()).slice(0, 7));
  const query = useMonthView(company.id, month);
  const command = useMonthCommand(company.id);
  const [error, setError] = useState<string | undefined>();
  const view = query.data;

  async function run(action: "close" | "reopen") {
    setError(undefined);
    if (!window.confirm(t(action === "close" ? "month.closeConfirm" : "month.reopenConfirm")))
      return;
    try {
      await command.mutateAsync({ action, month });
    } catch (e) {
      setError(describeError(e, []).form);
    }
  }

  return (
    <NavGate path={path}>
      <PageHeader
        title={t(title)}
        description={t("month.description")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <MonthPicker
              id="month-picker"
              value={month}
              label={t("month.picker")}
              onChange={setMonth}
            />
            {view ? <StatusBadge status={view.status} /> : null}
            {view?.canClose ? (
              <Button
                variant="primary"
                disabled={command.isPending || view.closeBlockedBy !== null}
                onClick={() => void run("close")}
              >
                {t("month.close")}
              </Button>
            ) : null}
            {view?.canReopen ? (
              <Button disabled={command.isPending} onClick={() => void run("reopen")}>
                {t("month.reopen")}
              </Button>
            ) : null}
          </div>
        }
      />
      <div className="flex flex-col gap-4">
        {view?.status === "closed" && view.closedAt ? (
          <p className="text-sm text-text-muted">
            {t("month.closedBy")} {view.closedByName ?? "—"} ·{" "}
            {formatBusinessDate(businessDateOf(new Date(view.closedAt)))}
          </p>
        ) : null}
        {view?.canClose && view.closeBlockedBy ? (
          <StatePanel
            tone="warning"
            title={t("month.closeBlocked")}
            hint={labelOf(view.closeBlockedBy)}
          />
        ) : null}
        {error ? <StatePanel tone="error" title={error} /> : null}
        {query.isPending ? (
          <SummarySkeleton stats={6} rows={8} />
        ) : query.isError ? (
          <QueryError error={query.error} onRetry={() => void query.refetch()} />
        ) : (
          <MonthBody view={query.data} />
        )}
      </div>
    </NavGate>
  );
}
