"use client";

import { t } from "@bsd/i18n";
import { ButtonLink } from "@/components/button";
import { ModuleCard } from "@/components/module-card";
import { PageHeader } from "@/components/page-header";
import { StatePanel } from "@/components/state-panel";
import { companyHref, navGroups, visibleNavigation } from "@/features/shell/navigation";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";

/**
 * The dashboard is the navigation hub: modules grouped into cards (guide section 5.2), compacted
 * from the flat 10-section/45-screen list into 4 groups. Operational metrics (guide section 5.3)
 * are future work once posted mock events exist; until then this stays an honest hub, not
 * hardcoded totals.
 */
export function DashboardPage() {
  const workspace = useCurrentWorkspace();
  const { company, permissions } = workspace;
  const sections = visibleNavigation(workspace).filter((s) => s.id !== "dashboard");

  return (
    <NavGate path="">
      <PageHeader
        title={t("nav.dashboard")}
        description={`${t("dashboard.welcome")}, ${company.name}`}
      />
      {sections.length === 0 ? (
        <StatePanel
          title={t("dashboard.noActivity")}
          hint={t("dashboard.noActivityHint")}
          action={
            permissions.includes("product.view") ? (
              <ButtonLink href={companyHref(company.id, "masters/products")} variant="primary">
                {t("nav.masters.products")}
              </ButtonLink>
            ) : null
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          {navGroups.map((group) => {
            const groupSections = sections.filter((s) => s.groupId === group.id);
            if (groupSections.length === 0) return null;
            return (
              <section key={group.id}>
                <h2 className="mb-3 text-sm font-semibold tracking-wide text-text-muted">
                  {t(group.labelKey)}
                </h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {groupSections.map((section) => (
                    <ModuleCard
                      key={section.id}
                      href={companyHref(company.id, section.id)}
                      title={t(section.labelKey)}
                      screenCount={section.items.length}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </NavGate>
  );
}
