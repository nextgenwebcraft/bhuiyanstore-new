"use client";

import { resourceIds, type ResourceId } from "@bsd/architecture";
import type {
  CompanyUpsertRequest,
  DamageCaseCreateRequest,
  DamageEventRequest,
  DsrDay,
  DsrDaySaveRequest,
  MoneyEntryPostRequest,
  Opening,
  OpeningSaveRequest,
  PayrollAction,
  PayrollSaveRequest,
  PayrollTransitionRequest,
  PriceChangeRequest,
  ProductCreateRequest,
  ProductPackRequest,
  ReportId,
  ReportRange,
  RoleUpsertRequest,
  StaffAccountKind,
  StaffAssignmentRequest,
  StaffCreateRequest,
  StaffUpsertRequest,
  StockEntryPostRequest,
  SupplierUpsertRequest,
  UserCreateRequest,
  UserPasswordResetRequest,
  UserUpdateRequest,
} from "@bsd/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ConfigListId, ConfigLists } from "./ports/distribution-service";
import { postingEffects, queryKeys, resourceKey } from "./query-keys";
import { useActorId, useService } from "./service-context";

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
    mutationFn: (input: CompanyUpsertRequest) => service.createCompany(input),
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

export function useSuppliers(companyId: string) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.suppliers(actorId, companyId),
    queryFn: ({ signal }) => service.listSuppliers(companyId, { signal }),
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

export function useDashboardSummary(companyId: string, date: string) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.dashboardSummary(actorId, companyId, date),
    queryFn: ({ signal }) => service.getDashboardSummary(companyId, date, { signal }),
    placeholderData: (previous) => previous,
  });
}

export function useCreateProduct(companyId: string) {
  const service = useService();
  const actorId = useActorId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ProductCreateRequest) => service.createProduct(companyId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.products(actorId, companyId) });
    },
  });
}

export function useUpdateProduct(companyId: string) {
  const service = useService();
  const actorId = useActorId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, input }: { productId: string; input: ProductCreateRequest }) =>
      service.updateProduct(companyId, productId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.products(actorId, companyId) });
    },
  });
}

function usePostingMutation<TInput, TResult>(
  companyId: string,
  effects: keyof typeof postingEffects,
  post: (input: TInput) => Promise<TResult>,
) {
  const actorId = useActorId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: post,
    // Awaited, so the success state never renders beside stale balances.
    onSuccess: () =>
      Promise.all(
        postingEffects[effects].map((resource) =>
          queryClient.invalidateQueries({ queryKey: resourceKey(actorId, companyId, resource) }),
        ),
      ),
  });
}

// ------------------------------------------------------------- daily entry (Phase E)

export function useDayView(companyId: string, date: string) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.dayView(actorId, companyId, date),
    queryFn: ({ signal }) => service.getDayView(companyId, date, { signal }),
    placeholderData: (previous) => previous,
  });
}

export function useStockEntries(companyId: string, date: string) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.stockEntries(actorId, companyId, date),
    queryFn: ({ signal }) => service.listStockEntries(companyId, date, { signal }),
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
    }: {
      action: "post" | "reverse" | "discard";
      dayId: string;
      version: number;
    }): Promise<DsrDay | null> => {
      if (action === "post") return service.postDsrDay(companyId, dayId, { version });
      if (action === "reverse") return service.reverseDsrDay(companyId, dayId, { version });
      await service.discardDsrDay(companyId, dayId, { version });
      return null;
    },
  );
}

export function useMoneyEntries(
  companyId: string,
  query: { from: string; to?: string; staffId?: string },
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

export function useReverseMoneyEntry(companyId: string) {
  const service = useService();
  return usePostingMutation(companyId, "money", (entryId: string) =>
    service.reverseMoneyEntry(companyId, entryId),
  );
}

// ------------------------------------------------------------- month view and reports (Phase F)

export function useMonthView(companyId: string, month: string) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.monthView(actorId, companyId, month),
    queryFn: ({ signal }) => service.getMonthView(companyId, month, { signal }),
    placeholderData: (previous) => previous,
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

export function useReport(companyId: string, report: ReportId, range: ReportRange) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.report(actorId, companyId, report, range.from, range.to),
    queryFn: ({ signal }) => service.getReport(companyId, report, range, { signal }),
    placeholderData: (previous) => previous,
    enabled: range.from <= range.to,
  });
}

// ------------------------------------------------------------- accounts, payroll, damage (Phase G)

export function useStaffAccounts(companyId: string, kind: StaffAccountKind, date: string) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.staffAccounts(actorId, companyId, kind, date),
    queryFn: ({ signal }) => service.getStaffAccounts(companyId, { kind, date }, { signal }),
    placeholderData: (previous) => previous,
  });
}

export function useStaffStatement(companyId: string, staffId: string, range: ReportRange) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.staffStatement(actorId, companyId, staffId, range.from, range.to),
    queryFn: ({ signal }) => service.getStaffStatement(companyId, staffId, range, { signal }),
    placeholderData: (previous) => previous,
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

export function useDamageCases(companyId: string, status: "open" | "all") {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.damageCases(actorId, companyId, status),
    queryFn: ({ signal }) =>
      service.listDamageCases(companyId, status === "open" ? { status } : {}, { signal }),
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

export function useSaveSupplier(companyId: string) {
  const service = useService();
  return useMasterMutation(
    [resourceIds.supplier],
    ({ supplierId, input }: { supplierId?: string; input: SupplierUpsertRequest }) =>
      supplierId
        ? service.updateSupplier(companyId, supplierId, input)
        : service.createSupplier(companyId, input),
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
  cashAccounts: resourceIds.cashAccount,
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

// ------------------------------------------------------------- opening balances (Phase D)

export function useOpening(companyId: string) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.opening(actorId, companyId),
    queryFn: ({ signal }) => service.getOpening(companyId, { signal }),
  });
}

/** Every opening command returns the new snapshot; it replaces the cached one directly. */
function useOpeningCommand<TInput>(
  companyId: string,
  run: (input: TInput) => Promise<Opening>,
  alsoRefresh: readonly ResourceId[] = [],
) {
  const actorId = useActorId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (opening) => {
      queryClient.setQueryData(queryKeys.opening(actorId, companyId), opening);
      for (const resource of alsoRefresh) {
        void queryClient.invalidateQueries({ queryKey: resourceKey(actorId, companyId, resource) });
      }
    },
  });
}

export function useSaveOpening(companyId: string) {
  const service = useService();
  return useOpeningCommand(companyId, (input: OpeningSaveRequest) =>
    service.saveOpening(companyId, input),
  );
}

export function useInspectOpeningWorkbook(companyId: string) {
  const service = useService();
  return useMutation({
    mutationFn: (file: Blob) => service.inspectOpeningWorkbook(companyId, file),
  });
}

export function useImportOpeningWorkbook(companyId: string) {
  const service = useService();
  return useOpeningCommand(
    companyId,
    (input: { file: Blob; fileName: string; sheet: string | null; version: number }) =>
      service.importOpeningWorkbook(companyId, input),
  );
}

export function useApproveOpening(companyId: string) {
  const service = useService();
  return useOpeningCommand(companyId, (version: number) =>
    service.approveOpening(companyId, { version }),
  );
}

export function useActivateOpening(companyId: string) {
  const service = useService();
  return useOpeningCommand(
    companyId,
    (version: number) => service.activateOpening(companyId, { version }),
    [
      resourceIds.product,
      resourceIds.productHistory,
      resourceIds.ledger,
      resourceIds.dashboardSummary,
    ],
  );
}
