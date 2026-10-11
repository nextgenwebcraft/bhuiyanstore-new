import { bn } from "@bsd/i18n";
import { describe, expect, it } from "vitest";
import { demoSeed } from "@/data/mock/demo-seed";
import { createMockService } from "@/data/mock/mock-service";
import {
  equivalentPath,
  findNavEntry,
  hubOfPath,
  hubs,
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
  it("lists every built screen in exactly one hub tab", () => {
    const tabPaths = hubs.flatMap((hub) => hub.tabs.map((tab) => tab.path));
    const built = navigation.flatMap((s) => s.items).map((i) => i.path);
    expect(new Set(tabPaths).size).toBe(tabPaths.length);
    expect([...tabPaths].sort()).toEqual([...built].sort());
  });

  it("is the nine hubs in sidebar order, Alt+1…9 by position, dashboard first", () => {
    expect(hubs.map((h) => h.id)).toEqual([
      "dashboard",
      "sales",
      "goods",
      "shops",
      "money",
      "ledgers",
      "monthEnd",
      "opening",
      "setup",
    ]);
    expect(hubs.map((h) => h.shortcut)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(hubs[0]?.tabs.map((tab) => tab.path)).toEqual([""]);
    for (const hub of hubs) {
      expect(bn[hub.labelKey]).toBeTruthy();
      hub.tabs.forEach((tab) => tab.labelKey && expect(bn[tab.labelKey]).toBeTruthy());
    }
  });

  it("keeps the tab order the owner decided", () => {
    const paths = (id: string) => hubs.find((h) => h.id === id)?.tabs.map((tab) => tab.path);
    expect(paths("sales")).toEqual(["sales/daily-summaries", "sales/field"]);
    expect(paths("goods")).toEqual([
      "purchases/receipts",
      "purchases/orders",
      "inventory/stock",
      "inventory/damage",
      "inventory/claims",
    ]);
    expect(paths("shops")).toEqual(["sales/old-dues-collection", "sales/shops"]);
    expect(paths("monthEnd")).toEqual(["dsr/salary-recovery", "finance/period-close"]);
    expect(paths("opening")).toEqual(["admin/opening"]);
  });

  it("finds the hub of a path", () => {
    expect(hubOfPath("")?.id).toBe("dashboard");
    expect(hubOfPath("inventory/claims")?.id).toBe("goods");
    expect(hubOfPath("admin/roles")?.id).toBe("setup");
    expect(hubOfPath("unknown/path")).toBeUndefined();
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
    expect(operatorHubs.find((h) => h.id === "setup")?.tabs.map((tab) => tab.path)).not.toContain(
      "admin/roles",
    );
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

  it("keeps the equivalent route only when the destination supports it", async () => {
    const snacks = await workspace("user-owner", "demo-snacks");
    expect(equivalentPath("masters/products", snacks)).toBe("masters/products");
    expect(equivalentPath("purchases/orders", snacks)).toBe("");
    expect(equivalentPath("unknown/path", snacks)).toBe("");
    expect(equivalentPath("reports/month", snacks)).toBe("");
  });
});
