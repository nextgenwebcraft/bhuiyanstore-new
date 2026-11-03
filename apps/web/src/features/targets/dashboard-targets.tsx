"use client";

import Link from "next/link";
import { t } from "@bsd/i18n";
import { QueryError } from "@/components/query-error";
import { useOrderTargets } from "@/data/queries";
import { companyHref } from "@/features/shell/navigation";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { TargetProgressCompact } from "./target-progress";

/** Up to two pinned order-target widgets beside the dashboard period filter (D111). */
export function DashboardTargetStrip() {
  const { company, permissions } = useCurrentWorkspace();
  const canView = permissions.includes("company.view");
  const targets = useOrderTargets(company.id, true);
  const setupHref = companyHref(company.id, "masters/targets");

  if (!canView) return null;

  if (targets.isPending) {
    return (
      <div className="flex min-w-0 flex-1 gap-2 print:hidden" aria-hidden>
        <div className="h-16 flex-1 animate-pulse rounded-xl bg-surface-muted" />
        <div className="hidden h-16 flex-1 animate-pulse rounded-xl bg-surface-muted sm:block" />
      </div>
    );
  }

  if (targets.isError) {
    return (
      <div className="min-w-0 flex-1 print:hidden">
        <QueryError error={targets.error} onRetry={() => void targets.refetch()} />
      </div>
    );
  }

  const items = targets.data.items.slice(0, 2);
  if (items.length === 0) {
    return (
      <div className="min-w-0 flex-1 print:hidden">
        <Link
          href={setupHref}
          className="flex min-h-(--touch-target) items-center rounded-xl border border-dashed border-border px-3 py-2 text-sm text-text-muted hover:border-border-strong hover:bg-surface-hover hover:text-text"
        >
          {t("target.dashboard.cta")}
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-stretch gap-2 print:hidden">
      {items.map((target) => (
        <Link key={target.id} href={setupHref} className="min-w-[10rem] flex-1 no-underline">
          <TargetProgressCompact target={target} />
        </Link>
      ))}
    </div>
  );
}
