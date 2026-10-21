"use client";

import type { Company } from "@bsd/contracts";
import { t } from "@bsd/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { useWorkspaces } from "@/data/queries";
import { queryKeys } from "@/data/query-keys";
import { useActorId } from "@/data/service-context";
import { CompanyForm } from "@/features/company-picker/company-form";
import { MasterPanelMenuItem } from "@/features/master/master-link";
import { CompanyMark } from "./company-mark";
import { useActiveDraftGuard } from "./draft-guard";
import { DraftSwitchPrompt, type DraftSwitchPromptHandle } from "./draft-switch-prompt";
import { companyHref, equivalentPath } from "./navigation";

/**
 * The company name in the sidebar header opens a menu of the person's other companies and a
 * create button. Switching is by URL (guide section 4.2): in-flight requests of the old company
 * are cancelled; its cache stays scoped to its own keys, so late responses cannot leak across.
 * An active DraftGuard (guide section 4.2 step 2) is resolved with Save draft / Discard / Stay
 * before any navigation happens.
 */
export function CompanySwitcher({
  company,
  currentPath,
}: {
  company: Company;
  currentPath: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const actorId = useActorId();
  const workspaces = useWorkspaces();
  const menuId = useId();
  const getActiveDraftGuard = useActiveDraftGuard();
  const promptRef = useRef<DraftSwitchPromptHandle>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const options = workspaces.data ?? [];

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function goTo(companyId: string) {
    const destination = options.find((w) => w.company.id === companyId);
    if (!destination) return;
    void queryClient.cancelQueries({
      queryKey: queryKeys.companyScope(actorId, company.id),
    });
    router.push(companyHref(destination.company.id, equivalentPath(currentPath, destination)));
  }

  async function choose(companyId: string) {
    setOpen(false);
    if (companyId === company.id) return;
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
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={t("company.switch")}
        onClick={() => setOpen((value) => !value)}
        className={`flex w-full items-center gap-3 rounded-lg px-1.5 py-1.5 text-left transition-colors hover:bg-surface-hover ${
          open ? "bg-surface-hover" : ""
        }`}
      >
        <CompanyMark company={company} />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block truncate text-[15px] font-semibold">{company.name}</span>
          <span className="block truncate text-[11px] text-text-muted">{t("app.name")}</span>
        </span>
        <Icon name="chevronUpDown" className="size-4 shrink-0 text-text-subtle" />
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={t("company.switch")}
          className="absolute inset-x-0 top-full z-40 mt-1.5 flex flex-col rounded-xl border border-border bg-surface p-1.5 shadow-raised"
        >
          <p className="px-2 pt-1 pb-1.5 text-[11px] font-semibold tracking-wider text-text-muted">
            {t("company.switch")}
          </p>
          <ul className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
            {options.map(({ company: option }) => {
              const current = option.id === company.id;
              return (
                <li key={option.id}>
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={current}
                    onClick={() => void choose(option.id)}
                    className={`flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2 text-left text-sm transition-colors hover:bg-surface-hover ${
                      current ? "font-medium" : ""
                    }`}
                  >
                    <CompanyMark company={option} size="sm" />
                    <span className="min-w-0 flex-1 truncate">{option.name}</span>
                    {current ? <Icon name="check" className="size-4 shrink-0 text-brand" /> : null}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-1.5 border-t border-border pt-1.5">
            <MasterPanelMenuItem onSelect={() => setOpen(false)} />
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setCreating(true);
              }}
              className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2 text-left text-sm font-medium text-brand transition-colors hover:bg-brand/10"
            >
              <span className="inline-flex size-7 items-center justify-center rounded-md border border-dashed border-brand/40">
                <Icon name="plus" className="size-4" />
              </span>
              {t("company.new")}
            </button>
          </div>
        </div>
      ) : null}

      {creating ? <CompanyForm onClose={() => setCreating(false)} /> : null}
      <DraftSwitchPrompt ref={promptRef} />
    </div>
  );
}
