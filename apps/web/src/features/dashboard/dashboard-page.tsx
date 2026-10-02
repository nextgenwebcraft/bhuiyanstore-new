"use client";

import type { DashboardSummary } from "@bsd/contracts";
import { businessDateOf, shiftBusinessDate } from "@bsd/domain";
import { formatAmount, formatBusinessDate, t, toBengaliDigits } from "@bsd/i18n";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/button";
import { inputClass } from "@/components/field";
import { Icon, type IconName } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { Skeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { StatTile } from "@/components/stat-tile";
import { errorCodeOf } from "@/data/ports/service-error";
import { useDashboardSummary } from "@/data/queries";
import { companyHref, findNavEntry, navAccess } from "@/features/shell/navigation";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";

const amount = formatAmount;
const count = (value: number) => toBengaliDigits(String(value));

function DateBar({
  date,
  today,
  onChange,
}: {
  date: string;
  today: string;
  onChange: (date: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Button
        aria-label={t("dashboard.previousDay")}
        title={t("dashboard.previousDay")}
        className="px-2.5"
        onClick={() => onChange(shiftBusinessDate(date, -1))}
      >
        <Icon name="chevronLeft" className="size-4" />
      </Button>
      <label className="sr-only" htmlFor="dashboard-date">
        {t("dashboard.date")}
      </label>
      <input
        id="dashboard-date"
        type="date"
        value={date}
        max={today}
        onChange={(event) => {
          if (event.target.value) onChange(event.target.value);
        }}
        className={`${inputClass} w-auto text-sm tabular-nums`}
      />
      <Button
        aria-label={t("dashboard.nextDay")}
        title={t("dashboard.nextDay")}
        className="px-2.5"
        disabled={date >= today}
        onClick={() => onChange(shiftBusinessDate(date, 1))}
      >
        <Icon name="chevronRight" className="size-4" />
      </Button>
      <Button disabled={date === today} onClick={() => onChange(today)}>
        {t("dashboard.today")}
      </Button>
    </div>
  );
}

function ReportSection({
  title,
  icon,
  href,
  children,
}: {
  title: string;
  icon: IconName;
  href?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <span className="grid size-7 place-items-center rounded-lg bg-brand/10 text-brand">
            <Icon name={icon} className="size-4" />
          </span>
          {title}
        </h2>
        {href ? (
          <Link
            href={href}
            className="inline-flex items-center gap-1 text-xs font-medium text-text-muted transition-colors hover:text-brand"
          >
            {t("dashboard.open")}
            <Icon name="arrowRight" className="size-3.5" />
          </Link>
        ) : null}
      </div>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</dl>
    </section>
  );
}

function DsrTable({ rows }: { rows: DashboardSummary["byDsr"] }) {
  return (
    <section>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <span className="grid size-7 place-items-center rounded-lg bg-brand/10 text-brand">
          <Icon name="dsrStaff" className="size-4" />
        </span>
        {t("dashboard.section.byDsr")}
      </h2>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-text-muted">
          {t("dashboard.noDsrActivity")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-surface-muted text-left text-xs text-text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  {t("dashboard.dsr")}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {t("dashboard.netSales")}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {t("dashboard.salesCash")}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {t("dashboard.marketDueCreated")}
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  {t("dashboard.oldDuesCollected")}
                </th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {rows.map((row) => (
                <tr key={row.dsrId} className="border-t border-border">
                  <th scope="row" className="px-4 py-3 text-left font-medium">
                    {row.dsrName}
                  </th>
                  <td className="px-4 py-3 text-right">{amount(row.netSales)}</td>
                  <td className="px-4 py-3 text-right">{amount(row.salesCash)}</td>
                  <td className="px-4 py-3 text-right">{amount(row.marketDueCreated)}</td>
                  <td className="px-4 py-3 text-right">{amount(row.oldDuesCollected)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * The daily report: every figure comes from the service's event-derived summary for one business
 * date (guide 5.2, 5.3); the page only formats it and links to the screens behind each figure.
 */
function DailyReport({ companyId, date }: { companyId: string; date: string }) {
  const workspace = useCurrentWorkspace();
  const summary = useDashboardSummary(companyId, date);

  const linkTo = (path: string) => {
    const entry = findNavEntry(path);
    if (!entry?.item.implemented) return undefined;
    return navAccess(workspace, entry.section, entry.item) === "ok"
      ? companyHref(companyId, path)
      : undefined;
  };

  if (summary.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
      </div>
    );
  }
  if (summary.isError && errorCodeOf(summary.error) === "MODULE_UNAVAILABLE") {
    return <StatePanel title={t("dashboard.unavailable")} hint={t("dashboard.unavailableHint")} />;
  }
  if (summary.isError) {
    return <QueryError error={summary.error} onRetry={() => void summary.refetch()} />;
  }

  const d = summary.data;
  const quiet =
    d.postedSummaryCount === 0 && d.postedReceiptCount === 0 && d.oldDuesCollected === "0.00";

  return (
    <div
      className={`flex flex-col gap-8 transition-opacity ${summary.isPlaceholderData ? "opacity-60" : ""}`}
    >
      {quiet ? (
        <StatePanel title={t("dashboard.noActivity")} hint={t("dashboard.noActivityHint")} />
      ) : null}

      <ReportSection
        title={t("dashboard.section.sales")}
        icon="sales"
        href={linkTo("sales/daily-summaries")}
      >
        <StatTile label={t("dashboard.netSales")} value={amount(d.netSales)} emphasis />
        {d.grossProfit !== undefined ? (
          <StatTile label={t("dashboard.grossProfit")} value={amount(d.grossProfit)} />
        ) : null}
        <StatTile label={t("dashboard.postedSummaries")} value={count(d.postedSummaryCount)} />
      </ReportSection>

      <ReportSection
        title={t("dashboard.section.collections")}
        icon="finance"
        href={linkTo("sales/old-dues-collection")}
      >
        <StatTile label={t("dashboard.cashCollected")} value={amount(d.cashCollected)} emphasis />
        <StatTile label={t("dashboard.salesCash")} value={amount(d.salesCash)} />
        <StatTile label={t("dashboard.oldDuesCollected")} value={amount(d.oldDuesCollected)} />
      </ReportSection>

      <ReportSection title={t("dashboard.section.dues")} icon="srAccounts">
        <StatTile
          label={t("dashboard.marketDueOutstanding")}
          value={amount(d.marketDueOutstanding)}
          emphasis
        />
        <StatTile label={t("dashboard.marketDueCreated")} value={amount(d.marketDueCreated)} />
        <StatTile label={t("dashboard.oldDuesCollected")} value={amount(d.oldDuesCollected)} />
      </ReportSection>

      <ReportSection
        title={t("dashboard.section.stock")}
        icon="purchases"
        href={linkTo("purchases/receipts")}
      >
        <StatTile label={t("dashboard.postedReceipts")} value={count(d.postedReceiptCount)} />
        {d.receivedValue !== undefined ? (
          <StatTile label={t("dashboard.receivedValue")} value={amount(d.receivedValue)} />
        ) : null}
        {d.stockValue !== undefined ? (
          <StatTile
            label={t("dashboard.stockValue")}
            value={amount(d.stockValue)}
            hint={t("dashboard.stockValueHint")}
          />
        ) : null}
      </ReportSection>

      <DsrTable rows={d.byDsr} />
    </div>
  );
}

export function DashboardPage() {
  const { company } = useCurrentWorkspace();
  const [today] = useState(() => businessDateOf(new Date()));
  const [date, setDate] = useState(today);

  return (
    <NavGate path="">
      <PageHeader
        title={t("nav.dashboard")}
        description={t("dashboard.description")}
        actions={<DateBar date={date} today={today} onChange={setDate} />}
      />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <p className="flex items-center gap-2 text-base font-semibold">
          <Icon name="calendar" className="size-4 text-text-muted" />
          {formatBusinessDate(date)}
        </p>
        {date === today ? (
          <span className="rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-medium text-brand">
            {t("dashboard.isToday")}
          </span>
        ) : null}
      </div>
      {date > today ? (
        <StatePanel title={t("dashboard.futureDate")} />
      ) : (
        <DailyReport companyId={company.id} date={date} />
      )}
    </NavGate>
  );
}
