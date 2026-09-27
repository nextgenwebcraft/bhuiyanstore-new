"use client";

import { t } from "@bsd/i18n";
import { notFound } from "next/navigation";
import { StatePanel } from "@/components/state-panel";
import { findNavEntry, navAccess } from "./navigation";
import { useCurrentWorkspace } from "./workspace-context";

/**
 * Presentation guard for a navigable screen: unavailable module, forbidden and not-yet-built
 * states (guide section 5.5). The service enforces the same rules independently.
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
  if (!entry.item.implemented) {
    return (
      <>
        <h1 className="mb-6 text-2xl font-semibold">{t(entry.item.labelKey)}</h1>
        <StatePanel title={t("state.notBuiltTitle")} hint={t("state.notBuiltHint")} />
      </>
    );
  }
  return children;
}
