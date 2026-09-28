import { contrastRatio, MIN_TEXT_CONTRAST } from "@bsd/design-system";
import { toDecimal } from "@bsd/domain";
import { describe, expect, it } from "vitest";
import { demoSeed } from "./demo-seed";
import { createMockService } from "./mock-service";

const service = () => createMockService(demoSeed, { latencyMs: 0 });

function first<T>(items: T[]): T {
  const value = items[0];
  if (value === undefined) throw new Error("expected at least one item");
  return value;
}

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

  it("references only existing companies and products, with received == available + reserved + quarantine", () => {
    const companyIds = new Set(demoSeed.companies.map((c) => c.id));
    const productIds = new Set(demoSeed.products.map((p) => p.id));
    for (const batch of demoSeed.batches) {
      expect(companyIds).toContain(batch.companyId);
      expect(productIds).toContain(batch.productId);
      const sum = toDecimal(batch.availableQuantity)
        .add(toDecimal(batch.reservedQuantity))
        .add(toDecimal(batch.quarantineQuantity));
      expect(sum.equals(toDecimal(batch.receivedQuantity))).toBe(true);
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

  const newProduct = {
    sku: "NEW-001",
    name: "Test Product",
    aliases: ["টেস্ট পণ্য"],
    baseUnit: "piece" as const,
    piecesPerCarton: "24",
    status: "active" as const,
  };

  it("creates a product visible to a later listProducts call", async () => {
    const s = service();
    s.setActorId("user-owner");
    const created = await s.createProduct("drinko", newProduct);
    expect(created.companyId).toBe("drinko");
    const products = await s.listProducts("drinko");
    expect(products.map((p) => p.id)).toContain(created.id);
  });

  it("rejects a duplicate SKU within the same company but allows it across companies", async () => {
    const s = service();
    s.setActorId("user-owner");
    const existing = first(await s.listProducts("drinko"));
    await expect(
      s.createProduct("drinko", { ...newProduct, sku: existing.sku }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(
      s.createProduct("demo-foods", { ...newProduct, sku: existing.sku }),
    ).resolves.toMatchObject({ sku: existing.sku, companyId: "demo-foods" });
  });

  it("rejects create/update for an actor lacking the permission", async () => {
    const s = service();
    s.setActorId("user-operator");
    await expect(s.createProduct("drinko", newProduct)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const existing = first(await s.listProducts("drinko"));
    await expect(
      s.updateProduct("drinko", existing.id, { ...newProduct, sku: existing.sku }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("updates a product without leaking it into another company", async () => {
    const s = service();
    s.setActorId("user-owner");
    const existing = first(await s.listProducts("drinko"));
    const updated = await s.updateProduct("drinko", existing.id, {
      ...newProduct,
      sku: existing.sku,
      name: "Renamed",
    });
    expect(updated.name).toBe("Renamed");
    expect(updated.id).toBe(existing.id);
    const drinkoProducts = await s.listProducts("drinko");
    expect(drinkoProducts.find((p) => p.id === existing.id)?.name).toBe("Renamed");
    const foodsProducts = await s.listProducts("demo-foods");
    expect(foodsProducts.some((p) => p.id === existing.id)).toBe(false);
  });

  it("returns only the requested company's batches", async () => {
    const s = service();
    s.setActorId("user-owner");
    const batches = await s.listBatches("drinko");
    expect(batches.length).toBeGreaterThan(0);
    expect(batches.every((b) => b.companyId === "drinko")).toBe(true);
  });

  it("hides batches of an inaccessible company behind COMPANY_NOT_FOUND", async () => {
    const s = service();
    s.setActorId("user-operator");
    await expect(s.listBatches("demo-foods")).rejects.toMatchObject({
      code: "COMPANY_NOT_FOUND",
    });
  });
});
