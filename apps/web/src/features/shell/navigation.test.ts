import { bn } from "@bsd/i18n";
import { describe, expect, it } from "vitest";
import { demoSeed } from "@/data/mock/demo-seed";
import { createMockService } from "@/data/mock/mock-service";
import {
  equivalentPath,
  findNavEntry,
  findSectionById,
  navGroups,
  navigation,
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

  it("assigns every non-dashboard section to one of the fixed groups", () => {
    const groupIds = new Set(navGroups.map((g) => g.id));
    for (const section of navigation) {
      if (section.id === "dashboard") {
        expect(section.groupId).toBeUndefined();
      } else {
        expect(Boolean(section.groupId && groupIds.has(section.groupId))).toBe(true);
      }
    }
  });

  it("resolves a module landing path but not the dashboard or a leaf path", () => {
    expect(findSectionById("purchases")?.id).toBe("purchases");
    expect(findSectionById("masters")?.id).toBe("masters");
    expect(findSectionById("dashboard")).toBeUndefined();
    expect(findSectionById("masters/products")).toBeUndefined();
    expect(findSectionById("unknown")).toBeUndefined();
  });
});
