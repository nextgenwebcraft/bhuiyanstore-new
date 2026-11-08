import type { CompanyWorkspace, PermissionId, WorkspaceModuleId } from "@bsd/contracts";
import type { TranslationKey } from "@bsd/i18n";
import type { IconName } from "@/components/icons";

type NavItem = {
  /** Path below `/c/{companyId}`; "" is the dashboard. */
  path: string;
  labelKey: TranslationKey;
  permission: PermissionId;
};

type NavSection = {
  id: string;
  labelKey: TranslationKey;
  /** Sections without a module (dashboard, masters, administration) are permission-gated only. */
  module?: WorkspaceModuleId;
  items: NavItem[];
};

const item = (path: string, labelKey: TranslationKey, permission: PermissionId): NavItem => ({
  path,
  labelKey,
  permission,
});

/**
 * The single source of access rules (module + permission per path), in a fixed order across
 * companies. Where a path appears in the sidebar is `hubs`; access always comes from here. The SR
 * section follows the guide section 5.3 SR account workspace (loans, repayments, incentives,
 * payables; money only, D18). Only screens backed by the monthly workbook (plus sign-in) are
 * listed; reports live on the dashboard (D44). The opening is seeded with a new company (D73).
 */
export const navigation: readonly NavSection[] = [
  {
    id: "dashboard",
    labelKey: "nav.dashboard",
    items: [
      item("", "nav.dashboard", "company.view"),
      item("master/company-hishab", "nav.master.companyHishab", "company.view"),
      item("master/shareholders", "nav.master.shareholders", "company.view"),
      item("master/companies", "nav.master.companies", "company.view"),
    ],
  },
  {
    id: "sales",
    labelKey: "nav.sales",
    module: "sales",
    items: [
      item("sales/daily-summaries", "nav.sales.dailySummaries", "sale.view"),
      item("sales/shops", "nav.sales.shops", "company.view"),
      item("sales/sr", "nav.sales.sr", "sr_loan.view"),
    ],
  },
  {
    id: "history",
    labelKey: "nav.history",
    items: [
      item("history/orders", "nav.history.orders", "purchase.view"),
      item("history/stock", "nav.history.stock", "purchase.view"),
      item("history/damage", "nav.history.damage", "purchase.view"),
      item("history/shop-dues", "nav.history.shopDues", "sale.view"),
      item("history/staff-cash", "nav.history.staffCash", "finance.view"),
      item("history/sr-cash", "nav.history.srCash", "sr_loan.view"),
      item("history/expenses", "nav.history.expenses", "finance.view"),
      item("history/dsr-sheets", "nav.history.dsrSheets", "sale.view"),
    ],
  },
  {
    id: "purchases",
    labelKey: "nav.purchases",
    module: "purchases",
    items: [
      item("purchases/orders", "nav.purchases.orders", "purchase.view"),
      item("purchases/receipts", "nav.purchases.receipts", "purchase.view"),
    ],
  },
  {
    id: "inventory",
    labelKey: "nav.inventory",
    module: "inventory",
    items: [
      item("inventory/stock", "nav.inventory.stock", "inventory.view"),
      item("inventory/undelivered", "nav.inventory.undelivered", "inventory.view"),
    ],
  },
  {
    id: "dsr-staff",
    labelKey: "nav.dsrStaff",
    module: "dsrStaff",
    items: [item("dsr/salary-recovery", "dsr.salaryRecovery", "compensation.view")],
  },
  {
    id: "finance",
    labelKey: "nav.finance",
    module: "finance",
    items: [
      item("finance/company-account", "nav.finance.companyAccount", "finance.view"),
      item("finance/cash-book", "nav.finance.cashBook", "finance.view"),
      item("finance/supplier-deposits", "finance.supplierDeposit", "finance.view"),
    ],
  },
  {
    id: "masters",
    labelKey: "nav.masters",
    items: [
      item("masters/products", "nav.masters.products", "product.view"),
      item("masters/cartons", "nav.masters.cartons", "product.view"),
      item("masters/targets", "nav.masters.targets", "company.view"),
      item("masters/staff", "nav.masters.staff", "company.view"),
      item("masters/lists", "nav.masters.lists", "company.view"),
      item("opening", "opening.title", "opening.prepare"),
    ],
  },
];

export type HubId =
  | "dashboard"
  | "sales"
  | "goods"
  | "shops"
  | "money"
  | "ledgers"
  | "monthEnd"
  | "history"
  | "setup"
  | "staff"
  | "companies"
  | "shares"
  | "shareholders";

type HubTab = {
  path: string;
  /** Tab label; the screen's own label when absent. */
  labelKey?: TranslationKey;
};

type Hub = {
  id: HubId;
  labelKey: TranslationKey;
  icon: IconName;
  /** Alt+n opens the hub (n = position, 1…9). */
  shortcut: number;
  tabs: readonly HubTab[];
};

const hubDefinitions: readonly Omit<Hub, "shortcut">[] = [
  { id: "dashboard", labelKey: "nav.dashboard", icon: "dashboard", tabs: [{ path: "" }] },
  {
    id: "sales",
    labelKey: "nav.hub.sales",
    icon: "sales",
    tabs: [{ path: "sales/daily-summaries" }, { path: "sales/sr" }],
  },
  {
    id: "goods",
    labelKey: "nav.hub.goods",
    icon: "inventory",
    tabs: [
      { path: "purchases/orders", labelKey: "nav.flow.orders" },
      { path: "purchases/receipts", labelKey: "nav.flow.receipts" },
      { path: "inventory/stock" },
      { path: "inventory/undelivered" },
    ],
  },
  {
    id: "shops",
    labelKey: "nav.hub.shops",
    icon: "srAccounts",
    tabs: [{ path: "sales/shops" }],
  },
  {
    id: "money",
    labelKey: "nav.hub.money",
    icon: "finance",
    tabs: [{ path: "finance/supplier-deposits" }, { path: "finance/company-account" }],
  },
  {
    id: "ledgers",
    labelKey: "nav.flow.accounts",
    icon: "reports",
    tabs: [
      { path: "finance/cash-book" },
      { path: "dsr/salary-recovery", labelKey: "nav.flow.payroll" },
    ],
  },
  {
    id: "history",
    labelKey: "nav.history",
    icon: "calendar",
    tabs: [
      { path: "history/orders" },
      { path: "history/stock" },
      { path: "history/damage" },
      { path: "history/shop-dues" },
      { path: "history/staff-cash" },
      { path: "history/sr-cash" },
      { path: "history/expenses" },
      { path: "history/dsr-sheets" },
    ],
  },
  {
    id: "setup",
    labelKey: "nav.hub.setup",
    icon: "masters",
    tabs: [
      { path: "masters/products" },
      { path: "masters/cartons" },
      { path: "masters/targets" },
      { path: "masters/lists" },
      { path: "opening", labelKey: "opening.title" },
    ],
  },
];

/**
 * The master panel's hubs (D66, D67, D90): the dashboard, company add/edit/delete, Company Hishab
 * Reports, the শেয়ারহোল্ডার module and the global staff; everything else lives in the companies.
 */
const masterHubDefinitions: readonly Omit<Hub, "shortcut">[] = [
  { id: "dashboard", labelKey: "nav.master.dashboard", icon: "dashboard", tabs: [{ path: "" }] },
  {
    id: "shares",
    labelKey: "nav.master.companyHishab",
    icon: "finance",
    tabs: [{ path: "master/company-hishab", labelKey: "nav.master.companyHishab" }],
  },
  {
    id: "shareholders",
    labelKey: "nav.master.shareholders",
    icon: "srAccounts",
    tabs: [{ path: "master/shareholders", labelKey: "nav.master.shareholders" }],
  },
  {
    id: "staff",
    labelKey: "nav.master.staff",
    icon: "srAccounts",
    tabs: [{ path: "masters/staff", labelKey: "nav.master.staff" }],
  },
  {
    id: "companies",
    labelKey: "nav.master.companies",
    icon: "masters",
    tabs: [{ path: "master/companies", labelKey: "nav.master.companies" }],
  },
];

const withShortcuts = (definitions: readonly Omit<Hub, "shortcut">[]): readonly Hub[] =>
  definitions.map((hub, index) => ({ ...hub, shortcut: index + 1 }));

/**
 * The sidebar: exactly these hubs in this order (Alt+1…n), each a row of tabs. Every built
 * company screen is a tab of exactly one hub; access still comes from `navigation`. Presentation
 * only. The master company has its own set (`masterHubs`).
 */
export const hubs: readonly Hub[] = withShortcuts(hubDefinitions);

export const masterHubs: readonly Hub[] = withShortcuts(masterHubDefinitions);

const hubsFor = (master: boolean) => (master ? masterHubs : hubs);

export type VisibleTab = { path: string; labelKey: TranslationKey };

export type VisibleHub = {
  id: HubId;
  labelKey: TranslationKey;
  icon: IconName;
  shortcut: number;
  /** The first tab this person may open; where the hub's sidebar link goes. */
  path: string;
  tabs: VisibleTab[];
};

/** The hub whose tabs include this path (in the master panel's hubs when `master`). */
export function hubOfPath(path: string, master = false): Hub | undefined {
  return hubsFor(master).find((hub) => hub.tabs.some((tab) => tab.path === path));
}

/** Hubs a Manager must not see (owner 2026-11-08; amends D112 UI). */
const MANAGER_HIDDEN_HUBS: ReadonlySet<HubId> = new Set([
  "money",
  "ledgers",
  "history",
  "setup",
]);

/** The hubs with at least one screen this person may open in this company, tabs cut down too. */
export function visibleHubs(workspace: CompanyWorkspace): VisibleHub[] {
  return hubsFor(workspace.company.isMaster).flatMap((hub): VisibleHub[] => {
    if (workspace.loginRoleKind === "manager" && MANAGER_HIDDEN_HUBS.has(hub.id)) return [];
    const tabs = hub.tabs.flatMap((tab): VisibleTab[] => {
      const found = findNavEntry(tab.path);
      if (!found || navAccess(workspace, found.section, found.item) !== "ok") return [];
      return [{ path: tab.path, labelKey: tab.labelKey ?? found.item.labelKey }];
    });
    const first = tabs[0];
    if (!first) return [];
    return [
      {
        id: hub.id,
        labelKey: hub.labelKey,
        icon: hub.icon,
        shortcut: hub.shortcut,
        path: first.path,
        tabs,
      },
    ];
  });
}

type NavAccess = "ok" | "moduleUnavailable" | "forbidden";

export function findNavEntry(path: string): { section: NavSection; item: NavItem } | undefined {
  for (const section of navigation) {
    const match = section.items.find((i) => i.path === path);
    if (match) return { section, item: match };
  }
  return undefined;
}

/**
 * Effective visibility = enabled module ∩ authorized permission (guide section 4.3); a
 * super-admin opens every module (D59). A company opens only company screens and the master
 * company only its own (D66).
 */
export function navAccess(
  workspace: CompanyWorkspace,
  section: NavSection,
  navItem: NavItem,
): NavAccess {
  const hub = hubOfPath(navItem.path, workspace.company.isMaster);
  if (!hub) return "forbidden";
  if (workspace.loginRoleKind === "manager" && MANAGER_HIDDEN_HUBS.has(hub.id)) {
    return "forbidden";
  }
  if (
    section.module &&
    !workspace.allModules &&
    !workspace.company.modules.includes(section.module)
  ) {
    return "moduleUnavailable";
  }
  return workspace.permissions.includes(navItem.permission) ? "ok" : "forbidden";
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
