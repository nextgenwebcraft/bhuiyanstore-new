import { bootstrapSuperAdmin, type Actor } from "@bsd/auth";
import { toDecimal } from "@bsd/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCompany } from "./companies";
import { staffRoles } from "./configuration";
import type { AppContext } from "./context";
import { getDayView, postDsrDay, postStockEntries, reverseStockEntry, saveDsrDay } from "./daily";
import { createProduct } from "./products";
import { createStaff } from "./staff";
import { contextFor, resetTestSchema, saveWholeOpening, testDatabase } from "./test-support";

process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-integration-test-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

/**
 * D57 carton rate and free goods on the order, batch cost from the order. Hand-worked numbers:
 * opening 24 pieces at cost 10 / sale 12 (batch 1). 2026-08-02 the owner example: 10 cartons of 24
 * ordered at 480 a carton plus 1 free carton: bill 240 x 480 / 24 = 4800 for 264 pieces. 2026-08-03
 * the 264 arrive at sale price 30: batch 2 costs 4800 / 264 = 18.1818... a piece. 2026-08-04 one
 * DSR sheet issues 34: 24 from batch 1 (cost 240, sales 288) + 10 from batch 2 (cost 181.8181...,
 * sales 300).
 */

const { db, schema } = testDatabase();
const theme = { primary: "#0F766E", primaryForeground: "#FFFFFF" };

let admin: Actor;
let ctx: AppContext;
let company = "";
let alpha = "";
let mamun = "";

function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected a value");
  return value;
}

async function row(date: string) {
  return must((await getDayView(ctx, company, date)).products.find((p) => p.productId === alpha));
}
async function balance(date: string) {
  return toDecimal(must((await getDayView(ctx, company, date)).company).balance);
}
const close = (value: string | null, expected: number) =>
  expect(Number(value)).toBeCloseTo(expected, 8);

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
    await createCompany(ctx, { name: "Drinko L", theme, modules: ["sales"], starterData: false })
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
        pieces: "24",
        unitCost: "10",
        salePrice: "12",
        orderPrice: "10",
        dueFromCompany: "0",
        note: "",
      },
    ],
    balances: [],
  });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("D57: order with carton rate and free goods", () => {
  it("rejects an order without a carton rate or pieces, and a rate on a receipt", async () => {
    const attempt = (line: Record<string, string>) =>
      postStockEntries(ctx, company, {
        date: "2026-08-02",
        lines: [{ kind: "order", productId: alpha, pieces: "24", ...line } as never],
        prices: [],
      });
    await expect(attempt({})).rejects.toThrow();
    await expect(attempt({ pieces: "0", cartonRate: "480" })).rejects.toThrow();
    await expect(
      postStockEntries(ctx, company, {
        date: "2026-08-02",
        lines: [{ kind: "receipt", productId: alpha, pieces: "24", cartonRate: "480" } as never],
        prices: [],
      }),
    ).rejects.toThrow();
  });

  it("the owner example bills 4800, owes 264 pieces and sets the order price to 20 a piece", async () => {
    const before = await balance("2026-08-02");
    const posted = await postStockEntries(ctx, company, {
      date: "2026-08-02",
      lines: [
        { kind: "order", productId: alpha, pieces: "240", freePieces: "24", cartonRate: "480" },
      ],
      prices: [],
    });
    const entry = must(posted[0]);
    expect([entry.pieces, entry.freePieces, entry.cartonRate, entry.piecesPerCarton]).toEqual([
      "240",
      "24",
      "480",
      24,
    ]);
    const day = await row("2026-08-02");
    expect([day.ordered, day.orderValue, day.dueFromCompany, day.dueFromCompanyValue]).toEqual([
      "240",
      "4800",
      "264",
      "4800",
    ]);
    // 480 a carton of 24 = 20 a piece becomes the current order price (for excess receipts).
    expect(day.orderPrice).toBe("20");
    expect((await balance("2026-08-02")).toString()).toBe(before.sub(4800).toString());
  });

  it("the receipt batch costs the order bill per piece, free pieces included", async () => {
    await postStockEntries(ctx, company, {
      date: "2026-08-03",
      lines: [{ kind: "receipt", productId: alpha, pieces: "264" }],
      prices: [{ productId: alpha, kind: "sale", price: "30" }],
    });
    const day = await row("2026-08-03");
    expect([day.receiptValue, day.receiptBill, day.dueFromCompany]).toEqual(["4800", "0", "0"]);
    expect(day.batches.map((b) => [b.seq, b.startDate, b.salePrice, b.quantity])).toEqual([
      [1, "2026-08-01", "12", "24"],
      [2, "2026-08-03", "30", "264"],
    ]);
    close(must(day.batches[1]).costPrice, 4800 / 264);
    close(day.stockValue, 240 + 4800);
  });

  it("a DSR sale uses the batch cost", async () => {
    const draft = await saveDsrDay(ctx, company, {
      date: "2026-08-04",
      staffId: mamun,
      version: 0,
      marketDueNew: "0",
      marketDueCollected: "0",
      lines: [{ productId: alpha, issued: "34", returned: "0", damaged: "0" }],
    });
    await postDsrDay(ctx, company, draft.id, { version: draft.version });
    const day = await row("2026-08-04");
    expect(day.sales).toBe("588"); // 24 x 12 + 10 x 30
    close(day.cost, 240 + (10 * 4800) / 264);
    close(day.stockValue, (254 * 4800) / 264);
  });

  it("reversing an order removes its bill and its free pieces from what is due", async () => {
    const before = await balance("2026-08-05");
    const [entry] = await postStockEntries(ctx, company, {
      date: "2026-08-05",
      lines: [
        { kind: "order", productId: alpha, pieces: "24", freePieces: "24", cartonRate: "480" },
      ],
      prices: [],
    });
    const open = await row("2026-08-05");
    expect([open.dueFromCompany, open.dueFromCompanyValue]).toEqual(["48", "480"]);
    expect((await balance("2026-08-05")).toString()).toBe(before.sub(480).toString());

    await reverseStockEntry(ctx, company, must(entry).id);
    const reversed = await row("2026-08-05");
    expect([reversed.dueFromCompany, reversed.dueFromCompanyValue]).toEqual(["0", "0"]);
    expect((await balance("2026-08-05")).toString()).toBe(before.toString());
  });
});
