"use client";

import { t } from "@bsd/i18n";
import { ModuleCard } from "@/components/module-card";
import { PageHeader } from "@/components/page-header";
import { StatePanel } from "@/components/state-panel";
import { companyHref, findSectionById, navAccess } from "./navigation";
import { useCurrentWorkspace } from "./workspace-context";

/**
 * Card grid of one module's screens (guide section 5.2), reached at the module's bare path
 * (e.g. "purchases"). Mirrors NavGate's module-unavailable/forbidden states for the module as a
 * whole; each visible screen still enforces its own permission when opened.
 */
export function ModuleLandingPage({ sectionId }: { sectionId: string }) {
  const workspace = useCurrentWorkspace();
  const section = findSectionById(sectionId);
  if (!section) return null;

  if (section.module && !workspace.company.modules.includes(section.module)) {
    return (
      <>
        <PageHeader title={t(section.labelKey)} />
        <StatePanel
          tone="warning"
          title={t("state.moduleUnavailableTitle")}
          hint={t("state.moduleUnavailableHint")}
        />
      </>
    );
  }

  const visibleItems = section.items.filter((item) => navAccess(workspace, section, item) === "ok");

  return (
    <>
      <PageHeader title={t(section.labelKey)} />
      {visibleItems.length === 0 ? (
        <StatePanel
          tone="warning"
          title={t("state.forbiddenTitle")}
          hint={t("state.forbiddenHint")}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visibleItems.map((item) => (
            <ModuleCard
              key={item.path}
              href={companyHref(workspace.company.id, item.path)}
              title={t(item.labelKey)}
              notBuilt={!item.implemented}
            />
          ))}
        </div>
      )}
    </>
  );
}
