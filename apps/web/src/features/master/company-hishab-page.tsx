"use client";

import type { CompanyHishabYear } from "@bsd/contracts";
import { formatMoney, monthNames, t } from "@bsd/i18n";
import { useMemo, useState } from "react";
import { Button } from "@/components/button";
import { tableClass, tdNum, thClass, thNum, theadClass } from "@/components/data-table";
import { inputClass } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { TableSkeleton } from "@/components/skeleton";
import { TableScroller } from "@/components/table-scroller";
import { useCompanyHishabYear, useWorkspaces } from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { useToday } from "@/lib/today";

const months = monthNames();
const YEARS = Array.from({ length: 15 }, (_, index) => String(2026 + index));

function Money({ value }: { value: string }) {
  return <span className={value.startsWith("-") ? "text-error" : ""}>{formatMoney(value)}</span>;
}

export function CompanyHishabPage() {
  const { company } = useCurrentWorkspace();
  const today = useToday();
  const workspaces = useWorkspaces();
  const companies = useMemo(
    () => (workspaces.data ?? []).map((w) => w.company).filter((c) => !c.isMaster),
    [workspaces.data],
  );
  const [targetCompanyId, setTargetCompanyId] = useState("");
  const [year, setYear] = useState(() => {
    const current = today.slice(0, 4);
    return YEARS.includes(current) ? current : (YEARS[0] ?? current);
  });
  const [shareholderId, setShareholderId] = useState("");
  const selectedCompanyId = targetCompanyId || companies[0]?.id || "";
  const query = useCompanyHishabYear(company.id, selectedCompanyId, year, shareholderId);

  return (
    <NavGate path="master/company-hishab">
      <PageHeader title={t("nav.master.companyHishab")} description={t("share.description")} />
      <div className="mb-4 flex flex-wrap gap-2 print:hidden">
        {companies.map((option) => (
          <Button
            key={option.id}
            variant={option.id === selectedCompanyId ? "primary" : "secondary"}
            onClick={() => setTargetCompanyId(option.id)}
          >
            {option.name}
          </Button>
        ))}
      </div>
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
        <YearTable view={query.data} />
      )}
    </NavGate>
  );
}

function YearTable({ view }: { view: CompanyHishabYear }) {
  return (
    <TableScroller>
      <table className={tableClass}>
        <thead className={theadClass}>
          <tr>
            <th scope="col" className={thClass}>
              {t("month.picker")}
            </th>
            <th scope="col" className={thNum}>
              {t("share.profit")}
            </th>
            <th scope="col" className={thNum}>
              {t("share.khoroch")}
            </th>
            <th scope="col" className={thNum}>
              {t("share.dan")}
            </th>
            <th scope="col" className={thNum}>
              {t("share.total")}
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
              <th scope="row" className={`${thClass} font-medium whitespace-nowrap`}>
                {months[index]}
              </th>
              <td className={tdNum}>
                <Money value={month.profit} />
              </td>
              <td className={tdNum}>
                <Money value={month.khoroch} />
              </td>
              <td className={tdNum}>
                <Money value={month.dan} />
              </td>
              <td className={tdNum}>
                <Money value={month.totalProfit} />
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
