"use client";

import type { CompanyWorkspace } from "@bsd/contracts";
import { createContext, useContext } from "react";

const WorkspaceContext = createContext<CompanyWorkspace | null>(null);

export const WorkspaceProvider = WorkspaceContext.Provider;

/** The authorized workspace of the enclosing `/c/[companyId]` shell. */
export function useCurrentWorkspace(): CompanyWorkspace {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useCurrentWorkspace must be used inside CompanyShell");
  return value;
}
