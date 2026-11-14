import {
  dashboardSummarySchema,
  masterMonthSchema,
  masterSummarySchema,
  monthSchema,
  type DashboardSummary,
  type MasterMonth,
  type MasterSummary,
} from "@bsd/contracts";
import { sumAmounts } from "@bsd/domain";
import { loadCompanyAccess, requireSuperAdmin, requireSuperAdminView } from "./access";
import type { AppContext } from "./context";
import { dashboardOf } from "./daily";
import { AppError, invalid } from "./errors";
import { closeMonth, monthCloseState, reopenMonth } from "./month";
import { parseReportRange } from "./report-range";

/**
 * The master panel (D66): the all-company dashboard and closing a month for every company and
 * the master together. Super-admin only; every figure is a company's engine output, summed.
 */

async function requireMaster(ctx: AppContext, companyId: string) {
  requireSuperAdminView(ctx);
  const access = await loadCompanyAccess(ctx, companyId);
  if (!access.company.isMaster) throw new AppError("COMPANY_NOT_FOUND");
  return access;
}

/** The tenant's active companies (not the master), by name. */
async function companiesOf(ctx: AppContext) {
  return ctx.db.company.findMany({
    where: { tenantId: ctx.actor.tenantId, isMaster: false, status: "active" },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

const SUMMED = [
  "netSales",
  "salesCash",
  "oldDuesCollected",
  "cashCollected",
  "marketDueCreated",
  "marketDueOpening",
  "marketDueOutstanding",
  "issuedValue",
  "returnValue",
  "commission",
  "damageSaleValue",
  "handoverShort",
  "totalSales",
] as const;

const SUMMED_OPTIONAL = [
  "expenses",
  "staffShortage",
  "staffCost",
  "srCost",
  "totalCost",
  "profitCost",
  "cashInHand",
  "salesProfit",
  "netProfit",
  "damageValue",
  "undeliveredValue",
  "grossProfit",
  "receivedValue",
  "stockValue",
] as const;

/** Every summary figure summed; the master's own (its expenses and staff money) included. */
function totalOf(range: { from: string; to: string }, parts: DashboardSummary[]): DashboardSummary {
  const cutoffs = parts.flatMap((p) => (p.cutoffDate ? [p.cutoffDate] : [])).sort();
  const optional = Object.fromEntries(
    SUMMED_OPTIONAL.flatMap((key) =>
      parts.some((p) => p[key] !== undefined)
        ? [[key, sumAmounts(["0", ...parts.map((p) => p[key] ?? "0")])]]
        : [],
    ),
  );
  return dashboardSummarySchema.parse({
    from: range.from,
    to: range.to,
    cutoffDate: cutoffs[0] ?? null,
    ...Object.fromEntries(
      SUMMED.map((key) => [key, sumAmounts(["0", ...parts.map((p) => p[key])])]),
    ),
    ...optional,
    postedSummaryCount: parts.reduce((n, p) => n + p.postedSummaryCount, 0),
    postedReceiptCount: parts.reduce((n, p) => n + p.postedReceiptCount, 0),
    byDsr: [],
    damageLots: [],
  });
}

/** Every company's dashboard summary, their total and the business's profit and loss (D66). */
export async function getMasterSummary(
  ctx: AppContext,
  companyId: string,
  query: unknown,
): Promise<MasterSummary> {
  const master = await requireMaster(ctx, companyId);
  const range = parseReportRange(query);
  const companies = await companiesOf(ctx);
  // Read-only and independent per company, so they run together: the wait is the slowest company.
  const [own, ...results] = await Promise.all([
    dashboardOf(ctx, master, range),
    ...companies.map(async (company) => {
      const access = await loadCompanyAccess(ctx, company.id);
      return { company, ...(await dashboardOf(ctx, access, range)) };
    }),
  ]);
  const profits = results.flatMap((r) =>
    r.profit
      ? [
          {
            companyId: r.company.id,
            companyName: r.company.name,
            gross: r.profit.gross,
            salaries: r.profit.salaries,
            expenses: r.profit.expenses,
            srIncentive: r.profit.srIncentive,
            net: r.profit.net,
          },
        ]
      : [],
  );
  return masterSummarySchema.parse({
    from: range.from,
    to: range.to,
    companies: results.map((r) => ({
      companyId: r.company.id,
      companyName: r.company.name,
      summary: r.summary,
    })),
    total: totalOf(range, [...results.map((r) => r.summary), own.summary]),
    profit: own.profit
      ? {
          companies: profits,
          companiesNet: sumAmounts(["0", ...profits.map((p) => p.net)]),
          salaries: sumAmounts(["0", ...profits.map((p) => p.salaries), own.profit.salaries]),
          masterExpenses: own.profit.expenses,
          net: sumAmounts(["0", ...profits.map((p) => p.net), own.profit.net]),
        }
      : null,
  });
}

function parseMonth(value: unknown): string {
  const parsed = monthSchema.safeParse(value);
  if (!parsed.success) throw invalid("month", "validation.month.invalid");
  return parsed.data;
}

/** Each company's and the master's close state for the month (companies first, master last). */
export async function getMasterMonth(
  ctx: AppContext,
  companyId: string,
  monthInput: unknown,
): Promise<MasterMonth> {
  const master = await requireMaster(ctx, companyId);
  const month = parseMonth(monthInput);
  const all = [
    ...(await companiesOf(ctx)).map((c) => ({ ...c, isMaster: false })),
    { id: master.company.id, name: master.company.name, isMaster: true },
  ];
  const rows = await Promise.all(
    all.map(async (c) => {
      const state = await monthCloseState(ctx.db, c.id, month);
      return {
        companyId: c.id,
        companyName: c.name,
        isMaster: c.isMaster,
        status: state.status,
        closeBlockedBy: state.blocker,
      };
    }),
  );
  const live = rows.filter((r) => r.status === "open" || r.status === "closed");
  return masterMonthSchema.parse({
    month,
    companies: rows,
    canCloseAll:
      live.some((r) => r.status === "open") &&
      live.every((r) => r.status === "closed" || r.closeBlockedBy === null),
    canReopenAll: live.some((r) => r.status === "closed"),
  });
}

/**
 * Closes the month for every company, then the master (D66). Refused up front when any open one
 * is blocked, so the month never ends up closed for only some of them.
 */
export async function closeMonthAll(
  ctx: AppContext,
  companyId: string,
  monthInput: unknown,
  requestKey?: string,
): Promise<MasterMonth> {
  requireSuperAdmin(ctx);
  const view = await getMasterMonth(ctx, companyId, monthInput);
  const blocked = view.companies.find((c) => c.status === "open" && c.closeBlockedBy);
  if (blocked?.closeBlockedBy) throw invalid("month", blocked.closeBlockedBy);
  for (const c of view.companies.filter((r) => r.status === "open")) {
    await closeMonth(ctx, c.companyId, view.month, requestKey && `${requestKey}:${c.companyId}`);
  }
  return getMasterMonth(ctx, companyId, view.month);
}

/** Reopens the month for the master, then every company (the reverse order of closing). */
export async function reopenMonthAll(
  ctx: AppContext,
  companyId: string,
  monthInput: unknown,
  requestKey?: string,
): Promise<MasterMonth> {
  requireSuperAdmin(ctx);
  const view = await getMasterMonth(ctx, companyId, monthInput);
  for (const c of [...view.companies].reverse().filter((r) => r.status === "closed")) {
    await reopenMonth(ctx, c.companyId, view.month, requestKey && `${requestKey}:${c.companyId}`);
  }
  return getMasterMonth(ctx, companyId, view.month);
}
