"use client";

import { createContext, useContext } from "react";
import type { DistributionService } from "./ports/distribution-service";

type ServiceContextValue = { service: DistributionService; actorId: string };

const ServiceContext = createContext<ServiceContextValue | null>(null);

/** Composition root seam: the demo provider supplies the mock adapter; Phase 3 supplies HTTP. */
export const ServiceProvider = ServiceContext.Provider;

function useServiceContext(): ServiceContextValue {
  const value = useContext(ServiceContext);
  if (!value) throw new Error("ServiceProvider is missing");
  return value;
}

export function useService(): DistributionService {
  return useServiceContext().service;
}

export function useActorId(): string {
  return useServiceContext().actorId;
}
