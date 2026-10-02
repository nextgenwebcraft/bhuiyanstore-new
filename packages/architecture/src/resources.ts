/**
 * Canonical resource IDs (guide section 21.4). Client query keys, future Redis keys and outbox
 * invalidations reference these instead of ad hoc strings.
 */
export const resourceIds = {
  companyWorkspace: "company-workspace",
  product: "product",
  productHistory: "product-history",
  batch: "batch",
  supplier: "supplier",
  staffMember: "staff-member",
  staffRecord: "staff-record",
  staffRole: "staff-role",
  expenseCategory: "expense-category",
  cashAccount: "cash-account",
  role: "role",
  user: "user",
  goodsReceipt: "goods-receipt",
  dailySalesSummary: "daily-sales-summary",
  marketDue: "market-due",
  oldDueCollection: "old-due-collection",
  dashboardSummary: "dashboard-summary",
  opening: "opening",
} as const;

export type ResourceId = (typeof resourceIds)[keyof typeof resourceIds];
