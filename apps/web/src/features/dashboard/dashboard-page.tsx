"use client";

import { ReportExportButtons, useReportDownload } from "@/features/reports/report-export";
import {
  canViewReport,
  type DashboardSummary,
  type DsrDayRow,
  type ReportId,
  type ReportRange,
} from "@bsd/contracts";
import { Decimal } from "@bsd/domain";
import { t, type TranslationKey, formatBusinessDate, formatRate } from "@bsd/i18n";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import {
  money,
  quantity,
  stickyCell,
  stickyHead,
  tableClass,
  tdClass,
  tdNum,
  thClass,
  thNum,
  theadClass,
} from "@/components/data-table";
import { DateRangePicker } from "@/components/date-picker";
import { Icon } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { StatsSkeleton, TableSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { StatTile, type StatTone } from "@/components/stat-tile";
import { TableScroller } from "@/components/table-scroller";
import { errorCodeOf } from "@/data/ports/service-error";
import { useApproveDsrHandoversForRange, useDashboardSummary } from "@/data/queries";
import { useStaffRowActions } from "@/features/accounts/staff-dialogs";
import { ReportBody, SalesProfitBody } from "@/features/reports/report-view";
import { companyHref } from "@/features/shell/navigation";
import { NavGate } from "@/features/shell/nav-gate";
import { PrintButton, PrintHeader } from "@/features/shell/print";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { DashboardTargetStrip } from "@/features/targets/dashboard-targets";
import { useToday } from "@/lib/today";
import { parsePeriod, periodForRange, periodParam, periodRange, type Period } from "./period";

const nonZero = (value: string) => !new Decimal(value).isZero();

// ---------------------------------------------------------------- the period filter

const pillClass = (active: boolean) =>
  `inline-flex min-h-(--touch-target) items-center justify-center rounded-lg border px-4 text-sm font-medium transition-colors ${
    active
      ? "border-brand bg-brand font-semibold text-brand-foreground shadow-card"
      : "border-border bg-surface text-text shadow-card hover:border-border-strong hover:bg-surface-hover"
  }`;

/** Today, this month, last month, then a calendar for one day or a range (D83). */
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
      className="flex flex-wrap items-center gap-2"
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
      <DateRangePicker
        value={periodRange(period, today)}
        min={cutoffDate ?? undefined}
        max={today}
        onChange={(range) => onChange(periodForRange(range.from, range.to, today))}
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
  /** Its step in the calculation chain: subtracted (−), added (+) or a result (=). */
  op?: "minus" | "plus" | "equals";
};

/**
 * D107, in formula order: মোট বিক্রি = মোট সামারি − মোট ফেরত; হাতে জমা = মোট বিক্রি − মোট ড্যামেজ −
 * মোট কমিশন − অপারেটিং খরচ − ডিএসআর খরচ − নতুন বকেয়া + বকেয়া জমা (domain `dashboardTotals`).
 * A card without permission is left out.
 */
export function chainCards(d: DashboardSummary): Card[] {
  return [
    { label: "dashboard.card.issued", value: d.issuedValue, tone: "info" },
    { label: "dashboard.card.returned", value: d.returnValue, op: "minus" },
    { label: "dashboard.card.totalSales", value: d.totalSales, op: "equals", tone: "result" },
    { label: "dashboard.card.damage", value: d.damageSaleValue, op: "minus" },
    { label: "dashboard.card.commission", value: d.commission, op: "minus" },
    { label: "dashboard.card.operating", value: d.expenses, op: "minus" },
    { label: "dashboard.card.staffCost", value: d.staffCost, op: "minus" },
    { label: "dashboard.card.newDue", value: d.marketDueCreated, op: "minus" },
    { label: "dashboard.card.dueCollected", value: d.oldDuesCollected, op: "plus" },
    { label: "dashboard.card.cashInHand", value: d.cashInHand, op: "equals", tone: "result" },
  ];
}

/**
 * Cards outside the cash chain. মোট প্রফিট − অপারেটিং − ডিএসআর খরচ = নিট প্রফিট (D69). The position
 * cards are dues, goods and what the SRs owe (D60, D67). Their figures are unchanged.
 */
export function summaryCards(d: DashboardSummary, singleDay: boolean): Card[] {
  return [
    { label: "dashboard.card.salesProfit", value: d.salesProfit, tone: "result" },
    { label: "dashboard.card.profitCost", value: d.profitCost, op: "minus", tone: "error" },
    { label: "dashboard.card.netProfit", value: d.netProfit, op: "equals", tone: "result" },
    ...(singleDay
      ? ([{ label: "dashboard.card.oldDue", value: d.marketDueOpening }] satisfies Card[])
      : []),
    { label: "dashboard.card.totalDue", value: d.marketDueOutstanding, tone: "warning" },
    { label: "dashboard.card.totalCost", value: d.totalCost, tone: "error" },
    { label: "dashboard.card.undelivered", value: d.undeliveredValue },
    { label: "dashboard.card.stock", value: d.stockValue, tone: "info" },
    { label: "dashboard.card.srCost", value: d.srCost, tone: "warning" },
    { label: "dashboard.card.handoverShort", value: d.handoverShort, tone: "warning" },
  ];
}

const OP_SIGN = { minus: "−", plus: "+", equals: "=" } as const;

/** D125: হাতে জমা — পেন্ডিং (orange ▾); options পেন্ডিং=red / অ্যাপ্রুভ=green; approved chip green. */
function CashInHandHandoverBadge({
  handover,
  onApproveHandover,
  approvePending,
}: {
  handover: NonNullable<DashboardSummary["cashInHandHandover"]>;
  onApproveHandover?: (() => void) | undefined;
  approvePending?: boolean | undefined;
}) {
  const [open, setOpen] = useState(false);
  if (handover.status === "none") return null;
  if (handover.status === "approved") {
    return (
      <div className="absolute right-2 top-2 z-10">
        <span className="rounded-md border border-success bg-success/15 px-2.5 py-1 text-sm font-semibold text-success">
          {t("dsr.handover.approved")}
        </span>
      </div>
    );
  }
  if (onApproveHandover) {
    return (
      <div className="absolute right-2 top-2 z-10">
        <button
          type="button"
          aria-expanded={open}
          aria-haspopup="listbox"
          disabled={approvePending}
          className="inline-flex items-center gap-1 rounded-md border border-warning/50 bg-warning/20 px-2.5 py-1 text-sm font-semibold text-warning"
          onClick={() => setOpen((v) => !v)}
          onBlur={() => {
            // Defer so option click can run first.
            window.setTimeout(() => setOpen(false), 120);
          }}
        >
          {t("dsr.handover.pending")}
          <Icon name="chevronDown" className="size-3.5 shrink-0 opacity-80" />
        </button>
        {open ? (
          <ul
            role="listbox"
            className="absolute end-0 mt-1 min-w-full overflow-hidden rounded-md border border-border bg-surface py-0.5 shadow-card"
          >
            <li role="option" aria-selected>
              <span className="block px-2.5 py-1.5 text-sm font-semibold text-error">
                {t("dsr.handover.pending")}
              </span>
            </li>
            <li role="option">
              <button
                type="button"
                className="block w-full px-2.5 py-1.5 text-left text-sm font-semibold text-success hover:bg-success/10"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setOpen(false);
                  onApproveHandover();
                }}
              >
                {t("dsr.handover.approveSuperAdmin")}
              </button>
            </li>
          </ul>
        ) : null}
      </div>
    );
  }
  return (
    <div className="absolute right-2 top-2 z-10">
      <span className="rounded-md border border-warning/50 bg-warning/20 px-2.5 py-1 text-sm font-semibold text-warning">
        {t("dsr.handover.pending")}
      </span>
    </div>
  );
}

export function SummaryCards({
  cards,
  columns = 4,
  handover,
  onApproveHandover,
  approvePending,
}: {
  cards: Card[];
  columns?: 4 | 5;
  handover?: DashboardSummary["cashInHandHandover"];
  onApproveHandover?: () => void;
  approvePending?: boolean;
}) {
  return (
    <dl
      className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${columns === 5 ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}
    >
      {cards.flatMap((card) =>
        card.value === undefined
          ? []
          : [
              <div
                key={card.label}
                className={`relative flex flex-col gap-1 ${
                  card.label === "dashboard.card.cashInHand" && handover?.status === "pending"
                    ? "[&>div]:border-error"
                    : card.label === "dashboard.card.cashInHand" &&
                        handover?.status === "approved"
                      ? "[&>div]:border-success"
                      : ""
                }`}
              >
                <StatTile
                  label={card.op ? `${OP_SIGN[card.op]} ${t(card.label)}` : t(card.label)}
                  value={money(card.value)}
                  tone={
                    card.tone === "result"
                      ? card.value.trim().startsWith("-")
                        ? "error"
                        : "success"
                      : card.tone
                  }
                />
                {card.label === "dashboard.card.cashInHand" && handover ? (
                  <CashInHandHandoverBadge
                    handover={handover}
                    {...(onApproveHandover ? { onApproveHandover } : {})}
                    {...(approvePending !== undefined ? { approvePending } : {})}
                  />
                ) : null}
              </div>,
            ],
      )}
    </dl>
  );
}

/** The chain, then the other cards (D67). */
export function SummaryGroups({
  d,
  singleDay,
  onApproveHandover,
  approvePending,
}: {
  d: DashboardSummary;
  singleDay: boolean;
  onApproveHandover?: () => void;
  approvePending?: boolean;
}) {
  return (
    <>
      <SummaryCards
        cards={chainCards(d)}
        columns={5}
        {...(d.cashInHandHandover ? { handover: d.cashInHandHandover } : {})}
        {...(onApproveHandover ? { onApproveHandover } : {})}
        {...(approvePending !== undefined ? { approvePending } : {})}
      />
      <SummaryCards cards={summaryCards(d, singleDay)} columns={5} />
    </>
  );
}

/**
 * DSR-wise sales: সামারি, ফেরত and মোট বিক্রি (সামারি − ফেরত, D107), then ড্যামেজ, কমিশন and
 * মোট প্রফিট. One row per DSR. Follows the page's own period filter.
 */
export function ByDsrTable({ rows }: { rows: DsrDayRow[] }) {
  if (rows.length === 0) return null;
  const showProfit = rows.every((r) => r.salesProfit !== undefined);
  return (
    <TableScroller>
      <table className={tableClass}>
        <thead className={theadClass}>
          <tr>
            <th scope="col" className={`${thClass} ${stickyHead}`}>
              {t("staffCash.dsr")}
            </th>
            <th scope="col" className={thNum}>
              {t("dashboard.card.issued")}
            </th>
            <th scope="col" className={thNum}>
              {t("dashboard.card.returned")}
            </th>
            <th scope="col" className={thNum}>
              {t("dashboard.card.totalSales")}
            </th>
            <th scope="col" className={thNum}>
              {t("dashboard.card.damage")}
            </th>
            <th scope="col" className={thNum}>
              {t("dashboard.card.commission")}
            </th>
            {showProfit ? (
              <th scope="col" className={thNum}>
                {t("dashboard.card.salesProfit")}
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.dsrId} className="border-t border-border">
              <th scope="row" className={`${tdClass} ${stickyCell} text-left font-medium`}>
                {row.dsrName}
              </th>
              <td className={tdNum}>{money(row.issuedValue)}</td>
              <td className={tdNum}>{money(row.returnValue)}</td>
              <td className={`${tdNum} font-semibold`}>{money(row.totalSales)}</td>
              <td className={tdNum}>{money(row.damageSaleValue)}</td>
              <td className={tdNum}>{money(row.commission)}</td>
              {showProfit ? (
                <td className={`${tdNum} font-semibold`}>{money(row.salesProfit ?? "0")}</td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}

/** Damaged pieces still held, one row per product and rate (D109). */
export function DamageLotsTable({ rows }: { rows: DashboardSummary["damageLots"] }) {
  if (rows.length === 0)
    return <p className="text-sm text-text-muted">{t("dashboard.damageLots.empty")}</p>;
  return (
    <TableScroller>
      <table className={tableClass}>
        <thead className={theadClass}>
          <tr>
            <th scope="col" className={`${thClass} ${stickyHead}`}>
              {t("godown.column.product")}
            </th>
            <th scope="col" className={thNum}>
              {t("deposit.damage.rate")}
            </th>
            <th scope="col" className={thNum}>
              {t("godown.column.pieces")}
            </th>
            <th scope="col" className={thNum}>
              {t("common.amount")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.productId}|${row.rate}`} className="border-t border-border">
              <th scope="row" className={`${tdClass} ${stickyCell} text-left font-medium`}>
                {row.productName}
              </th>
              <td className={tdNum}>{formatRate(row.rate)}</td>
              <td className={tdNum}>{quantity(row.pieces)}</td>
              <td className={`${tdNum} font-semibold`}>{money(row.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
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
function ReportSections({
  range,
  dsrLimited = false,
  hidePayrollColumns = false,
}: {
  range: ReportRange;
  /** D112: DSR sees staff balances without salary/cashPabe/staffCost and without row actions. */
  dsrLimited?: boolean;
  /**
   * D127: Manager (and DSR) hide বেতন / ক্যাশ পাবে / ডিএসআর খরচ — payroll figures belong on
   * বেতন ও খরচ, which Manager cannot open (D119).
   */
  hidePayrollColumns?: boolean;
}) {
  const { company, permissions } = useCurrentWorkspace();
  const canExport = !dsrLimited && permissions.includes("report.export");
  const allowed = (id: ReportId) => canViewReport(id, permissions);
  const staffActions = useStaffRowActions();
  const hideStaffPayroll = dsrLimited || hidePayrollColumns;
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
            {...(hideStaffPayroll
              ? { hideColumns: ["salary", "cashPabe", "staffCost"] as const }
              : {})}
            rowActions={dsrLimited ? {} : { staffBalances: staffActions.rowAction }}
          />
          {dsrLimited ? null : staffActions.dialog}
        </Section>
      ) : null}
      {!dsrLimited && allowed("sales") ? (
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
  const { company, permissions, loginRoleKind } = useCurrentWorkspace();
  const confirm = useConfirm();
  const summary = useDashboardSummary(company.id, range);
  const approveHandovers = useApproveDsrHandoversForRange(company.id);
  const canReport = company.modules.includes("reports") && permissions.includes("report.view");
  const dsrLimited = loginRoleKind === "dsr";
  const managerLimited = loginRoleKind === "manager";
  const canApproveHandover =
    loginRoleKind === null && permissions.includes("sale.handover_approve");

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

  if (dsrLimited) {
    return (
      <div className="flex flex-col gap-6">
        <Section title={t("dashboard.section.damageLots")}>
          <DamageLotsTable rows={d.damageLots} />
        </Section>
        {canReport ? <ReportSections range={range} dsrLimited /> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {quiet ? (
        <StatePanel title={t("dashboard.noActivity")} hint={t("dashboard.noActivityHint")} />
      ) : null}
      <Section title={t("dashboard.section.summary")}>
        <SummaryGroups
          d={d}
          singleDay={range.from === range.to}
          {...(canApproveHandover
            ? {
                approvePending: approveHandovers.isPending,
                onApproveHandover: () =>
                  void (async () => {
                    const ok = await confirm({
                      message: t("dsr.handover.approveRangeConfirm"),
                      confirmLabel: t("dsr.handover.approveRange"),
                    });
                    if (!ok) return;
                    await approveHandovers.mutateAsync({ from: range.from, to: range.to });
                  })(),
              }
            : {})}
        />
      </Section>
      {d.byDsr.length > 0 ? (
        <Section title={t("dashboard.section.byDsr")}>
          <ByDsrTable rows={d.byDsr} />
        </Section>
      ) : null}
      <Section title={t("dashboard.section.damageLots")}>
        <DamageLotsTable rows={d.damageLots} />
      </Section>
      {canReport ? (
        <ReportSections range={range} hidePayrollColumns={managerLimited} />
      ) : null}
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
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between print:hidden">
        <PeriodBar period={period} cutoffDate={cutoff} today={today} onChange={choose} />
        <DashboardTargetStrip />
      </div>
      <RangeHeading range={range} isToday={period.kind === "today"} />
      <DashboardBody range={range} />
    </NavGate>
  );
}
