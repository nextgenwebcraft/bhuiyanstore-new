"use client";

import { resourceIds, type ResourceId } from "@bsd/architecture";
import type {
  CompanyCreateRequest,
  CompanyUpsertRequest,
  DamageCaseCreateRequest,
  DamageEventRequest,
  DsrDay,
  DsrDaySaveRequest,
  OpeningCutoffRequest,
  OpeningSectionSaveRequest,
  FieldDayEndRequest,
  FieldShopCreateRequest,
  FieldVisitDeleteRequest,
  FieldVisitSaveRequest,
  MoneyEntryPostRequest,
  PayrollAction,
  PayrollSaveRequest,
  PayrollTransitionRequest,
  PriceChangeRequest,
  ProductCreateRequest,
  ProductPackRequest,
  ReportId,
  ReportRange,
  InvestmentsRequest,
  PartnerPayRequest,
  PreviousDueCreateRequest,
  PreviousDueReduceRequest,
  PreviousDueUpdateRequest,
  CompanyCheckBulkCreateRequest,
  CompanyCheckPaymentRequest,
  ShareholderCreateRequest,
  ShareholderUpdateRequest,
  RoleUpsertRequest,
  StaffAccountKind,
  StaffAssignmentRequest,
  StaffCreateRequest,
  StaffLoginCreateRequest,
  StaffLoginPasswordResetRequest,
  StaffLoginUpdateRequest,
  StaffUpsertRequest,
  ShopUpsertRequest,
  StockEntryPostRequest,
  OrderPaymentCorrectRequest,
  UserCreateRequest,
  UserPasswordResetRequest,
  UserUpdateRequest,
} from "@bsd/contracts";
import {
  keepPreviousData,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { ConfigListId, ConfigLists } from "./ports/distribution-service";
import { postingEffects, queryKeys, resourceKey } from "./query-keys";
import { useActorId, useService } from "./service-context";

/** Refreshes every resource a command writes (postingEffects) for one company; resolves when done. */
function useInvalidate(companyId: string, effects: keyof typeof postingEffects) {
  const actorId = useActorId();
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      postingEffects[effects].map((resource) =>
        queryClient.invalidateQueries({ queryKey: resourceKey(actorId, companyId, resource) }),
      ),
    );
}

export function useWorkspaces() {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.workspaces(actorId),
    queryFn: ({ signal }) => service.listWorkspaces({ signal }),
  });
}

export function useCreateCompany() {
  const service = useService();
  const actorId = useActorId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CompanyCreateRequest) => service.createCompany(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.workspaces(actorId) }),
  });
}

export function useUpdateCompany(companyId: string) {
  const service = useService();
  const actorId = useActorId();
  const queryClient = useQueryClient();
  const invalidateWorkspace = useInvalidate(companyId, "workspace");
  return useMutation({
    mutationFn: (input: CompanyUpsertRequest) => service.updateCompany(companyId, input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaces(actorId) }),
        invalidateWorkspace(),
      ]);
    },
  });
}

export function useDeleteCompany() {
  const service = useService();
  const actorId = useActorId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (companyId: string) => service.deleteCompany(companyId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.workspaces(actorId) }),
  });
}

export function useWorkspace(companyId: string) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.workspace(actorId, companyId),
    queryFn: ({ signal }) => service.getWorkspace(companyId, { signal }),
  });
}

export function useProducts(companyId: string) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.products(actorId, companyId),
    queryFn: ({ signal }) => service.listProducts(companyId, { signal }),
  });
}

export function useStaff(companyId: string) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.staff(actorId, companyId),
    queryFn: ({ signal }) => service.listStaff(companyId, { signal }),
  });
}

export function useDashboardSummary(companyId: string, range: ReportRange) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.dashboardSummary(actorId, companyId, range.from, range.to),
    queryFn: ({ signal }) => service.getDashboardSummary(companyId, range, { signal }),
    // Keeps the opening cutoff (period choices) while another period loads.
    placeholderData: keepPreviousData,
  });
}

export function useDashboardMonthly(companyId: string, year: string, enabled = true) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.dashboardMonthly(actorId, companyId, year),
    queryFn: ({ signal }) => service.getDashboardMonthly(companyId, year, { signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** D146 History → সারাংশ. */
export function useCompanyCapitalYear(companyId: string, year: string) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.companyCapitalYear(actorId, companyId, year),
    queryFn: ({ signal }) => service.getCompanyCapitalYear(companyId, year, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useDashboardDaily(companyId: string, month: string, enabled = true) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.dashboardDaily(actorId, companyId, month),
    queryFn: ({ signal }) => service.getDashboardDaily(companyId, month, { signal }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useApproveDsrHandoversForRange(companyId: string) {
  const service = useService();
  return usePostingMutation(companyId, "dsrDay", (range: { from: string; to: string }) =>
    service.approveDsrHandoversForRange(companyId, range),
  );
}

export function useCreateProduct(companyId: string) {
  const service = useService();
  const invalidate = useInvalidate(companyId, "products");
  return useMutation({
    mutationFn: (input: ProductCreateRequest) => service.createProduct(companyId, input),
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useUpdateProduct(companyId: string) {
  const service = useService();
  const invalidate = useInvalidate(companyId, "products");
  return useMutation({
    mutationFn: ({ productId, input }: { productId: string; input: ProductCreateRequest }) =>
      service.updateProduct(companyId, productId, input),
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useDeleteProduct(companyId: string) {
  const service = useService();
  return useMasterMutation([resourceIds.product, resourceIds.productHistory], (productId: string) =>
    service.deleteProduct(companyId, productId),
  );
}

function usePostingMutation<TInput, TResult>(
  companyId: string,
  effects: keyof typeof postingEffects,
  post: (input: TInput) => Promise<TResult>,
) {
  const invalidate = useInvalidate(companyId, effects);
  return useMutation({
    mutationFn: post,
    // Awaited, so the success state never renders beside stale balances.
    onSuccess: invalidate,
  });
}

// ------------------------------------------------------------- daily entry (Phase E)

export function useDayView(companyId: string, date: string, enabled = true) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.dayView(actorId, companyId, date),
    queryFn: ({ signal }) => service.getDayView(companyId, date, { signal }),
    enabled,
  });
}

export function useStockTrackingProducts(
  companyId: string,
  page: number,
  pageSize: number,
  q = "",
  enabled = true,
) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.stockTrackingProducts(actorId, companyId, page, pageSize, q),
    queryFn: ({ signal }) =>
      service.listStockTrackingProducts(companyId, { page, pageSize, q }, { signal }),
    enabled: enabled && companyId !== "",
  });
}

export function useStockTrackingProduct(
  companyId: string,
  productId: string,
  page: number,
  pageSize: number,
  enabled = true,
) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.stockTrackingProduct(actorId, companyId, productId, page, pageSize),
    queryFn: ({ signal }) =>
      service.getStockTrackingProduct(companyId, productId, { page, pageSize }, { signal }),
    enabled: enabled && companyId !== "" && productId !== "",
  });
}

export function useStockEntries(companyId: string, date: string, enabled = true) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.stockEntries(actorId, companyId, date),
    queryFn: ({ signal }) => service.listStockEntries(companyId, date, { signal }),
    enabled: enabled && companyId !== "" && date !== "",
  });
}

export function usePostStockEntries(companyId: string) {
  const service = useService();
  return usePostingMutation(companyId, "stock", (input: StockEntryPostRequest) =>
    service.postStockEntries(companyId, input),
  );
}

export function useReverseStockEntry(companyId: string) {
  const service = useService();
  return usePostingMutation(companyId, "stock", (entryId: string) =>
    service.reverseStockEntry(companyId, entryId),
  );
}

export function useCorrectOrderPayment(companyId: string) {
  const service = useService();
  return usePostingMutation(
    companyId,
    "stock",
    (input: { entryId: string; body: OrderPaymentCorrectRequest }) =>
      service.correctOrderPayment(companyId, input.entryId, input.body),
  );
}

export function useApprovePendingOrders(companyId: string) {
  const service = useService();
  return usePostingMutation(companyId, "stock", (date: string) =>
    service.approvePendingOrders(companyId, date),
  );
}

export function useDiscardPendingOrder(companyId: string) {
  const service = useService();
  return usePostingMutation(companyId, "stock", (entryId: string) =>
    service.discardPendingOrder(companyId, entryId),
  );
}

export function useDsrDays(companyId: string, date: string) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.dsrDays(actorId, companyId, date),
    queryFn: ({ signal }) => service.listDsrDays(companyId, date, { signal }),
  });
}

export function useSaveDsrDay(companyId: string) {
  const service = useService();
  return usePostingMutation(companyId, "dsrDay", (input: DsrDaySaveRequest) =>
    service.saveDsrDay(companyId, input),
  );
}

export function useDsrDayCommand(companyId: string) {
  const service = useService();
  return usePostingMutation(
    companyId,
    "dsrDay",
    async ({
      action,
      dayId,
      version,
      cashHandedOver,
    }: {
      action: "post" | "reverse" | "discard" | "handover-submit" | "handover-approve";
      dayId: string;
      version: number;
      cashHandedOver?: string;
    }): Promise<DsrDay | null> => {
      if (action === "post") return service.postDsrDay(companyId, dayId, { version });
      if (action === "reverse") return service.reverseDsrDay(companyId, dayId, { version });
      if (action === "handover-submit") {
        if (cashHandedOver === undefined) throw new Error("cashHandedOver required");
        return service.submitDsrHandover(companyId, dayId, { version, cashHandedOver });
      }
      if (action === "handover-approve") {
        return service.approveDsrHandover(companyId, dayId, { version });
      }
      await service.discardDsrDay(companyId, dayId, { version });
      return null;
    },
  );
}

/** D71: approve or reject a DSR's field report; approving corrects the sheet. */
export function useDecideFieldReport(companyId: string) {
  const service = useService();
  return usePostingMutation(
    companyId,
    "dsrDay",
    ({
      reportId,
      action,
      version,
    }: {
      reportId: string;
      action: "approve" | "reject";
      version: number;
    }) => service.decideFieldReport(companyId, reportId, action, { version }),
  );
}

export function useMoneyEntries(
  companyId: string,
  query: {
    from: string;
    to?: string;
    staffId?: string;
    shopId?: string;
    sheetStaffId?: string;
  },
  enabled = true,
) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.moneyEntries(
      actorId,
      companyId,
      query.from,
      query.to ?? query.from,
      query.staffId ?? "",
      query.shopId ?? "",
      query.sheetStaffId ?? "",
    ),
    queryFn: ({ signal }) => service.listMoneyEntries(companyId, query, { signal }),
    enabled,
  });
}

export function usePostMoneyEntry(companyId: string) {
  const service = useService();
  return usePostingMutation(companyId, "money", (input: MoneyEntryPostRequest) =>
    service.postMoneyEntry(companyId, input),
  );
}

export function useCorrectMoneyEntry(companyId: string) {
  const service = useService();
  return usePostingMutation(
    companyId,
    "money",
    (input: { entryId: string; body: MoneyEntryPostRequest }) =>
      service.correctMoneyEntry(companyId, input.entryId, input.body),
  );
}

export function useReverseMoneyEntry(companyId: string) {
  const service = useService();
  return usePostingMutation(companyId, "money", (entryId: string) =>
    service.reverseMoneyEntry(companyId, entryId),
  );
}

export function useDeleteMoneyEntry(companyId: string) {
  const service = useService();
  return usePostingMutation(companyId, "money", (entryId: string) =>
    service.deleteMoneyEntry(companyId, entryId),
  );
}

export function useHistoryStockEntries(
  companyId: string,
  group: import("@bsd/contracts").HistoryStockKindGroup,
  page: number,
  pageSize: number,
  date: string | undefined,
  status: import("@bsd/contracts").HistoryStatusFilter,
  /** When true, skip the request until a date is chosen (orders/stock date-card drill-in). */
  requireDate = false,
) {
  "use no memo";
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.historyStock(actorId, companyId, group, page, pageSize, date, status),
    queryFn: ({ signal }) =>
      service.listHistoryStockEntries(
        companyId,
        group,
        { page, pageSize, ...(date ? { date } : {}), status },
        { signal },
      ),
    enabled: !requireDate || Boolean(date),
  });
}

export function useHistoryStockDateSummaries(
  companyId: string,
  group: import("@bsd/contracts").HistoryStockKindGroup,
  status: import("@bsd/contracts").HistoryStatusFilter,
  enabled = true,
) {
  "use no memo";
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.historyStockDates(actorId, companyId, group, status),
    queryFn: ({ signal }) =>
      service.listHistoryStockDateSummaries(companyId, group, { status }, { signal }),
    enabled,
  });
}

export function useHistoryMoneyEntries(
  companyId: string,
  group: import("@bsd/contracts").HistoryMoneyKindGroup,
  page: number,
  pageSize: number,
  date: string | undefined,
  status: import("@bsd/contracts").HistoryStatusFilter,
) {
  "use no memo";
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.historyMoney(actorId, companyId, group, page, pageSize, date, status),
    queryFn: ({ signal }) =>
      service.listHistoryMoneyEntries(
        companyId,
        group,
        { page, pageSize, ...(date ? { date } : {}), status },
        { signal },
      ),
  });
}

export function useHistoryDsrDays(
  companyId: string,
  page: number,
  pageSize: number,
  date: string | undefined,
  status: import("@bsd/contracts").HistoryStatusFilter,
) {
  "use no memo";
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.historyDsr(actorId, companyId, page, pageSize, date, status),
    queryFn: ({ signal }) =>
      service.listHistoryDsrDays(
        companyId,
        { page, pageSize, ...(date ? { date } : {}), status },
        { signal },
      ),
  });
}

// ------------------------------------------------------------- month view and reports (Phase F)

export function useMonthView(companyId: string, month: string) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.monthView(actorId, companyId, month),
    queryFn: ({ signal }) => service.getMonthView(companyId, month, { signal }),
  });
}

export function useMonthCommand(companyId: string) {
  const service = useService();
  return usePostingMutation(
    companyId,
    "monthClose",
    ({ action, month }: { action: "close" | "reopen"; month: string }) =>
      action === "close"
        ? service.closeMonth(companyId, month)
        : service.reopenMonth(companyId, month),
  );
}

// ------------------------------------------------------------- master panel (D66)

/** Opens (and on first use creates) the master company; super-admin only. */
export function useMasterWorkspace(enabled = true) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.masterWorkspace(actorId),
    queryFn: ({ signal }) => service.getMasterWorkspace({ signal }),
    enabled,
  });
}

export function useMasterSummary(companyId: string, range: ReportRange) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.masterSummary(actorId, companyId, range.from, range.to),
    queryFn: ({ signal }) => service.getMasterSummary(companyId, range, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useMasterMonth(companyId: string, month: string) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.masterMonth(actorId, companyId, month),
    queryFn: ({ signal }) => service.getMasterMonth(companyId, month, { signal }),
  });
}

/** Closing or reopening for every company changes every company's figures: refresh them all. */
export function useMasterMonthCommand(companyId: string) {
  const service = useService();
  const actorId = useActorId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ action, month }: { action: "close" | "reopen"; month: string }) =>
      service.masterMonthCommand(companyId, month, action),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.actor(actorId) }),
  });
}

export function useCompanyHishabYear(
  companyId: string,
  targetCompanyId: string,
  year: string,
  shareholderId: string,
) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.companyHishabYear(actorId, companyId, targetCompanyId, year, shareholderId),
    queryFn: ({ signal }) =>
      service.getCompanyHishabYear(companyId, targetCompanyId, year, shareholderId || undefined, {
        signal,
      }),
    enabled: targetCompanyId !== "",
    placeholderData: keepPreviousData,
  });
}

export function useMasterHishabYear(companyId: string, year: string, shareholderId: string) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.masterHishabYear(actorId, companyId, year, shareholderId),
    queryFn: ({ signal }) =>
      service.getMasterHishabYear(companyId, year, shareholderId || undefined, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useShareholders(companyId: string, month: string) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.shareholders(actorId, companyId, month),
    queryFn: ({ signal }) => service.listShareholders(companyId, month, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function useCreateShareholder(companyId: string) {
  const service = useService();
  return useMasterMutation([resourceIds.shareMonth], (input: ShareholderCreateRequest) =>
    service.createShareholder(companyId, input),
  );
}

export function useUpdateShareholder(companyId: string) {
  const service = useService();
  return useMasterMutation(
    [resourceIds.shareMonth],
    ({ shareholderId, input }: { shareholderId: string; input: ShareholderUpdateRequest }) =>
      service.updateShareholder(companyId, shareholderId, input),
  );
}

export function useSaveInvestments(companyId: string) {
  const service = useService();
  return useMasterMutation(
    [resourceIds.shareMonth],
    ({ shareholderId, input }: { shareholderId: string; input: InvestmentsRequest }) =>
      service.saveInvestments(companyId, shareholderId, input),
  );
}

export function usePartnerPayoutMonth(companyId: string, month: string) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.partnerPayoutMonth(actorId, companyId, month),
    queryFn: ({ signal }) => service.getPartnerPayoutMonth(companyId, month, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function usePartnerPayoutHistory(companyId: string, year: string, shareholderId: string) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.partnerPayoutHistory(actorId, companyId, year, shareholderId),
    queryFn: ({ signal }) =>
      service.getPartnerPayoutHistory(companyId, year, shareholderId || undefined, { signal }),
    placeholderData: keepPreviousData,
  });
}

export function usePayPartners(companyId: string) {
  const service = useService();
  return useMasterMutation([resourceIds.shareMonth], (input: PartnerPayRequest) =>
    service.payPartners(companyId, input),
  );
}

export function useCancelPartnerPayout(companyId: string) {
  const service = useService();
  return useMasterMutation([resourceIds.shareMonth], (payoutId: string) =>
    service.cancelPartnerPayout(companyId, payoutId),
  );
}

export function usePreviousDues(companyId: string) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.previousDues(actorId, companyId),
    queryFn: ({ signal }) => service.listPreviousDues(companyId, { signal }),
  });
}

export function useCreatePreviousDue(companyId: string) {
  const service = useService();
  return useMasterMutation(
    [resourceIds.previousDue, resourceIds.shareMonth],
    (input: PreviousDueCreateRequest) => service.createPreviousDue(companyId, input),
  );
}

export function useUpdatePreviousDue(companyId: string) {
  const service = useService();
  return useMasterMutation(
    [resourceIds.previousDue, resourceIds.shareMonth],
    ({ previousDueId, input }: { previousDueId: string; input: PreviousDueUpdateRequest }) =>
      service.updatePreviousDue(companyId, previousDueId, input),
  );
}

export function useDeletePreviousDue(companyId: string) {
  const service = useService();
  return useMasterMutation(
    [resourceIds.previousDue, resourceIds.shareMonth],
    (previousDueId: string) => service.deletePreviousDue(companyId, previousDueId),
  );
}

export function useApplyPreviousDueReduction(companyId: string) {
  const service = useService();
  return useMasterMutation(
    [resourceIds.previousDue, resourceIds.shareMonth],
    (input: PreviousDueReduceRequest) => service.applyPreviousDueReduction(companyId, input),
  );
}

export function useCompanyCheckDues(companyId: string) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.companyCheckDues(actorId, companyId),
    queryFn: ({ signal }) => service.listCompanyCheckDues(companyId, { signal }),
  });
}

export function useCompanyCheckPicker(companyId: string, enabled = true) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.companyCheckPicker(actorId, companyId),
    queryFn: ({ signal }) => service.listCompanyCheckPicker(companyId, { signal }),
    // Always fresh: a cheque added on the cheque page must be pickable at once.
    staleTime: 0,
    enabled,
  });
}

export function useBulkCreateCompanyChecks(companyId: string) {
  const service = useService();
  return usePostingMutation(companyId, "checks", (input: CompanyCheckBulkCreateRequest) =>
    service.bulkCreateCompanyChecks(companyId, input),
  );
}

export function usePostCompanyCheckPayment(companyId: string) {
  const service = useService();
  return usePostingMutation(companyId, "checks", (input: CompanyCheckPaymentRequest) =>
    service.postCompanyCheckPayment(companyId, input),
  );
}

export function useCompanyCheckHistory(companyId: string) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.companyCheckHistory(actorId, companyId),
    queryFn: ({ signal }) => service.listCompanyCheckHistory(companyId, { signal }),
  });
}

export function useReport(companyId: string, report: ReportId, range: ReportRange, enabled = true) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.report(actorId, companyId, report, range.from, range.to),
    queryFn: ({ signal }) => service.getReport(companyId, report, range, { signal }),
    enabled: enabled && range.from <= range.to,
  });
}

// ------------------------------------------------------------- accounts, payroll, damage (Phase G)

export function useStaffAccounts(companyId: string, kind: StaffAccountKind, date: string) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.staffAccounts(actorId, companyId, kind, date),
    queryFn: ({ signal }) => service.getStaffAccounts(companyId, { kind, date }, { signal }),
  });
}

export function useStaffStatement(companyId: string, staffId: string, range: ReportRange) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.staffStatement(actorId, companyId, staffId, range.from, range.to),
    queryFn: ({ signal }) => service.getStaffStatement(companyId, staffId, range, { signal }),
    enabled: staffId !== "" && range.from <= range.to,
  });
}

export function usePayrollRun(companyId: string, month: string) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.payrollRun(actorId, companyId, month),
    queryFn: ({ signal }) => service.getPayrollRun(companyId, month, { signal }),
  });
}

export function useSavePayrollRun(companyId: string, month: string) {
  const service = useService();
  return usePostingMutation(companyId, "payroll", (input: PayrollSaveRequest) =>
    service.savePayrollRun(companyId, month, input),
  );
}

export function usePayrollCommand(companyId: string, month: string) {
  const service = useService();
  return usePostingMutation(
    companyId,
    "payroll",
    ({ action, input }: { action: PayrollAction; input: PayrollTransitionRequest }) =>
      service.payrollCommand(companyId, month, action, input),
  );
}

export function useDamageCases(
  companyId: string,
  filter: { status?: "open"; from?: string; to?: string } = {},
) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.damageCases(actorId, companyId, filter),
    queryFn: ({ signal }) => service.listDamageCases(companyId, filter, { signal }),
  });
}

export function useCreateDamageCase(companyId: string) {
  const service = useService();
  return usePostingMutation(companyId, "damage", (input: DamageCaseCreateRequest) =>
    service.createDamageCase(companyId, input),
  );
}

export function useDamageCaseCommand(companyId: string) {
  const service = useService();
  return usePostingMutation(
    companyId,
    "damage",
    (
      command:
        | { action: "event"; caseId: string; input: DamageEventRequest }
        | { action: "reverse"; eventId: string }
        | { action: "cancel"; caseId: string },
    ) => {
      if (command.action === "event") {
        return service.postDamageEvent(companyId, command.caseId, command.input);
      }
      if (command.action === "reverse")
        return service.reverseDamageEvent(companyId, command.eventId);
      return service.cancelDamageCase(companyId, command.caseId);
    },
  );
}

// ------------------------------------------------------------- masters and configuration

/** Refreshes every cached query of the actor that holds one of these resources, in any company. */
function useMasterMutation<TInput, TResult>(
  resources: readonly ResourceId[],
  write: (input: TInput) => Promise<TResult>,
) {
  const actorId = useActorId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: write,
    onSuccess: () =>
      queryClient.invalidateQueries({
        predicate: (query) =>
          query.queryKey[0] === "actor" &&
          query.queryKey[1] === actorId &&
          query.queryKey.some((part) => resources.includes(part as ResourceId)),
      }),
  });
}

export function useProductHistory(companyId: string, productId: string) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.productHistory(actorId, companyId, productId),
    queryFn: ({ signal }) => service.getProductHistory(companyId, productId, { signal }),
  });
}

export function useAddProductPack(companyId: string, productId: string) {
  const service = useService();
  return useMasterMutation(
    [resourceIds.productHistory, resourceIds.product],
    (input: ProductPackRequest) => service.addProductPack(companyId, productId, input),
  );
}

export function useSetProductPrice(companyId: string, productId: string) {
  const service = useService();
  return useMasterMutation([resourceIds.productHistory], (input: PriceChangeRequest) =>
    service.setProductPrice(companyId, productId, input),
  );
}

export function useStaffRecords(companyId: string) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.staffRecords(actorId, companyId),
    queryFn: ({ signal }) => service.listStaffRecords(companyId, { signal }),
  });
}

export function useShops(companyId: string) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.shops(actorId, companyId),
    queryFn: ({ signal }) => service.listShops(companyId, { signal }),
  });
}

export function useOrderTargets(companyId: string, dashboardOnly = false, enabled = true) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.orderTargets(actorId, companyId, dashboardOnly),
    queryFn: ({ signal }) => service.listOrderTargets(companyId, { dashboardOnly }, { signal }),
    enabled,
  });
}

export function useSaveOrderTarget(companyId: string) {
  const service = useService();
  return useMasterMutation(
    [resourceIds.orderTarget],
    ({
      targetId,
      input,
    }: {
      targetId?: string;
      input: import("@bsd/contracts").OrderTargetUpsertRequest;
    }) =>
      targetId
        ? service.updateOrderTarget(companyId, targetId, input)
        : service.createOrderTarget(companyId, input),
  );
}

export function useArchiveOrderTarget(companyId: string) {
  const service = useService();
  return useMasterMutation([resourceIds.orderTarget], (targetId: string) =>
    service.archiveOrderTarget(companyId, targetId),
  );
}

export function useSaveShop(companyId: string) {
  const service = useService();
  return useMasterMutation(
    [resourceIds.shop],
    ({ shopId, input }: { shopId?: string; input: ShopUpsertRequest }) =>
      shopId ? service.updateShop(companyId, shopId, input) : service.createShop(companyId, input),
  );
}

export function useDeleteShop(companyId: string) {
  const service = useService();
  return useMasterMutation([resourceIds.shop], (shopId: string) =>
    service.deleteShop(companyId, shopId),
  );
}

export function useShopStatement(
  companyId: string,
  shopId: string,
  range: { from: string; to: string },
) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.shopStatement(actorId, companyId, shopId, range.from, range.to),
    queryFn: ({ signal }) => service.getShopStatement(companyId, shopId, range, { signal }),
    enabled: shopId !== "" && range.from <= range.to,
  });
}

export function useAllStaff(enabled: boolean) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.tenant(actorId, resourceIds.staffRecord),
    queryFn: ({ signal }) => service.listAllStaff({ signal }),
    enabled,
  });
}

const staffResources = [resourceIds.staffRecord, resourceIds.staffMember] as const;

export function useCreateStaff(companyId: string) {
  const service = useService();
  return useMasterMutation(staffResources, (input: StaffCreateRequest) =>
    service.createStaff(companyId, input),
  );
}

export function useUpdateStaff(companyId: string) {
  const service = useService();
  return useMasterMutation(
    staffResources,
    ({ staffId, input }: { staffId: string; input: StaffUpsertRequest }) =>
      service.updateStaff(companyId, staffId, input),
  );
}

export function useStaffDeleteImpact(companyId: string, staffId: string | null) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: [...queryKeys.staffRecords(actorId, companyId), "delete-impact", staffId],
    queryFn: ({ signal }) => {
      if (!staffId) throw new Error("staffId required");
      return service.getStaffDeleteImpact(companyId, staffId);
    },
    enabled: staffId !== null,
  });
}

export function useDeleteStaff(companyId: string) {
  const service = useService();
  return useMasterMutation(
    [
      ...staffResources,
      resourceIds.moneyEntry,
      resourceIds.dsrDay,
      resourceIds.ledger,
      resourceIds.opening,
      resourceIds.payrollRun,
      resourceIds.damageCase,
      resourceIds.dashboardSummary,
      resourceIds.fieldDay,
    ],
    (staffId: string) => service.deleteStaff(companyId, staffId),
  );
}

export function useSaveStaffAssignment(companyId: string) {
  const service = useService();
  return useMasterMutation(
    staffResources,
    ({
      staffId,
      assignmentId,
      input,
    }: {
      staffId: string;
      assignmentId?: string;
      input: StaffAssignmentRequest;
    }) =>
      assignmentId
        ? service.updateStaffAssignment(companyId, staffId, assignmentId, input)
        : service.addStaffAssignment(companyId, staffId, input),
  );
}

const configResource: Record<ConfigListId, ResourceId> = {
  staffRoles: resourceIds.staffRole,
  expenseCategories: resourceIds.expenseCategory,
};

export function useConfigList<K extends ConfigListId>(list: K) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.tenant(actorId, configResource[list]),
    queryFn: ({ signal }) => service.listConfig(list, { signal }),
  });
}

export function useSaveConfig<K extends ConfigListId>(list: K) {
  const service = useService();
  // Role names appear inside staff records.
  return useMasterMutation(
    [configResource[list], ...(list === "staffRoles" ? staffResources : [])],
    ({ id, input }: { id?: string; input: ConfigLists[K]["input"] }) =>
      id ? service.updateConfig(list, id, input) : service.createConfig(list, input),
  );
}

export function useRoles() {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.tenant(actorId, resourceIds.role),
    queryFn: ({ signal }) => service.listRoles({ signal }),
  });
}

export function useSaveRole() {
  const service = useService();
  // Role permissions change what every workspace shows.
  return useMasterMutation(
    [resourceIds.role, resourceIds.companyWorkspace],
    ({ roleId, input }: { roleId?: string; input: RoleUpsertRequest }) =>
      roleId ? service.updateRole(roleId, input) : service.createRole(input),
  );
}

export function useUsers() {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.tenant(actorId, resourceIds.user),
    queryFn: ({ signal }) => service.listUsers({ signal }),
  });
}

export function useCreateUser() {
  const service = useService();
  return useMasterMutation([resourceIds.user], (input: UserCreateRequest) =>
    service.createUser(input),
  );
}

export function useUpdateUser() {
  const service = useService();
  return useMasterMutation(
    [resourceIds.user],
    ({ userId, input }: { userId: string; input: UserUpdateRequest }) =>
      service.updateUser(userId, input),
  );
}

export function useResetUserPassword() {
  const service = useService();
  return useMasterMutation(
    [resourceIds.user],
    ({ userId, input }: { userId: string; input: UserPasswordResetRequest }) =>
      service.resetUserPassword(userId, input),
  );
}

// ------------------------------------------------------------- DSR field panel (D40)

export function useFieldDay(companyId: string, date: string, enabled = true) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.fieldDay(actorId, companyId, date),
    queryFn: ({ signal }) => service.getFieldDay(companyId, date, { signal }),
    enabled,
  });
}

export function useDsrFieldDay(companyId: string, staffId: string, date: string, enabled = true) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: [...queryKeys.fieldDay(actorId, companyId, date), staffId] as const,
    queryFn: ({ signal }) => service.getDsrFieldDay(companyId, staffId, date, { signal }),
    enabled: enabled && staffId !== "",
  });
}

/** Field days of several people on one date; same cache entries as `useDsrFieldDay`. */
export function useDsrFieldDays(companyId: string, staffIds: readonly string[], date: string) {
  const service = useService();
  const actorId = useActorId();
  return useQueries({
    queries: staffIds.map((staffId) => ({
      queryKey: [...queryKeys.fieldDay(actorId, companyId, date), staffId] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        service.getDsrFieldDay(companyId, staffId, date, { signal }),
    })),
  });
}

export function useSaveFieldVisit(companyId: string) {
  const service = useService();
  return usePostingMutation(
    companyId,
    "field",
    ({ visitId, input }: { visitId?: string; input: FieldVisitSaveRequest }) =>
      service.saveFieldVisit(companyId, visitId, input),
  );
}

export function useDeleteFieldVisit(companyId: string) {
  const service = useService();
  return usePostingMutation(
    companyId,
    "field",
    ({ visitId, ...input }: { visitId: string } & FieldVisitDeleteRequest) =>
      service.deleteFieldVisit(companyId, visitId, input),
  );
}

export function useSaveFieldDayEnd(companyId: string) {
  const service = useService();
  return usePostingMutation(companyId, "fieldDayEnd", (input: FieldDayEndRequest) =>
    service.saveFieldDayEnd(companyId, input),
  );
}

export function useCreateFieldShop(companyId: string) {
  const service = useService();
  return usePostingMutation(companyId, "field", (input: FieldShopCreateRequest) =>
    service.createFieldShop(companyId, input),
  );
}

function useStaffLoginInvalidate(companyId: string) {
  const actorId = useActorId();
  const queryClient = useQueryClient();
  const invalidate = useInvalidate(companyId, "staffLogin");
  return () =>
    Promise.all([
      invalidate(),
      queryClient.invalidateQueries({
        queryKey: queryKeys.tenant(actorId, resourceIds.role),
      }),
    ]);
}

export function useCreateStaffLogin(companyId: string) {
  const service = useService();
  const onSuccess = useStaffLoginInvalidate(companyId);
  return useMutation({
    mutationFn: ({ staffId, input }: { staffId: string; input: StaffLoginCreateRequest }) =>
      service.createStaffLogin(companyId, staffId, input),
    onSuccess,
  });
}

export function useUpdateStaffLogin(companyId: string) {
  const service = useService();
  const onSuccess = useStaffLoginInvalidate(companyId);
  return useMutation({
    mutationFn: ({ staffId, input }: { staffId: string; input: StaffLoginUpdateRequest }) =>
      service.updateStaffLogin(companyId, staffId, input),
    onSuccess,
  });
}

export function useResetStaffLoginPassword(companyId: string) {
  const service = useService();
  const onSuccess = useStaffLoginInvalidate(companyId);
  return useMutation({
    mutationFn: ({ staffId, input }: { staffId: string; input: StaffLoginPasswordResetRequest }) =>
      service.resetStaffLoginPassword(companyId, staffId, input),
    onSuccess,
  });
}

// ------------------------------------------------------------- opening balances

export function useOpening(companyId: string) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.opening(actorId, companyId),
    queryFn: ({ signal }) => service.getOpening(companyId, { signal }),
  });
}

export function useSaveOpeningCutoff(companyId: string) {
  const service = useService();
  return usePostingMutation(companyId, "opening", (input: OpeningCutoffRequest) =>
    service.saveOpeningCutoff(companyId, input),
  );
}

export function useSaveOpeningSection(companyId: string) {
  const service = useService();
  return usePostingMutation(companyId, "opening", (input: OpeningSectionSaveRequest) =>
    service.saveOpeningSection(companyId, input),
  );
}
