"use client";

import type { MonthlySummary } from "@bsd/contracts";
import { monthOf } from "@bsd/domain";
import { formatMoney, formatShortDate, t, toBengaliDigits } from "@bsd/i18n";
import { useState } from "react";
import {
  stickyCell,
  stickyHead,
  tableClass,
  tdClass,
  tdNum,
  thClass,
  thNum,
  theadClass,
} from "@/components/data-table";
import { MonthPicker } from "@/components/date-picker";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { SummarySkeleton, TableSkeleton } from "@/components/skeleton";
import { StatTile } from "@/components/stat-tile";
import { StatePanel } from "@/components/state-panel";
import { TableScroller } from "@/components/table-scroller";
import { useMonthlySummary } from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
import { PrintButton, PrintHeader } from "@/features/shell/print";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { useToday } from "@/lib/today";

const negative = (value: string) => value.trim().startsWith("-");

/**
 * D148 History → মাসিক সারসংক্ষেপ: one month's order, receive, sale and commission, then the
 * khoroch (operating and each staff role, salary included) and the net profit after them. Every
 * figure comes from the server.
 */
export function MonthlySummaryPage() {
  const { company } = useCurrentWorkspace();
  const today = useToday();
  const current = monthOf(today);
  const [month, setMonth] = useState(current);
  const query = useMonthlySummary(company.id, month);

  return (
    <NavGate path="history/monthly-summary">
      <PageHeader
        title={t("nav.history.monthlySummary")}
        description={t("monthlySummary.description")}
        actions={
          <div className="flex items-center gap-2 print:hidden">
            <MonthPicker
              id="monthly-summary-month"
              value={month}
              max={current}
              label={t("month.picker")}
              onChange={setMonth}
            />
            <PrintButton />
          </div>
        }
      />
      <PrintHeader
        title={t("nav.history.monthlySummary")}
        from={query.data?.from ?? `${month}-01`}
        to={query.data?.to ?? `${month}-01`}
      />
      {query.isPending ? (
        <div className="flex flex-col gap-6">
          <SummarySkeleton />
          <TableSkeleton rows={6} columns={4} />
        </div>
      ) : query.isError ? (
        <QueryError error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <SummaryBody d={query.data} />
      )}
    </NavGate>
  );
}

function SummaryBody({ d }: { d: MonthlySummary }) {
  if (!d.cutoffDate || d.to < d.cutoffDate) {
    return <StatePanel tone="warning" title={t("monthlySummary.beforeCutoff")} />;
  }
  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm text-text-muted">
        {`${formatShortDate(d.from < d.cutoffDate ? d.cutoffDate : d.from)} – ${formatShortDate(d.to)}`}
      </p>
      {d.salaryPendingCount > 0 ? (
        <StatePanel
          compact
          tone="warning"
          title={t("monthlySummary.salaryPending").replace(
            "{count}",
            toBengaliDigits(String(d.salaryPendingCount)),
          )}
          hint={t("monthlySummary.salaryPendingHint")}
        />
      ) : null}

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={t("monthlySummary.totalOrder")} value={formatMoney(d.totalOrder)} />
        <StatTile label={t("monthlySummary.totalReceive")} value={formatMoney(d.totalReceive)} />
        <StatTile
          tone="brand"
          label={t("monthlySummary.totalSales")}
          value={formatMoney(d.totalSales)}
        />
        <StatTile label={t("monthlySummary.commission")} value={formatMoney(d.commission)} />
      </dl>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{t("monthlySummary.khoroch")}</h2>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            label={t("monthlySummary.operatingCost")}
            value={formatMoney(d.operatingCost)}
          />
          {d.roles.map((role) => (
            <StatTile
              key={role.roleId || "none"}
              label={t("monthlySummary.roleKhoroch").replace(
                "{role}",
                role.roleName || t("monthlySummary.noRole"),
              )}
              value={formatMoney(role.total)}
              hint={`${t("monthlySummary.col.salary")} ${formatMoney(role.salary)} · ${t("monthlySummary.col.expenses")} ${formatMoney(role.expenses)}`}
            />
          ))}
          <StatTile
            large
            tone={negative(d.netProfit) ? "error" : "success"}
            label={t("monthlySummary.netProfit")}
            value={formatMoney(d.netProfit)}
          />
        </dl>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">{t("monthlySummary.howTitle")}</h2>
          <p className="mt-1 text-sm text-text-muted">{t("monthlySummary.howHint")}</p>
        </div>
        <ProfitStatement d={d} />
        <p className="text-xs text-text-subtle">
          {`${t("monthlySummary.dashboardNet")}: ${formatMoney(d.dashboardNetProfit)} — ${t("monthlySummary.dashboardNetHint")}`}
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{t("monthlySummary.staffTitle")}</h2>
        <StaffTable d={d} />
      </section>
    </div>
  );
}

/** বিক্রয় লাভ − each khoroch = নিট লাভ, line by line. */
function ProfitStatement({ d }: { d: MonthlySummary }) {
  const lines: { key: string; label: string; value: string; sign: "" | "−" }[] = [
    { key: "profit", label: t("monthlySummary.salesProfit"), value: d.salesProfit, sign: "" },
    {
      key: "operating",
      label: t("monthlySummary.operatingCost"),
      value: d.operatingCost,
      sign: "−",
    },
    ...d.roles.map((role) => ({
      key: role.roleId || "none",
      label: t("monthlySummary.roleKhoroch").replace(
        "{role}",
        role.roleName || t("monthlySummary.noRole"),
      ),
      value: role.total,
      sign: "−" as const,
    })),
  ];
  return (
    <TableScroller>
      <table className={`${tableClass} max-w-xl`}>
        <tbody>
          {lines.map((line) => (
            <tr key={line.key} className="border-t border-border first:border-t-0">
              <th scope="row" className={`${thClass} text-left font-medium`}>
                {line.sign ? `${line.sign} ${line.label}` : line.label}
              </th>
              <td className={tdNum}>{formatMoney(line.value)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-border-strong">
            <th scope="row" className={`${thClass} text-left font-semibold`}>
              {`= ${t("monthlySummary.netProfit")}`}
            </th>
            <td
              className={`${tdNum} font-semibold ${negative(d.netProfit) ? "text-error" : "text-success"}`}
            >
              {formatMoney(d.netProfit)}
            </td>
          </tr>
        </tbody>
      </table>
    </TableScroller>
  );
}

function StaffTable({ d }: { d: MonthlySummary }) {
  const rows = d.roles.flatMap((role) =>
    role.staff.map((s) => ({ ...s, roleName: role.roleName || t("monthlySummary.noRole") })),
  );
  if (rows.length === 0) return <StatePanel compact title={t("monthlySummary.staffEmpty")} />;
  return (
    <TableScroller>
      <table className={tableClass}>
        <thead className={theadClass}>
          <tr>
            <th scope="col" className={`${thClass} ${stickyHead}`}>
              {t("monthlySummary.col.staff")}
            </th>
            <th scope="col" className={thClass}>
              {t("monthlySummary.col.role")}
            </th>
            <th scope="col" className={thNum}>
              {t("monthlySummary.col.salary")}
            </th>
            <th scope="col" className={thNum}>
              {t("monthlySummary.col.expenses")}
            </th>
            <th scope="col" className={thNum}>
              {t("monthlySummary.col.total")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.staffId} className="border-t border-border">
              <th
                scope="row"
                className={`${thClass} ${stickyCell} text-left font-medium whitespace-nowrap`}
              >
                {row.staffName}
              </th>
              <td className={`${tdClass} text-text-muted`}>{row.roleName}</td>
              <td className={tdNum}>{formatMoney(row.salary)}</td>
              <td className={tdNum}>{formatMoney(row.expenses)}</td>
              <td className={`${tdNum} font-semibold`}>{formatMoney(row.total)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-border-strong">
            <th scope="row" className={`${thClass} ${stickyCell} text-left font-semibold`}>
              {t("common.total")}
            </th>
            <td className={tdClass} />
            <td className={tdNum} />
            <td className={tdNum} />
            <td className={`${tdNum} font-semibold`}>{formatMoney(d.staffTotal)}</td>
          </tr>
        </tbody>
      </table>
    </TableScroller>
  );
}
