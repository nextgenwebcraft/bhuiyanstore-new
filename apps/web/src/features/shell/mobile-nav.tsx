"use client";

import type { CompanyWorkspace } from "@bsd/contracts";
import { t, type TranslationKey } from "@bsd/i18n";
import Link from "next/link";
import { useRef } from "react";
import { Icon, sectionIcon } from "@/components/icons";
import { CompanySwitcher } from "./company-switcher";
import { companyHref, visibleFlow } from "./navigation";
import { SideNav } from "./side-nav";

/** The most used daily screens get a thumb-reach tab on phones, with short labels. */
const TABS: readonly { path: string; labelKey: TranslationKey }[] = [
  { path: "sales/daily-summaries", labelKey: "nav.tab.dsr" },
  { path: "purchases/receipts", labelKey: "nav.tab.receipts" },
  { path: "sales/old-dues-collection", labelKey: "nav.tab.marketDue" },
];

const tabClass = (active: boolean) =>
  `flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ${
    active ? "font-semibold text-brand" : "text-text-muted"
  }`;

/**
 * Narrow screens: a drawer with the full work-order menu (native dialog: focus trap and Esc)
 * and a bottom tab bar for today and the three most used daily entries.
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
  const links = visibleFlow(workspace).flatMap((g) => g.links);
  const tabs = TABS.flatMap((tab) => {
    const link = links.find((l) => l.path === tab.path);
    return link ? [{ ...tab, sectionId: link.sectionId }] : [];
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
        className="m-0 scrollbar-none h-dvh max-h-none w-72 max-w-[85vw] bg-surface text-text shadow-raised backdrop:bg-black/30 backdrop:backdrop-blur-sm"
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
        aria-label={t("nav.flow.daily")}
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
      >
        <Link
          href={companyHref(companyId)}
          aria-current={currentPath === "" ? "page" : undefined}
          className={tabClass(currentPath === "")}
        >
          <Icon name="dashboard" className="size-5" />
          {t("nav.tab.today")}
        </Link>
        {tabs.map((tab) => (
          <Link
            key={tab.path}
            href={companyHref(companyId, tab.path)}
            aria-current={currentPath === tab.path ? "page" : undefined}
            className={tabClass(currentPath === tab.path)}
          >
            <Icon name={sectionIcon(tab.sectionId)} className="size-5" />
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
