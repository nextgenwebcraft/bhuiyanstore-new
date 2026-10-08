import { resourceIds, type ResourceId } from "@bsd/architecture";

const companyResource = (actorId: string, companyId: string, resource: ResourceId) =>
  [...queryKeys.companyScope(actorId, companyId), resource] as const;

/**
 * The single query-key factory (guide section 21.7). Every key is scoped by actor and, for
 * company data, by company, so a late response or cached entry can never surface in another
 * user's or company's workspace.
 */
export const queryKeys = {
  actor: (actorId: string) => ["actor", actorId] as const,
  workspaces: (actorId: string) =>
    [...queryKeys.actor(actorId), resourceIds.companyWorkspace] as const,
  companyScope: (actorId: string, companyId: string) =>
    [...queryKeys.actor(actorId), "company", companyId] as const,
  workspace: (actorId: string, companyId: string) =>
    companyResource(actorId, companyId, resourceIds.companyWorkspace),
  products: (actorId: string, companyId: string) =>
    companyResource(actorId, companyId, resourceIds.product),
  staff: (actorId: string, companyId: string) =>
    companyResource(actorId, companyId, resourceIds.staffMember),
  dashboardSummary: (actorId: string, companyId: string, date: string) =>
    [...companyResource(actorId, companyId, resourceIds.dashboardSummary), date] as const,
  productHistory: (actorId: string, companyId: string, productId: string) =>
    [...companyResource(actorId, companyId, resourceIds.productHistory), productId] as const,
  staffRecords: (actorId: string, companyId: string) =>
    companyResource(actorId, companyId, resourceIds.staffRecord),
  opening: (actorId: string, companyId: string) =>
    companyResource(actorId, companyId, resourceIds.opening),
  dayView: (actorId: string, companyId: string, date: string) =>
    [...companyResource(actorId, companyId, resourceIds.ledger), "day", date] as const,
  stockEntries: (actorId: string, companyId: string, date: string) =>
    [...companyResource(actorId, companyId, resourceIds.stockEntry), date] as const,
  dsrDays: (actorId: string, companyId: string, date: string) =>
    [...companyResource(actorId, companyId, resourceIds.dsrDay), date] as const,
  moneyEntries: (actorId: string, companyId: string, from: string, to: string, staffId: string) =>
    [...companyResource(actorId, companyId, resourceIds.moneyEntry), from, to, staffId] as const,
  monthView: (actorId: string, companyId: string, month: string) =>
    [...companyResource(actorId, companyId, resourceIds.ledger), "month", month] as const,
  report: (actorId: string, companyId: string, report: string, from: string, to: string) =>
    [
      ...companyResource(actorId, companyId, resourceIds.ledger),
      "report",
      report,
      from,
      to,
    ] as const,
  staffAccounts: (actorId: string, companyId: string, kind: string, date: string) =>
    [...companyResource(actorId, companyId, resourceIds.ledger), "accounts", kind, date] as const,
  staffStatement: (actorId: string, companyId: string, staffId: string, from: string, to: string) =>
    [
      ...companyResource(actorId, companyId, resourceIds.ledger),
      "statement",
      staffId,
      from,
      to,
    ] as const,
  payrollRun: (actorId: string, companyId: string, month: string) =>
    [...companyResource(actorId, companyId, resourceIds.payrollRun), month] as const,
  damageCases: (
    actorId: string,
    companyId: string,
    filter: { status?: string; from?: string; to?: string },
  ) =>
    [
      ...companyResource(actorId, companyId, resourceIds.damageCase),
      filter.status ?? "all",
      filter.from ?? "",
      filter.to ?? "",
    ] as const,
  importJobs: (actorId: string, companyId: string) =>
    [...companyResource(actorId, companyId, resourceIds.importJob), "list"] as const,
  importJob: (actorId: string, companyId: string, jobId: string) =>
    [...companyResource(actorId, companyId, resourceIds.importJob), "job", jobId] as const,
  /** Tenant-level lists and administration are scoped by actor only. */
  tenant: (actorId: string, resource: ResourceId) =>
    [...queryKeys.actor(actorId), "tenant", resource] as const,
};

/**
 * Resources each posting command writes (guide 21.4 "downstream resource invalidations"). One
 * owner, so a screen cannot forget to refresh a dependent view after posting. Every posting
 * changes the engine output, so the ledger and dashboard always refresh.
 */
export const postingEffects = {
  stock: [
    resourceIds.stockEntry,
    resourceIds.productHistory,
    resourceIds.ledger,
    resourceIds.dashboardSummary,
  ],
  dsrDay: [resourceIds.dsrDay, resourceIds.ledger, resourceIds.dashboardSummary],
  money: [
    resourceIds.moneyEntry,
    resourceIds.payrollRun,
    resourceIds.ledger,
    resourceIds.dashboardSummary,
  ],
  payroll: [
    resourceIds.payrollRun,
    resourceIds.moneyEntry,
    resourceIds.ledger,
    resourceIds.dashboardSummary,
  ],
  damage: [resourceIds.damageCase, resourceIds.ledger, resourceIds.dashboardSummary],
  monthClose: [resourceIds.ledger, resourceIds.payrollRun],
  /** A committed import posts a whole month (or rewrites the draft opening) and closes it. */
  importCommit: [
    resourceIds.importJob,
    resourceIds.stockEntry,
    resourceIds.dsrDay,
    resourceIds.moneyEntry,
    resourceIds.productHistory,
    resourceIds.opening,
    resourceIds.payrollRun,
    resourceIds.ledger,
    resourceIds.dashboardSummary,
  ],
} as const satisfies Record<string, readonly ResourceId[]>;

export function resourceKey(actorId: string, companyId: string, resource: ResourceId) {
  return companyResource(actorId, companyId, resource);
}
