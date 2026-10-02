"use client";

import type { CompanyWorkspace } from "@bsd/contracts";
import { t } from "@bsd/i18n";
import { useRef } from "react";
import { Icon } from "@/components/icons";
import { CompanyMark } from "./company-mark";
import { CompanySwitcher } from "./company-switcher";
import { SideNav } from "./side-nav";

/** Drawer navigation for narrow screens; the native dialog provides focus trapping and Esc. */
export function MobileNav({
  workspace,
  currentPath,
}: {
  workspace: CompanyWorkspace;
  currentPath: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const close = () => dialogRef.current?.close();

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
        <div className="flex h-16 items-center gap-3 px-4">
          <CompanyMark company={workspace.company} />
          <span className="min-w-0 flex-1 truncate font-semibold">{workspace.company.name}</span>
          <button
            type="button"
            onClick={close}
            aria-label={t("nav.close")}
            className="inline-flex size-10 items-center justify-center rounded-lg text-text-muted hover:bg-surface-hover hover:text-text"
          >
            <Icon name="close" />
          </button>
        </div>
        <div className="px-3">
          <CompanySwitcher currentCompanyId={workspace.company.id} currentPath={currentPath} />
        </div>
        <SideNav workspace={workspace} currentPath={currentPath} onNavigate={close} />
      </dialog>
    </>
  );
}
