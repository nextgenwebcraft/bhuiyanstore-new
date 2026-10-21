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
  dashboardSummary: (actorId: string, companyId: string, from: string, to: string) =>
    [...companyResource(actorId, companyId, resourceIds.dashboardSummary), from, to] as const,
  productHistory: (actorId: string, companyId: string, productId: string) =>
    [...companyResource(actorId, companyId, resourceIds.productHistory), productId] as const,
  staffRecords: (actorId: string, companyId: string) =>
    companyResource(actorId, companyId, resourceIds.staffRecord),
  shops: (actorId: string, companyId: string) =>
    companyResource(actorId, companyId, resourceIds.shop),
  shopStatement: (actorId: string, companyId: string, shopId: string, from: string, to: string) =>
    [
      ...companyResource(actorId, companyId, resourceIds.ledger),
      "shopStatement",
      shopId,
      from,
      to,
    ] as const,
  opening: (actorId: string, companyId: string) =>
    companyResource(actorId, companyId, resourceIds.opening),
  setupStatus: (actorId: string, companyId: string) =>
    companyResource(actorId, companyId, resourceIds.setupStatus),
  fieldDay: (actorId: string, companyId: string, date: string) =>
    [...companyResource(actorId, companyId, resourceIds.fieldDay), date] as const,
  dayView: (actorId: string, companyId: string, date: string) =>
    [...companyResource(actorId, companyId, resourceIds.ledger), "day", date] as const,
  stockEntries: (actorId: string, companyId: string, date: string) =>
    [...companyResource(actorId, companyId, resourceIds.stockEntry), date] as const,
  dsrDays: (actorId: string, companyId: string, date: string) =>
    [...companyResource(actorId, companyId, resourceIds.dsrDay), date] as const,
  moneyEntries: (
    actorId: string,
    companyId: string,
    from: string,
    to: string,
    staffId: string,
    shopId = "",
  ) =>
    [
      ...companyResource(actorId, companyId, resourceIds.moneyEntry),
      from,
      to,
      staffId,
      shopId,
    ] as const,
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
  masterSummary: (actorId: string, companyId: string, from: string, to: string) =>
    [
      ...companyResource(actorId, companyId, resourceIds.dashboardSummary),
      "master",
      from,
      to,
    ] as const,
  masterMonth: (actorId: string, companyId: string, month: string) =>
    [...companyResource(actorId, companyId, resourceIds.ledger), "masterMonth", month] as const,
  masterWorkspace: (actorId: string) =>
    [...queryKeys.actor(actorId), "master", resourceIds.companyWorkspace] as const,
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
  products: [resourceIds.product],
  workspace: [resourceIds.companyWorkspace],
  /** A new staff login also changes the staff's record (the role count is tenant-scoped). */
  staffLogin: [resourceIds.staffRecord],
  /** A saved opening is live at once (D43), so the setup status, prices and reports follow it. */
  opening: [
    resourceIds.setupStatus,
    resourceIds.product,
    resourceIds.productHistory,
    resourceIds.ledger,
    resourceIds.dashboardSummary,
  ],
  stock: [
    resourceIds.stockEntry,
    resourceIds.productHistory,
    resourceIds.ledger,
    resourceIds.dashboardSummary,
  ],
  /** Posting a sheet with field visits also writes shop dues and the exchange case (D40). */
  dsrDay: [
    resourceIds.dsrDay,
    resourceIds.fieldDay,
    resourceIds.moneyEntry,
    resourceIds.shop,
    resourceIds.damageCase,
    resourceIds.ledger,
    resourceIds.dashboardSummary,
  ],
  /** A field visit changes only the field day until the office posts the sheet. */
  field: [resourceIds.fieldDay],
  money: [
    resourceIds.moneyEntry,
    resourceIds.shop,
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
} as const satisfies Record<string, readonly ResourceId[]>;

export function resourceKey(actorId: string, companyId: string, resource: ResourceId) {
  return companyResource(actorId, companyId, resource);
}
