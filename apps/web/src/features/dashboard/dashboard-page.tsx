"use client";

import { ReportExportButtons, useReportDownload } from "@/features/reports/report-export";
import { canViewReport, type DayView, type ReportId, type ReportRange } from "@bsd/contracts";
import { Decimal } from "@bsd/domain";
import {
  t,
  type TranslationKey,
  toBengaliDigits,
  formatBusinessDate,
  formatCount,
  formatMonth,
} from "@bsd/i18n";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { ButtonLink } from "@/components/button";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { CardGridSkeleton, StatsSkeleton, TableSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { StatTile } from "@/components/stat-tile";
import { errorCodeOf } from "@/data/ports/service-error";
import { useDashboardSummary } from "@/data/queries";
import { SetupBanner, useSetupNext } from "@/features/administration/setup-next";
import { DayGate } from "@/features/daily/daily-kit";
import { money } from "@/components/data-table";
import { ReportBody } from "@/features/reports/report-view";
import {
  companyHref,
  findNavEntry,
  navAccess,
  visibleHubs,
  type VisibleTab,
} from "@/features/shell/navigation";
import { NavGate } from "@/features/shell/nav-gate";
import { PageWarnings } from "@/features/shell/notifications";
import { PrintButton, PrintHeader } from "@/features/shell/print";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { useToday } from "@/lib/today";
import {
  earlierMonths,
  parsePeriod,
  periodParam,
  periodRange,
  periodYears,
  type Period,
} from "./period";

const nonZero = (value: string) => !new Decimal(value).isZero();
const sum = (values: string[]) =>
  values.reduce((total, v) => total.plus(v), new Decimal(0)).toString();

// ---------------------------------------------------------------- the period filter

const pillClass = (active: boolean) =>
  `inline-flex min-h-(--touch-target) items-center justify-center rounded-lg border px-4 text-sm font-medium transition-colors ${
    active
      ? "border-brand bg-brand font-semibold text-brand-foreground shadow-card"
      : "border-border bg-surface text-text shadow-card hover:border-border-strong hover:bg-surface-hover"
  }`;

function PeriodSelect({
  label,
  active,
  value,
  options,
  onPick,
}: {
  label: string;
  active: boolean;
  value: string;
  options: { value: string; label: string }[];
  onPick: (value: string) => void;
}) {
  if (options.length === 0) return null;
  return (
    <select
      aria-label={label}
      value={active ? value : ""}
      onChange={(event) => event.target.value && onPick(event.target.value)}
      className={`${pillClass(active)} cursor-pointer`}
    >
      <option value="" disabled>
        {label}
      </option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/** Today | this month | last month | an earlier month | a year; the choice lives in the URL. */
function PeriodBar({
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
      <PeriodSelect
        label={t("dashboard.period.earlierMonth")}
        active={period.kind === "month"}
        value={period.kind === "month" ? period.month : ""}
        options={earlierMonths(cutoffDate, today).map((month) => ({
          value: month,
          label: formatMonth(month),
        }))}
        onPick={(month) => onChange({ kind: "month", month })}
      />
      <PeriodSelect
        label={t("dashboard.period.year")}
        active={period.kind === "year"}
        value={period.kind === "year" ? period.year : ""}
        options={periodYears(cutoffDate, today).map((year) => ({
          value: year,
          label: toBengaliDigits(year),
        }))}
        onPick={(year) => onChange({ kind: "year", year })}
      />
    </div>
  );
}

// ---------------------------------------------------------------- the summary

function Summary({ range }: { range: ReportRange }) {
  const { company } = useCurrentWorkspace();
  const summary = useDashboardSummary(company.id, range);
  if (summary.isPending || summary.isPlaceholderData) return <StatsSkeleton count={8} />;
  if (summary.isError) {
    return <QueryError error={summary.error} onRetry={() => void summary.refetch()} />;
  }
  const d = summary.data;
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatTile label={t("dashboard.netSales")} value={money(d.netSales)} emphasis />
      {d.grossProfit !== undefined ? (
        <StatTile label={t("dashboard.grossProfit")} value={money(d.grossProfit)} />
      ) : null}
      <StatTile label={t("dashboard.cashCollected")} value={money(d.cashCollected)} emphasis />
      <StatTile label={t("dashboard.marketDueCreated")} value={money(d.marketDueCreated)} />
      <StatTile label={t("dashboard.oldDuesCollected")} value={money(d.oldDuesCollected)} />
      <StatTile
        label={t("dashboard.marketDueOutstanding")}
        value={money(d.marketDueOutstanding)}
        emphasis
      />
      {d.receivedValue !== undefined ? (
        <StatTile label={t("dashboard.receivedValue")} value={money(d.receivedValue)} />
      ) : null}
      {d.stockValue !== undefined ? (
        <StatTile
          label={t("dashboard.stockValue")}
          value={money(d.stockValue)}
          hint={t("dashboard.stockValueHint")}
        />
      ) : null}
    </dl>
  );
}

// ---------------------------------------------------------------- today's work

/** The day's entry screens in work order (a day block of the workbook). */
const DAILY_ENTRY_PATHS = [
  "sales/daily-summaries",
  "purchases/receipts",
  "sales/old-dues-collection",
  "finance/expenses",
  "dsr/settlements",
  "finance/supplier-deposits",
  "purchases/orders",
  "inventory/damage",
] as const;

type Status = { done: boolean; detail: string } | null;

/** What the day view already holds for each daily entry screen; null = nothing to show. */
function entryStatus(path: string, view: DayView): Status {
  const products = (field: "received" | "ordered" | "damaged") =>
    view.products.filter((p) => nonZero(p[field]));
  switch (path) {
    case "sales/daily-summaries": {
      const dsrs = new Set(view.persons.filter((p) => nonZero(p.issued)).map((p) => p.staffId));
      return {
        done: dsrs.size > 0,
        detail: `${formatCount(dsrs.size)} ${t("dashboard.work.dsrCount")} · ${money(view.money.sales)}`,
      };
    }
    case "purchases/receipts": {
      const rows = products("received");
      return {
        done: rows.length > 0,
        detail: `${formatCount(rows.length)} ${t("dashboard.work.productCount")} · ${money(sum(rows.map((r) => r.receiptBill)))}`,
      };
    }
    case "purchases/orders": {
      const rows = products("ordered");
      return {
        done: rows.length > 0,
        detail: `${formatCount(rows.length)} ${t("dashboard.work.productCount")} · ${money(sum(rows.map((r) => r.orderValue)))}`,
      };
    }
    case "inventory/damage": {
      const rows = products("damaged");
      return {
        done: rows.length > 0,
        detail: `${formatCount(rows.length)} ${t("dashboard.work.productCount")}`,
      };
    }
    case "sales/old-dues-collection":
      return {
        done: nonZero(view.money.marketDueNew) || nonZero(view.money.marketDueCollected),
        detail: `${t("day.money.marketDueCollected")} ${money(view.money.marketDueCollected)}`,
      };
    case "finance/expenses":
      return { done: nonZero(view.money.expenses), detail: money(view.money.expenses) };
    case "finance/supplier-deposits":
      return { done: nonZero(view.money.banked), detail: money(view.money.banked) };
    default:
      return null;
  }
}

/**
 * The day's entry screens, each with what is already entered for today, so the day can be
 * finished top to bottom like a day block in the workbook.
 */
function WorkChecklist({ view, links }: { view: DayView; links: VisibleTab[] }) {
  const { company } = useCurrentWorkspace();
  const rows = links.map((link) => ({ link, status: entryStatus(link.path, view) }));
  const tracked = rows.filter((r) => r.status);
  const done = tracked.filter((r) => r.status?.done).length;

  return (
    <>
      <p className="-mt-2 mb-3 text-xs text-text-muted">
        {formatCount(done)}/{formatCount(tracked.length)} {t("dashboard.work.progress")}
      </p>
      <PageWarnings warnings={view.warnings} />
      <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {rows.map(({ link, status }, index) => (
          <li key={link.path}>
            <Link
              href={companyHref(company.id, link.path)}
              className={`group flex h-full flex-col gap-2 rounded-xl border bg-surface p-3.5 shadow-card transition-colors hover:border-brand/40 ${
                status?.done ? "border-success/30" : "border-border"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span
                  aria-hidden
                  className={`grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold ${
                    status?.done ? "bg-success text-surface" : "bg-surface-muted text-text-muted"
                  }`}
                >
                  {status?.done ? <Icon name="check" className="size-4" /> : formatCount(index + 1)}
                </span>
                <span className="min-w-0 flex-1 text-sm leading-snug font-medium">
                  {t(link.labelKey)}
                </span>
                <Icon
                  name="arrowRight"
                  className="size-4 text-text-subtle transition-colors group-hover:text-brand"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2 pl-9.5 text-xs">
                {status ? (
                  <span className={status.done ? "text-success" : "text-text-muted"}>
                    {status.done ? t("dashboard.work.done") : t("dashboard.work.pending")}
                  </span>
                ) : null}
                {status?.done ? (
                  <span className="text-text-muted tabular-nums">{status.detail}</span>
                ) : null}
              </div>
            </Link>
          </li>
        ))}
      </ol>
    </>
  );
}

function TodaysWork({ today }: { today: string }) {
  const workspace = useCurrentWorkspace();
  const tabs = visibleHubs(workspace).flatMap((hub) => hub.tabs);
  const links = DAILY_ENTRY_PATHS.flatMap((path) => {
    const entry = findNavEntry(path);
    if (!entry || navAccess(workspace, entry.section, entry.item) !== "ok") return [];
    return [tabs.find((tab) => tab.path === path) ?? { path, labelKey: entry.item.labelKey }];
  });
  if (links.length === 0) return null;
  return (
    <DayGate
      companyId={workspace.company.id}
      date={today}
      skeleton={<CardGridSkeleton count={links.length} />}
    >
      {(view) => (
        <Section title={t("dashboard.work.title")}>
          <WorkChecklist view={view} links={links} />
        </Section>
      )}
    </DayGate>
  );
}

// ---------------------------------------------------------------- report sections

function Section({
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

type ReportSectionSpec = {
  id: string;
  titleKey: TranslationKey;
  reports: readonly ReportId[];
  defaultOpen: boolean;
};

/** Report sections in priority order; the closed ones fetch only once opened. */
const REPORT_SECTIONS: readonly ReportSectionSpec[] = [
  {
    id: "dsr",
    titleKey: "dashboard.section.byDsr",
    reports: ["dsr-daily", "person-sales"],
    defaultOpen: true,
  },
  {
    id: "salesProfit",
    titleKey: "dashboard.section.salesProfit",
    reports: ["sales", "profit"],
    defaultOpen: true,
  },
  { id: "cash", titleKey: "dashboard.section.cash", reports: ["daily-cash"], defaultOpen: false },
  {
    id: "stock",
    titleKey: "dashboard.section.stock",
    reports: ["stock", "cartons"],
    defaultOpen: false,
  },
  {
    id: "marketDue",
    titleKey: "dashboard.section.marketDue",
    reports: ["market-due"],
    defaultOpen: false,
  },
  {
    id: "company",
    titleKey: "dashboard.section.company",
    reports: ["company-due", "company-account"],
    defaultOpen: false,
  },
  { id: "damage", titleKey: "dashboard.section.damage", reports: ["damage"], defaultOpen: false },
  {
    id: "staff",
    titleKey: "dashboard.section.staff",
    reports: ["staff-balances"],
    defaultOpen: false,
  },
];

function ReportSections({ range }: { range: ReportRange }) {
  const { company, permissions } = useCurrentWorkspace();
  const canExport = permissions.includes("report.export");
  const allowed = (id: ReportId) => canViewReport(id, permissions);
  return (
    <>
      {REPORT_SECTIONS.map((spec) => {
        const reports = spec.reports.filter(allowed);
        if (reports.length === 0) return null;
        return (
          <Section
            key={spec.id}
            title={t(spec.titleKey)}
            collapsible
            defaultOpen={spec.defaultOpen}
          >
            {reports.map((id) => (
              <div key={id} className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {reports.length > 1 ? (
                    <h3 className="text-sm font-semibold text-text-muted">
                      {t(`report.name.${id}` as TranslationKey)}
                    </h3>
                  ) : (
                    <span />
                  )}
                  {canExport ? (
                    <ExportButtons companyId={company.id} report={id} range={range} />
                  ) : null}
                </div>
                <ReportBody companyId={company.id} report={id} range={range} />
              </div>
            ))}
          </Section>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------- the page

function RangeHeading({ range, isToday }: { range: ReportRange; isToday: boolean }) {
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
 * Everything below the period filter: the summary, today's work (today only) and the reports.
 * Explains why there is nothing when no opening is live or the period lies before its cutoff.
 */
function DashboardBody({ range, isToday }: { range: ReportRange; isToday: boolean }) {
  const { company, permissions } = useCurrentWorkspace();
  const summary = useDashboardSummary(company.id, range);
  const next = useSetupNext();
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
        action={next ? <ButtonLink href={next.href}>{t(next.label)}</ButtonLink> : undefined}
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
        <Summary range={range} />
      </Section>
      {isToday ? <TodaysWork today={range.to} /> : null}
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
  // The opening cutoff comes with the summary and bounds the month and year choices.
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
      <SetupBanner />
      <PeriodBar period={period} cutoffDate={cutoff} today={today} onChange={choose} />
      <RangeHeading range={range} isToday={period.kind === "today"} />
      <DashboardBody range={range} isToday={period.kind === "today"} />
    </NavGate>
  );
}
