"use client";

import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { demoSeed } from "@/data/mock/demo-seed";
import { createMockService, type MockDistributionService } from "@/data/mock/mock-service";
import { ServiceProvider } from "@/data/service-context";

type DemoControls = {
  users: MockDistributionService["users"];
  actorId: string;
  setActor: (userId: string) => void;
  reset: () => void;
};

const DemoContext = createContext<DemoControls | null>(null);

/** Demo-only composition: mock adapter, demo user switching and reset (guide section 6.1). */
export function DemoProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [service] = useState(() => createMockService(demoSeed));
  const [actorId, setActorId] = useState(() => service.getActorId());

  const setActor = useCallback(
    (userId: string) => {
      service.setActorId(userId);
      setActorId(userId);
    },
    [service],
  );

  const reset = useCallback(() => {
    service.reset();
    void queryClient.resetQueries();
  }, [service, queryClient]);

  const controls = useMemo(
    () => ({ users: service.users, actorId, setActor, reset }),
    [service, actorId, setActor, reset],
  );
  const serviceValue = useMemo(() => ({ service, actorId }), [service, actorId]);

  return (
    <DemoContext.Provider value={controls}>
      <ServiceProvider value={serviceValue}>{children}</ServiceProvider>
    </DemoContext.Provider>
  );
}

export function useDemoControls(): DemoControls {
  const value = useContext(DemoContext);
  if (!value) throw new Error("DemoProvider is missing");
  return value;
}
