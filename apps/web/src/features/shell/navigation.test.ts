import { bn } from "@bsd/i18n";
import { describe, expect, it } from "vitest";
import { demoSeed } from "@/data/mock/demo-seed";
import { createMockService } from "@/data/mock/mock-service";
import {
  equivalentPath,
  findNavEntry,
  findSectionById,
  flowGroups,
  navigation,
  visibleFlow,
  visibleNavigation,
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

  it("hides sections whose module is disabled for the company", async () => {
    const snacks = await workspace("user-owner", "demo-snacks");
    const ids = visibleNavigation(snacks).map((s) => s.id);
    expect(ids).toContain("sales");
    expect(ids).not.toContain("purchases");
    expect(ids).not.toContain("sr-accounts");
  });

  it("hides items the role does not grant", async () => {
    const operator = await workspace("user-operator", "drinko");
    const ids = visibleNavigation(operator).map((s) => s.id);
    expect(ids).not.toContain("administration");
    expect(ids).not.toContain("finance");
    expect(ids).toContain("masters");
  });

  it("keeps the equivalent route only when the destination supports it", async () => {
    const snacks = await workspace("user-owner", "demo-snacks");
    expect(equivalentPath("masters/products", snacks)).toBe("masters/products");
    expect(equivalentPath("purchases/orders", snacks)).toBe("");
    expect(equivalentPath("unknown/path", snacks)).toBe("");
  });

  it("resolves the dashboard entry", () => {
    expect(findNavEntry("")?.section.id).toBe("dashboard");
  });

  it("lists every built screen exactly once in the work order, with Bangla labels", () => {
    const flowPaths = flowGroups.flatMap((g) => g.entries.map((e) => e.path));
    const built = navigation
      .flatMap((s) => s.items)
      .filter((i) => i.implemented && i.path !== "")
      .map((i) => i.path);
    expect([...flowPaths].sort()).toEqual([...built].sort());
    for (const group of flowGroups) {
      expect(bn[group.labelKey]).toBeTruthy();
      group.entries.forEach((e) => e.labelKey && expect(bn[e.labelKey]).toBeTruthy());
    }
  });

  it("gives Alt+1…9 to distinct screens, starting with the day's entries", () => {
    const shortcuts = flowGroups.flatMap((g) => g.entries.flatMap((e) => e.shortcut ?? []));
    expect([...shortcuts].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(flowGroups[0]?.id).toBe("daily");
    expect(flowGroups[0]?.entries[0]?.path).toBe("sales/daily-summaries");
  });

  it("shows only the screens the role and modules allow", async () => {
    const operator = await workspace("user-operator", "drinko");
    const operatorPaths = visibleFlow(operator).flatMap((g) => g.links.map((l) => l.path));
    expect(operatorPaths).toContain("sales/daily-summaries");
    expect(operatorPaths).not.toContain("admin/users");
    const snacks = await workspace("user-owner", "demo-snacks");
    const paths = visibleFlow(snacks).flatMap((g) => g.links.map((l) => l.path));
    expect(paths).toContain("sales/daily-summaries");
    expect(paths).not.toContain("purchases/receipts");
  });

  it("resolves a module landing path but not the dashboard or a leaf path", () => {
    expect(findSectionById("purchases")?.id).toBe("purchases");
    expect(findSectionById("masters")?.id).toBe("masters");
    expect(findSectionById("dashboard")).toBeUndefined();
    expect(findSectionById("masters/products")).toBeUndefined();
    expect(findSectionById("unknown")).toBeUndefined();
  });
});
