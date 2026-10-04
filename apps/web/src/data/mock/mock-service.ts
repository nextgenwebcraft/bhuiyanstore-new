import {
  companyWorkspaceSchema,
  permissionIds,
  productCreateRequestSchema,
  productHistorySchema,
  productSchema,
  staffMemberSchema,
  staffRecordSchema,
  type CompanyWorkspace,
  type PermissionId,
  type Product,
  type StaffRole,
  type StaffRoleKind,
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

type MockState = {
  companies: DemoSeed["companies"];
  products: Product[];
  staff: DemoSeed["staff"];
  roles: DemoSeed["roles"];
  memberships: DemoSeed["memberships"];
};

function initialState(seed: DemoSeed): MockState {
  const s = structuredClone(seed);
  return {
    companies: s.companies,
    products: s.products,
    staff: s.staff,
    roles: s.roles,
    memberships: s.memberships,
  };
}

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
 * Deterministic in-memory adapter over the JSON seed for tests and the offline demo. It enforces
 * the same membership and permission rules as the server and validates every response against its
 * contract. Daily entry, reports and administration run on the real API only (every figure comes
 * from the month engine there), so the demo answers them with MODULE_UNAVAILABLE.
 */
export function createMockService(
  seed: DemoSeed,
  { latencyMs = 150 }: MockServiceOptions = {},
): MockDistributionService {
  let state = initialState(seed);
  let actorId = seed.users[0]?.id ?? "";

  function permissionsFor(companyId: string): PermissionId[] | undefined {
    const membership = state.memberships.find(
      (m) => m.userId === actorId && m.companyId === companyId,
    );
    if (!membership) return undefined;
    const granted = new Set<PermissionId>();
    for (const roleId of membership.roleIds) {
      const role = state.roles.find((r) => r.id === roleId);
      const rolePermissions =
        role?.permissions === "all" ? permissionIds : (role?.permissions ?? []);
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

  function requirePermission(companyId: string, permission: PermissionId): void {
    if (!workspace(companyId).permissions.includes(permission)) {
      throw new ServiceError("FORBIDDEN");
    }
  }

  /** Case-insensitive, scoped to the company; a duplicate SKU in another company is allowed. */
  function assertUniqueSku(companyId: string, sku: string, excludeProductId?: string): void {
    const normalized = sku.trim().toLowerCase();
    const clash = state.products.some(
      (p) =>
        p.companyId === companyId &&
        p.id !== excludeProductId &&
        p.sku.trim().toLowerCase() === normalized,
    );
    if (clash) throw new ServiceError("VALIDATION_FAILED");
  }

  return {
    users: seed.users,
    getActorId: () => actorId,
    setActorId(userId) {
      if (!seed.users.some((u) => u.id === userId)) throw new ServiceError("VALIDATION_FAILED");
      actorId = userId;
    },
    reset() {
      state = initialState(seed);
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
      requirePermission(companyId, "product.view");
      return productSchema.array().parse(state.products.filter((p) => p.companyId === companyId));
    },

    async createProduct(companyId, input, options) {
      await delay(latencyMs, options?.signal);
      requirePermission(companyId, "product.create");
      const parsedInput = productCreateRequestSchema.parse(input);
      assertUniqueSku(companyId, parsedInput.sku);
      const product = productSchema.parse({
        ...parsedInput,
        id: crypto.randomUUID(),
        companyId,
      });
      state.products.push(product);
      return product;
    },

    async updateProduct(companyId, productId, input, options) {
      await delay(latencyMs, options?.signal);
      requirePermission(companyId, "product.edit");
      const index = state.products.findIndex(
        (p) => p.id === productId && p.companyId === companyId,
      );
      if (index === -1) throw new ServiceError("VALIDATION_FAILED");
      const parsedInput = productCreateRequestSchema.parse(input);
      assertUniqueSku(companyId, parsedInput.sku, productId);
      const product = productSchema.parse({ ...parsedInput, id: productId, companyId });
      state.products[index] = product;
      return product;
    },

    async listStaff(companyId, options) {
      await delay(latencyMs, options?.signal);
      requirePermission(companyId, "company.view");
      // Anti-enumeration: never reveal companies the actor cannot access.
      const visible = (id: string) => permissionsFor(id)?.includes("company.view") ?? false;
      return staffMemberSchema
        .array()
        .parse(
          state.staff
            .filter((p) => p.companyIds.includes(companyId))
            .map((p) => ({ ...p, companyIds: p.companyIds.filter(visible) })),
        );
    },

    getDashboardSummary: demoReadOnly,
    getDayView: demoReadOnly,
    listStockEntries: demoReadOnly,
    postStockEntries: demoReadOnly,
    reverseStockEntry: demoReadOnly,
    listDsrDays: demoReadOnly,
    saveDsrDay: demoReadOnly,
    postDsrDay: demoReadOnly,
    reverseDsrDay: demoReadOnly,
    discardDsrDay: demoReadOnly,
    listMoneyEntries: demoReadOnly,
    postMoneyEntry: demoReadOnly,
    reverseMoneyEntry: demoReadOnly,
    getMonthView: demoReadOnly,
    closeMonth: demoReadOnly,
    reopenMonth: demoReadOnly,
    getReport: demoReadOnly,
    downloadReport: demoReadOnly,
    getStaffAccounts: demoReadOnly,
    getStaffStatement: demoReadOnly,
    downloadStaffStatement: demoReadOnly,
    getPayrollRun: demoReadOnly,
    savePayrollRun: demoReadOnly,
    payrollCommand: demoReadOnly,
    listDamageCases: demoReadOnly,
    createDamageCase: demoReadOnly,
    postDamageEvent: demoReadOnly,
    reverseDamageEvent: demoReadOnly,
    cancelDamageCase: demoReadOnly,

    async getProductHistory(companyId, productId, options) {
      await delay(latencyMs, options?.signal);
      requirePermission(companyId, "product.view");
      const product = state.products.find((p) => p.id === productId && p.companyId === companyId);
      if (!product) throw new ServiceError("VALIDATION_FAILED");
      return productHistorySchema.parse({
        packs: [
          {
            id: `${product.id}-base`,
            productId: product.id,
            piecesPerCarton: product.piecesPerCarton,
            effectiveFrom: null,
          },
        ],
        prices: [],
      });
    },
    addProductPack: demoReadOnly,
    setProductPrice: demoReadOnly,
    createCompany: demoReadOnly,
    async listStaffRecords(companyId, options) {
      await delay(latencyMs, options?.signal);
      requirePermission(companyId, "company.view");
      const visible = (id: string) => permissionsFor(id)?.includes("company.view") ?? false;
      return staffRecordSchema.array().parse(
        state.staff
          .filter((p) => p.companyIds.includes(companyId))
          .map((p) => ({
            id: p.id,
            name: p.name,
            employer: p.kind === "sr" ? "supplier" : "distributor",
            status: "active",
            assignments: p.companyIds.filter(visible).map((id) => ({
              id: `${p.id}-${id}`,
              companyId: id,
              roleId: DEMO_ROLES[p.kind].id,
              roleName: DEMO_ROLES[p.kind].name,
              roleKind: p.kind,
              from: "2026-01-01",
              to: null,
            })),
          })),
      );
    },
    listAllStaff: demoReadOnly,
    createStaff: demoReadOnly,
    updateStaff: demoReadOnly,
    addStaffAssignment: demoReadOnly,
    updateStaffAssignment: demoReadOnly,

    async listConfig(list, options) {
      await delay(latencyMs, options?.signal);
      return (list === "staffRoles" ? Object.values(DEMO_ROLES) : []) as never;
    },
    createConfig: demoReadOnly,
    updateConfig: demoReadOnly,
    listRoles: demoReadOnly,
    createRole: demoReadOnly,
    updateRole: demoReadOnly,
    listUsers: demoReadOnly,
    createUser: demoReadOnly,
    updateUser: demoReadOnly,
    resetUserPassword: demoReadOnly,

    getOpening: demoReadOnly,
    saveOpening: demoReadOnly,
    inspectOpeningWorkbook: demoReadOnly,
    importOpeningWorkbook: demoReadOnly,
    downloadOpeningTemplate: demoReadOnly,
    approveOpening: demoReadOnly,
    activateOpening: demoReadOnly,
    inspectImportWorkbook: demoReadOnly,
    createImportJob: demoReadOnly,
    listImportJobs: demoReadOnly,
    getImportJob: demoReadOnly,
    saveImportMapping: demoReadOnly,
    commitImportJob: demoReadOnly,
    discardImportJob: demoReadOnly,
  };
}

async function demoReadOnly(): Promise<never> {
  throw new ServiceError("MODULE_UNAVAILABLE");
}

const DEMO_ROLES: Record<StaffRoleKind, StaffRole> = {
  dsr: { id: "demo-role-dsr", name: "ডিএসআর", kind: "dsr", active: true },
  sr: { id: "demo-role-sr", name: "এসআর", kind: "sr", active: true },
  general: { id: "demo-role-general", name: "কর্মী", kind: "general", active: true },
};
