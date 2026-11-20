import { bn } from "@bsd/i18n";
import { describe, expect, it } from "vitest";
import { demoSeed } from "@/data/mock/demo-seed";
import { createMockService } from "@/data/mock/mock-service";
import {
  equivalentPath,
  findNavEntry,
  hubOfPath,
  hubs,
  masterHubs,
  navigation,
  visibleHubs,
} from "./navigation";

const service = createMockService(demoSeed, { latencyMs: 0 });

async function workspace(userId: string, companyId: string) {
  service.setActorId(userId);
  return service.getWorkspace(companyId);
}

describe("navigation", () => {
  it("has unique paths with Bangla labels", () => {
    const paths = navigation.flatMap((s) => s.items.map((i) => i.path));
    expect(new Set(paths).size).toBe(paths.length);
    for (const section of navigation) {
      expect(bn[section.labelKey]).toBeTruthy();
      section.items.forEach((i) => expect(bn[i.labelKey]).toBeTruthy());
    }
  });

  it("resolves the dashboard entry", () => {
    expect(findNavEntry("")?.section.id).toBe("dashboard");
  });

  it("has no entry for the removed report, samari and firot screens", () => {
    for (const path of [
      "reports/operations",
      "reports/month",
      "reports/stock",
      "reports/money",
      "reports/staff",
      "sales/samari",
      "sales/firot",
    ]) {
      expect(findNavEntry(path)).toBeUndefined();
      expect(hubOfPath(path)).toBeUndefined();
    }
  });
});

describe("hubs", () => {
  it("lists every built screen in a company or master hub tab, once per hub set", () => {
    const companyTabs = hubs.flatMap((hub) => hub.tabs.map((tab) => tab.path));
    const masterTabs = masterHubs.flatMap((hub) => hub.tabs.map((tab) => tab.path));
    const built = navigation.flatMap((s) => s.items).map((i) => i.path);
    expect(new Set(companyTabs).size).toBe(companyTabs.length);
    expect(new Set(masterTabs).size).toBe(masterTabs.length);
    expect([...new Set([...companyTabs, ...masterTabs])].sort()).toEqual([...built].sort());
  });

  it("is the company hubs in sidebar order, Alt+1…8 by position, dashboard first", () => {
    expect(hubs.map((h) => h.id)).toEqual([
      "dashboard",
      "sales",
      "goods",
      "shops",
      "money",
      "ledgers",
      "history",
      "setup",
    ]);
    expect(hubs.map((h) => h.shortcut)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(hubs[0]?.tabs.map((tab) => tab.path)).toEqual([""]);
    for (const hub of [...hubs, ...masterHubs]) {
      expect(bn[hub.labelKey]).toBeTruthy();
      hub.tabs.forEach((tab) => tab.labelKey && expect(bn[tab.labelKey]).toBeTruthy());
    }
  });

  it("keeps the tab order the owner decided", () => {
    const paths = (id: string) => hubs.find((h) => h.id === id)?.tabs.map((tab) => tab.path);
    expect(paths("sales")).toEqual(["sales/daily-summaries", "sales/sr"]);
    expect(paths("goods")).toEqual([
      "purchases/orders",
      "purchases/receipts",
      "inventory/stock",
      "inventory/undelivered",
      "inventory/floor-damage",
    ]);
    expect(paths("history")).toEqual([
      "history/orders",
      "history/stock",
      "history/stock-tracking",
      "history/damage",
      "history/shop-dues",
      "history/staff-cash",
      "history/sr-cash",
      "history/expenses",
      "history/company-checks",
      "history/dsr-sheets",
    ]);
    expect(paths("shops")).toEqual(["sales/shops"]);
    expect(paths("money")).toEqual([
      "finance/supplier-deposits",
      "finance/company-account",
      "finance/company-checks",
    ]);
    expect(paths("ledgers")).toEqual(["finance/cash-book", "dsr/salary-recovery"]);
  });

  it("has no entry for the removed statement, receivable, payable and opening screens (D73)", () => {
    for (const path of [
      "dsr/statement",
      "dsr/accounts",
      "finance/receivables",
      "finance/payables",
      "admin/opening",
    ]) {
      expect(findNavEntry(path)).toBeUndefined();
      expect(hubOfPath(path)).toBeUndefined();
    }
  });

  it("gives the master panel its dashboard, Company Hishab Reports, shareholders, staff and companies", () => {
    const paths = (id: string) => masterHubs.find((h) => h.id === id)?.tabs.map((tab) => tab.path);
    expect(masterHubs.map((h) => h.id)).toEqual([
      "dashboard",
      "shares",
      "shareholders",
      "partnerPayments",
      "previousDue",
      "staff",
      "companies",
    ]);
    expect(paths("companies")).toEqual(["master/companies"]);
    expect(paths("shares")).toEqual(["master/company-hishab"]);
    expect(paths("shareholders")).toEqual(["master/shareholders"]);
    expect(paths("partnerPayments")).toEqual([
      "master/partner-payments",
      "master/partner-payments/history",
    ]);
    expect(hubOfPath("master/partner-payments/history", true)?.id).toBe("partnerPayments");
    expect(paths("previousDue")).toEqual(["master/previous-due"]);
    expect(paths("staff")).toEqual(["masters/staff"]);
    expect(hubOfPath("master/companies", true)?.id).toBe("companies");
    expect(hubOfPath("master/companies")).toBeUndefined();
    expect(hubOfPath("master/company-hishab", true)?.id).toBe("shares");
    expect(hubOfPath("master/company-hishab")).toBeUndefined();
    expect(hubOfPath("masters/staff")).toBeUndefined();
    for (const path of ["sr-accounts/representatives", "dsr/settlements", "master/month-close"]) {
      expect(findNavEntry(path)).toBeUndefined();
    }
  });

  it("finds the hub of a path", () => {
    expect(hubOfPath("")?.id).toBe("dashboard");
    expect(hubOfPath("inventory/undelivered")?.id).toBe("goods");
    expect(hubOfPath("admin/roles")).toBeUndefined();
    expect(hubOfPath("admin/users")).toBeUndefined();
    expect(hubOfPath("masters/staff", true)?.id).toBe("staff");
    expect(hubOfPath("unknown/path")).toBeUndefined();
  });

  it("opens company screens in a company and master screens in the master only", async () => {
    const owner = await workspace("user-owner", "drinko");
    const master = { ...owner, company: { ...owner.company, isMaster: true } };
    expect(equivalentPath("masters/staff", owner)).toBe("");
    expect(equivalentPath("masters/staff", master)).toBe("masters/staff");
    expect(equivalentPath("purchases/orders", master)).toBe("");
    expect(visibleHubs(master).map((h) => h.id)).toContain("staff");
  });

  it("shows a hub only when a tab is visible, and links to its first visible tab", async () => {
    const owner = await workspace("user-owner", "drinko");
    const all = visibleHubs(owner);
    expect(all[0]?.id).toBe("dashboard");
    expect(all[0]?.path).toBe("");
    expect(all.find((h) => h.id === "sales")?.path).toBe("sales/daily-summaries");

    const operator = await workspace("user-operator", "drinko");
    const operatorHubs = visibleHubs(operator);
    const operatorPaths = operatorHubs.flatMap((h) => h.tabs.map((tab) => tab.path));
    expect(operatorPaths).toContain("sales/daily-summaries");
    expect(operatorPaths).not.toContain("admin/users");
    expect(operatorPaths).not.toContain("admin/roles");
    expect(all.flatMap((h) => h.tabs.map((tab) => tab.path))).not.toContain("admin/users");
    expect(all.flatMap((h) => h.tabs.map((tab) => tab.path))).not.toContain("admin/roles");
    for (const hub of operatorHubs) expect(hub.path).toBe(hub.tabs[0]?.path);
  });

  it("hides hubs whose module is disabled for the company", async () => {
    const snacks = await workspace("user-owner", "demo-snacks");
    const paths = visibleHubs(snacks).flatMap((h) => h.tabs.map((tab) => tab.path));
    expect(paths).toContain("sales/daily-summaries");
    expect(paths).not.toContain("purchases/receipts");
    expect(
      visibleHubs(snacks)
        .find((h) => h.id === "goods")
        ?.tabs.map((tab) => tab.path),
    ).toEqual(expect.not.arrayContaining(["purchases/orders"]));
  });

  it("opens every module for a super-admin, still by permission (D59)", async () => {
    const snacks = { ...(await workspace("user-owner", "demo-snacks")), allModules: true };
    const paths = visibleHubs(snacks).flatMap((h) => h.tabs.map((tab) => tab.path));
    expect(paths).toEqual(expect.arrayContaining(["purchases/receipts", "sales/daily-summaries"]));
    expect(equivalentPath("purchases/orders", snacks)).toBe("purchases/orders");
  });

  it("keeps the equivalent route only when the destination supports it", async () => {
    const snacks = await workspace("user-owner", "demo-snacks");
    expect(equivalentPath("masters/products", snacks)).toBe("masters/products");
    expect(equivalentPath("purchases/orders", snacks)).toBe("");
    expect(equivalentPath("unknown/path", snacks)).toBe("");
    expect(equivalentPath("reports/month", snacks)).toBe("");
  });

  it("limits Manager / DSR / TSM hubs to their D112–D125 allowlists", async () => {
    const base = await workspace("user-owner", "drinko");
    const pathsOf = (loginRoleKind: "manager" | "dsr" | "tsm") =>
      visibleHubs({ ...base, loginRoleKind }).flatMap((h) => h.tabs.map((tab) => tab.path));

    const managerPaths = pathsOf("manager");
    expect(managerPaths).toContain("sales/daily-summaries");
    expect(managerPaths).toContain("purchases/receipts");
    expect(managerPaths).not.toContain("finance/company-account");
    expect(managerPaths).not.toContain("dsr/salary-recovery");
    expect(managerPaths).not.toContain("history/orders");
    expect(managerPaths).not.toContain("masters/products");

    expect(pathsOf("dsr").sort()).toEqual(["", "sales/daily-summaries"]);

    const tsmPaths = pathsOf("tsm");
    expect(tsmPaths.sort()).toEqual([
      "",
      "inventory/floor-damage",
      "inventory/stock",
      "inventory/undelivered",
      "purchases/orders",
    ]);
    expect(tsmPaths).not.toContain("purchases/receipts");
  });
});
