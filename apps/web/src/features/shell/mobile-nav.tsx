"use client";

import type { CompanyWorkspace } from "@bsd/contracts";
import { t, type TranslationKey } from "@bsd/i18n";
import Link from "next/link";
import { useRef } from "react";
import { Icon } from "@/components/icons";
import { CompanySwitcher } from "./company-switcher";
import { companyHref, hubOfPath, visibleHubs, type HubId } from "./navigation";
import { SideNav } from "./side-nav";

/** The most used hubs get a thumb-reach tab on phones, with short labels. */
const TABS: readonly { hub: HubId; labelKey: TranslationKey }[] = [
  { hub: "dashboard", labelKey: "nav.tab.dashboard" },
  { hub: "sales", labelKey: "nav.tab.sales" },
  { hub: "goods", labelKey: "nav.tab.goods" },
  { hub: "shops", labelKey: "nav.tab.shops" },
];

const tabClass = (active: boolean) =>
  `flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ${
    active ? "font-semibold text-brand" : "text-text-muted"
  }`;

/**
 * Narrow screens: a drawer with the nine hubs (native dialog: focus trap and Esc) and a bottom
 * tab bar for the dashboard and the three most used hubs.
 */
export function MobileNav({
  workspace,
  currentPath,
  onSearch,
}: {
  workspace: CompanyWorkspace;
  currentPath: string;
  onSearch: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const close = () => dialogRef.current?.close();
  const companyId = workspace.company.id;
  const visible = visibleHubs(workspace);
  const currentHub = hubOfPath(currentPath)?.id;
  const tabs = TABS.flatMap((tab) => {
    const hub = visible.find((h) => h.id === tab.hub);
    return hub ? [{ ...tab, path: hub.path, icon: hub.icon, active: hub.id === currentHub }] : [];
  });

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        aria-label={t("nav.menu")}
        className="inline-flex size-10 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-hover hover:text-text md:hidden"
      >
        <Icon name="menu" />
      </button>
      <dialog
        ref={dialogRef}
        aria-label={t("nav.menu")}
        onClick={(event) => {
          if (event.target === dialogRef.current) close();
        }}
        className="m-0 scrollbar-none h-dvh max-h-none w-72 max-w-[85vw] bg-surface text-text shadow-raised"
      >
        <div className="flex h-16 items-center gap-1 px-2.5">
          <CompanySwitcher company={workspace.company} currentPath={currentPath} />
          <button
            type="button"
            onClick={close}
            aria-label={t("nav.close")}
            className="inline-flex size-10 items-center justify-center rounded-lg text-text-muted hover:bg-surface-hover hover:text-text"
          >
            <Icon name="close" />
          </button>
        </div>
        <SideNav
          workspace={workspace}
          currentPath={currentPath}
          onNavigate={close}
          onSearch={() => {
            close();
            onSearch();
          }}
        />
      </dialog>

      <nav
        aria-label={t("nav.menu")}
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      >
        {tabs.map((tab) => (
          <Link
            key={tab.hub}
            href={companyHref(companyId, tab.path)}
            aria-current={tab.active ? "page" : undefined}
            className={tabClass(tab.active)}
          >
            <Icon name={tab.icon} className="size-5" />
            {t(tab.labelKey)}
          </Link>
        ))}
        <button
          type="button"
          onClick={() => dialogRef.current?.showModal()}
          className={tabClass(false)}
        >
          <Icon name="menu" className="size-5" />
          {t("nav.more")}
        </button>
      </nav>
    </>
  );
}
