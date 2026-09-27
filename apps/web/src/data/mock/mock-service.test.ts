import { contrastRatio, MIN_TEXT_CONTRAST } from "@bsd/design-system";
import { describe, expect, it } from "vitest";
import { demoSeed } from "./demo-seed";
import { createMockService } from "./mock-service";

const service = () => createMockService(demoSeed, { latencyMs: 0 });

describe("demo seed", () => {
  it("gives every company theme WCAG AA text contrast", () => {
    for (const { theme } of demoSeed.companies) {
      expect(contrastRatio(theme.primaryForeground, theme.primary)).toBeGreaterThanOrEqual(
        MIN_TEXT_CONTRAST,
      );
    }
  });

  it("references only existing companies, users and roles", () => {
    const companyIds = new Set(demoSeed.companies.map((c) => c.id));
    const userIds = new Set(demoSeed.users.map((u) => u.id));
    const roleIds = new Set(demoSeed.roles.map((r) => r.id));
    for (const p of demoSeed.products) expect(companyIds).toContain(p.companyId);
    for (const m of demoSeed.memberships) {
      expect(userIds).toContain(m.userId);
      expect(companyIds).toContain(m.companyId);
      m.roleIds.forEach((id) => expect(roleIds).toContain(id));
    }
  });
});

describe("mock service", () => {
  it("lists only the companies the actor belongs to", async () => {
    const s = service();
    s.setActorId("user-operator");
    const workspaces = await s.listWorkspaces();
    expect(workspaces.map((w) => w.company.id)).toEqual(["drinko"]);
  });

  it("hides inaccessible companies behind COMPANY_NOT_FOUND", async () => {
    const s = service();
    s.setActorId("user-operator");
    await expect(s.getWorkspace("demo-foods")).rejects.toMatchObject({
      code: "COMPANY_NOT_FOUND",
    });
    await expect(s.getWorkspace("no-such-company")).rejects.toMatchObject({
      code: "COMPANY_NOT_FOUND",
    });
  });

  it("returns only the requested company's products", async () => {
    const products = await service().listProducts("demo-foods");
    expect(products.length).toBeGreaterThan(0);
    expect(products.every((p) => p.companyId === "demo-foods")).toBe(true);
  });

  it("grants the owner every permission and the operator a subset", async () => {
    const s = service();
    s.setActorId("user-owner");
    const owner = await s.getWorkspace("drinko");
    s.setActorId("user-operator");
    const operator = await s.getWorkspace("drinko");
    expect(owner.permissions).toContain("role.manage");
    expect(operator.permissions).not.toContain("role.manage");
    expect(operator.permissions).toContain("product.view");
  });

  it("rejects an aborted request", async () => {
    const s = createMockService(demoSeed, { latencyMs: 50 });
    const controller = new AbortController();
    const pending = s.listWorkspaces({ signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "REQUEST_ABORTED" });
  });
});
