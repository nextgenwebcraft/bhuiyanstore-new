import type { Batch, CompanyWorkspace, Product, ProductCreateRequest } from "@bsd/contracts";

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
  /** Requires `product.create`; rejects a SKU already used in the company (VALIDATION_FAILED). */
  createProduct(
    companyId: string,
    input: ProductCreateRequest,
    options?: RequestOptions,
  ): Promise<Product>;
  /** Requires `product.edit`; rejects an unknown product or one from another company. */
  updateProduct(
    companyId: string,
    productId: string,
    input: ProductCreateRequest,
    options?: RequestOptions,
  ): Promise<Product>;
  /** Requires `inventory.view` in the company. Read-only opening/receipt cost layers. */
  listBatches(companyId: string, options?: RequestOptions): Promise<Batch[]>;
}
