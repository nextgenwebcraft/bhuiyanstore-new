import type { CompanyWorkspace, PermissionId, WorkspaceModuleId } from "@bsd/contracts";
import type { TranslationKey } from "@bsd/i18n";

export type NavItem = {
  /** Path below `/c/{companyId}`; "" is the dashboard. */
  path: string;
  labelKey: TranslationKey;
  permission: PermissionId;
  /** False until the prototype screen exists; the route shows a "not built yet" state. */
  implemented: boolean;
};

/** Presentation-only grouping (guide section 21.6): compacts 10 sections into 4 hub cards. */
export type NavGroupId = "operations" | "moneyStaff" | "reports" | "setup";

export type NavSection = {
  id: string;
  labelKey: TranslationKey;
  /** Sections without a module (dashboard, masters, administration) are permission-gated only. */
  module?: WorkspaceModuleId;
  /** Undefined only for "dashboard": it's the hub page itself, not a card on it. */
  groupId?: NavGroupId;
  items: NavItem[];
};

export const navGroups: readonly { id: NavGroupId; labelKey: TranslationKey }[] = [
  { id: "operations", labelKey: "nav.group.operations" },
  { id: "moneyStaff", labelKey: "nav.group.moneyStaff" },
  { id: "reports", labelKey: "nav.group.reports" },
  { id: "setup", labelKey: "nav.group.setup" },
];

const item = (
  path: string,
  labelKey: TranslationKey,
  permission: PermissionId,
  implemented = false,
): NavItem => ({ path, labelKey, permission, implemented });

/**
 * Navigation from guide section 5.2, in a fixed order across companies. The SR section follows
 * the section 5.3 SR account workspace (loans, repayments, incentives, payables; money only,
 * D18), not the "Deliveries / Dues" wording in 5.2. Supplier incentive products live under
 * purchases, fully separate from SR incentives (D16, D20).
 */
export const navigation: readonly NavSection[] = [
  {
    id: "dashboard",
    labelKey: "nav.dashboard",
    items: [item("", "nav.dashboard", "company.view", true)],
  },
  {
    id: "sales",
    labelKey: "nav.sales",
    module: "sales",
    groupId: "operations",
    items: [
      item("sales/daily-summaries", "nav.sales.dailySummaries", "sale.view", true),
      item("sales/samari", "sales.samari", "sale.view"),
      item("sales/firot", "sales.firot", "sale.view"),
      item("sales/old-dues-collection", "sales.oldDuesCollection", "sale.view", true),
    ],
  },
  {
    id: "purchases",
    labelKey: "nav.purchases",
    module: "purchases",
    groupId: "operations",
    items: [
      item("purchases/orders", "nav.purchases.orders", "purchase.view"),
      item("purchases/receipts", "nav.purchases.receipts", "purchase.view", true),
      item("purchases/bills", "nav.purchases.bills", "purchase.view"),
      item("purchases/payments", "nav.purchases.payments", "purchase.view"),
      item("purchases/returns", "nav.purchases.returns", "purchase.view"),
      item(
        "purchases/incentive-products",
        "procurement.incentiveProductStatement",
        "supplier_incentive.report_view",
      ),
    ],
  },
  {
    id: "inventory",
    labelKey: "nav.inventory",
    module: "inventory",
    groupId: "operations",
    items: [
      item("inventory/stock", "nav.inventory.stock", "inventory.view", true),
      item("inventory/batches", "nav.inventory.batches", "inventory.view", true),
      item("inventory/custody", "nav.inventory.custody", "inventory.view"),
      item("inventory/counts", "nav.inventory.counts", "inventory.view"),
      item("inventory/damage", "nav.inventory.damage", "damage.report"),
      item("inventory/claims", "nav.inventory.claims", "damage.report"),
    ],
  },
  {
    id: "sr-accounts",
    labelKey: "nav.srAccounts",
    module: "srAccounts",
    groupId: "moneyStaff",
    items: [
      item("sr-accounts/representatives", "nav.srAccounts.representatives", "sr_loan.view"),
      item("sr-accounts/statement", "nav.srAccounts.statement", "sr_loan.view"),
      item("sr-accounts/incentives", "sr.incentivePayment", "sr_incentive.view"),
      item("sr-accounts/settlements", "nav.srAccounts.settlements", "sr_loan.view"),
    ],
  },
  {
    id: "dsr-staff",
    labelKey: "nav.dsrStaff",
    module: "dsrStaff",
    groupId: "moneyStaff",
    items: [
      item("dsr/routes", "nav.dsrStaff.routes", "settlement.view"),
      item("dsr/assignments", "nav.dsrStaff.assignments", "settlement.view"),
      item("dsr/issue-return", "nav.dsrStaff.issueReturn", "settlement.view"),
      item("dsr/settlements", "nav.dsrStaff.settlements", "settlement.view"),
      item("dsr/salary-recovery", "dsr.salaryRecovery", "dsr_due.view"),
    ],
  },
  {
    id: "finance",
    labelKey: "nav.finance",
    module: "finance",
    groupId: "moneyStaff",
    items: [
      item("finance/supplier-deposits", "finance.supplierDeposit", "finance.view"),
      item("finance/cash-bank", "nav.finance.cashBank", "finance.view"),
      item("finance/expenses", "nav.finance.expenses", "finance.view"),
      item("finance/receivables", "nav.finance.receivables", "finance.view"),
      item("finance/payables", "nav.finance.payables", "finance.view"),
      item("finance/journals", "nav.finance.journals", "finance.view"),
      item("finance/period-close", "nav.finance.periodClose", "period.close"),
    ],
  },
  {
    id: "reports",
    labelKey: "nav.reports",
    module: "reports",
    groupId: "reports",
    items: [
      item("reports/operations", "nav.reports.operations", "report.view"),
      item("reports/stock", "nav.reports.stock", "report.view"),
      item("reports/money", "nav.reports.money", "report.view"),
      item("reports/staff", "nav.reports.staff", "report.view"),
      item("reports/reconciliation", "nav.reports.reconciliation", "report.view"),
    ],
  },
  {
    id: "masters",
    labelKey: "nav.masters",
    groupId: "setup",
    items: [
      item("masters/products", "nav.masters.products", "product.view", true),
      item("masters/suppliers", "nav.masters.suppliers", "company.view", true),
      item("masters/staff", "nav.masters.staff", "company.view", true),
      item("masters/godown", "inventory.godown", "inventory.view"),
      item("masters/lists", "nav.masters.lists", "company.view", true),
    ],
  },
  {
    id: "administration",
    labelKey: "nav.administration",
    groupId: "setup",
    items: [
      item("admin/companies", "nav.administration.companies", "company.manage"),
      item("admin/modules", "nav.administration.modules", "company.manage"),
      item("admin/users", "nav.administration.users", "membership.manage", true),
      item("admin/roles", "nav.administration.roles", "role.manage", true),
      item("admin/audit", "nav.administration.audit", "audit.view"),
      item("admin/opening", "nav.administration.opening", "opening.prepare", true),
    ],
  },
];

export type NavAccess = "ok" | "moduleUnavailable" | "forbidden";

export function findNavEntry(path: string): { section: NavSection; item: NavItem } | undefined {
  for (const section of navigation) {
    const match = section.items.find((i) => i.path === path);
    if (match) return { section, item: match };
  }
  return undefined;
}

/**
 * Resolves a bare module-landing path (e.g. "purchases"), distinct from a two-segment leaf path
 * (e.g. "purchases/orders"). Excludes "dashboard": its landing is the root company page.
 */
export function findSectionById(id: string): NavSection | undefined {
  return navigation.find((section) => section.id === id && section.id !== "dashboard");
}

/** Effective visibility = enabled module ∩ authorized permission (guide section 4.3). */
export function navAccess(
  workspace: CompanyWorkspace,
  section: NavSection,
  navItem: NavItem,
): NavAccess {
  if (section.module && !workspace.company.modules.includes(section.module)) {
    return "moduleUnavailable";
  }
  return workspace.permissions.includes(navItem.permission) ? "ok" : "forbidden";
}

export function visibleNavigation(workspace: CompanyWorkspace): NavSection[] {
  return navigation
    .map((section) => ({
      ...section,
      items: section.items.filter((i) => navAccess(workspace, section, i) === "ok"),
    }))
    .filter((section) => section.items.length > 0);
}

/**
 * Where to land after switching company: the same screen when the destination supports it,
 * otherwise its dashboard (guide section 4.2 step 6).
 */
export function equivalentPath(path: string, destination: CompanyWorkspace): string {
  const entry = findNavEntry(path);
  return entry && navAccess(destination, entry.section, entry.item) === "ok" ? path : "";
}

export function companyHref(companyId: string, path = ""): string {
  return path ? `/c/${companyId}/${path}` : `/c/${companyId}`;
}
