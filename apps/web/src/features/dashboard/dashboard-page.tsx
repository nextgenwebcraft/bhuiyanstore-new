"use client";

import { t } from "@bsd/i18n";
import { ButtonLink } from "@/components/button";
import { PageHeader } from "@/components/page-header";
import { StatePanel } from "@/components/state-panel";
import { companyHref } from "@/features/shell/navigation";
import { NavGate } from "@/features/shell/nav-gate";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";

/**
 * Metrics will be derived from posted mock events; until then the dashboard shows an honest
 * empty state instead of hardcoded totals (guide section 6.2).
 */
export function DashboardPage() {
  const { company, permissions } = useCurrentWorkspace();

  return (
    <NavGate path="">
      <PageHeader title={t("nav.dashboard")} description={`${t("dashboard.welcome")}, ${company.name}`} />
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
    </NavGate>
  );
}
