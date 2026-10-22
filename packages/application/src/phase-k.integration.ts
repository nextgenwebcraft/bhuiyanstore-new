import { bootstrapSuperAdmin, type Actor } from "@bsd/auth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRole, createUser } from "./administration";
import { createCompany } from "./companies";
import { staffRoles } from "./configuration";
import type { AppContext } from "./context";
import { getDayView, postDsrDay, postStockEntries, saveDsrDay } from "./daily";
import { closeMonth, getMonthView, getReport, reopenMonth } from "./month";
import { createProduct } from "./products";
import { createStaff } from "./staff";
import { contextFor, resetTestSchema, saveWholeOpening, testDatabase } from "./test-support";

process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-integration-test-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

/**
 * D49 product batches (FIFO) through the application services; a DSR line without a batch (D68)
 * still takes FIFO. Hand-worked numbers: opening 100 pieces at cost 10 / sale 12 on 2026-08-01
 * (batch 1); 2026-08-02 receives 50 at cost 11 / sale 14 (batch 2); 2026-08-03 one DSR sheet
 * issues 120:
 *   100 from batch 1 (100 x 12 = 1200, cost 1000) + 20 from batch 2 (20 x 14 = 280, cost 220)
 *   = sales 1480, cost 1220; 30 pieces of batch 2 are left (value 330).
 */

const { db, schema } = testDatabase();
const theme = { primary: "#0F766E", primaryForeground: "#FFFFFF" };

let admin: Actor;
let ctx: AppContext;
let viewerCtx: AppContext;
let company = "";
let alpha = "";
let mamun = "";
/** D68: the opening batch and the order's batch ids, the engine's batch keys. */
let opening = "";
let paid = "";

function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected a value");
  return value;
}

async function row(date: string, context = ctx) {
  return must(
    (await getDayView(context, company, date)).products.find((p) => p.productId === alpha),
  );
}

beforeAll(async () => {
  await resetTestSchema(db, schema);
  const boot = await bootstrapSuperAdmin(db, {
    tenantName: "Test Distributor",
    adminEmail: "admin@example.test",
    adminName: "Admin",
    adminPassword: "one-time-Password-123",
  });
  await db.user.update({ where: { id: boot.adminId }, data: { mustChangePassword: false } });
  admin = {
    userId: boot.adminId,
    tenantId: boot.tenantId,
    isSuperAdmin: true,
    mustChangePassword: false,
  };
  ctx = contextFor(db, admin);
  company = (
    await createCompany(ctx, { name: "Drinko K", theme, modules: ["sales"], starterData: false })
  ).company.id;
  alpha = (
    await createProduct(ctx, company, {
      sku: "A250",
      name: "Alpha 250ml",
      aliases: [],
      baseUnit: "piece",
      piecesPerCarton: "24",
      status: "active",
    })
  ).id;
  const roles = await staffRoles.list(ctx);
  mamun = (
    await createStaff(ctx, company, {
      name: "Mamun",
      employer: "distributor",
      status: "active",
      assignment: {
        roleId: must(roles.find((r) => r.kind === "dsr")).id,
        from: "2026-01-01",
        to: null,
      },
    })
  ).id;
  await saveWholeOpening(ctx, company, {
    cutoffDate: "2026-08-01",
    stock: [
      {
        productId: alpha,
        pieces: "100",
        unitCost: "10",
        salePrice: "12",
        orderPrice: "10",
        dueFromCompany: "0",
        note: "",
      },
    ],
    balances: [],
  });
  const role = await createRole(ctx, {
    name: "Viewer",
    permissions: ["company.view", "report.view"],
  });
  const viewer = await createUser(ctx, {
    name: "Viewer",
    email: "viewer.k@example.test",
    password: "temporary-Password-1",
    memberships: [{ companyId: company, roleIds: [role.id] }],
  });
  viewerCtx = contextFor(db, {
    userId: viewer.id,
    tenantId: admin.tenantId,
    isSuperAdmin: false,
    mustChangePassword: false,
  });

  opening = must(
    await db.productBatch.findFirst({ where: { productId: alpha, source: "opening" } }),
  ).id;
  // D68: 50 pieces ordered at 264 a carton of 24 (= 11 a piece, bill 550) to sell at 14 open
  // batch 2; they arrive the same day.
  const [order] = await postStockEntries(ctx, company, {
    date: "2026-08-02",
    lines: [
      {
        kind: "order",
        productId: alpha,
        pieces: "50",
        freePieces: "0",
        cartonRate: "264",
        salePrice: "14",
      },
    ],
    prices: [],
  });
  paid = must(must(order).batchId);
  await postStockEntries(ctx, company, {
    date: "2026-08-02",
    lines: [{ kind: "receipt", productId: alpha, pieces: "50", batchId: paid }],
    prices: [],
  });
  const draft = await saveDsrDay(ctx, company, {
    date: "2026-08-03",
    staffId: mamun,
    version: 0,
    marketDueNew: "0",
    marketDueCollected: "0",
    lines: [{ productId: alpha, issued: "120", returned: "0", damaged: "0" }],
  });
  await postDsrDay(ctx, company, draft.id, { version: draft.version });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("D49: opening batch and receipts", () => {
  it("opening stock is batch 1 and the opening prices create no extra batch on the cutoff day", async () => {
    const day1 = await row("2026-08-01");
    expect(day1.batches).toEqual([
      {
        key: opening,
        seq: 1,
        startDate: "2026-08-01",
        costPrice: "10",
        salePrice: "12",
        quantity: "100",
        value: "1000",
      },
    ]);
  });

  it("a receipt at new prices is batch 2; batch 1 keeps its prices", async () => {
    const day2 = await row("2026-08-02");
    expect(
      day2.batches.map((b) => [b.seq, b.startDate, b.costPrice, b.salePrice, b.quantity]),
    ).toEqual([
      [1, "2026-08-01", "10", "12", "100"],
      [2, "2026-08-02", "11", "14", "50"],
    ]);
    expect(day2.stock).toBe("150");
    expect(day2.stockValue).toBe("1550"); // 1000 + 550
  });
});

describe("D49: DSR sales, stock report and month close", () => {
  it("prices the day sales and cost per batch, with the allocation on the person row", async () => {
    const view = await getDayView(ctx, company, "2026-08-03");
    const p = must(view.products.find((x) => x.productId === alpha));
    expect([p.sales, p.cost, p.grossProfit, p.stock, p.stockValue]).toEqual([
      "1480",
      "1220",
      "260",
      "30",
      "330",
    ]);
    expect(p.batches.map((b) => [b.seq, b.quantity])).toEqual([[2, "30"]]);
    expect(view.persons[0]?.allocations).toEqual([
      { key: opening, seq: 1, quantity: "100", costPrice: "10", salePrice: "12" },
      { key: paid, seq: 2, quantity: "20", costPrice: "11", salePrice: "14" },
    ]);
  });

  it("the stock report has a batch table without zero batches", async () => {
    const report = await getReport(ctx, company, "stock", {
      from: "2026-08-01",
      to: "2026-08-31",
    });
    const batches = must(report.tables.find((t) => t.title === "report.table.stockBatches"));
    expect(batches.rows.map((r) => r.cells)).toEqual([
      {
        product: "Alpha 250ml",
        batchNo: "2",
        batchStart: "2026-08-02",
        batchCost: "11",
        batchSale: "14",
        closingStock: "30",
        batchValue: "330",
      },
    ]);
  });

  it("month close stores the batches; reopen recomputes the same; an old snapshot falls back", async () => {
    await closeMonth(ctx, company, "2026-08");
    const stored = must(
      await db.monthClose.findUnique({
        where: { companyId_month: { companyId: company, month: "2026-08" } },
      }),
    );
    const closing = stored.closing as unknown as {
      products: Record<string, { batches?: unknown[] }>;
    };
    expect(closing.products[alpha]?.batches).toEqual([
      {
        key: paid,
        seq: 2,
        startDate: "2026-08-02",
        costPrice: "11",
        salePrice: "14",
        quantity: "30",
      },
    ]);
    const carried = await row("2026-09-01");
    expect(carried.batches.map((b) => [b.seq, b.quantity])).toEqual([[2, "30"]]);

    // A snapshot stored before batches: one batch at the closing prices.
    const legacy = JSON.parse(JSON.stringify(stored.closing)) as typeof closing;
    delete legacy.products[alpha]?.batches;
    await db.monthClose.update({
      where: { companyId_month: { companyId: company, month: "2026-08" } },
      data: { closing: legacy as never },
    });
    const fallback = await row("2026-09-01");
    expect(
      fallback.batches.map((b) => [b.seq, b.startDate, b.costPrice, b.salePrice, b.quantity]),
    ).toEqual([[1, "opening", "11", "14", "30"]]);
    expect(fallback.stockValue).toBe("330");

    await reopenMonth(ctx, company, "2026-08");
    const again = await row("2026-09-01");
    expect(again.batches.map((b) => [b.seq, b.quantity])).toEqual([[2, "30"]]);
    expect((await getMonthView(ctx, company, "2026-08")).status).toBe("open");
  });
});

describe("D49: cost redaction", () => {
  it("hides batch costs and values without inventory.cost_view", async () => {
    const view = await getDayView(viewerCtx, company, "2026-08-03");
    expect(view.canSeeCost).toBe(false);
    const p = must(view.products.find((x) => x.productId === alpha));
    expect(p.batches).toEqual([
      {
        key: paid,
        seq: 2,
        startDate: "2026-08-02",
        costPrice: null,
        salePrice: "14",
        quantity: "30",
        value: null,
      },
    ]);
    expect(view.persons[0]?.allocations.every((a) => a.costPrice === null)).toBe(true);
    const report = await getReport(viewerCtx, company, "stock", {
      from: "2026-08-01",
      to: "2026-08-31",
    });
    const batches = must(report.tables.find((t) => t.title === "report.table.stockBatches"));
    expect(batches.columns.map((c) => c.key)).toEqual([
      "product",
      "batchNo",
      "batchStart",
      "batchSale",
      "closingStock",
    ]);
  });
});
