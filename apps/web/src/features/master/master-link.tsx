"use client";

import { t } from "@bsd/i18n";
import Link from "next/link";
import { Icon } from "@/components/icons";
import { useSession } from "@/data/http/http-provider";
import { useMasterWorkspace } from "@/data/queries";
import { companyHref } from "@/features/shell/navigation";

/** Where the master panel lives (D66); null for anyone but a super-admin or until it loads. */
export function useMasterHref(): string | null {
  const isSuperAdmin = useSession()?.me.isSuperAdmin === true;
  const master = useMasterWorkspace(isSuperAdmin);
  return isSuperAdmin && master.data ? companyHref(master.data.company.id) : null;
}

/** The company picker's way into the master panel: a card above the companies. */
export function MasterPanelCard() {
  const href = useMasterHref();
  if (!href) return null;
  return (
    <Link
      href={href}
      className="group flex min-h-20 items-center gap-4 rounded-xl border border-brand/30 bg-brand/8 p-4 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-raised"
    >
      <span className="inline-flex size-11 items-center justify-center rounded-lg bg-brand text-brand-foreground">
        <Icon name="dashboard" className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold">{t("nav.master.dashboard")}</span>
        <span className="block text-xs text-text-muted">{t("master.linkHint")}</span>
      </span>
      <Icon
        name="arrowRight"
        className="size-4 text-text-subtle transition-transform group-hover:translate-x-0.5"
      />
    </Link>
  );
}

/** The company switcher's menu item for the master panel. */
export function MasterPanelMenuItem({
  onSelect,
  href,
}: {
  onSelect: () => void;
  href: string | null;
}) {
  if (!href) return null;
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onSelect}
      className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2 text-left text-sm font-medium transition-colors hover:bg-surface-hover"
    >
      <span className="inline-flex size-7 items-center justify-center rounded-md bg-brand text-brand-foreground">
        <Icon name="dashboard" className="size-4" />
      </span>
      {t("nav.master.dashboard")}
    </Link>
  );
}
