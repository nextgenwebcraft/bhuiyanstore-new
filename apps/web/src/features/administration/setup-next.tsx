"use client";

import { t, type TranslationKey, formatCount } from "@bsd/i18n";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { useSetupStatus } from "@/data/queries";
import { companyHref } from "@/features/shell/navigation";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";

/**
 * Where an owner goes next before go-live (D43): the opening page, while the go-live date is not
 * saved yet. Null once the opening is live or for users who cannot prepare it.
 */
export function useSetupNext(): { href: string; label: TranslationKey } | null {
  const { company, permissions } = useCurrentWorkspace();
  const canPrepare = permissions.includes("opening.prepare");
  const status = useSetupStatus(company.id, canPrepare);
  if (!canPrepare || status.data?.live) return null;
  return { href: companyHref(company.id, "admin/opening"), label: "setup.next.opening" };
}

/** Dashboard banner until the opening is live; hidden when the status cannot be read. */
export function SetupBanner() {
  const { company } = useCurrentWorkspace();
  const status = useSetupStatus(company.id);
  const next = useSetupNext();
  if (!next || !status.data) return null;
  return (
    <Link
      href={next.href}
      className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm transition-colors hover:border-warning"
    >
      <Icon name="arrowRight" className="size-4 text-warning" />
      <span className="flex-1 font-medium">{t("setup.banner")}</span>
      <span className="text-text-muted tabular-nums">
        {formatCount(status.data.completed)}/{formatCount(status.data.steps.length)}
      </span>
    </Link>
  );
}
