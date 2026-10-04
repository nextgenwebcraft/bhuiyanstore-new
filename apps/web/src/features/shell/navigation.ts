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

export type NavSection = {
  id: string;
  labelKey: TranslationKey;
  /** Sections without a module (dashboard, masters, administration) are permission-gated only. */
  module?: WorkspaceModuleId;
  items: NavItem[];
};

const item = (
  path: string,
  labelKey: TranslationKey,
  permission: PermissionId,
  implemented = false,
): NavItem => ({ path, labelKey, permission, implemented });

/**
 * Navigation from guide section 5.2, in a fixed order across companies. The SR section follows
 * the section 5.3 SR account workspace (loans, repayments, incentives, payables; money only,
 * D18), not the "Deliveries / Dues" wording in 5.2. Only screens backed by the monthly workbook
 * (plus sign-in, opening and import) are listed.
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
    items: [
      item("sales/daily-summaries", "nav.sales.dailySummaries", "sale.view", true),
      item("sales/samari", "sales.samari", "sale.view", true),
      item("sales/firot", "sales.firot", "sale.view", true),
      item("sales/old-dues-collection", "sales.oldDuesCollection", "sale.view", true),
    ],
  },
  {
    id: "purchases",
    labelKey: "nav.purchases",
    module: "purchases",
    items: [
      item("purchases/orders", "nav.purchases.orders", "purchase.view", true),
      item("purchases/receipts", "nav.purchases.receipts", "purchase.view", true),
    ],
  },
  {
    id: "inventory",
    labelKey: "nav.inventory",
    module: "inventory",
    items: [
      item("inventory/stock", "nav.inventory.stock", "inventory.view", true),
      item("inventory/damage", "nav.inventory.damage", "damage.report", true),
      item("inventory/claims", "nav.inventory.claims", "damage.report", true),
    ],
  },
  {
    id: "sr-accounts",
    labelKey: "nav.srAccounts",
    module: "srAccounts",
    items: [
      item("sr-accounts/representatives", "nav.srAccounts.representatives", "sr_loan.view", true),
      item("sr-accounts/statement", "nav.srAccounts.statement", "sr_loan.view", true),
      item("sr-accounts/incentives", "sr.incentivePayment", "sr_incentive.view", true),
      item("sr-accounts/settlements", "nav.srAccounts.settlements", "sr_loan.view", true),
    ],
  },
  {
    id: "dsr-staff",
    labelKey: "nav.dsrStaff",
    module: "dsrStaff",
    items: [
      item("dsr/settlements", "nav.dsrStaff.settlements", "settlement.view", true),
      item("dsr/accounts", "nav.dsrStaff.accounts", "finance.view", true),
      item("dsr/statement", "nav.dsrStaff.statement", "finance.view", true),
      item("dsr/salary-recovery", "dsr.salaryRecovery", "compensation.view", true),
    ],
  },
  {
    id: "finance",
    labelKey: "nav.finance",
    module: "finance",
    items: [
      item("finance/supplier-deposits", "finance.supplierDeposit", "finance.view", true),
      item("finance/expenses", "nav.finance.expenses", "finance.view", true),
      item("finance/receivables", "nav.finance.receivables", "finance.view", true),
      item("finance/payables", "nav.finance.payables", "finance.view", true),
      item("finance/period-close", "nav.finance.periodClose", "period.close", true),
    ],
  },
  {
    id: "reports",
    labelKey: "nav.reports",
    module: "reports",
    items: [
      item("reports/operations", "nav.reports.operations", "report.view", true),
      item("reports/month", "nav.reports.month", "report.view", true),
      item("reports/stock", "nav.reports.stock", "report.view", true),
      item("reports/money", "nav.reports.money", "report.view", true),
      item("reports/staff", "nav.reports.staff", "report.view", true),
    ],
  },
  {
    id: "masters",
    labelKey: "nav.masters",
    items: [
      item("masters/products", "nav.masters.products", "product.view", true),
      item("masters/staff", "nav.masters.staff", "company.view", true),
      item("masters/lists", "nav.masters.lists", "company.view", true),
    ],
  },
  {
    id: "administration",
    labelKey: "nav.administration",
    items: [
      item("admin/users", "nav.administration.users", "membership.manage", true),
      item("admin/roles", "nav.administration.roles", "role.manage", true),
      item("admin/opening", "nav.administration.opening", "opening.prepare", true),
      item("admin/import", "nav.administration.import", "period.close", true),
    ],
  },
];

/**
 * Presentation-only work order for people coming from the monthly workbook (guide 21.6): the
 * day's entries in the order of a day block, then checking, month end, accounts, reports and the
 * rarely changed setup. Every built screen appears exactly once; access still comes from
 * `navigation`. `shortcut` n opens the screen with Alt+n.
 */
export type FlowGroupId = "daily" | "check" | "monthEnd" | "accounts" | "reports" | "setup";

export type FlowEntry = { path: string; labelKey?: TranslationKey; shortcut?: number };

export const flowGroups: readonly {
  id: FlowGroupId;
  labelKey: TranslationKey;
  /** Shown closed unless the current screen is inside. */
  collapsed: boolean;
  entries: readonly FlowEntry[];
}[] = [
  {
    id: "daily",
    labelKey: "nav.flow.daily",
    collapsed: false,
    entries: [
      { path: "sales/daily-summaries", labelKey: "nav.flow.dsrSheet", shortcut: 1 },
      { path: "purchases/receipts", labelKey: "nav.flow.receipts", shortcut: 2 },
      { path: "sales/old-dues-collection", labelKey: "nav.flow.marketDue", shortcut: 3 },
      { path: "finance/expenses", shortcut: 4 },
      { path: "dsr/settlements", labelKey: "nav.flow.staffCash", shortcut: 5 },
      { path: "finance/supplier-deposits", shortcut: 6 },
      { path: "purchases/orders", labelKey: "nav.flow.orders", shortcut: 7 },
      { path: "inventory/damage", shortcut: 8 },
    ],
  },
  {
    id: "check",
    labelKey: "nav.flow.check",
    collapsed: false,
    entries: [
      { path: "reports/operations", labelKey: "nav.flow.daySheet", shortcut: 9 },
      { path: "inventory/stock" },
      { path: "reports/month", labelKey: "nav.flow.monthSheet" },
      { path: "sales/samari", labelKey: "nav.flow.samari" },
      { path: "sales/firot", labelKey: "nav.flow.firot" },
    ],
  },
  {
    id: "monthEnd",
    labelKey: "nav.flow.monthEnd",
    collapsed: false,
    entries: [
      { path: "dsr/salary-recovery", labelKey: "nav.flow.payroll" },
      { path: "inventory/claims" },
      { path: "finance/period-close", labelKey: "nav.flow.monthClose" },
    ],
  },
  {
    id: "accounts",
    labelKey: "nav.flow.accounts",
    collapsed: true,
    entries: [
      { path: "dsr/accounts" },
      { path: "dsr/statement" },
      { path: "finance/receivables" },
      { path: "finance/payables" },
      { path: "sr-accounts/representatives" },
      { path: "sr-accounts/settlements" },
      { path: "sr-accounts/incentives" },
      { path: "sr-accounts/statement" },
    ],
  },
  {
    id: "reports",
    labelKey: "nav.reports",
    collapsed: true,
    entries: [{ path: "reports/stock" }, { path: "reports/money" }, { path: "reports/staff" }],
  },
  {
    id: "setup",
    labelKey: "nav.flow.setup",
    collapsed: true,
    entries: [
      { path: "masters/products" },
      { path: "masters/staff" },
      { path: "masters/lists" },
      { path: "admin/opening" },
      { path: "admin/import" },
      { path: "admin/users" },
      { path: "admin/roles" },
    ],
  },
];

export type FlowLink = {
  path: string;
  labelKey: TranslationKey;
  sectionId: string;
  shortcut: number | undefined;
};

export type FlowLinkGroup = {
  id: FlowGroupId;
  labelKey: TranslationKey;
  collapsed: boolean;
  links: FlowLink[];
};

/** The work order cut down to the screens this person may open in this company. */
export function visibleFlow(workspace: CompanyWorkspace): FlowLinkGroup[] {
  return flowGroups
    .map((group) => ({
      id: group.id,
      labelKey: group.labelKey,
      collapsed: group.collapsed,
      links: group.entries.flatMap((entry): FlowLink[] => {
        const found = findNavEntry(entry.path);
        if (!found?.item.implemented) return [];
        if (navAccess(workspace, found.section, found.item) !== "ok") return [];
        return [
          {
            path: entry.path,
            labelKey: entry.labelKey ?? found.item.labelKey,
            sectionId: found.section.id,
            shortcut: entry.shortcut,
          },
        ];
      }),
    }))
    .filter((group) => group.links.length > 0);
}

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
