"use client";

import type { CompanyWorkspace } from "@bsd/contracts";
import { t } from "@bsd/i18n";
import { useRef } from "react";
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
        className="inline-flex min-h-(--touch-target) items-center rounded-md border border-white/40 px-3 md:hidden"
      >
        {t("nav.menu")}
      </button>
      <dialog
        ref={dialogRef}
        aria-label={t("nav.menu")}
        onClick={(event) => {
          if (event.target === dialogRef.current) close();
        }}
        className="m-0 h-dvh max-h-none w-72 max-w-[85vw] bg-surface text-text backdrop:bg-black/40"
      >
        <div className="flex items-center justify-between border-b border-border p-3">
          <span className="font-semibold">{workspace.company.name}</span>
          <button
            type="button"
            onClick={close}
            className="min-h-(--touch-target) rounded-md border border-border px-3"
          >
            {t("nav.close")}
          </button>
        </div>
        <SideNav workspace={workspace} currentPath={currentPath} onNavigate={close} />
      </dialog>
    </>
  );
}
