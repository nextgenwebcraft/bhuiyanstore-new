"use client";

import type { SalaryHistoryRow } from "@bsd/contracts";
import { toDecimal } from "@bsd/domain";
import { formatMoney, formatMonth, formatShortDate, monthNames, t } from "@bsd/i18n";
import { Fragment, useState } from "react";
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
import { useSalaryHistory } from "@/data/queries";
import { NavGate } from "@/features/shell/nav-gate";
import { PrintButton, PrintHeader } from "@/features/shell/print";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { useToday } from "@/lib/today";

const FIRST_YEAR = 2026;
const longMonths = monthNames("long");
const nonZero = (value: string) => !toDecimal(value).isZero();

/**
 * D149 History → বেতন ইতিহাস: every posted salary — what each person earned, what was kept back
 * (absent fee, advance, loan, shortage) and what reached their hand. A row opens the line-by-line
 * calculation. Every figure and total comes from the server.
 */
export function SalaryHistoryPage() {
  const { company } = useCurrentWorkspace();
  const today = useToday();
  const currentYear = today.slice(0, 4);
  const years = Array.from(
    { length: Math.max(1, Number(currentYear) - FIRST_YEAR + 1) },
    (_, index) => String(FIRST_YEAR + index),
  ).reverse();
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState("");
  const [staffId, setStaffId] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const query = useSalaryHistory(company.id, {
    year,
    month: month ? `${year}-${month}` : null,
    staffId: staffId || null,
  });

  const filters = (
    <div className="flex flex-wrap items-end gap-3 print:hidden">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-medium text-text-muted">{t("share.filter.year")}</span>
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
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-medium text-text-muted">{t("month.picker")}</span>
        <select
          className={`${inputClass} w-36`}
          value={month}
          onChange={(event) => setMonth(event.target.value)}
        >
          <option value="">{t("salaryHistory.allMonths")}</option>
          {longMonths.map((name, index) => (
            <option key={name} value={String(index + 1).padStart(2, "0")}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs font-medium text-text-muted">{t("salaryHistory.staff")}</span>
        <select
          className={`${inputClass} w-44`}
          value={staffId}
          onChange={(event) => setStaffId(event.target.value)}
        >
          <option value="">{t("salaryHistory.allStaff")}</option>
          {(query.data?.staffOptions ?? []).map((option) => (
            <option key={option.staffId} value={option.staffId}>
              {option.staffName}
            </option>
          ))}
        </select>
      </label>
      <PrintButton />
    </div>
  );

  return (
    <NavGate path="history/salaries">
      <PageHeader
        title={t("nav.history.salaries")}
        description={t("salaryHistory.description")}
        actions={filters}
      />
      <PrintHeader title={t("nav.history.salaries")} />
      <p className="mb-6 rounded-xl border border-info/35 bg-info/10 px-4 py-3 text-sm text-text">
        {t("salaryHistory.absentNote")}
      </p>
      {query.isPending ? (
        <div className="flex flex-col gap-6">
          <SummarySkeleton />
          <TableSkeleton rows={6} columns={8} />
        </div>
      ) : query.isError ? (
        <QueryError error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <div className="flex flex-col gap-6">
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatTile
              label={t("salaryHistory.col.salary")}
              value={formatMoney(query.data.totals.salary)}
            />
            <StatTile
              label={t("salaryHistory.col.absent")}
              value={formatMoney(query.data.totals.absent)}
            />
            <StatTile
              label={t("salaryHistory.col.recovery")}
              value={formatMoney(query.data.totals.recovery)}
            />
            <StatTile
              label={t("salaryHistory.col.cashPay")}
              value={formatMoney(query.data.totals.cashPay)}
            />
            <StatTile
              tone="brand"
              label={t("salaryHistory.col.cashPaid")}
              value={formatMoney(query.data.totals.cashPaid)}
            />
          </dl>
          {query.data.rows.length === 0 ? (
            <StatePanel title={t("salaryHistory.empty")} />
          ) : (
            <TableScroller>
              <table className={tableClass}>
                <thead className={theadClass}>
                  <tr>
                    <th scope="col" className={`${thClass} ${stickyHead}`}>
                      {t("salaryHistory.col.staff")}
                    </th>
                    <th scope="col" className={thClass}>
                      {t("capital.col.month")}
                    </th>
                    <th scope="col" className={thNum}>
                      {t("salaryHistory.col.salary")}
                    </th>
                    <th scope="col" className={thNum}>
                      {t("salaryHistory.col.absent")}
                    </th>
                    <th scope="col" className={thNum}>
                      {t("salaryHistory.col.recovery")}
                    </th>
                    <th scope="col" className={thNum}>
                      {t("salaryHistory.col.cashPaid")}
                    </th>
                    <th scope="col" className={thClass}>
                      {t("salaryHistory.col.paidDate")}
                    </th>
                    <th scope="col" className={`${thClass} print:hidden`}>
                      <span className="sr-only">{t("salaryHistory.details")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.rows.map((row) => {
                    const key = `${row.runId}:${row.staffId}`;
                    const expanded = open === key;
                    return (
                      <Fragment key={key}>
                        <tr className="border-t border-border">
                          <th
                            scope="row"
                            className={`${thClass} ${stickyCell} text-left font-medium whitespace-nowrap`}
                          >
                            <div>{row.staffName}</div>
                            <div className="text-xs font-normal text-text-muted">
                              {row.roleName}
                            </div>
                          </th>
                          <td className={`${tdClass} whitespace-nowrap`}>
                            {formatMonth(row.month)}
                          </td>
                          <td className={tdNum}>{formatMoney(row.salary)}</td>
                          <td className={tdNum}>{formatMoney(row.absent)}</td>
                          <td className={tdNum}>{formatMoney(row.recoveryTotal)}</td>
                          <td className={`${tdNum} font-semibold`}>
                            {nonZero(row.cashPaid) || row.paidDate
                              ? formatMoney(row.cashPaid)
                              : `${formatMoney(row.cashPay)} · ${t("salaryHistory.unpaid")}`}
                          </td>
                          <td className={`${tdClass} whitespace-nowrap text-text-muted`}>
                            {row.paidDate ? formatShortDate(row.paidDate) : "—"}
                          </td>
                          <td className={`${tdClass} print:hidden`}>
                            <button
                              type="button"
                              aria-expanded={expanded}
                              className="min-h-8 rounded-md border border-border px-3 text-xs font-semibold text-text hover:border-border-strong hover:bg-surface-hover"
                              onClick={() => setOpen(expanded ? null : key)}
                            >
                              {t(expanded ? "salaryHistory.hide" : "salaryHistory.details")}
                            </button>
                          </td>
                        </tr>
                        {expanded ? (
                          <tr className="bg-surface-muted">
                            <td colSpan={8} className="px-4 py-4">
                              <SalaryBreakdown row={row} />
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </TableScroller>
          )}
        </div>
      )}
    </NavGate>
  );
}

/** বেতন − অনুপস্থিতি ফি = পাওনা বেতন; − অগ্রিম / ঋণ / শর্ট কর্তন = ক্যাশ পাবে; then what was paid. */
function SalaryBreakdown({ row }: { row: SalaryHistoryRow }) {
  const buckets = [
    ["advance", "salaryHistory.recover.advance"],
    ["loan", "salaryHistory.recover.loan"],
    ["shortage", "salaryHistory.recover.shortage"],
  ] as const;
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,28rem)_minmax(0,1fr)]">
      <table className="w-full text-sm">
        <tbody>
          <Line label={t("salaryHistory.col.salary")} value={row.salary} />
          <Line
            label={`− ${t("salaryHistory.col.absent")}`}
            value={row.absent}
            hint={t("salaryHistory.absentHint")}
          />
          <Line label={`= ${t("salaryHistory.col.payable")}`} value={row.payable} strong />
          {buckets.map(([bucket, labelKey]) => (
            <Line
              key={bucket}
              label={`− ${t(labelKey)}`}
              value={row.recovery[bucket]}
              hint={
                nonZero(row.owed[bucket]) || nonZero(row.recovery[bucket])
                  ? t("salaryHistory.balanceMove")
                      .replace("{before}", formatMoney(row.owed[bucket]))
                      .replace("{after}", formatMoney(row.remaining[bucket]))
                  : undefined
              }
            />
          ))}
          <Line label={`= ${t("salaryHistory.col.cashPay")}`} value={row.cashPay} strong />
        </tbody>
      </table>
      <dl className="flex flex-col gap-2 text-sm">
        <div>
          <dt className="text-xs text-text-muted">{t("salaryHistory.col.cashPaid")}</dt>
          <dd className="font-semibold tabular-nums">
            {row.paidDate
              ? `${formatMoney(row.cashPaid)} — ${formatShortDate(row.paidDate)}`
              : t("salaryHistory.unpaid")}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-text-muted">{t("salaryHistory.postedDate")}</dt>
          <dd className="tabular-nums">{formatShortDate(row.postedDate)}</dd>
        </div>
      </dl>
    </div>
  );
}

function Line({
  label,
  value,
  hint,
  strong = false,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
  strong?: boolean;
}) {
  return (
    <tr className={strong ? "border-t border-border-strong" : ""}>
      <th scope="row" className={`py-1 pr-4 text-left ${strong ? "font-semibold" : "font-normal"}`}>
        {label}
        {hint ? <div className="text-xs font-normal text-text-muted">{hint}</div> : null}
      </th>
      <td className={`py-1 text-right tabular-nums ${strong ? "font-semibold" : ""}`}>
        {formatMoney(value)}
      </td>
    </tr>
  );
}
