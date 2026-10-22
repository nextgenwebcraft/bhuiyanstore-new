"use client";

import { ReportExportButtons, useReportDownload } from "@/features/reports/report-export";
import {
  canViewReport,
  type DashboardSummary,
  type ReportId,
  type ReportRange,
} from "@bsd/contracts";
import { Decimal } from "@bsd/domain";
import { t, type TranslationKey, formatBusinessDate } from "@bsd/i18n";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { StatsSkeleton, TableSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { StatTile, type StatTone } from "@/components/stat-tile";
import { errorCodeOf } from "@/data/ports/service-error";
import { useDashboardSummary } from "@/data/queries";
import { money } from "@/components/data-table";
import { useStaffRowActions } from "@/features/accounts/staff-dialogs";
import { ReportBody, SalesProfitBody } from "@/features/reports/report-view";
import { companyHref } from "@/features/shell/navigation";
import { NavGate } from "@/features/shell/nav-gate";
import { PrintButton, PrintHeader } from "@/features/shell/print";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { useToday } from "@/lib/today";
import { parsePeriod, periodParam, periodRange, type Period } from "./period";
import { PeriodPicker } from "./period-picker";

const nonZero = (value: string) => !new Decimal(value).isZero();

// ---------------------------------------------------------------- the period filter

const pillClass = (active: boolean) =>
  `inline-flex min-h-(--touch-target) items-center justify-center rounded-lg border px-4 text-sm font-medium transition-colors ${
    active
      ? "border-brand bg-brand font-semibold text-brand-foreground shadow-card"
      : "border-border bg-surface text-text shadow-card hover:border-border-strong hover:bg-surface-hover"
  }`;

/** Today | this month | last month | any month or year (calendar picker); kept in the URL (D60). */
export function PeriodBar({
  period,
  cutoffDate,
  today,
  onChange,
}: {
  period: Period;
  cutoffDate: string | null;
  today: string;
  onChange: (period: Period) => void;
}) {
  const fixed: { kind: "today" | "this-month" | "last-month"; label: string }[] = [
    { kind: "today", label: t("dashboard.today") },
    { kind: "this-month", label: t("dashboard.period.thisMonth") },
    { kind: "last-month", label: t("dashboard.period.lastMonth") },
  ];
  return (
    <div
      role="group"
      aria-label={t("dashboard.period.label")}
      className="mb-5 flex flex-wrap items-center gap-2 print:hidden"
    >
      {fixed.map((item) => (
        <button
          key={item.kind}
          type="button"
          aria-pressed={period.kind === item.kind}
          onClick={() => onChange({ kind: item.kind })}
          className={pillClass(period.kind === item.kind)}
        >
          {item.label}
        </button>
      ))}
      <PeriodPicker
        period={period}
        cutoffDate={cutoffDate}
        today={today}
        onChange={onChange}
        active={period.kind === "month" || period.kind === "year"}
      />
    </div>
  );
}

// ---------------------------------------------------------------- the summary

type Card = {
  label: TranslationKey;
  value: string | undefined;
  /** Its colour; "result" is success when the value is 0 or more and error below. */
  tone?: StatTone | "result";
  /** Its step in the calculation chain: subtracted (−) or a result (=). */
  op?: "minus" | "equals";
};

/**
 * D69: মোট সামারি to ডিএসআর খরচ, and মোট বিক্রি = সামারি minus those five (D74); then মোট প্রফিট (from the DSR lines) − অপারেটিং
 * + ডিএসআর খরচ = নিট প্রফিট (domain `dashboardTotals`). A card without permission is left out.
 */
export function chainCards(d: DashboardSummary): Card[] {
  return [
    { label: "dashboard.card.issued", value: d.issuedValue, tone: "info" },
    { label: "dashboard.card.returned", value: d.returnValue },
    { label: "dashboard.card.damage", value: d.damageSaleValue },
    { label: "dashboard.card.commission", value: d.commission },
    { label: "dashboard.card.operating", value: d.expenses },
    { label: "dashboard.card.staffCost", value: d.staffCost },
    { label: "dashboard.card.totalSales", value: d.totalSales, op: "equals", tone: "result" },
    { label: "dashboard.card.salesProfit", value: d.salesProfit, tone: "result" },
    { label: "dashboard.card.profitCost", value: d.profitCost, op: "minus", tone: "error" },
    { label: "dashboard.card.netProfit", value: d.netProfit, op: "equals", tone: "result" },
  ];
}

/** The position cards beside the chain: dues, goods and what the SRs owe (D60, D67, D69). */
export function summaryCards(d: DashboardSummary, singleDay: boolean): Card[] {
  return [
    ...(singleDay
      ? ([
          { label: "dashboard.card.newDue", value: d.marketDueCreated },
          { label: "dashboard.card.oldDue", value: d.marketDueOpening },
        ] satisfies Card[])
      : []),
    { label: "dashboard.card.totalDue", value: d.marketDueOutstanding, tone: "warning" },
    { label: "dashboard.card.totalCost", value: d.totalCost, tone: "error" },
    { label: "dashboard.card.undelivered", value: d.undeliveredValue },
    { label: "dashboard.card.stock", value: d.stockValue, tone: "info" },
    { label: "dashboard.card.srCost", value: d.srCost, tone: "warning" },
  ];
}

const OP_SIGN = { minus: "−", equals: "=" } as const;

export function SummaryCards({ cards, columns = 4 }: { cards: Card[]; columns?: 4 | 5 }) {
  return (
    <dl
      className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${columns === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}
    >
      {cards.flatMap((card) =>
        card.value === undefined
          ? []
          : [
              <StatTile
                key={card.label}
                label={card.op ? `${OP_SIGN[card.op]} ${t(card.label)}` : t(card.label)}
                value={money(card.value)}
                tone={
                  card.tone === "result"
                    ? card.value.trim().startsWith("-")
                      ? "error"
                      : "success"
                    : card.tone
                }
              />,
            ],
      )}
    </dl>
  );
}

/** The chain, then the other cards (D67). */
export function SummaryGroups({ d, singleDay }: { d: DashboardSummary; singleDay: boolean }) {
  return (
    <>
      <SummaryCards cards={chainCards(d)} columns={5} />
      <SummaryCards cards={summaryCards(d, singleDay)} columns={5} />
    </>
  );
}

// ---------------------------------------------------------------- report sections

export function Section({
  title,
  collapsible = false,
  defaultOpen = true,
  children,
}: {
  title: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** Mounted only while open, so a closed section fetches nothing. */
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const expanded = !collapsible || open;
  return (
    <section className="rounded-xl border border-border bg-surface p-4 shadow-card sm:p-5">
      <h2 className="text-base font-semibold">
        {collapsible ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="flex w-full items-center gap-2 text-left"
          >
            <Icon
              name="chevronDown"
              className={`size-4 text-text-muted transition-transform ${open ? "" : "-rotate-90"}`}
            />
            {title}
          </button>
        ) : (
          title
        )}
      </h2>
      {expanded ? <div className="mt-4 flex flex-col gap-4">{children}</div> : null}
    </section>
  );
}

function ExportButtons({
  companyId,
  report,
  range,
}: {
  companyId: string;
  report: ReportId;
  range: ReportRange;
}) {
  const { exportAs, busy, error } = useReportDownload(companyId, report, range);

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      {error ? (
        <span role="alert" className="text-xs text-error">
          {error}
        </span>
      ) : null}
      <ReportExportButtons exportAs={exportAs} busy={busy} />
    </div>
  );
}

/** কর্মীর ব্যালান্স, then পণ্য অনুযায়ী বিক্রি ও লাভ (D60); the other report sections are gone. */
function ReportSections({ range }: { range: ReportRange }) {
  const { company, permissions } = useCurrentWorkspace();
  const canExport = permissions.includes("report.export");
  const allowed = (id: ReportId) => canViewReport(id, permissions);
  const staffActions = useStaffRowActions();
  return (
    <>
      {allowed("staff-balances") ? (
        <Section title={t("dashboard.section.staff")} collapsible>
          {canExport ? (
            <div className="flex justify-end">
              <ExportButtons companyId={company.id} report="staff-balances" range={range} />
            </div>
          ) : null}
          <ReportBody
            companyId={company.id}
            report="staff-balances"
            range={range}
            rowActions={{ staffBalances: staffActions.rowAction }}
          />
          {staffActions.dialog}
        </Section>
      ) : null}
      {allowed("sales") ? (
        <Section title={t("report.table.salesProfitByProduct")} collapsible>
          {canExport ? (
            <div className="flex justify-end">
              <ExportButtons companyId={company.id} report="sales" range={range} />
            </div>
          ) : null}
          <SalesProfitBody
            companyId={company.id}
            range={range}
            withProfit={allowed("profit")}
            productOnly
          />
        </Section>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------- the page

export function RangeHeading({ range, isToday }: { range: ReportRange; isToday: boolean }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3">
      <p className="flex items-center gap-2 text-base font-semibold">
        <Icon name="calendar" className="size-4 text-text-muted" />
        {range.from === range.to
          ? formatBusinessDate(range.from)
          : `${formatBusinessDate(range.from)} – ${formatBusinessDate(range.to)}`}
      </p>
      {isToday ? (
        <span className="rounded-full bg-brand/10 px-2.5 py-0.5 text-xs font-medium text-brand">
          {t("dashboard.isToday")}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Everything below the period filter: the summary and the reports. Explains why there is
 * nothing when no opening is live or the period lies before its cutoff.
 */
function DashboardBody({ range }: { range: ReportRange }) {
  const { company, permissions } = useCurrentWorkspace();
  const summary = useDashboardSummary(company.id, range);
  const canReport = company.modules.includes("reports") && permissions.includes("report.view");

  if (summary.isPending || summary.isPlaceholderData) {
    return (
      <div className="flex flex-col gap-6">
        <StatsSkeleton count={8} />
        <TableSkeleton rows={6} columns={6} title />
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
  if (!d.cutoffDate) {
    return (
      <StatePanel
        tone="warning"
        title={t("daily.noOpening.title")}
        hint={t("daily.noOpening.hint")}
      />
    );
  }
  if (range.to < d.cutoffDate) {
    return (
      <StatePanel
        tone="warning"
        title={t("daily.beforeCutoff.title")}
        hint={`${t("daily.beforeCutoff.hint")} ${formatBusinessDate(d.cutoffDate)}`}
      />
    );
  }
  const quiet =
    d.postedSummaryCount === 0 && d.postedReceiptCount === 0 && !nonZero(d.oldDuesCollected);

  return (
    <div className="flex flex-col gap-6">
      {quiet ? (
        <StatePanel title={t("dashboard.noActivity")} hint={t("dashboard.noActivityHint")} />
      ) : null}
      <Section title={t("dashboard.section.summary")}>
        <SummaryGroups d={d} singleDay={range.from === range.to} />
      </Section>
      {canReport ? <ReportSections range={range} /> : null}
    </div>
  );
}

export function DashboardPage() {
  const { company } = useCurrentWorkspace();
  const router = useRouter();
  const search = useSearchParams();
  const today = useToday();
  const period = parsePeriod(search.get("period"), today);
  const range = periodRange(period, today);
  // The opening cutoff comes with the summary and widens the picker's year list.
  const cutoff = useDashboardSummary(company.id, range).data?.cutoffDate ?? null;

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
        title={t("nav.dashboard")}
        description={t("dashboard.description")}
        actions={<PrintButton />}
      />
      <PrintHeader title={t("nav.dashboard")} from={range.from} to={range.to} />
      <PeriodBar period={period} cutoffDate={cutoff} today={today} onChange={choose} />
      <RangeHeading range={range} isToday={period.kind === "today"} />
      <DashboardBody range={range} />
    </NavGate>
  );
}
