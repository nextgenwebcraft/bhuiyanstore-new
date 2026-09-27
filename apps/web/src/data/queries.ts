"use client";

import { useQuery } from "@tanstack/react-query";
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
