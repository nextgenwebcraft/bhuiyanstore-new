import {
  companyWorkspaceSchema,
  permissionIds,
  productSchema,
  type CompanyWorkspace,
  type PermissionId,
} from "@bsd/contracts";
import type { DistributionService, RequestOptions } from "../ports/distribution-service";
import { ServiceError } from "../ports/service-error";
import type { DemoSeed } from "./seed-schema";

export type MockServiceOptions = {
  /** Simulated network latency, so loading states are visible and cancellation is exercised. */
  latencyMs?: number;
};

export type MockDistributionService = DistributionService & {
  readonly users: DemoSeed["users"];
  getActorId(): string;
  setActorId(userId: string): void;
  /** Restores the initial fixture state (the "Reset demo" action). */
  reset(): void;
};

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ServiceError("REQUEST_ABORTED"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new ServiceError("REQUEST_ABORTED"));
      },
      { once: true },
    );
  });
}

/**
 * Deterministic in-memory adapter over the JSON seed. It enforces the same membership and
 * permission rules the server will, and validates every response against its contract.
 * State lives in memory only (online-only product, D15): a page reload restores the seed.
 */
export function createMockService(
  seed: DemoSeed,
  { latencyMs = 150 }: MockServiceOptions = {},
): MockDistributionService {
  let state = structuredClone(seed);
  let actorId = seed.users[0]?.id ?? "";

  function permissionsFor(companyId: string): PermissionId[] | undefined {
    const membership = state.memberships.find(
      (m) => m.userId === actorId && m.companyId === companyId,
    );
    if (!membership) return undefined;
    const granted = new Set<PermissionId>();
    for (const roleId of membership.roleIds) {
      const role = state.roles.find((r) => r.id === roleId);
      const rolePermissions = role?.permissions === "all" ? permissionIds : (role?.permissions ?? []);
      rolePermissions.forEach((p) => granted.add(p));
    }
    // Stable canonical order, independent of role composition.
    return permissionIds.filter((p) => granted.has(p));
  }

  function workspace(companyId: string): CompanyWorkspace {
    const company = state.companies.find((c) => c.id === companyId);
    const permissions = permissionsFor(companyId);
    if (!company || !permissions?.includes("company.view")) {
      throw new ServiceError("COMPANY_NOT_FOUND");
    }
    return companyWorkspaceSchema.parse({ company, permissions });
  }

  return {
    users: seed.users,
    getActorId: () => actorId,
    setActorId(userId) {
      if (!seed.users.some((u) => u.id === userId)) throw new ServiceError("VALIDATION_FAILED");
      actorId = userId;
    },
    reset() {
      state = structuredClone(seed);
    },

    async listWorkspaces(options?: RequestOptions) {
      await delay(latencyMs, options?.signal);
      return state.companies.flatMap((company) => {
        try {
          return [workspace(company.id)];
        } catch {
          return [];
        }
      });
    },

    async getWorkspace(companyId, options) {
      await delay(latencyMs, options?.signal);
      return workspace(companyId);
    },

    async listProducts(companyId, options) {
      await delay(latencyMs, options?.signal);
      if (!workspace(companyId).permissions.includes("product.view")) {
        throw new ServiceError("FORBIDDEN");
      }
      return productSchema.array().parse(state.products.filter((p) => p.companyId === companyId));
    },
  };
}
