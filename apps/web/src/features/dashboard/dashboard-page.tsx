"use client";

import type { DashboardSummary, DayView } from "@bsd/contracts";
import { businessDateOf, Decimal } from "@bsd/domain";
import { formatAmount, formatBusinessDate, t, toBengaliDigits } from "@bsd/i18n";
import Link from "next/link";
import { Icon, type IconName } from "@/components/icons";
import { PageHeader } from "@/components/page-header";
import { QueryError } from "@/components/query-error";
import { CardGridSkeleton, StatsSkeleton, TableSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { StatTile } from "@/components/stat-tile";
import { TableScroller } from "@/components/table-scroller";
import { errorCodeOf } from "@/data/ports/service-error";
import { useDashboardSummary } from "@/data/queries";
import { DateBar, DayGate, money, useWorkingDate } from "@/features/daily/daily-kit";
import {
  companyHref,
  findNavEntry,
  navAccess,
  visibleFlow,
  type FlowLink,
} from "@/features/shell/navigation";
import { NavGate } from "@/features/shell/nav-gate";
import { PageWarnings } from "@/features/shell/notifications";
import { ShortcutHint } from "@/features/shell/side-nav";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";

const amount = formatAmount;
const count = (value: number) => toBengaliDigits(String(value));

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
        <TableScroller>
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
        </TableScroller>
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
      <div className="flex flex-col gap-8">
        <StatsSkeleton count={3} title />
        <StatsSkeleton count={3} title />
        <StatsSkeleton count={3} title />
        <TableSkeleton rows={4} title />
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
    <div className="flex flex-col gap-8">
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

type Status = { done: boolean; detail: string } | null;

const nonZero = (value: string) => !new Decimal(value).isZero();
const sum = (values: string[]) =>
  values.reduce((total, v) => total.plus(v), new Decimal(0)).toString();

/** What the day view already holds for each daily entry screen; null = nothing to show. */
function entryStatus(path: string, view: DayView): Status {
  const products = (field: "received" | "ordered" | "damaged") =>
    view.products.filter((p) => nonZero(p[field]));
  switch (path) {
    case "sales/daily-summaries": {
      const dsrs = new Set(view.persons.filter((p) => nonZero(p.issued)).map((p) => p.staffId));
      return {
        done: dsrs.size > 0,
        detail: `${count(dsrs.size)} ${t("dashboard.work.dsrCount")} · ${money(view.money.sales)}`,
      };
    }
    case "purchases/receipts": {
      const rows = products("received");
      return {
        done: rows.length > 0,
        detail: `${count(rows.length)} ${t("dashboard.work.productCount")} · ${money(sum(rows.map((r) => r.receiptBill)))}`,
      };
    }
    case "purchases/orders": {
      const rows = products("ordered");
      return {
        done: rows.length > 0,
        detail: `${count(rows.length)} ${t("dashboard.work.productCount")} · ${money(sum(rows.map((r) => r.orderValue)))}`,
      };
    }
    case "inventory/damage": {
      const rows = products("damaged");
      return {
        done: rows.length > 0,
        detail: `${count(rows.length)} ${t("dashboard.work.productCount")}`,
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
 * The day's entry screens in work order, each with what is already entered for the working
 * date, so the day can be finished top to bottom like a day block in the workbook.
 */
function WorkChecklist({ view, links }: { view: DayView; links: FlowLink[] }) {
  const { company } = useCurrentWorkspace();
  const rows = links.map((link) => ({ link, status: entryStatus(link.path, view) }));
  const tracked = rows.filter((r) => r.status);
  const done = tracked.filter((r) => r.status?.done).length;

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">{t("dashboard.work.title")}</h2>
        <p className="text-xs text-text-muted">
          {count(done)}/{count(tracked.length)} {t("dashboard.work.progress")}
        </p>
      </div>
      <PageWarnings warnings={view.warnings} />
      <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {rows.map(({ link, status }) => (
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
                  {status?.done ? (
                    <Icon name="check" className="size-4" />
                  ) : (
                    count(link.shortcut ?? 0)
                  )}
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
                {link.shortcut ? <ShortcutHint n={link.shortcut} /> : null}
              </div>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function DashboardPage() {
  const workspace = useCurrentWorkspace();
  const { company } = workspace;
  const [date, setDate] = useWorkingDate();
  const today = businessDateOf(new Date());
  const daily = visibleFlow(workspace).find((g) => g.id === "daily")?.links ?? [];

  return (
    <NavGate path="">
      <PageHeader
        title={t("nav.dashboard")}
        description={t("dashboard.description")}
        actions={<DateBar date={date} onChange={setDate} id="dashboard-date" />}
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
        <div className="flex flex-col gap-10">
          {daily.length > 0 ? (
            <DayGate
              companyId={company.id}
              date={date}
              skeleton={<CardGridSkeleton count={daily.length} />}
            >
              {(view) => <WorkChecklist view={view} links={daily} />}
            </DayGate>
          ) : null}
          <section>
            <h2 className="mb-4 text-base font-semibold">{t("dashboard.figures")}</h2>
            <DailyReport companyId={company.id} date={date} />
          </section>
        </div>
      )}
    </NavGate>
  );
}
