"use client";

import type { PartnerPayoutHistory } from "@bsd/contracts";
import { formatCount, formatDateTime, formatMoney, formatMonth, monthNames, t } from "@bsd/i18n";
import Link from "next/link";
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
import { TableSkeleton } from "@/components/skeleton";
import { StatTile } from "@/components/stat-tile";
import { StatePanel } from "@/components/state-panel";
import { TableScroller } from "@/components/table-scroller";
import { usePartnerPayoutHistory } from "@/data/queries";
import { companyHref } from "@/features/shell/navigation";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { useToday } from "@/lib/today";

const YEARS = Array.from({ length: 15 }, (_, index) => String(2026 + index));
const longMonths = monthNames("long");

function Money({ value }: { value: string }) {
  return <span className={value.startsWith("-") ? "text-error" : ""}>{formatMoney(value)}</span>;
}

/**
 * পেমেন্ট ইতিহাস (D143, D144): only payments that were actually made. Filter by year and month;
 * each row is a paid partner with the invest the payment was made on and the profit received,
 * plus the date it was paid. Nothing unpaid or still running appears here.
 */
export function PartnerPaymentHistoryPage() {
  const { company } = useCurrentWorkspace();
  const today = useToday();
  const [year, setYear] = useState(() => {
    const current = today.slice(0, 4);
    return YEARS.includes(current) ? current : (YEARS[0] ?? current);
  });
  // "" = every month of the year, else "01".."12".
  const [monthNumber, setMonthNumber] = useState("");
  const [shareholderId, setShareholderId] = useState("");
  const query = usePartnerPayoutHistory(company.id, year, shareholderId);

  return (
    <NavGate path="master/partner-payments/history">
      <PageHeader
        title={t("nav.master.partnerPayments.history")}
        description={t("payout.history.description")}
      />
      <div className="mb-5 flex flex-wrap items-end gap-3 print:hidden">
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
            {(query.data?.shareholders ?? []).map((person) => (
              <option key={person.shareholderId} value={person.shareholderId}>
                {person.name}
                {person.active ? "" : ` (${t("common.status.inactive")})`}
              </option>
            ))}
          </select>
        </label>
      </div>
      {query.isPending ? (
        <TableSkeleton rows={6} columns={5} />
      ) : query.isError ? (
        <QueryError error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <PaymentList companyId={company.id} view={query.data} monthNumber={monthNumber} />
      )}
    </NavGate>
  );
}

function PaymentList({
  companyId,
  view,
  monthNumber,
}: {
  companyId: string;
  view: PartnerPayoutHistory;
  monthNumber: string;
}) {
  const payments = view.payments.filter(
    (payment) => monthNumber === "" || payment.month.slice(5, 7) === monthNumber,
  );
  if (payments.length === 0) return <StatePanel title={t("payout.history.empty")} />;
  // The total is the server's: the whole year, or that month's byMonth figure.
  const total = monthNumber === "" ? view.total : (view.byMonth[Number(monthNumber) - 1] ?? "0.00");

  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        <StatTile
          large
          tone="brand"
          label={`${t("payout.history.total")} — ${
            monthNumber === "" ? view.year : `${longMonths[Number(monthNumber) - 1]} ${view.year}`
          }`}
          value={formatMoney(total)}
          hint={`${formatCount(payments.length)} ${t("payout.history.count")}`}
        />
      </dl>
      <TableScroller>
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th scope="col" className={`${thClass} ${stickyHead}`}>
                {t("payout.col.partner")}
              </th>
              <th scope="col" className={thClass}>
                {t("payout.month")}
              </th>
              <th scope="col" className={thNum}>
                {t("share.invest")}
              </th>
              <th scope="col" className={thNum}>
                {t("payout.history.profitReceived")}
              </th>
              <th scope="col" className={thClass}>
                {t("payout.paidAt")}
              </th>
              <th scope="col" className={thClass}>
                {t("payout.paidBy")}
              </th>
              <th scope="col" className={thClass}>
                {t("payout.note")}
              </th>
            </tr>
          </thead>
          <tbody>
            {payments.map((payment) => (
              <tr key={payment.id} className="border-t border-border">
                <th
                  scope="row"
                  className={`${thClass} ${stickyCell} text-left font-medium whitespace-nowrap`}
                >
                  {payment.shareholderName}
                </th>
                <td className={`${tdClass} whitespace-nowrap`}>
                  <Link
                    href={`${companyHref(companyId, "master/partner-payments")}?month=${payment.month}`}
                    className="underline-offset-2 hover:text-brand hover:underline"
                  >
                    {formatMonth(payment.month)}
                  </Link>
                </td>
                <td className={tdNum}>{formatMoney(payment.invest)}</td>
                <td className={`${tdNum} font-semibold`}>
                  <Money value={payment.amount} />
                </td>
                <td className={`${tdClass} whitespace-nowrap`}>{formatDateTime(payment.paidAt)}</td>
                <td className={`${tdClass} whitespace-nowrap text-text-muted`}>
                  {payment.paidByName ?? "—"}
                </td>
                <td className={`${tdClass} text-text-muted`}>{payment.note ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroller>
    </div>
  );
}
