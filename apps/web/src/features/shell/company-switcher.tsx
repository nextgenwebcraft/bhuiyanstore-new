"use client";

import { t } from "@bsd/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useId, useRef } from "react";
import { useWorkspaces } from "@/data/queries";
import { queryKeys } from "@/data/query-keys";
import { useActorId } from "@/data/service-context";
import { useActiveDraftGuard } from "./draft-guard";
import { DraftSwitchPrompt, type DraftSwitchPromptHandle } from "./draft-switch-prompt";
import { companyHref, equivalentPath } from "./navigation";

/**
 * Switches company by URL (guide section 4.2). In-flight requests of the old company are
 * cancelled; its cache stays scoped to its own keys, so late responses cannot leak across.
 * An active DraftGuard (guide section 4.2 step 2) is resolved with Save draft / Discard / Stay
 * before any navigation happens.
 */
export function CompanySwitcher({
  currentCompanyId,
  currentPath,
}: {
  currentCompanyId: string;
  currentPath: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const actorId = useActorId();
  const workspaces = useWorkspaces();
  const selectId = useId();
  const getActiveDraftGuard = useActiveDraftGuard();
  const promptRef = useRef<DraftSwitchPromptHandle>(null);

  const options = workspaces.data ?? [];
  if (options.length < 2) return null;

  function goTo(companyId: string) {
    const destination = options.find((w) => w.company.id === companyId);
    if (!destination) return;
    void queryClient.cancelQueries({
      queryKey: queryKeys.companyScope(actorId, currentCompanyId),
    });
    router.push(companyHref(destination.company.id, equivalentPath(currentPath, destination)));
  }

  async function handleChange(companyId: string) {
    const guard = getActiveDraftGuard();
    if (!guard) {
      goTo(companyId);
      return;
    }
    const choice = await promptRef.current?.ask();
    if (choice === "stay" || choice === undefined) return;
    if (choice === "discard") {
      guard.discard();
      goTo(companyId);
      return;
    }
    // choice === "save": only navigate once the save actually succeeds; a failed save (e.g.
    // duplicate SKU) leaves the user on the current company with the error visible in the form.
    if (await guard.save()) goTo(companyId);
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={selectId} className="px-1 text-[11px] font-medium text-text-muted">
        {t("company.switch")}
      </label>
      <select
        id={selectId}
        value={currentCompanyId}
        onChange={(event) => void handleChange(event.target.value)}
        className="min-h-9 w-full rounded-lg border border-border bg-surface-muted px-2.5 text-sm text-text transition-colors hover:border-border-strong"
      >
        {options.map(({ company }) => (
          <option key={company.id} value={company.id}>
            {company.name}
          </option>
        ))}
      </select>
      <DraftSwitchPrompt ref={promptRef} />
    </div>
  );
}
