"use client";

import { t } from "@bsd/i18n";
import { notFound } from "next/navigation";
import { StatePanel } from "@/components/state-panel";
import { findNavEntry, navAccess } from "./navigation";
import { useCurrentWorkspace } from "./workspace-context";

/**
 * Presentation guard for a navigable screen: unavailable module and forbidden states (guide
 * section 5.5). The service enforces the access rules independently.
 */
export function NavGate({ path, children }: { path: string; children?: React.ReactNode }) {
  const workspace = useCurrentWorkspace();
  const entry = findNavEntry(path);
  if (!entry) notFound();

  const access = navAccess(workspace, entry.section, entry.item);
  if (access === "moduleUnavailable") {
    return (
      <StatePanel
        tone="warning"
        title={t("state.moduleUnavailableTitle")}
        hint={t("state.moduleUnavailableHint")}
      />
    );
  }
  if (access === "forbidden") {
    return (
      <StatePanel
        tone="warning"
        title={t("state.forbiddenTitle")}
        hint={t("state.forbiddenHint")}
      />
    );
  }
  return <>{children}</>;
}
