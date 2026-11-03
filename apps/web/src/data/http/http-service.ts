import {
  apiErrorSchema,
  companyWorkspaceSchema,
  damageCaseSchema,
  dashboardSummarySchema,
  dayViewSchema,
  dsrDaySchema,
  expenseCategorySchema,
  fieldDaySchema,
  fieldShopSchema,
  fieldVisitSchema,
  historyDsrPageSchema,
  historyMoneyPageSchema,
  historyStockDateSummariesSchema,
  historyStockPageSchema,
  type HistoryPageQuery,
  orderTargetListSchema,
  orderTargetSchema,
  meSchema,
  moneyEntrySchema,
  openingSchema,
  masterMonthSchema,
  masterSummarySchema,
  companyHishabYearSchema,
  masterHishabYearSchema,
  shareholderListSchema,
  shareholderSchema,
  monthCloseResultSchema,
  monthViewSchema,
  payrollRunSchema,
  priceChangeSchema,
  productHistorySchema,
  productPackSchema,
  productSchema,
  reportSchema,
  roleSchema,
  staffAccountsSchema,
  staffMemberSchema,
  shopSchema,
  shopStatementSchema,
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
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  idempotent?: boolean;
};

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
const READ_TIMEOUT_MS = 60_000;

/**
 * Idempotency keys of writes whose outcome is unknown (network failure or 5xx). Resubmitting the
 * identical request reuses the key, so the server replays a commit it already made instead of
 * posting twice. A definite answer (2xx or 4xx) forgets the key; the next submission is new.
 */
class PendingWriteKeys {
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
  return `${call.method ?? "GET"} ${url} ${JSON.stringify(call.body ?? null)}`;
}

function historyParams(query: HistoryPageQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set("page", String(query.page ?? 1));
  params.set("pageSize", String(query.pageSize ?? 25));
  // Always send status so the UI default (posted) cannot be dropped by a stale client bundle.
  params.set("status", query.status ?? "posted");
  if (query.date) params.set("date", query.date);
  return params;
}

async function send(url: string, call: Call, pending: PendingWriteKeys): Promise<Response> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (call.body !== undefined) headers["content-type"] = "application/json";
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
  return new ServiceError(
    parsed.data.code,
    parsed.data.retryable,
    parsed.data.fieldErrors ?? [],
    parsed.data.stockShortages ?? [],
  );
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
  /** A DELETE carries an empty JSON body (the API only accepts JSON writes); not retried by key. */
  const remove = (): Call => ({ method: "DELETE", body: {} });
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
    updateCompany: (companyId, input) =>
      request(companyWorkspaceSchema, company(companyId), write("PUT", input)),
    deleteCompany: (companyId) => request(z.undefined(), company(companyId), remove()),
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

    deleteProduct: (companyId, productId) =>
      request(z.undefined(), `${product(companyId, productId)}`, remove()),
    listStaff: (companyId, options) =>
      request(z.array(staffMemberSchema), `${company(companyId)}/staff-members`, options),
    getDashboardSummary: (companyId, range, options) =>
      request(
        dashboardSummarySchema,
        `${company(companyId)}/dashboard?${new URLSearchParams(range).toString()}`,
        options,
      ),

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
    submitDsrHandover: (companyId, dayId, input) =>
      request(
        dsrDaySchema,
        `${company(companyId)}/dsr-days/${id(dayId)}/handover-submit`,
        write("POST", input),
      ),
    approveDsrHandover: (companyId, dayId, input) =>
      request(
        dsrDaySchema,
        `${company(companyId)}/dsr-days/${id(dayId)}/handover-approve`,
        write("POST", input),
      ),
    decideFieldReport: (companyId, reportId, action, input) =>
      request(
        z.undefined(),
        `${company(companyId)}/field/reports/${id(reportId)}/${action}`,
        write("POST", input),
      ),
    listMoneyEntries: (companyId, query, options) => {
      const params = new URLSearchParams({ from: query.from });
      if (query.to) params.set("to", query.to);
      if (query.staffId) params.set("staffId", query.staffId);
      if (query.shopId) params.set("shopId", query.shopId);
      return request(
        z.array(moneyEntrySchema),
        `${company(companyId)}/money-entries?${params.toString()}`,
        options,
      );
    },
    postMoneyEntry: (companyId, input) =>
      request(moneyEntrySchema, `${company(companyId)}/money-entries`, write("POST", input)),
    listHistoryStockEntries: (companyId, group, query, options) => {
      const params = historyParams(query);
      params.set("group", group);
      return request(
        historyStockPageSchema,
        `${company(companyId)}/history/stock-entries?${params.toString()}`,
        options,
      );
    },
    listHistoryStockDateSummaries: (companyId, group, query, options) => {
      const params = new URLSearchParams({ group });
      params.set("status", query.status ?? "posted");
      return request(
        historyStockDateSummariesSchema,
        `${company(companyId)}/history/stock-dates?${params.toString()}`,
        options,
      );
    },
    listHistoryMoneyEntries: (companyId, group, query, options) => {
      const params = historyParams(query);
      params.set("group", group);
      return request(
        historyMoneyPageSchema,
        `${company(companyId)}/history/money-entries?${params.toString()}`,
        options,
      );
    },
    listHistoryDsrDays: (companyId, query, options) => {
      const params = historyParams(query);
      const q = params.toString();
      return request(
        historyDsrPageSchema,
        `${company(companyId)}/history/dsr-days${q ? `?${q}` : ""}`,
        options,
      );
    },
    listOrderTargets: (companyId, query, options) => {
      const params = new URLSearchParams();
      if (query?.dashboardOnly) params.set("dashboardOnly", "1");
      const q = params.toString();
      return request(
        orderTargetListSchema,
        `${company(companyId)}/order-targets${q ? `?${q}` : ""}`,
        options,
      );
    },
    createOrderTarget: (companyId, input) =>
      request(orderTargetSchema, `${company(companyId)}/order-targets`, write("POST", input)),
    updateOrderTarget: (companyId, targetId, input) =>
      request(
        orderTargetSchema,
        `${company(companyId)}/order-targets/${id(targetId)}`,
        write("PUT", input),
      ),
    archiveOrderTarget: (companyId, targetId) =>
      request(orderTargetSchema, `${company(companyId)}/order-targets/${id(targetId)}`, remove()),
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
    deleteStaff: (companyId, staffId) =>
      request(z.undefined(), `${company(companyId)}/staff/${id(staffId)}`, remove()),
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
    listShops: (companyId, options) =>
      request(z.array(shopSchema), `${company(companyId)}/shops`, options),
    createShop: (companyId, input) =>
      request(shopSchema, `${company(companyId)}/shops`, write("POST", input)),
    updateShop: (companyId, shopId, input) =>
      request(shopSchema, `${company(companyId)}/shops/${id(shopId)}`, write("PUT", input)),
    deleteShop: (companyId, shopId) =>
      request(z.undefined(), `${company(companyId)}/shops/${id(shopId)}`, remove()),
    getShopStatement: (companyId, shopId, range, options) => {
      const params = new URLSearchParams();
      if (range.from) params.set("from", range.from);
      if (range.to) params.set("to", range.to);
      return request(
        shopStatementSchema,
        `${company(companyId)}/shops/${id(shopId)}/statement?${params.toString()}`,
        options,
      );
    },
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

    getFieldDay: (companyId, date, options) =>
      request(fieldDaySchema, `${company(companyId)}/field/day?date=${id(date)}`, options),
    getDsrFieldDay: (companyId, staffId, date, options) =>
      request(
        fieldDaySchema,
        `${company(companyId)}/field/day?date=${id(date)}&staffId=${id(staffId)}`,
        options,
      ),
    saveFieldVisit: (companyId, visitId, input) =>
      visitId
        ? request(
            fieldVisitSchema,
            `${company(companyId)}/field/visits/${id(visitId)}`,
            write("PUT", input),
          )
        : request(fieldVisitSchema, `${company(companyId)}/field/visits`, write("POST", input)),
    deleteFieldVisit: (companyId, visitId, input) =>
      request(z.undefined(), `${company(companyId)}/field/visits/${id(visitId)}`, {
        method: "DELETE",
        body: input,
      }),
    saveFieldDayEnd: (companyId, input) =>
      request(fieldDaySchema, `${company(companyId)}/field/day-end`, write("PUT", input)),
    createFieldShop: (companyId, input) =>
      request(fieldShopSchema, `${company(companyId)}/field/shops`, write("POST", input)),
    createStaffLogin: (companyId, staffId, input) =>
      request(
        staffRecordSchema,
        `${company(companyId)}/staff/${id(staffId)}/login`,
        write("POST", input),
      ),
    updateStaffLogin: (companyId, staffId, input) =>
      request(
        staffRecordSchema,
        `${company(companyId)}/staff/${id(staffId)}/login`,
        write("PUT", input),
      ),
    resetStaffLoginPassword: (companyId, staffId, input) =>
      request(
        staffRecordSchema,
        `${company(companyId)}/staff/${id(staffId)}/login/password`,
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
    getMasterWorkspace: (options) => request(companyWorkspaceSchema, "/master", options),
    getMasterSummary: (companyId, range, options) =>
      request(
        masterSummarySchema,
        `${company(companyId)}/master-summary?${new URLSearchParams(range).toString()}`,
        options,
      ),
    getMasterMonth: (companyId, month, options) =>
      request(masterMonthSchema, `${company(companyId)}/master-months/${id(month)}`, options),
    masterMonthCommand: (companyId, month, action) =>
      request(
        masterMonthSchema,
        `${company(companyId)}/master-months/${id(month)}/${action}`,
        write("POST", {}),
      ),
    getCompanyHishabYear: (companyId, targetCompanyId, year, shareholderId, options) => {
      const params = new URLSearchParams({ targetCompanyId });
      if (shareholderId) params.set("shareholderId", shareholderId);
      return request(
        companyHishabYearSchema,
        `${company(companyId)}/company-hishab-years/${id(year)}?${params.toString()}`,
        options,
      );
    },
    getMasterHishabYear: (companyId, year, shareholderId, options) => {
      const params = new URLSearchParams();
      if (shareholderId) params.set("shareholderId", shareholderId);
      const search = params.toString();
      return request(
        masterHishabYearSchema,
        `${company(companyId)}/master-hishab-years/${id(year)}${search ? `?${search}` : ""}`,
        options,
      );
    },
    listShareholders: (companyId, month, options) => {
      const search = month ? `?${new URLSearchParams({ month }).toString()}` : "";
      return request(shareholderListSchema, `${company(companyId)}/shareholders${search}`, options);
    },
    createShareholder: (companyId, input) =>
      request(shareholderSchema, `${company(companyId)}/shareholders`, write("POST", input)),
    updateShareholder: (companyId, shareholderId, input) =>
      request(
        shareholderSchema,
        `${company(companyId)}/shareholders/${id(shareholderId)}`,
        write("PUT", input),
      ),
    saveInvestments: (companyId, shareholderId, input) =>
      request(
        shareholderSchema,
        `${company(companyId)}/shareholders/${id(shareholderId)}/investments`,
        write("PUT", input),
      ),
    setShareholderPayout: (companyId, input) =>
      request(
        z.undefined(),
        `${company(companyId)}/master-shareholder-payouts`,
        write("PUT", input),
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
    listDamageCases: (companyId, query, options) => {
      const params = new URLSearchParams();
      if (query.status) params.set("status", query.status);
      if (query.from) params.set("from", query.from);
      if (query.to) params.set("to", query.to);
      const search = params.toString();
      return request(
        z.array(damageCaseSchema),
        `${company(companyId)}/damage-cases${search ? `?${search}` : ""}`,
        options,
      );
    },
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

    getOpening: (companyId, options) =>
      request(openingSchema, `${company(companyId)}/opening`, options),
    saveOpeningCutoff: (companyId, input) =>
      request(openingSchema, `${company(companyId)}/opening/cutoff`, write("PUT", input)),
    saveOpeningSection: (companyId, input) => {
      const { section, ...body } = input;
      return request(
        openingSchema,
        `${company(companyId)}/opening/${id(section)}`,
        write("PUT", body),
      );
    },
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
};
