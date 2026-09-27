import type { CompanyWorkspace, Product } from "@bsd/contracts";

export type RequestOptions = { signal?: AbortSignal };

/**
 * Service port shared by the mock adapter (Phase 1) and the HTTP adapter (after client
 * approval). Both return the same contract DTOs (guide section 6.1). The actor comes from the
 * session, never from a parameter.
 */
export interface DistributionService {
  /** Companies the current actor is a member of, with their effective permissions. */
  listWorkspaces(options?: RequestOptions): Promise<CompanyWorkspace[]>;
  /** Fails with COMPANY_NOT_FOUND for unknown and inaccessible companies alike. */
  getWorkspace(companyId: string, options?: RequestOptions): Promise<CompanyWorkspace>;
  /** Requires `product.view` in the company. */
  listProducts(companyId: string, options?: RequestOptions): Promise<Product[]>;
}
