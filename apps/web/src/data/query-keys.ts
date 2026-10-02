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
  batches: (actorId: string, companyId: string) =>
    companyResource(actorId, companyId, resourceIds.batch),
  suppliers: (actorId: string, companyId: string) =>
    companyResource(actorId, companyId, resourceIds.supplier),
  staff: (actorId: string, companyId: string) =>
    companyResource(actorId, companyId, resourceIds.staffMember),
  goodsReceipts: (actorId: string, companyId: string) =>
    companyResource(actorId, companyId, resourceIds.goodsReceipt),
  dailySalesSummaries: (actorId: string, companyId: string) =>
    companyResource(actorId, companyId, resourceIds.dailySalesSummary),
  marketDues: (actorId: string, companyId: string) =>
    companyResource(actorId, companyId, resourceIds.marketDue),
  oldDueCollections: (actorId: string, companyId: string) =>
    companyResource(actorId, companyId, resourceIds.oldDueCollection),
  dashboardSummary: (actorId: string, companyId: string, date: string) =>
    [...companyResource(actorId, companyId, resourceIds.dashboardSummary), date] as const,
  productHistory: (actorId: string, companyId: string, productId: string) =>
    [...companyResource(actorId, companyId, resourceIds.productHistory), productId] as const,
  staffRecords: (actorId: string, companyId: string) =>
    companyResource(actorId, companyId, resourceIds.staffRecord),
  opening: (actorId: string, companyId: string) =>
    companyResource(actorId, companyId, resourceIds.opening),
  /** Tenant-level lists and administration are scoped by actor only. */
  tenant: (actorId: string, resource: ResourceId) =>
    [...queryKeys.actor(actorId), "tenant", resource] as const,
};

/**
 * Resources each posting command writes (guide 21.4 "downstream resource invalidations"). One
 * owner, so a screen cannot forget to refresh a dependent view after posting.
 */
export const postingEffects = {
  goodsReceipt: [resourceIds.goodsReceipt, resourceIds.batch, resourceIds.dashboardSummary],
  dailySalesSummary: [
    resourceIds.dailySalesSummary,
    resourceIds.batch,
    resourceIds.marketDue,
    resourceIds.dashboardSummary,
  ],
  oldDueCollection: [
    resourceIds.oldDueCollection,
    resourceIds.marketDue,
    resourceIds.dashboardSummary,
  ],
} as const satisfies Record<string, readonly ResourceId[]>;

export function resourceKey(actorId: string, companyId: string, resource: ResourceId) {
  return companyResource(actorId, companyId, resource);
}
