"use client";

import { t } from "@bsd/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useId } from "react";
import { useWorkspaces } from "@/data/queries";
import { queryKeys } from "@/data/query-keys";
import { useActorId } from "@/data/service-context";
import { companyHref, equivalentPath } from "./navigation";

/**
 * Switches company by URL (guide section 4.2). In-flight requests of the old company are
 * cancelled; its cache stays scoped to its own keys, so late responses cannot leak across.
 * TODO(Phase 1, drafts): add the Save draft / Discard / Stay guard once drafts exist.
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

  const options = workspaces.data ?? [];
  if (options.length < 2) return null;

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={selectId} className="sr-only">
        {t("company.switch")}
      </label>
      <select
        id={selectId}
        value={currentCompanyId}
        onChange={(event) => {
          const destination = options.find((w) => w.company.id === event.target.value);
          if (!destination) return;
          void queryClient.cancelQueries({
            queryKey: queryKeys.companyScope(actorId, currentCompanyId),
          });
          router.push(
            companyHref(destination.company.id, equivalentPath(currentPath, destination)),
          );
        }}
        className="min-h-(--touch-target) rounded-md border border-white/40 bg-white/10 px-2 text-brand-foreground"
      >
        {options.map(({ company }) => (
          <option key={company.id} value={company.id} className="text-text">
            {company.name}
          </option>
        ))}
      </select>
    </div>
  );
}
