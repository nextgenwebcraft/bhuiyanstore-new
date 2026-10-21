"use client";

import type { MasterSummary, ReportRange } from "@bsd/contracts";
import { t } from "@bsd/i18n";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useState } from "react";
import {
  money,
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
import { StatsSkeleton, TableSkeleton } from "@/components/skeleton";
import { TableScroller } from "@/components/table-scroller";
import { useMasterSummary } from "@/data/queries";
import { periodParam, parsePeriod, periodRange, type Period } from "@/features/dashboard/period";
import {
  PeriodBar,
  RangeHeading,
  Section,
  SummaryGroups,
} from "@/features/dashboard/dashboard-page";
import { MasterMonthClose } from "@/features/master/master-month-page";
import { ReportBody } from "@/features/reports/report-view";
import { companyHref } from "@/features/shell/navigation";
import { NavGate } from "@/features/shell/nav-gate";
import { PrintButton, PrintHeader } from "@/features/shell/print";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { useToday } from "@/lib/today";

const ALL = "all";

/**
 * D66, D67: the business's profit and loss = Σ company net profit (after the salaries each company
 * paid) − master expenses. With one company chosen, only that company's line.
 */
function ProfitAndLoss({
  profit,
  companyId,
}: {
  profit: NonNullable<MasterSummary["profit"]>;
  companyId: string;
}) {
  const companies =
    companyId === ALL
      ? profit.companies
      : profit.companies.filter((c) => c.companyId === companyId);
  return (
    <TableScroller>
      <table className={tableClass}>
        <thead className={theadClass}>
          <tr>
            <th scope="col" className={thClass}>
              {t("master.pl.line")}
            </th>
            <th scope="col" className={thNum}>
              {t("report.line.gross")}
            </th>
            <th scope="col" className={thNum}>
              {t("report.column.salary")}
            </th>
            <th scope="col" className={thNum}>
              {t("report.line.expenses")}
            </th>
            <th scope="col" className={thNum}>
              {t("report.line.srIncentive")}
            </th>
            <th scope="col" className={thNum}>
              {t("report.line.net")}
            </th>
          </tr>
        </thead>
        <tbody>
          {companies.map((c) => (
            <tr key={c.companyId} className="border-t border-border">
              <td className={tdClass}>{c.companyName}</td>
              <td className={tdNum}>{money(c.gross)}</td>
              <td className={tdNum}>{money(c.salaries)}</td>
              <td className={tdNum}>{money(c.expenses)}</td>
              <td className={tdNum}>{money(c.srIncentive)}</td>
              <td className={tdNum}>{money(c.net)}</td>
            </tr>
          ))}
          {companyId === ALL ? (
            <>
              <tr className="border-t border-border-strong font-semibold">
                <td className={tdClass}>{t("master.pl.companiesNet")}</td>
                <td className={tdNum} colSpan={5}>
                  {money(profit.companiesNet)}
                </td>
              </tr>
              <tr className="border-t border-border">
                <td className={tdClass}>{t("master.pl.masterExpenses")}</td>
                <td className={tdNum} colSpan={5}>
                  {money(profit.masterExpenses)}
                </td>
              </tr>
              <tr className="border-t-2 border-border-strong bg-brand/8 text-base font-semibold">
                <td className={tdClass}>{t("master.pl.net")}</td>
                <td className={tdNum} colSpan={5}>
                  {money(profit.net)}
                </td>
              </tr>
            </>
          ) : null}
        </tbody>
      </table>
    </TableScroller>
  );
}

function MasterBody({ range, companyId }: { range: ReportRange; companyId: string }) {
  const { company } = useCurrentWorkspace();
  const summary = useMasterSummary(company.id, range);
  if (summary.isPending || summary.isPlaceholderData) {
    return (
      <div className="flex flex-col gap-6">
        <StatsSkeleton count={8} />
        <TableSkeleton rows={4} columns={5} title />
      </div>
    );
  }
  if (summary.isError) {
    return <QueryError error={summary.error} onRetry={() => void summary.refetch()} />;
  }
  const data = summary.data;
  const chosen =
    companyId === ALL
      ? data.total
      : (data.companies.find((c) => c.companyId === companyId)?.summary ?? data.total);
  return (
    <div className="flex flex-col gap-6">
      <Section title={t("dashboard.section.summary")}>
        <SummaryGroups d={chosen} singleDay={range.from === range.to} />
        {companyId === ALL ? (
          <p className="text-xs text-text-muted">{t("master.totalHint")}</p>
        ) : null}
      </Section>
      {data.profit ? (
        <Section title={t("master.pl.title")}>
          <ProfitAndLoss profit={data.profit} companyId={companyId} />
        </Section>
      ) : null}
      <Section title={t("dashboard.section.staff")} collapsible>
        <ReportBody companyId={company.id} report="staff-balances" range={range} />
      </Section>
      <Section title={t("nav.flow.monthClose")} collapsible defaultOpen={false}>
        <MasterMonthClose />
      </Section>
    </div>
  );
}

/** The master panel's dashboard (D66): every company together or one, with the business P&L. */
export function MasterDashboardPage() {
  const { company } = useCurrentWorkspace();
  const id = useId();
  const router = useRouter();
  const search = useSearchParams();
  const today = useToday();
  const period = parsePeriod(search.get("period"), today);
  const range = periodRange(period, today);
  const [companyId, setCompanyId] = useState(ALL);
  const data = useMasterSummary(company.id, range).data;

  const choose = (next: Period) =>
    router.push(
      next.kind === "today"
        ? companyHref(company.id)
        : `${companyHref(company.id)}?period=${periodParam(next)}`,
      { scroll: false },
    );

  return (
    <NavGate path="">
      <PageHeader
        title={t("nav.master.dashboard")}
        description={t("master.dashboard.description")}
        actions={<PrintButton />}
      />
      <PrintHeader title={t("nav.master.dashboard")} from={range.from} to={range.to} />
      <PeriodBar
        period={period}
        cutoffDate={data?.total.cutoffDate ?? null}
        today={today}
        onChange={choose}
      />
      <div className="mb-5 flex flex-wrap items-center gap-2 print:hidden">
        <label htmlFor={`${id}-company`} className="text-sm font-medium">
          {t("master.filter.company")}
        </label>
        <select
          id={`${id}-company`}
          value={companyId}
          onChange={(event) => setCompanyId(event.target.value)}
          className={`${inputClass} w-auto min-w-56`}
        >
          <option value={ALL}>{t("master.filter.all")}</option>
          {(data?.companies ?? []).map((c) => (
            <option key={c.companyId} value={c.companyId}>
              {c.companyName}
            </option>
          ))}
        </select>
      </div>
      <RangeHeading range={range} isToday={period.kind === "today"} />
      <MasterBody range={range} companyId={companyId} />
    </NavGate>
  );
}
