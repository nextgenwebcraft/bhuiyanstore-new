/**
 * Canonical module IDs (guide section 21.3). Leaf definitions only: this file must never
 * import application code, so every consumer can reference these IDs without cycles.
 */
export const moduleIds = {
  identityAccess: "identity-access",
  organizationCatalog: "organization-catalog",
  procurement: "procurement",
  inventory: "inventory",
  sales: "sales",
  returnsDamage: "returns-damage",
  finance: "finance",
  supplierSr: "supplier-sr",
  dsrOperations: "dsr-operations",
  compensation: "compensation",
  incentiveReporting: "incentive-reporting",
  openingImport: "opening-import",
  reporting: "reporting",
  outboxOperations: "outbox-operations",
} as const;

export type ModuleId = (typeof moduleIds)[keyof typeof moduleIds];
