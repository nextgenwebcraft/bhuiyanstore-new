"use client";

import type { ProductCreateRequest } from "@bsd/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./query-keys";
import { useActorId, useService } from "./service-context";

export function useWorkspaces() {
  const service = useService();
  const actorId = useActorId();
  return useQuery({
    queryKey: queryKeys.workspaces(actorId),
    queryFn: ({ signal }) => service.listWorkspaces({ signal }),
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
