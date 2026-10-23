"use client";

import type { ShareYear } from "@bsd/contracts";
import { monthOf, sumAmounts } from "@bsd/domain";
import { formatMoney, monthNames, t, toBengaliDigits } from "@bsd/i18n";
import { useState } from "react";
import { Button } from "@/components/button";
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
import { useShareYear } from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { useToday } from "@/lib/today";

const months = monthNames();

function Money({ value }: { value: string }) {
  return <span className={value.startsWith("-") ? "text-error" : ""}>{formatMoney(value)}</span>;
}

/**
 * The master page (D77): the workbook's year grid. One row per month, one column per company
 * for that company's total, then দান, per unit and each shareholder. Same figures as মাসিক হিসাব.
 */
export function MasterDashboardPage() {
  const { company } = useCurrentWorkspace();
  const today = useToday();
  const current = monthOf(today).slice(0, 4);
  const [year, setYear] = useState(current);
  const query = useShareYear(company.id, year);

  return (
    <NavGate path="">
      <PageHeader title={t("nav.master.dashboard")} description={t("share.year.description")} />
      <div className="mb-4 flex items-center gap-2 print:hidden">
        <Button onClick={() => setYear(String(Number(year) - 1))}>{t("share.year.prev")}</Button>
        <span className="min-w-16 text-center text-sm font-semibold tabular-nums">
          {toBengaliDigits(year)}
        </span>
        <Button disabled={year >= current} onClick={() => setYear(String(Number(year) + 1))}>
          {t("share.year.next")}
        </Button>
      </div>
      {query.isPending ? (
        <TableSkeleton rows={12} columns={6} />
      ) : query.isError ? (
        <QueryError error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <YearGrid view={query.data} />
      )}
    </NavGate>
  );
}

function YearGrid({ view }: { view: ShareYear }) {
  const companyTotal = (companyId: string) =>
    sumAmounts(view.months.map((month) => companyOf(month, companyId)?.total ?? "0"));
  const holderIncome = (shareholderId: string) =>
    sumAmounts(view.months.map((month) => holderOf(month, shareholderId)?.income ?? "0"));

  return (
    <TableScroller>
      <table className={tableClass}>
        <thead className={theadClass}>
          <tr>
            <th scope="col" rowSpan={2} className={`${thClass} ${stickyHead}`}>
              {t("month.picker")}
            </th>
            {view.companies.map((company) => (
              <th key={company.companyId} scope="col" rowSpan={2} className={thNum}>
                {company.companyName}
              </th>
            ))}
            <th scope="col" rowSpan={2} className={thNum}>
              {t("share.distributable")}
            </th>
            <th scope="col" rowSpan={2} className={thNum}>
              {t("share.dan")}
            </th>
            <th scope="col" rowSpan={2} className={thNum}>
              {t("share.perUnit")}
            </th>
            <th scope="col" rowSpan={2} className={thNum}>
              {t("share.totalUnits")}
            </th>
            {view.shareholders.map((person) => (
              <th key={person.shareholderId} scope="col" colSpan={2} className={thClass}>
                <span className={person.active ? "" : "text-text-muted"}>{person.name}</span>
              </th>
            ))}
          </tr>
          <tr>
            {view.shareholders.map((person) => (
              <HeaderPair key={person.shareholderId} />
            ))}
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
                  <Money value={companyOf(month, company.companyId)?.total ?? "0.00"} />
                </td>
              ))}
              <td className={tdNum}>
                <Money value={month.totals.distributable} />
              </td>
              <td className={tdNum}>
                <Money value={month.totals.dan} />
              </td>
              <td className={tdNum}>{toBengaliDigits(month.totals.perUnit)}</td>
              <td className={tdNum}>{toBengaliDigits(month.totals.units)}</td>
              {view.shareholders.map((person) => {
                const holder = holderOf(month, person.shareholderId);
                return (
                  <Pair
                    key={person.shareholderId}
                    units={holder?.units ?? "0"}
                    income={holder?.income ?? "0.00"}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-2 border-border font-semibold">
          <tr>
            <th scope="row" className={`${thClass} ${stickyCell}`}>
              {t("share.year.total")}
            </th>
            {view.companies.map((company) => (
              <td key={company.companyId} className={tdNum}>
                <Money value={companyTotal(company.companyId)} />
              </td>
            ))}
            <td className={tdNum}>
              <Money value={sumAmounts(view.months.map((month) => month.totals.distributable))} />
            </td>
            <td className={tdNum}>
              <Money value={sumAmounts(view.months.map((month) => month.totals.dan))} />
            </td>
            <td className={tdNum} />
            <td className={tdNum} />
            {view.shareholders.map((person) => (
              <Pair
                key={person.shareholderId}
                units=""
                income={holderIncome(person.shareholderId)}
              />
            ))}
          </tr>
        </tfoot>
      </table>
    </TableScroller>
  );
}

function HeaderPair() {
  return (
    <>
      <th scope="col" className={thNum}>
        {t("share.units")}
      </th>
      <th scope="col" className={thNum}>
        {t("share.income")}
      </th>
    </>
  );
}

function Pair({ units, income }: { units: string; income: string }) {
  return (
    <>
      <td className={tdNum}>{units === "" ? null : toBengaliDigits(units)}</td>
      <td className={tdNum}>
        <Money value={income} />
      </td>
    </>
  );
}

function companyOf(month: ShareYear["months"][number], companyId: string) {
  return month.companies.find((row) => row.companyId === companyId);
}

function holderOf(month: ShareYear["months"][number], shareholderId: string) {
  return month.shareholders.find((row) => row.shareholderId === shareholderId);
}
