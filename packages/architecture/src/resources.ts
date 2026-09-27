/**
 * Canonical resource IDs (guide section 21.4). Client query keys, future Redis keys and outbox
 * invalidations reference these instead of ad hoc strings.
 */
export const resourceIds = {
  companyWorkspace: "company-workspace",
  product: "product",
} as const;

export type ResourceId = (typeof resourceIds)[keyof typeof resourceIds];
