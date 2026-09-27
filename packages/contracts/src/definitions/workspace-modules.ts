/**
 * Business modules a company workspace can enable (guide section 4.3). Distinct from the
 * code-ownership modules in @bsd/architecture. Masters and administration are always present
 * and gated by permissions only.
 */
export const workspaceModuleIds = [
  "sales",
  "purchases",
  "inventory",
  "srAccounts",
  "dsrStaff",
  "finance",
  "reports",
] as const;

export type WorkspaceModuleId = (typeof workspaceModuleIds)[number];
