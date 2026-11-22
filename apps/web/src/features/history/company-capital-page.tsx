"use client";

import { formatMoney, formatMonth, formatShortDate, t } from "@bsd/i18n";
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
import { inputClass } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { SummarySkeleton, TableSkeleton } from "@/components/skeleton";
import { StatTile } from "@/components/stat-tile";
import { StatePanel } from "@/components/state-panel";
import { TableScroller } from "@/components/table-scroller";
import { useCompanyCapitalYear } from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { useToday } from "@/lib/today";

const FIRST_YEAR = 2026;

/**
 * D146 History → সারাংশ: how much money is held in this company — আনডেলিভারি পণ্য + মজুদ মাল +
 * বাজারের বাকি — today and at each month end. Every figure comes from the server.
 */
export function CompanyCapitalPage() {
  const { company } = useCurrentWorkspace();
  const today = useToday();
  const currentYear = today.slice(0, 4);
  const years = Array.from(
    { length: Math.max(1, Number(currentYear) - FIRST_YEAR + 1) },
    (_, index) => String(FIRST_YEAR + index),
  ).reverse();
  const [year, setYear] = useState(currentYear);
  const query = useCompanyCapitalYear(company.id, year);

  return (
    <NavGate path="history/summary">
      <PageHeader title={t("nav.history.summary")} description={t("capital.description")} />
      {query.isPending ? (
        <div className="flex flex-col gap-6">
          <SummarySkeleton />
          <TableSkeleton rows={6} columns={5} />
        </div>
      ) : query.isError ? (
        <QueryError error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <div className="flex flex-col gap-8">
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              large
              tone="brand"
              label={t("capital.total")}
              value={formatMoney(query.data.current.total)}
              hint={`${t("capital.asOf")} — ${formatShortDate(query.data.asOf)}`}
            />
            <StatTile
              label={t("capital.undelivered")}
              value={formatMoney(query.data.current.undelivered)}
            />
            <StatTile label={t("capital.stock")} value={formatMoney(query.data.current.stock)} />
            <StatTile
              label={t("capital.marketDue")}
              value={formatMoney(query.data.current.marketDue)}
            />
          </dl>

          <section className="flex flex-col gap-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">{t("capital.monthly")}</h2>
                <p className="mt-1 text-sm text-text-muted">{t("capital.monthlyHint")}</p>
              </div>
              <label className="flex flex-col gap-1 text-sm print:hidden">
                <span className="text-xs font-medium text-text-muted">
                  {t("share.filter.year")}
                </span>
                <select
                  className={`${inputClass} w-28`}
                  value={year}
                  onChange={(event) => setYear(event.target.value)}
                >
                  {years.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {query.data.months.length === 0 ? (
              <StatePanel title={t("capital.empty")} />
            ) : (
              <TableScroller>
                <table className={tableClass}>
                  <thead className={theadClass}>
                    <tr>
                      <th scope="col" className={`${thClass} ${stickyHead}`}>
                        {t("capital.col.month")}
                      </th>
                      <th scope="col" className={thClass}>
                        {t("capital.col.date")}
                      </th>
                      <th scope="col" className={thNum}>
                        {t("capital.undelivered")}
                      </th>
                      <th scope="col" className={thNum}>
                        {t("capital.stock")}
                      </th>
                      <th scope="col" className={thNum}>
                        {t("capital.marketDue")}
                      </th>
                      <th scope="col" className={thNum}>
                        {t("capital.total")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.months.map((row) => (
                      <tr key={row.month} className="border-t border-border">
                        <th
                          scope="row"
                          className={`${thClass} ${stickyCell} text-left font-medium whitespace-nowrap`}
                        >
                          {formatMonth(row.month)}
                        </th>
                        <td className={`${tdClass} whitespace-nowrap text-text-muted`}>
                          {formatShortDate(row.to)}
                        </td>
                        <td className={tdNum}>{formatMoney(row.undelivered)}</td>
                        <td className={tdNum}>{formatMoney(row.stock)}</td>
                        <td className={tdNum}>{formatMoney(row.marketDue)}</td>
                        <td className={`${tdNum} font-semibold`}>{formatMoney(row.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroller>
            )}
          </section>
        </div>
      )}
    </NavGate>
  );
}
