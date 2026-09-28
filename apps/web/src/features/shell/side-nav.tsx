"use client";

import type { CompanyWorkspace } from "@bsd/contracts";
import { t } from "@bsd/i18n";
import Link from "next/link";
import { companyHref, navGroups, visibleNavigation } from "./navigation";

/**
 * Compact persistent navigation: group headers plus one link per visible module (no leaf items),
 * so the count of rows stays small regardless of role. Drilling into a module's screens happens
 * on its card-grid landing page (ModuleLandingPage), not in this sidebar.
 */
export function SideNav({
  workspace,
  currentPath,
  onNavigate,
}: {
  workspace: CompanyWorkspace;
  currentPath: string;
  onNavigate?: () => void;
}) {
  const sections = visibleNavigation(workspace);
  const dashboard = sections.find((s) => s.id === "dashboard");
  const companyId = workspace.company.id;
  const activeSectionId = currentPath === "" ? "dashboard" : currentPath.split("/")[0];

  return (
    <nav aria-label={t("nav.menu")} className="flex flex-col gap-4 p-3">
      {dashboard ? (
        <Link
          href={companyHref(companyId)}
          aria-current={activeSectionId === "dashboard" ? "page" : undefined}
          {...(onNavigate ? { onClick: onNavigate } : {})}
          className={`flex min-h-10 items-center rounded-md border-l-4 px-3 text-sm ${
            activeSectionId === "dashboard"
              ? "border-brand bg-surface-muted font-semibold"
              : "border-transparent hover:bg-surface-muted"
          }`}
        >
          {t("nav.dashboard")}
        </Link>
      ) : null}

      {navGroups.map((group) => {
        const groupSections = sections.filter((s) => s.groupId === group.id);
        if (groupSections.length === 0) return null;
        return (
          <div key={group.id}>
            <h2 className="px-3 pb-1 text-xs font-semibold tracking-wide text-text-muted">
              {t(group.labelKey)}
            </h2>
            <ul className="flex flex-col">
              {groupSections.map((section) => {
                const active = section.id === activeSectionId;
                return (
                  <li key={section.id}>
                    <Link
                      href={companyHref(companyId, section.id)}
                      aria-current={active ? "page" : undefined}
                      {...(onNavigate ? { onClick: onNavigate } : {})}
                      className={`flex min-h-10 items-center rounded-md border-l-4 px-3 text-sm ${
                        active
                          ? "border-brand bg-surface-muted font-semibold"
                          : "border-transparent hover:bg-surface-muted"
                      }`}
                    >
                      {t(section.labelKey)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
