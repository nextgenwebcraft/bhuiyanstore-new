"use client";

import type { CompanyWorkspace } from "@bsd/contracts";
import { t } from "@bsd/i18n";
import Link from "next/link";
import { companyHref, hubOfPath, visibleHubs } from "./navigation";

/**
 * The tab strip of the current hub, rendered once by the company shell above the page. Shown only
 * when the hub has two or more screens this person may open; scrolls sideways on phones.
 */
export function HubTabs({
  workspace,
  currentPath,
}: {
  workspace: CompanyWorkspace;
  currentPath: string;
}) {
  const hubId = hubOfPath(currentPath, workspace.company.isMaster)?.id;
  const hub = visibleHubs(workspace).find((h) => h.id === hubId);
  if (!hub || hub.tabs.length < 2) return null;

  return (
    <nav
      aria-label={t(hub.labelKey)}
      className="-mx-4 mb-5 scrollbar-none overflow-x-auto border-b border-border px-4 sm:-mx-6 sm:px-6 md:mx-0 md:px-0 print:hidden"
    >
      <ul className="flex w-max min-w-full gap-1">
        {hub.tabs.map((tab) => {
          const active = tab.path === currentPath;
          return (
            <li key={tab.path}>
              <Link
                href={companyHref(workspace.company.id, tab.path)}
                aria-current={active ? "page" : undefined}
                className={`-mb-px inline-flex min-h-11 items-center border-b-2 px-3.5 text-sm whitespace-nowrap transition-colors ${
                  active
                    ? "border-brand font-semibold text-brand"
                    : "border-transparent text-text-muted hover:border-border-strong hover:text-text"
                }`}
              >
                {t(tab.labelKey)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
