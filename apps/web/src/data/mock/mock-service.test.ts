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

  it("assigns suppliers, staff and opening market dues only to existing companies and DSRs", () => {
    const companyIds = new Set(demoSeed.companies.map((c) => c.id));
    for (const s of demoSeed.suppliers) expect(companyIds).toContain(s.companyId);
    for (const p of demoSeed.staff) p.companyIds.forEach((id) => expect(companyIds).toContain(id));
    for (const due of demoSeed.openingMarketDues) {
      const dsr = demoSeed.staff.find((p) => p.id === due.dsrId);
      expect(dsr?.kind).toBe("dsr");
      expect(dsr?.companyIds).toContain(due.companyId);
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

  it("hides staff assignments to companies the actor cannot access", async () => {
    const s = service();
    s.setActorId("user-operator");
    const staff = await s.listStaff("drinko");
    const rahim = staff.find((p) => p.id === "dsr-rahim");
    expect(rahim?.companyIds).toEqual(["drinko"]);
  });

  it("derives seed batch balances from opening movements unchanged", async () => {
    const batches = await service().listBatches("drinko");
    const quarantined = batches.find((b) => b.id === "batch-sdor250-a");
    expect(quarantined).toMatchObject({
      receivedQuantity: "288",
      availableQuantity: "216",
      quarantineQuantity: "72",
      origin: "opening",
    });
  });
});

const key = () => crypto.randomUUID();

async function availableOf(s: ReturnType<typeof service>, companyId: string, batchId: string) {
  const batch = (await s.listBatches(companyId)).find((b) => b.id === batchId);
  return batch?.availableQuantity;
}

describe("purchase receipt posting", () => {
  const receipt = (overrides: Record<string, unknown> = {}) => ({
    requestKey: key(),
    kind: "purchase" as const,
    supplierId: "sup-drinko",
    receivedDate: "2026-10-01",
    reference: "INV-77",
    lines: [{ productId: "drink-250", cartons: "2", loosePieces: "3", unitCost: "20.5" }],
    ...overrides,
  });

  it("creates a new cost layer from cartons + pieces using the product's factor", async () => {
    const s = service();
    const posted = await s.postGoodsReceipt("drinko", receipt());
    const line = first(posted.lines);
    // 2 cartons × 24 + 3 = 51 pieces (guide 9.2).
    expect(line.quantity).toBe("51");
    expect(line.lineValue).toBe("1045.50");
    expect(posted.number).toBe("GRN-0001");
    const batch = (await s.listBatches("drinko")).find((b) => b.id === line.batchId);
    expect(batch).toMatchObject({
      availableQuantity: "51",
      receivedQuantity: "51",
      unitCost: "20.500000",
      origin: "purchase",
    });
  });

  it("returns the original receipt for a retried request key without posting twice", async () => {
    const s = service();
    const input = receipt();
    const firstPost = await s.postGoodsReceipt("drinko", input);
    const retry = await s.postGoodsReceipt("drinko", input);
    expect(retry.id).toBe(firstPost.id);
    expect(await s.listGoodsReceipts("drinko")).toHaveLength(1);
  });

  it("rejects the same request key with a different payload", async () => {
    const s = service();
    const input = receipt();
    await s.postGoodsReceipt("drinko", input);
    await expect(
      s.postGoodsReceipt("drinko", { ...input, reference: "changed" }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("tags free supplier-incentive stock separately (D16)", async () => {
    const s = service();
    const posted = await s.postGoodsReceipt("drinko", receipt({ kind: "supplier_incentive" }));
    const batch = (await s.listBatches("drinko")).find((b) => b.id === first(posted.lines).batchId);
    expect(batch?.origin).toBe("supplier_incentive");
  });

  it("rejects a zero valuation, a foreign supplier and a disabled purchases module", async () => {
    const s = service();
    await expect(
      s.postGoodsReceipt(
        "drinko",
        receipt({
          lines: [{ productId: "drink-250", cartons: "1", loosePieces: "0", unitCost: "0" }],
        }),
      ),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(
      s.postGoodsReceipt("drinko", receipt({ supplierId: "sup-demo-foods" })),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(
      s.postGoodsReceipt("demo-snacks", receipt({ supplierId: "sup-demo-snacks", lines: [] })),
    ).rejects.toMatchObject({ code: "MODULE_UNAVAILABLE" });
  });

  it("forbids an actor without purchase.post", async () => {
    const s = service();
    s.setActorId("user-operator");
    await expect(s.postGoodsReceipt("drinko", receipt())).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

const summary = (overrides: Record<string, unknown> = {}) => ({
  requestKey: key(),
  businessDate: "2026-10-02",
  dsrId: "dsr-rahim",
  cashCollected: "10000",
  lines: [
    {
      productId: "drink-250",
      priceSplits: [
        { quantity: "500", unitPrice: "25" },
        { quantity: "100", unitPrice: "26" },
      ],
    },
  ],
  ...overrides,
});

describe("daily sales summary posting", () => {
  it("spans two batches FEFO, keeps both prices, and splits market due", async () => {
    const s = service();
    const posted = await s.postDailySalesSummary("drinko", summary());
    const line = first(posted.lines);
    // FEFO: batch A (exp 2026-12-31, 480 @ 18.5) before B (exp 2027-01-31, 240 @ 19.75).
    expect(line.allocations.map((a) => [a.batchId, a.quantity])).toEqual([
      ["batch-dr250-a", "480"],
      ["batch-dr250-b", "120"],
    ]);
    expect(line.priceSplits.map((p) => p.amount)).toEqual(["12500.00", "2600.00"]);
    expect(posted.netSales).toBe("15100.00");
    // 480 × 18.5 + 120 × 19.75 = 8880 + 2370
    expect(posted.cogs).toBe("11250.00");
    expect(posted.grossProfit).toBe("3850.00");
    expect(posted.marketDue).toBe("5100.00");
    expect(await availableOf(s, "drinko", "batch-dr250-a")).toBe("0");
    expect(await availableOf(s, "drinko", "batch-dr250-b")).toBe("120");
    const dues = await s.listMarketDues("drinko");
    expect(dues.find((d) => d.sourceSummaryId === posted.id)?.remainingAmount).toBe("5100.00");
  });

  it("fails atomically with INSUFFICIENT_STOCK, leaving stock untouched", async () => {
    const s = service();
    const tooMuch = summary({
      lines: [
        { productId: "drink-500", priceSplits: [{ quantity: "10", unitPrice: "40" }] },
        { productId: "drink-250", priceSplits: [{ quantity: "721", unitPrice: "25" }] },
      ],
      cashCollected: "0",
    });
    await expect(s.postDailySalesSummary("drinko", tooMuch)).rejects.toMatchObject({
      code: "INSUFFICIENT_STOCK",
    });
    expect(await availableOf(s, "drinko", "batch-dr500-a")).toBe("180");
    expect(await s.listDailySalesSummaries("drinko")).toHaveLength(0);
  });

  it("never consumes quarantined stock", async () => {
    const s = service();
    await expect(
      s.postDailySalesSummary(
        "drinko",
        summary({
          lines: [
            {
              productId: "sundrop-orange-250",
              priceSplits: [{ quantity: "217", unitPrice: "20" }],
            },
          ],
          cashCollected: "0",
        }),
      ),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_STOCK" });
  });

  it("allows only one summary per company, DSR and business date (D03)", async () => {
    const s = service();
    await s.postDailySalesSummary("drinko", summary({ cashCollected: "0" }));
    await expect(
      s.postDailySalesSummary(
        "drinko",
        summary({
          cashCollected: "0",
          lines: [{ productId: "drink-500", priceSplits: [{ quantity: "1", unitPrice: "40" }] }],
        }),
      ),
    ).rejects.toMatchObject({ code: "DUPLICATE_DOCUMENT" });
  });

  it("rejects collecting more cash than was sold", async () => {
    await expect(
      service().postDailySalesSummary("drinko", summary({ cashCollected: "15100.01" })),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("redacts cost and profit for an actor without inventory.cost_view", async () => {
    const s = service();
    s.setActorId("user-manager");
    const posted = await s.postDailySalesSummary("drinko", summary());
    expect(posted.cogs).toBeUndefined();
    expect(posted.grossProfit).toBeUndefined();
    expect(first(posted.lines).allocations.every((a) => a.unitCost === undefined)).toBe(true);
    const dashboard = await s.getDashboardSummary("drinko", "2026-10-02");
    expect(dashboard.stockValue).toBeUndefined();
    expect(dashboard.grossProfit).toBeUndefined();
    expect(dashboard.netSales).toBe("15100.00");
  });

  it("sells stock that was received earlier in the same session", async () => {
    const s = service();
    const receipt = await s.postGoodsReceipt("drinko", {
      requestKey: key(),
      kind: "purchase",
      supplierId: "sup-drinko",
      receivedDate: "2026-10-01",
      reference: "",
      lines: [{ productId: "drink-500", cartons: "1", loosePieces: "0", unitCost: "33" }],
    });
    const posted = await s.postDailySalesSummary(
      "drinko",
      summary({
        cashCollected: "0",
        lines: [{ productId: "drink-500", priceSplits: [{ quantity: "190", unitPrice: "40" }] }],
      }),
    );
    expect(first(posted.lines).allocations.map((a) => [a.batchId, a.quantity])).toEqual([
      ["batch-dr500-a", "180"],
      [first(receipt.lines).batchId, "10"],
    ]);
  });
});

describe("old-dues collection", () => {
  const collection = (amount: string) => ({
    requestKey: key(),
    dsrId: "dsr-rahim",
    collectedDate: "2026-10-02",
    amount,
  });

  it("settles the oldest open due first and updates remaining balances", async () => {
    const s = service();
    const posted = await s.postOldDueCollection("drinko", collection("1800"));
    expect(posted.allocations.map((a) => [a.dueItemId, a.amount])).toEqual([
      ["open-due-1", "1500.00"],
      ["open-due-2", "300.00"],
    ]);
    const dues = await s.listMarketDues("drinko");
    expect(dues.find((d) => d.id === "open-due-1")?.remainingAmount).toBe("0.00");
    expect(dues.find((d) => d.id === "open-due-2")?.remainingAmount).toBe("500.00");
    // Another DSR's dues are never touched.
    expect(dues.find((d) => d.id === "open-due-3")?.remainingAmount).toBe("1200.00");
  });

  it("rejects collecting more than the DSR's open market due", async () => {
    await expect(
      service().postOldDueCollection("drinko", collection("2300.01")),
    ).rejects.toMatchObject({ code: "AMOUNT_EXCEEDS_DUE" });
  });

  it("counts collections in dashboard cash but not in net sales", async () => {
    const s = service();
    await s.postOldDueCollection("drinko", collection("500"));
    const dashboard = await s.getDashboardSummary("drinko", "2026-10-02");
    expect(dashboard.netSales).toBe("0.00");
    expect(dashboard.oldDuesCollected).toBe("500.00");
    expect(dashboard.cashCollected).toBe("500.00");
    expect(dashboard.marketDueOutstanding).toBe("3000.00");
    expect(dashboard.byDsr.map((r) => [r.dsrId, r.oldDuesCollected])).toEqual([
      ["dsr-rahim", "500.00"],
    ]);
  });

  it("reports only the chosen date, with dues outstanding as of that date", async () => {
    const s = service();
    await s.postOldDueCollection("drinko", collection("500"));
    await s.postDailySalesSummary("drinko", summary({ cashCollected: "15000" }));
    const dayBefore = await s.getDashboardSummary("drinko", "2026-10-01");
    expect(dayBefore.cashCollected).toBe("0.00");
    expect(dayBefore.postedSummaryCount).toBe(0);
    expect(dayBefore.marketDueOutstanding).toBe("3500.00");
    const day = await s.getDashboardSummary("drinko", "2026-10-02");
    expect(day.netSales).toBe("15100.00");
    expect(day.salesCash).toBe("15000.00");
    expect(day.marketDueCreated).toBe("100.00");
    expect(day.cashCollected).toBe("15500.00");
    expect(day.marketDueOutstanding).toBe("3100.00");
  });

  it("rejects a malformed report date", async () => {
    await expect(service().getDashboardSummary("drinko", "02-10-2026")).rejects.toBeDefined();
  });
});
