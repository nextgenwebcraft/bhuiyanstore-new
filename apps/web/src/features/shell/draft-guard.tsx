"use client";

import { createContext, useContext, useEffect, useMemo, useRef } from "react";

export type DraftGuard = {
  /** Resolves true on a successful save (safe to proceed), false to keep the user in place. */
  save: () => Promise<boolean>;
  discard: () => void;
};

type DraftGuardApi = {
  register: (guard: DraftGuard | null) => void;
  getActive: () => DraftGuard | null;
};

const DraftGuardContext = createContext<DraftGuardApi | null>(null);

/**
 * One shared boundary for "is there unsaved input right now" (guide section 4.2 step 2, 21.7):
 * at most one form registers itself as the active draft while its dialog/editor is open.
 * CompanySwitcher reads it before navigating instead of each screen building its own guard.
 */
export function DraftGuardProvider({ children }: { children: React.ReactNode }) {
  const activeRef = useRef<DraftGuard | null>(null);
  const api = useMemo<DraftGuardApi>(
    () => ({
      register: (guard) => {
        activeRef.current = guard;
      },
      getActive: () => activeRef.current,
    }),
    [],
  );
  return <DraftGuardContext.Provider value={api}>{children}</DraftGuardContext.Provider>;
}

function useDraftGuardApi(): DraftGuardApi {
  const api = useContext(DraftGuardContext);
  if (!api) throw new Error("useDraftGuardApi must be used within a DraftGuardProvider");
  return api;
}

/** A form calls this while it has unsaved input open; pass null once it closes/saves/discards. */
export function useRegisterDraftGuard(guard: DraftGuard | null): void {
  const { register } = useDraftGuardApi();
  useEffect(() => {
    register(guard);
    return () => register(null);
  }, [register, guard]);
}

/** Read at the moment of switching, not reactively: only the click handler needs the value. */
export function useActiveDraftGuard(): () => DraftGuard | null {
  const { getActive } = useDraftGuardApi();
  return getActive;
}
