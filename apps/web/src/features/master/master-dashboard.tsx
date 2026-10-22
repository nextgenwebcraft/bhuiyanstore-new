"use client";

import { t } from "@bsd/i18n";
import { PageHeader } from "@/components/page-header";
import { NavGate } from "@/features/shell/nav-gate";

/** The master panel's page (D66): left empty by the owner (2026-10-22) for content still to come. */
export function MasterDashboardPage() {
  return (
    <NavGate path="">
      <PageHeader title={t("nav.master.dashboard")} />
    </NavGate>
  );
}
