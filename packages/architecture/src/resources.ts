/**
 * Canonical resource IDs (guide section 21.4). Client query keys, future Redis keys and outbox
 * invalidations reference these instead of ad hoc strings.
 */
export const resourceIds = {
  companyWorkspace: "company-workspace",
  product: "product",
  productHistory: "product-history",
  supplier: "supplier",
  staffMember: "staff-member",
  staffRecord: "staff-record",
  staffRole: "staff-role",
  shop: "shop",
  expenseCategory: "expense-category",
  cashAccount: "cash-account",
  role: "role",
  user: "user",
  dashboardSummary: "dashboard-summary",
  opening: "opening",
  stockEntry: "stock-entry",
  dsrDay: "dsr-day",
  moneyEntry: "money-entry",
  payrollRun: "payroll-run",
  damageCase: "damage-case",
  setupStatus: "setup-status",
  fieldDay: "field-day",
  /** Engine output for a date or month; every posting changes it. */
  ledger: "ledger",
  /** D76: the master monthly account (shareholders and the calculated split). */
  shareMonth: "share-month",
  /** D128: tenant-wide Previous Due rows that reduce distributable profit. */
  previousDue: "previous-due",
  /** D111: company order-amount targets. */
  orderTarget: "order-target",
} as const;

export type ResourceId = (typeof resourceIds)[keyof typeof resourceIds];
