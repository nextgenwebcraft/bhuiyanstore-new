"use client";

import type { CompanyWorkspace } from "@bsd/contracts";
import { t } from "@bsd/i18n";
import Link from "next/link";
import { companyHref, visibleNavigation } from "./navigation";

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
  const companyId = workspace.company.id;

  return (
    <nav aria-label={t("nav.menu")} className="flex flex-col gap-4 p-3">
      {sections.map((section) => (
        <div key={section.id}>
          {section.id === "dashboard" ? null : (
            <h2 className="px-3 pb-1 text-xs font-semibold tracking-wide text-text-muted">
              {t(section.labelKey)}
            </h2>
          )}
          <ul className="flex flex-col">
            {section.items.map((item) => {
              const active = item.path === currentPath;
              return (
                <li key={item.path}>
                  <Link
                    href={companyHref(companyId, item.path)}
                    aria-current={active ? "page" : undefined}
                    onClick={onNavigate}
                    className={`flex min-h-10 items-center rounded-md border-l-4 px-3 text-sm ${
                      active
                        ? "border-brand bg-surface-muted font-semibold"
                        : "border-transparent hover:bg-surface-muted"
                    }`}
                  >
                    {t(item.labelKey)}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
