"use client";

import Link from "next/link";
import { t } from "@bsd/i18n";
import { QueryError } from "@/components/query-error";
import { useOrderTargets } from "@/data/queries";
import { companyHref } from "@/features/shell/navigation";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import {
  TargetProgressBlock,
  TargetProgressCompact,
  targetLabel,
} from "./target-progress";

/** Up to two pinned order-target widgets (D111/D115). `column` sits beside the sales chart. */
export function DashboardTargetStrip({ layout = "row" }: { layout?: "row" | "column" }) {
  const { company, permissions } = useCurrentWorkspace();
  const canView = permissions.includes("company.view");
  const targets = useOrderTargets(company.id, true);
  const setupHref = companyHref(company.id, "masters/targets");
  const column = layout === "column";

  if (!canView) return null;

  if (targets.isPending) {
    return (
      <div
        className={`flex min-w-0 gap-2 print:hidden ${column ? "h-full flex-col" : "flex-1"}`}
        aria-hidden
      >
        <div
          className={`animate-pulse rounded-xl bg-surface-muted ${column ? "min-h-28 flex-1" : "h-16 flex-1"}`}
        />
        <div
          className={`animate-pulse rounded-xl bg-surface-muted ${column ? "min-h-28 flex-1" : "hidden h-16 flex-1 sm:block"}`}
        />
      </div>
    );
  }

  if (targets.isError) {
    return (
      <div className={`min-w-0 print:hidden ${column ? "" : "flex-1"}`}>
        <QueryError error={targets.error} onRetry={() => void targets.refetch()} />
      </div>
    );
  }

  const items = targets.data.items.slice(0, 2);
  if (items.length === 0) {
    return (
      <div className={`min-w-0 print:hidden ${column ? "h-full" : "flex-1"}`}>
        <Link
          href={setupHref}
          className={`flex items-center rounded-xl border border-dashed border-border px-3 py-2 text-sm text-text-muted hover:border-border-strong hover:bg-surface-hover hover:text-text ${
            column ? "h-full min-h-40 justify-center text-center" : "min-h-(--touch-target)"
          }`}
        >
          {t("target.dashboard.cta")}
        </Link>
      </div>
    );
  }

  if (column) {
    return (
      <div className="flex h-full min-w-0 flex-col gap-3 print:hidden">
        {items.map((target) => (
          <Link
            key={target.id}
            href={setupHref}
            className="flex min-h-0 flex-1 flex-col no-underline"
          >
            <div className="flex h-full flex-col rounded-xl border border-border bg-surface p-3 shadow-card">
              <p className="mb-2 truncate text-sm font-semibold text-text">{targetLabel(target)}</p>
              <TargetProgressBlock target={target} />
            </div>
          </Link>
        ))}
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
