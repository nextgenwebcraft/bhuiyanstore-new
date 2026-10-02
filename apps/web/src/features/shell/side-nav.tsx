"use client";

import type { CompanyWorkspace } from "@bsd/contracts";
import { t } from "@bsd/i18n";
import Link from "next/link";
import { Icon, sectionIcon } from "@/components/icons";
import { companyHref, navGroups, visibleNavigation, type NavSection } from "./navigation";

function NavLink({
  section,
  href,
  active,
  onNavigate,
}: {
  section: NavSection;
  href: string;
  active: boolean;
  onNavigate: (() => void) | undefined;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      {...(onNavigate ? { onClick: onNavigate } : {})}
      className={`group relative flex min-h-9 items-center gap-3 rounded-lg px-3 text-[13.5px] transition-colors ${
        active
          ? "bg-brand/10 font-medium text-text"
          : "text-text-muted hover:bg-surface-hover hover:text-text"
      }`}
    >
      {active ? (
        <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-brand" />
      ) : null}
      <Icon
        name={sectionIcon(section.id)}
        className={`size-[18px] ${active ? "text-brand" : "text-text-subtle group-hover:text-text-muted"}`}
      />
      <span className="truncate">{t(section.labelKey)}</span>
    </Link>
  );
}

/**
 * Compact persistent navigation: quiet group captions plus one link per visible module (no leaf
 * items), so the row count stays small regardless of role. Drilling into a module's screens
 * happens on its card-grid landing page (ModuleLandingPage), not in this sidebar.
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
    <nav aria-label={t("nav.menu")} className="flex flex-col gap-5 px-3 py-4">
      {dashboard ? (
        <NavLink
          section={dashboard}
          href={companyHref(companyId)}
          active={activeSectionId === "dashboard"}
          onNavigate={onNavigate}
        />
      ) : null}

      {navGroups.map((group) => {
        const groupSections = sections.filter((s) => s.groupId === group.id);
        if (groupSections.length === 0) return null;
        return (
          <div key={group.id} className="flex flex-col gap-0.5">
            <h2 className="px-3 pb-1.5 text-[11px] font-medium tracking-wider text-text-muted">
              {t(group.labelKey)}
            </h2>
            <ul className="flex flex-col gap-0.5">
              {groupSections.map((section) => (
                <li key={section.id}>
                  <NavLink
                    section={section}
                    href={companyHref(companyId, section.id)}
                    active={section.id === activeSectionId}
                    onNavigate={onNavigate}
                  />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
