import {
  apiErrorSchema,
  cashAccountSchema,
  companyWorkspaceSchema,
  damageCaseSchema,
  dashboardSummarySchema,
  dayViewSchema,
  dsrDaySchema,
  expenseCategorySchema,
  importJobSchema,
  importJobSummarySchema,
  importWorkbookSheetsSchema,
  meSchema,
  moneyEntrySchema,
  monthCloseResultSchema,
  monthViewSchema,
  openingSchema,
  openingWorkbookSheetsSchema,
  payrollRunSchema,
  priceChangeSchema,
  productHistorySchema,
  productPackSchema,
  productSchema,
  reportSchema,
  roleSchema,
  staffAccountsSchema,
  staffMemberSchema,
  staffRecordSchema,
  staffRoleSchema,
  staffStatementSchema,
  stockEntrySchema,
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

/**
 * Reads give up after this long and become a retryable failure. Writes never time out on the
 * client: their outcome would be unknown, and the server bounds its own transactions.
 */
export const READ_TIMEOUT_MS = 60_000;

/**
 * Idempotency keys of writes whose outcome is unknown (network failure or 5xx). Resubmitting the
 * identical request reuses the key, so the server replays a commit it already made instead of
 * posting twice. A definite answer (2xx or 4xx) forgets the key; the next submission is new.
 */
export class PendingWriteKeys {
  private readonly keys = new Map<string, string>();

  keyFor(fingerprint: string): string {
    let key = this.keys.get(fingerprint);
    if (!key) {
      key = crypto.randomUUID();
      this.keys.set(fingerprint, key);
    }
    return key;
  }

  settle(fingerprint: string, response: Response | null): void {
    if (response && response.status < 500) this.keys.delete(fingerprint);
  }
}

function fingerprintOf(url: string, call: Call): string {
  const file = call.file;
  const body = file
    ? `file:${file.size}:${file instanceof File ? `${file.name}:${file.lastModified}` : ""}`
    : JSON.stringify(call.body ?? null);
  return `${call.method ?? "GET"} ${url} ${body}`;
}

async function send(url: string, call: Call, pending: PendingWriteKeys): Promise<Response> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (call.body !== undefined) headers["content-type"] = "application/json";
  if (call.file) headers["content-type"] = XLSX;
  const fingerprint = call.idempotent ? fingerprintOf(url, call) : null;
  if (fingerprint) headers["idempotency-key"] = pending.keyFor(fingerprint);
  const isRead = (call.method ?? "GET") === "GET";
  const timeout = isRead ? AbortSignal.timeout(READ_TIMEOUT_MS) : undefined;
  const signal =
    timeout && call.signal ? AbortSignal.any([call.signal, timeout]) : (timeout ?? call.signal);
  let response: Response | null = null;
  try {
    response = await fetch(url, {
      method: call.method ?? "GET",
      headers,
      credentials: "same-origin",
      cache: "no-store",
      ...(call.body !== undefined ? { body: JSON.stringify(call.body) } : {}),
      ...(call.file ? { body: call.file } : {}),
      ...(signal ? { signal } : {}),
    });
    return response;
  } catch (error) {
    if (call.signal?.aborted) throw new ServiceError("REQUEST_ABORTED");
    throw Object.assign(new ServiceError("INTERNAL", true), { cause: error });
  } finally {
    if (fingerprint) pending.settle(fingerprint, response);
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
 * contracts.
 */
export function createHttpService(onUnauthenticated: () => void): HttpDistributionService {
  const pending = new PendingWriteKeys();

  async function request<T>(schema: z.ZodType<T>, path: string, call: Call = {}): Promise<T> {
    const response = await send(`/api/v1${path}`, call, pending);
    if (!response.ok) {
      const error = await failure(response);
      if (error.code === "UNAUTHENTICATED") onUnauthenticated();
      throw error;
    }
    return schema.parse(response.status === 204 ? undefined : ((await response.json()) as Json));
  }

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
      const response = await send(
        "/api/auth/sign-in/email",
        { method: "POST", body: { email, password } },
        pending,
      );
      if (response.status === 401 || response.status === 403 || response.status === 400) {
        throw new ServiceError("UNAUTHENTICATED");
      }
      if (!response.ok) throw new ServiceError("INTERNAL", response.status >= 500);
    },
    async signOut() {
      await send("/api/auth/sign-out", { method: "POST", body: {} }, pending);
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

    listStaff: (companyId, options) =>
      request(z.array(staffMemberSchema), `${company(companyId)}/staff-members`, options),
    getDashboardSummary: (companyId, date, options) =>
      request(dashboardSummarySchema, `${company(companyId)}/dashboard?date=${id(date)}`, options),

    getDayView: (companyId, date, options) =>
      request(dayViewSchema, `${company(companyId)}/days/${id(date)}`, options),
    listStockEntries: (companyId, date, options) =>
      request(
        z.array(stockEntrySchema),
        `${company(companyId)}/stock-entries?date=${id(date)}`,
        options,
      ),
    postStockEntries: (companyId, input) =>
      request(
        z.array(stockEntrySchema),
        `${company(companyId)}/stock-entries`,
        write("POST", input),
      ),
    reverseStockEntry: (companyId, entryId) =>
      request(
        stockEntrySchema,
        `${company(companyId)}/stock-entries/${id(entryId)}/reverse`,
        write("POST", {}),
      ),
    listDsrDays: (companyId, date, options) =>
      request(z.array(dsrDaySchema), `${company(companyId)}/dsr-days?date=${id(date)}`, options),
    saveDsrDay: (companyId, input) =>
      request(dsrDaySchema, `${company(companyId)}/dsr-days`, write("PUT", input)),
    postDsrDay: (companyId, dayId, input) =>
      request(
        dsrDaySchema,
        `${company(companyId)}/dsr-days/${id(dayId)}/post`,
        write("POST", input),
      ),
    reverseDsrDay: (companyId, dayId, input) =>
      request(
        dsrDaySchema,
        `${company(companyId)}/dsr-days/${id(dayId)}/reverse`,
        write("POST", input),
      ),
    discardDsrDay: (companyId, dayId, input) =>
      request(z.undefined(), `${company(companyId)}/dsr-days/${id(dayId)}/discard`, {
        method: "POST",
        body: input,
      }),
    listMoneyEntries: (companyId, query, options) => {
      const params = new URLSearchParams({ from: query.from });
      if (query.to) params.set("to", query.to);
      if (query.staffId) params.set("staffId", query.staffId);
      return request(
        z.array(moneyEntrySchema),
        `${company(companyId)}/money-entries?${params.toString()}`,
        options,
      );
    },
    postMoneyEntry: (companyId, input) =>
      request(moneyEntrySchema, `${company(companyId)}/money-entries`, write("POST", input)),
    reverseMoneyEntry: (companyId, entryId) =>
      request(
        moneyEntrySchema,
        `${company(companyId)}/money-entries/${id(entryId)}/reverse`,
        write("POST", {}),
      ),

    getProductHistory: (companyId, productId, options) =>
      request(productHistorySchema, `${product(companyId, productId)}/history`, options),
    addProductPack: (companyId, productId, input) =>
      request(productPackSchema, `${product(companyId, productId)}/packs`, write("POST", input)),
    setProductPrice: (companyId, productId, input) =>
      request(priceChangeSchema, `${product(companyId, productId)}/prices`, write("POST", input)),
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
    downloadOpeningTemplate: (companyId) =>
      download(`${company(companyId)}/opening/template`, "opening.xlsx"),
    approveOpening: (companyId, input) =>
      request(openingSchema, `${company(companyId)}/opening/approve`, write("POST", input)),
    activateOpening: (companyId, input) =>
      request(openingSchema, `${company(companyId)}/opening/activate`, write("POST", input)),

    inspectImportWorkbook: (companyId, file) =>
      request(importWorkbookSheetsSchema, `${company(companyId)}/imports`, {
        method: "POST",
        file,
      }),
    createImportJob: (companyId, input) => {
      const query = new URLSearchParams({ sheet: input.sheet, fileName: input.fileName });
      return request(importJobSchema, `${company(companyId)}/imports?${query.toString()}`, {
        method: "POST",
        file: input.file,
        idempotent: true,
      });
    },
    listImportJobs: (companyId, options) =>
      request(z.array(importJobSummarySchema), `${company(companyId)}/imports`, options),
    getImportJob: (companyId, jobId, options) =>
      request(importJobSchema, `${company(companyId)}/imports/${id(jobId)}`, options),
    saveImportMapping: (companyId, jobId, input) =>
      request(
        importJobSchema,
        `${company(companyId)}/imports/${id(jobId)}/mapping`,
        write("PUT", input),
      ),
    commitImportJob: (companyId, jobId, input) =>
      request(
        importJobSchema,
        `${company(companyId)}/imports/${id(jobId)}/commit`,
        write("POST", input),
      ),
    discardImportJob: (companyId, jobId, input) =>
      request(
        importJobSchema,
        `${company(companyId)}/imports/${id(jobId)}/discard`,
        write("POST", input),
      ),

    getMonthView: (companyId, month, options) =>
      request(monthViewSchema, `${company(companyId)}/months/${id(month)}`, options),
    closeMonth: (companyId, month) =>
      request(
        monthCloseResultSchema,
        `${company(companyId)}/months/${id(month)}/close`,
        write("POST", {}),
      ),
    reopenMonth: (companyId, month) =>
      request(
        monthCloseResultSchema,
        `${company(companyId)}/months/${id(month)}/reopen`,
        write("POST", {}),
      ),
    getReport: (companyId, report, range, options) =>
      request(
        reportSchema,
        `${company(companyId)}/reports/${id(report)}?${new URLSearchParams(range).toString()}`,
        options,
      ),
    downloadReport: (companyId, report, range, format) =>
      download(
        `${company(companyId)}/reports/${id(report)}?${new URLSearchParams({ ...range, format }).toString()}`,
        `${report}.${format}`,
      ),

    getStaffAccounts: (companyId, query, options) => {
      const params = new URLSearchParams({ kind: query.kind });
      if (query.date) params.set("date", query.date);
      return request(
        staffAccountsSchema,
        `${company(companyId)}/staff-accounts?${params.toString()}`,
        options,
      );
    },
    getStaffStatement: (companyId, staffId, range, options) =>
      request(
        staffStatementSchema,
        `${company(companyId)}/staff/${id(staffId)}/statement?${new URLSearchParams(range).toString()}`,
        options,
      ),
    downloadStaffStatement: (companyId, staffId, range, format) =>
      download(
        `${company(companyId)}/staff/${id(staffId)}/statement?${new URLSearchParams({ ...range, format }).toString()}`,
        `statement.${format}`,
      ),
    getPayrollRun: (companyId, month, options) =>
      request(payrollRunSchema, `${company(companyId)}/payroll-runs/${id(month)}`, options),
    savePayrollRun: (companyId, month, input) =>
      request(
        payrollRunSchema,
        `${company(companyId)}/payroll-runs/${id(month)}`,
        write("PUT", input),
      ),
    payrollCommand: (companyId, month, action, input) =>
      request(
        payrollRunSchema,
        `${company(companyId)}/payroll-runs/${id(month)}/${id(action)}`,
        write("POST", input),
      ),
    listDamageCases: (companyId, query, options) =>
      request(
        z.array(damageCaseSchema),
        `${company(companyId)}/damage-cases${query.status ? `?status=${query.status}` : ""}`,
        options,
      ),
    createDamageCase: (companyId, input) =>
      request(damageCaseSchema, `${company(companyId)}/damage-cases`, write("POST", input)),
    postDamageEvent: (companyId, caseId, input) =>
      request(
        damageCaseSchema,
        `${company(companyId)}/damage-cases/${id(caseId)}/events`,
        write("POST", input),
      ),
    reverseDamageEvent: (companyId, eventId) =>
      request(
        damageCaseSchema,
        `${company(companyId)}/damage-events/${id(eventId)}/reverse`,
        write("POST", {}),
      ),
    cancelDamageCase: (companyId, caseId) =>
      request(
        damageCaseSchema,
        `${company(companyId)}/damage-cases/${id(caseId)}/cancel`,
        write("POST", {}),
      ),
  };

  async function download(path: string, fallbackName: string) {
    const response = await send(`/api/v1${path}`, {}, pending);
    if (!response.ok) {
      const error = await failure(response);
      if (error.code === "UNAUTHENTICATED") onUnauthenticated();
      throw error;
    }
    const disposition = response.headers.get("content-disposition") ?? "";
    const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
    return {
      fileName: encoded ? decodeURIComponent(encoded) : fallbackName,
      file: await response.blob(),
    };
  }
}

const configLists: Record<ConfigListId, { path: string; schema: z.ZodType }> = {
  staffRoles: { path: "/staff-roles", schema: staffRoleSchema },
  expenseCategories: { path: "/expense-categories", schema: expenseCategorySchema },
  cashAccounts: { path: "/cash-accounts", schema: cashAccountSchema },
};
