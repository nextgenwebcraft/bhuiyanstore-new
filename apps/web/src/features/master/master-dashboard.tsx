"use client";

import type { MasterHishabYear } from "@bsd/contracts";
import { formatMoney, monthNames, t } from "@bsd/i18n";
import { useState } from "react";
import { inputClass } from "@/components/field";
import {
  stickyCell,
  stickyHead,
  tableClass,
  tdNum,
  thClass,
  thNum,
  theadClass,
} from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { TableSkeleton } from "@/components/skeleton";
import { TableScroller } from "@/components/table-scroller";
import { useMasterHishabYear } from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { useToday } from "@/lib/today";

const months = monthNames();
const YEARS = Array.from({ length: 15 }, (_, index) => String(2026 + index));

function Money({ value }: { value: string }) {
  return <span className={value.startsWith("-") ? "text-error" : ""}>{formatMoney(value)}</span>;
}

/** The master page: every active company's total profit side by side, filterable by shareholder. */
export function MasterDashboardPage() {
  const { company } = useCurrentWorkspace();
  const today = useToday();
  const [year, setYear] = useState(() => {
    const current = today.slice(0, 4);
    return YEARS.includes(current) ? current : (YEARS[0] ?? current);
  });
  const [shareholderId, setShareholderId] = useState("");
  const query = useMasterHishabYear(company.id, year, shareholderId);

  return (
    <NavGate path="">
      <PageHeader title={t("nav.master.dashboard")} description={t("share.year.description")} />
      <div className="mb-4 flex flex-wrap items-end gap-3 print:hidden">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-text-muted">{t("share.filter.year")}</span>
          <select
            className={`${inputClass} w-28`}
            value={year}
            onChange={(event) => setYear(event.target.value)}
          >
            {YEARS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-text-muted">
            {t("share.filter.shareholder")}
          </span>
          <select
            className={`${inputClass} w-48`}
            value={shareholderId}
            onChange={(event) => setShareholderId(event.target.value)}
          >
            <option value="">{t("share.filter.allShareholders")}</option>
            {(query.data?.shareholders ?? []).map((person) => (
              <option key={person.shareholderId} value={person.shareholderId}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {query.isPending ? (
        <TableSkeleton rows={12} columns={7} />
      ) : query.isError ? (
        <QueryError error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <YearGrid view={query.data} />
      )}
    </NavGate>
  );
}

function companyOf(month: MasterHishabYear["months"][number], companyId: string) {
  return month.companies.find((row) => row.companyId === companyId);
}

function YearGrid({ view }: { view: MasterHishabYear }) {
  return (
    <TableScroller>
      <table className={tableClass}>
        <thead className={theadClass}>
          <tr>
            <th scope="col" className={`${thClass} ${stickyHead}`}>
              {t("month.picker")}
            </th>
            {view.companies.map((company) => (
              <th key={company.companyId} scope="col" className={thNum}>
                {company.companyName}
              </th>
            ))}
            <th scope="col" className={thNum}>
              {t("share.total")}
            </th>
            <th scope="col" className={thNum}>
              {t("share.totalDan")}
            </th>
            <th scope="col" className={thNum}>
              {t("share.shareholderProfit")}
            </th>
            <th scope="col" className={thNum}>
              {t("share.invest")}
            </th>
            <th scope="col" className={thNum}>
              {t("share.profitPerLakh")}
            </th>
          </tr>
        </thead>
        <tbody>
          {view.months.map((month, index) => (
            <tr key={month.month} className="border-t border-border">
              <th scope="row" className={`${thClass} ${stickyCell} font-medium whitespace-nowrap`}>
                {months[index]}
              </th>
              {view.companies.map((company) => (
                <td key={company.companyId} className={tdNum}>
                  <Money value={companyOf(month, company.companyId)?.totalProfit ?? "0.00"} />
                </td>
              ))}
              <td className={tdNum}>
                <Money value={month.totalProfit} />
              </td>
              <td className={tdNum}>
                <Money value={month.totalDan} />
              </td>
              <td className={tdNum}>
                <Money value={month.shareholderProfit} />
              </td>
              <td className={tdNum}>
                <Money value={month.invest} />
              </td>
              <td className={tdNum}>
                <Money value={month.profitPerLakh} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}
