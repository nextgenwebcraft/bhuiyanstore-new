import { resourceIds } from "@bsd/architecture";

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
    [...queryKeys.companyScope(actorId, companyId), resourceIds.companyWorkspace] as const,
  products: (actorId: string, companyId: string) =>
    [...queryKeys.companyScope(actorId, companyId), resourceIds.product] as const,
};
