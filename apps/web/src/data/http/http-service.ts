import {
  apiErrorSchema,
  cashAccountSchema,
  companyWorkspaceSchema,
  expenseCategorySchema,
  meSchema,
  openingSchema,
  openingWorkbookSheetsSchema,
  priceChangeSchema,
  productHistorySchema,
  productPackSchema,
  productSchema,
  roleSchema,
  staffMemberSchema,
  staffRecordSchema,
  staffRoleSchema,
  supplierSchema,
  userSchema,
  type Me,
  type PasswordChangeRequest,
} from "@bsd/contracts";
import { z } from "zod";
import type {
  ConfigListId,
  DistributionService,
  RequestOptions,
} from "../ports/distribution-service";
import { ServiceError } from "../ports/service-error";

type Json = Record<string, unknown> | unknown[];

type Call = RequestOptions & {
  method?: "GET" | "POST" | "PUT";
  body?: unknown;
  /** A raw file body (workbook uploads) instead of JSON. */
  file?: Blob;
  idempotent?: boolean;
};

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type HttpDistributionService = DistributionService & {
  getMe(options?: RequestOptions): Promise<Me>;
  changePassword(input: PasswordChangeRequest): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
};

async function send(url: string, call: Call): Promise<Response> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (call.body !== undefined) headers["content-type"] = "application/json";
  if (call.file) headers["content-type"] = XLSX;
  // One key per user action; a network retry of the same request replays the stored result.
  if (call.idempotent) headers["idempotency-key"] = crypto.randomUUID();
  try {
    return await fetch(url, {
      method: call.method ?? "GET",
      headers,
      credentials: "same-origin",
      cache: "no-store",
      ...(call.body !== undefined ? { body: JSON.stringify(call.body) } : {}),
      ...(call.file ? { body: call.file } : {}),
      ...(call.signal ? { signal: call.signal } : {}),
    });
  } catch (error) {
    if (call.signal?.aborted) throw new ServiceError("REQUEST_ABORTED");
    throw Object.assign(new ServiceError("INTERNAL", true), { cause: error });
  }
}

async function failure(response: Response): Promise<ServiceError> {
  const body: unknown = await response.json().catch(() => null);
  const parsed = apiErrorSchema.safeParse(body);
  if (!parsed.success) return new ServiceError("INTERNAL", response.status >= 500);
  return new ServiceError(parsed.data.code, parsed.data.retryable, parsed.data.fieldErrors ?? []);
}

/**
 * Talks to `/api/v1` with the session cookie and validates every response against the shared
 * contracts. Modules whose API arrives in later phases (PLAN §9 C–F) fail with
 * MODULE_UNAVAILABLE instead of showing invented data.
 */
export function createHttpService(onUnauthenticated: () => void): HttpDistributionService {
  async function request<T>(schema: z.ZodType<T>, path: string, call: Call = {}): Promise<T> {
    const response = await send(`/api/v1${path}`, call);
    if (!response.ok) {
      const error = await failure(response);
      if (error.code === "UNAUTHENTICATED") onUnauthenticated();
      throw error;
    }
    return schema.parse(response.status === 204 ? undefined : ((await response.json()) as Json));
  }

  const notYet = async (): Promise<never> => {
    throw new ServiceError("MODULE_UNAVAILABLE");
  };
  const id = (value: string) => encodeURIComponent(value);
  const company = (companyId: string) => `/companies/${id(companyId)}`;
  const product = (companyId: string, productId: string) =>
    `${company(companyId)}/products/${id(productId)}`;
  const write = (method: "POST" | "PUT", body: unknown): Call => ({
    method,
    body,
    idempotent: true,
  });

  return {
    getMe: (options) => request(meSchema, "/me", options),
    changePassword: (input) =>
      request(z.undefined(), "/me/password", { method: "POST", body: input }),
    async signIn(email, password) {
      const response = await send("/api/auth/sign-in/email", {
        method: "POST",
        body: { email, password },
      });
      if (response.status === 401 || response.status === 403 || response.status === 400) {
        throw new ServiceError("UNAUTHENTICATED");
      }
      if (!response.ok) throw new ServiceError("INTERNAL", response.status >= 500);
    },
    async signOut() {
      await send("/api/auth/sign-out", { method: "POST", body: {} });
    },

    listWorkspaces: (options) => request(z.array(companyWorkspaceSchema), "/companies", options),
    createCompany: (input) => request(companyWorkspaceSchema, "/companies", write("POST", input)),
    getWorkspace: (companyId, options) =>
      request(companyWorkspaceSchema, company(companyId), options),
    listProducts: (companyId, options) =>
      request(z.array(productSchema), `${company(companyId)}/products`, options),
    createProduct: (companyId, input, options) =>
      request(productSchema, `${company(companyId)}/products`, {
        ...options,
        method: "POST",
        body: input,
        idempotent: true,
      }),
    updateProduct: (companyId, productId, input, options) =>
      request(productSchema, `${company(companyId)}/products/${encodeURIComponent(productId)}`, {
        ...options,
        method: "PUT",
        body: input,
        idempotent: true,
      }),

    listBatches: notYet,
    listSuppliers: (companyId, options) =>
      request(z.array(supplierSchema), `${company(companyId)}/suppliers`, options),
    listStaff: (companyId, options) =>
      request(z.array(staffMemberSchema), `${company(companyId)}/staff-members`, options),
    listGoodsReceipts: notYet,
    postGoodsReceipt: notYet,
    listDailySalesSummaries: notYet,
    postDailySalesSummary: notYet,
    listMarketDues: notYet,
    listOldDueCollections: notYet,
    postOldDueCollection: notYet,
    getDashboardSummary: notYet,

    getProductHistory: (companyId, productId, options) =>
      request(productHistorySchema, `${product(companyId, productId)}/history`, options),
    addProductPack: (companyId, productId, input) =>
      request(productPackSchema, `${product(companyId, productId)}/packs`, write("POST", input)),
    setProductPrice: (companyId, productId, input) =>
      request(priceChangeSchema, `${product(companyId, productId)}/prices`, write("POST", input)),
    createSupplier: (companyId, input) =>
      request(supplierSchema, `${company(companyId)}/suppliers`, write("POST", input)),
    updateSupplier: (companyId, supplierId, input) =>
      request(
        supplierSchema,
        `${company(companyId)}/suppliers/${id(supplierId)}`,
        write("PUT", input),
      ),
    listStaffRecords: (companyId, options) =>
      request(z.array(staffRecordSchema), `${company(companyId)}/staff`, options),
    listAllStaff: (options) => request(z.array(staffRecordSchema), "/staff", options),
    createStaff: (companyId, input) =>
      request(staffRecordSchema, `${company(companyId)}/staff`, write("POST", input)),
    updateStaff: (companyId, staffId, input) =>
      request(staffRecordSchema, `${company(companyId)}/staff/${id(staffId)}`, write("PUT", input)),
    addStaffAssignment: (companyId, staffId, input) =>
      request(
        staffRecordSchema,
        `${company(companyId)}/staff/${id(staffId)}/assignments`,
        write("POST", input),
      ),
    updateStaffAssignment: (companyId, staffId, assignmentId, input) =>
      request(
        staffRecordSchema,
        `${company(companyId)}/staff/${id(staffId)}/assignments/${id(assignmentId)}`,
        write("PUT", input),
      ),
    listConfig: (list, options) =>
      request(z.array(configLists[list].schema), configLists[list].path, options) as never,
    createConfig: (list, input) =>
      request(configLists[list].schema, configLists[list].path, write("POST", input)) as never,
    updateConfig: (list, itemId, input) =>
      request(
        configLists[list].schema,
        `${configLists[list].path}/${id(itemId)}`,
        write("PUT", input),
      ) as never,
    listRoles: (options) => request(z.array(roleSchema), "/roles", options),
    createRole: (input) => request(roleSchema, "/roles", write("POST", input)),
    updateRole: (roleId, input) => request(roleSchema, `/roles/${id(roleId)}`, write("PUT", input)),
    listUsers: (options) => request(z.array(userSchema), "/users", options),
    createUser: (input) => request(userSchema, "/users", write("POST", input)),
    updateUser: (userId, input) => request(userSchema, `/users/${id(userId)}`, write("PUT", input)),
    resetUserPassword: (userId, input) =>
      request(userSchema, `/users/${id(userId)}/password`, write("POST", input)),

    getOpening: (companyId, options) =>
      request(openingSchema, `${company(companyId)}/opening`, options),
    saveOpening: (companyId, input) =>
      request(openingSchema, `${company(companyId)}/opening`, write("PUT", input)),
    inspectOpeningWorkbook: (companyId, file) =>
      request(openingWorkbookSheetsSchema, `${company(companyId)}/opening/import`, {
        method: "POST",
        file,
      }),
    importOpeningWorkbook: (companyId, input) => {
      const query = new URLSearchParams({
        sheet: input.sheet ?? "template",
        version: String(input.version),
        fileName: input.fileName,
      });
      return request(openingSchema, `${company(companyId)}/opening/import?${query.toString()}`, {
        method: "POST",
        file: input.file,
        idempotent: true,
      });
    },
    async downloadOpeningTemplate(companyId) {
      const response = await send(`/api/v1${company(companyId)}/opening/template`, {});
      if (!response.ok) {
        const error = await failure(response);
        if (error.code === "UNAUTHENTICATED") onUnauthenticated();
        throw error;
      }
      const disposition = response.headers.get("content-disposition") ?? "";
      const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
      return {
        fileName: encoded ? decodeURIComponent(encoded) : "opening.xlsx",
        file: await response.blob(),
      };
    },
    approveOpening: (companyId, input) =>
      request(openingSchema, `${company(companyId)}/opening/approve`, write("POST", input)),
    activateOpening: (companyId, input) =>
      request(openingSchema, `${company(companyId)}/opening/activate`, write("POST", input)),
  };
}

const configLists: Record<ConfigListId, { path: string; schema: z.ZodType }> = {
  staffRoles: { path: "/staff-roles", schema: staffRoleSchema },
  expenseCategories: { path: "/expense-categories", schema: expenseCategorySchema },
  cashAccounts: { path: "/cash-accounts", schema: cashAccountSchema },
};
