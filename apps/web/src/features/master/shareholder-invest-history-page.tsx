"use client";

import { monthOf } from "@bsd/domain";
import { formatMoney, formatMonth, monthNames, t } from "@bsd/i18n";
import { useState } from "react";
import {
  ColumnHead,
  tableClass,
  tdClass,
  tdNum,
  thClass,
  theadClass,
} from "@/components/data-table";
import { inputClass } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { StatePanel } from "@/components/state-panel";
import { TableSkeleton } from "@/components/skeleton";
import { TableScroller } from "@/components/table-scroller";
import { useShareholders } from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { useToday } from "@/lib/today";

const YEARS = Array.from({ length: 15 }, (_, index) => String(2026 + index));
const longMonths = monthNames("long");

/**
 * ইনভেস্ট পরিবর্তনের ইতিহাস (D144): every month that holds an invest record, newest first, with
 * the amounts in force from that month. The changed companies are highlighted. Filtered by year
 * and month (the current month by default) and by partner. The log does not depend on the month
 * asked for, so the current month is requested.
 */
export function ShareholderInvestHistoryPage() {
  const { company } = useCurrentWorkspace();
  const today = useToday();
  const query = useShareholders(company.id, monthOf(today));
  const [year, setYear] = useState(() => {
    const current = today.slice(0, 4);
    return YEARS.includes(current) ? current : (YEARS[0] ?? current);
  });
  // "" = every month of the year, else "01".."12"; the current month by default.
  const [monthNumber, setMonthNumber] = useState(() => today.slice(5, 7));
  const [shareholderId, setShareholderId] = useState("");

  return (
    <NavGate path="master/shareholders/history">
      <PageHeader
        title={t("nav.master.shareholders.history")}
        description={t("share.changes.hint")}
      />
      {query.isPending ? (
        <TableSkeleton rows={5} columns={5} />
      ) : query.isError ? (
        <QueryError error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3 print:hidden">
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
              <span className="text-xs font-medium text-text-muted">{t("payout.month")}</span>
              <select
                className={`${inputClass} w-40`}
                value={monthNumber}
                onChange={(event) => setMonthNumber(event.target.value)}
              >
                <option value="">{t("payout.history.allMonths")}</option>
                {longMonths.map((label, index) => (
                  <option key={label} value={String(index + 1).padStart(2, "0")}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs font-medium text-text-muted">
                {t("share.filter.shareholder")}
              </span>
              <select
                className={`${inputClass} w-52`}
                value={shareholderId}
                onChange={(event) => setShareholderId(event.target.value)}
              >
                <option value="">{t("share.filter.allShareholders")}</option>
                {query.data.shareholders.map((person) => (
                  <option key={person.shareholderId} value={person.shareholderId}>
                    {person.name}
                    {person.active ? "" : ` (${t("common.status.inactive")})`}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <ChangeTable
            view={query.data}
            changes={query.data.changes.filter(
              (change) =>
                change.month.startsWith(`${year}-`) &&
                (monthNumber === "" || change.month.slice(5, 7) === monthNumber) &&
                (shareholderId === "" || change.shareholderId === shareholderId),
            )}
          />
        </div>
      )}
    </NavGate>
  );
}

function ChangeTable({
  view,
  changes,
}: {
  view: NonNullable<ReturnType<typeof useShareholders>["data"]>;
  changes: typeof view.changes;
}) {
  if (changes.length === 0) return <StatePanel title={t("share.changes.empty")} />;
  return (
    <TableScroller>
      <table className={tableClass}>
        <thead className={theadClass}>
          <tr>
            <th scope="col" className={thClass}>
              {t("share.month")}
            </th>
            <th scope="col" className={thClass}>
              {t("share.name")}
            </th>
            {view.companies.map((company) => (
              <ColumnHead key={company.companyId} label={company.companyName} quantity />
            ))}
            <ColumnHead label={t("share.totalInvest")} quantity />
          </tr>
        </thead>
        <tbody>
          {changes.map((change) => (
            <tr key={`${change.shareholderId}-${change.month}`} className="border-t border-border">
              <td className={`${tdClass} whitespace-nowrap`}>
                {formatMonth(change.month)} {t("share.since")}
              </td>
              <td className={`${tdClass} whitespace-nowrap`}>{change.name}</td>
              {view.companies.map((company) => {
                const changed = change.changedCompanyIds.includes(company.companyId);
                return (
                  <td
                    key={company.companyId}
                    className={`${tdNum} ${changed ? "font-semibold text-brand" : "text-text-muted"}`}
                  >
                    {formatMoney(
                      change.amounts.find((entry) => entry.companyId === company.companyId)
                        ?.amount ?? "0.00",
                    )}
                  </td>
                );
              })}
              <td className={`${tdNum} font-semibold`}>{formatMoney(change.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}
