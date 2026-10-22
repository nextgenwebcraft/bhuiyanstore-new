"use client";

import { DashboardPage } from "@/features/dashboard/dashboard-page";
import { useCurrentWorkspace } from "@/features/shell/workspace-context";
import { MasterDashboardPage } from "./master-dashboard";

/** A company opens its own dashboard; the master company the all-company one (D66). */
export function DashboardSwitch() {
  const { company } = useCurrentWorkspace();
  return company.isMaster ? <MasterDashboardPage /> : <DashboardPage />;
}
