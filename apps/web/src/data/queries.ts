"use client";

import { resourceIds, type ResourceId } from "@bsd/architecture";
import type {
  CompanyUpsertRequest,
  DailySalesSummaryPostRequest,
  GoodsReceiptPostRequest,
  OldDueCollectionPostRequest,
  Opening,
  OpeningSaveRequest,
  PriceChangeRequest,
  ProductCreateRequest,
  ProductPackRequest,
  RoleUpsertRequest,
  StaffAssignmentRequest,
  StaffCreateRequest,
  StaffUpsertRequest,
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

export function useBatches(companyId: string) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.batches(actorId, companyId),
    queryFn: ({ signal }) => service.listBatches(companyId, { signal }),
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

export function useGoodsReceipts(companyId: string) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.goodsReceipts(actorId, companyId),
    queryFn: ({ signal }) => service.listGoodsReceipts(companyId, { signal }),
  });
}

export function useDailySalesSummaries(companyId: string) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.dailySalesSummaries(actorId, companyId),
    queryFn: ({ signal }) => service.listDailySalesSummaries(companyId, { signal }),
  });
}

export function useMarketDues(companyId: string) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.marketDues(actorId, companyId),
    queryFn: ({ signal }) => service.listMarketDues(companyId, { signal }),
  });
}

export function useOldDueCollections(companyId: string) {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.oldDueCollections(actorId, companyId),
    queryFn: ({ signal }) => service.listOldDueCollections(companyId, { signal }),
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

export function usePostGoodsReceipt(companyId: string) {
  const service = useService();
  return usePostingMutation(companyId, "goodsReceipt", (input: GoodsReceiptPostRequest) =>
    service.postGoodsReceipt(companyId, input),
  );
}

export function usePostDailySalesSummary(companyId: string) {
  const service = useService();
  return usePostingMutation(companyId, "dailySalesSummary", (input: DailySalesSummaryPostRequest) =>
    service.postDailySalesSummary(companyId, input),
  );
}

export function usePostOldDueCollection(companyId: string) {
  const service = useService();
  return usePostingMutation(companyId, "oldDueCollection", (input: OldDueCollectionPostRequest) =>
    service.postOldDueCollection(companyId, input),
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
    [resourceIds.product, resourceIds.productHistory, resourceIds.dashboardSummary],
  );
}
