"use client";

import type { PartnerPayoutHistory } from "@bsd/contracts";
import { formatCount, formatDateTime, formatMoney, formatMonth, monthNames, t } from "@bsd/i18n";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/button";
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
const shortMonths = monthNames("short");
const footRow = "border-t-2 border-border-strong bg-surface-muted font-semibold";

function Money({ value }: { value: string }) {
  return <span className={value.startsWith("-") ? "text-error" : ""}>{formatMoney(value)}</span>;
}

/**
 * পেমেন্ট ইতিহাস (D143): who was paid how much, in which month and from which company, for a
 * year. Every figure is a recorded payment (snapshot), never a live recomputation.
 */
export function PartnerPaymentHistoryPage() {
  const { company } = useCurrentWorkspace();
  const today = useToday();
  const [year, setYear] = useState(() => {
    const current = today.slice(0, 4);
    return YEARS.includes(current) ? current : (YEARS[0] ?? current);
  });
  const [shareholderId, setShareholderId] = useState("");
  const query = usePartnerPayoutHistory(company.id, year, shareholderId);

  return (
    <NavGate path="master/partner-payments/history">
      <PageHeader
        title={t("nav.master.partnerPayments.history")}
        description={t("payout.history.description")}
        actions={<Button onClick={() => window.print()}>{t("payout.print")}</Button>}
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
        <TableSkeleton rows={6} columns={8} />
      ) : query.isError ? (
        <QueryError error={query.error} onRetry={() => void query.refetch()} />
      ) : query.data.payments.length === 0 ? (
        <StatePanel title={t("payout.history.empty")} />
      ) : (
        <HistoryView companyId={company.id} view={query.data} />
      )}
    </NavGate>
  );
}

function HistoryView({ companyId, view }: { companyId: string; view: PartnerPayoutHistory }) {
  const monthHref = (month: string) =>
    `${companyHref(companyId, "master/partner-payments")}?month=${month}`;
  const monthKey = (index: number) => `${view.year}-${String(index + 1).padStart(2, "0")}`;
  const amountIn = (rows: readonly { companyId: string; amount: string }[], id: string) =>
    rows.find((row) => row.companyId === id)?.amount ?? "0.00";

  return (
    <div className="flex flex-col gap-8">
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        <StatTile
          large
          tone="brand"
          label={`${t("payout.history.total")} — ${view.year}`}
          value={formatMoney(view.total)}
          hint={`${formatCount(view.payments.length)} ${t("payout.history.count")}`}
        />
        {view.companies.map((company) => (
          <StatTile
            key={company.companyId}
            label={company.companyName}
            value={formatMoney(amountIn(view.byCompany, company.companyId))}
          />
        ))}
      </dl>

      <section className="flex flex-col gap-3">
        <SectionHead title={t("payout.history.byMonth")} hint={t("payout.history.byMonthHint")} />
        <TableScroller>
          <table className={tableClass}>
            <thead className={theadClass}>
              <tr>
                <th scope="col" className={`${thClass} ${stickyHead}`}>
                  {t("payout.col.partner")}
                </th>
                {shortMonths.map((label, index) => (
                  <th key={label} scope="col" className={thNum}>
                    <Link
                      href={monthHref(monthKey(index))}
                      className="underline-offset-2 hover:text-brand hover:underline"
                    >
                      {label}
                    </Link>
                  </th>
                ))}
                <th scope="col" className={thNum}>
                  {t("common.total")}
                </th>
              </tr>
            </thead>
            <tbody>
              {view.byShareholder.map((row) => (
                <tr key={row.shareholderId} className="border-t border-border">
                  <th scope="row" className={`${thClass} ${stickyCell} text-left font-medium`}>
                    {row.name}
                  </th>
                  {row.months.map((amount, index) => (
                    <td
                      key={monthKey(index)}
                      className={`${tdNum} ${amount === null ? "" : "bg-success/8"}`}
                    >
                      {amount === null ? (
                        <span className="text-text-subtle">—</span>
                      ) : (
                        <Money value={amount} />
                      )}
                    </td>
                  ))}
                  <td className={`${tdNum} font-semibold`}>
                    <Money value={row.total} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className={footRow}>
                <th scope="row" className={`${thClass} ${stickyCell} text-left`}>
                  {t("common.total")}
                </th>
                {view.byMonth.map((amount, index) => (
                  <td key={monthKey(index)} className={tdNum}>
                    {/[1-9]/.test(amount) ? <Money value={amount} /> : "—"}
                  </td>
                ))}
                <td className={tdNum}>
                  <Money value={view.total} />
                </td>
              </tr>
            </tfoot>
          </table>
        </TableScroller>
      </section>

      <section className="flex flex-col gap-3">
        <SectionHead
          title={t("payout.history.byCompany")}
          hint={t("payout.history.byCompanyHint")}
        />
        <TableScroller>
          <table className={tableClass}>
            <thead className={theadClass}>
              <tr>
                <th scope="col" className={`${thClass} ${stickyHead}`}>
                  {t("payout.col.partner")}
                </th>
                {view.companies.map((company) => (
                  <th key={company.companyId} scope="col" className={thNum}>
                    {company.companyName}
                  </th>
                ))}
                <th scope="col" className={thNum}>
                  {t("common.total")}
                </th>
              </tr>
            </thead>
            <tbody>
              {view.byShareholder.map((row) => (
                <tr key={row.shareholderId} className="border-t border-border">
                  <th scope="row" className={`${thClass} ${stickyCell} text-left font-medium`}>
                    {row.name}
                  </th>
                  {view.companies.map((company) => (
                    <td key={company.companyId} className={tdNum}>
                      <Money value={amountIn(row.byCompany, company.companyId)} />
                    </td>
                  ))}
                  <td className={`${tdNum} font-semibold`}>
                    <Money value={row.total} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className={footRow}>
                <th scope="row" className={`${thClass} ${stickyCell} text-left`}>
                  {t("common.total")}
                </th>
                {view.companies.map((company) => (
                  <td key={company.companyId} className={tdNum}>
                    <Money value={amountIn(view.byCompany, company.companyId)} />
                  </td>
                ))}
                <td className={tdNum}>
                  <Money value={view.total} />
                </td>
              </tr>
            </tfoot>
          </table>
        </TableScroller>
      </section>

      <section className="flex flex-col gap-3">
        <SectionHead title={t("payout.history.payments")} />
        <TableScroller>
          <table className={tableClass}>
            <thead className={theadClass}>
              <tr>
                <th scope="col" className={`${thClass} ${stickyHead}`}>
                  {t("payout.month")}
                </th>
                <th scope="col" className={thClass}>
                  {t("payout.col.partner")}
                </th>
                {view.companies.map((company) => (
                  <th key={company.companyId} scope="col" className={thNum}>
                    {company.companyName}
                  </th>
                ))}
                <th scope="col" className={thNum}>
                  {t("payout.col.paid")}
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
              {view.payments.map((payment) => (
                <tr key={payment.id} className="border-t border-border">
                  <th
                    scope="row"
                    className={`${thClass} ${stickyCell} text-left font-medium whitespace-nowrap`}
                  >
                    <Link
                      href={monthHref(payment.month)}
                      className="underline-offset-2 hover:text-brand hover:underline"
                    >
                      {formatMonth(payment.month)}
                    </Link>
                  </th>
                  <td className={`${tdClass} whitespace-nowrap`}>{payment.shareholderName}</td>
                  {view.companies.map((company) => {
                    const line = payment.lines.find((row) => row.companyId === company.companyId);
                    return (
                      <td key={company.companyId} className={tdNum}>
                        {line ? (
                          <Money value={line.amount} />
                        ) : (
                          <span className="text-text-subtle">—</span>
                        )}
                      </td>
                    );
                  })}
                  <td className={`${tdNum} font-semibold`}>
                    <Money value={payment.amount} />
                  </td>
                  <td className={`${tdClass} whitespace-nowrap text-text-muted`}>
                    {formatDateTime(payment.paidAt)}
                  </td>
                  <td className={`${tdClass} whitespace-nowrap text-text-muted`}>
                    {payment.paidByName ?? "—"}
                  </td>
                  <td className={`${tdClass} text-text-muted`}>{payment.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroller>
      </section>
    </div>
  );
}

function SectionHead({ title, hint }: { title: string; hint?: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {hint ? <p className="mt-1 text-sm text-text-muted">{hint}</p> : null}
    </div>
  );
}
