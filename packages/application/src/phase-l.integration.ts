import { bootstrapSuperAdmin, type Actor } from "@bsd/auth";
import { toDecimal } from "@bsd/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCompany } from "./companies";
import { staffRoles } from "./configuration";
import type { AppContext } from "./context";
import { getDayView, postDsrDay, postStockEntries, reverseStockEntry, saveDsrDay } from "./daily";
import { AppError } from "./errors";
import { createProduct } from "./products";
import { createStaff } from "./staff";
import { contextFor, resetTestSchema, saveWholeOpening, testDatabase } from "./test-support";

process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-integration-test-secret";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

/**
 * D57 carton rate on the order, D68 batches. Hand-worked numbers: opening 24 pieces at cost 10 /
 * sale 12 (batch 1, the opening). 2026-08-02 the owner example: 10 cartons of 24 ordered at 480 a
 * carton to sell at 30, plus 1 free carton: bill 240 × 480 / 24 = 4800; batch 2 purchase =
 * 4800 / 264 ≈ 18.181818 (effective cost with free), sale 30. 2026-08-03 they arrive. 2026-08-04
 * one DSR sheet takes 24 from batch 1 (cost 240, sales 288) and 14 from batch 2 at an edited sale
 * price of 25 (cost 14 × 18.181818, sales 350).
 */

const { db, schema } = testDatabase();
const theme = { primary: "#0F766E", primaryForeground: "#FFFFFF" };

let admin: Actor;
let ctx: AppContext;
let company = "";
let alpha = "";
let mamun = "";
const batch = { opening: "", paid: "" };

function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) throw new Error("expected a value");
  return value;
}

async function expectField(promise: Promise<unknown>, path: string, code: string) {
  await expect(promise).rejects.toSatisfy(
    (e) =>
      e instanceof AppError &&
      e.code === "VALIDATION_FAILED" &&
      e.fieldErrors?.[0]?.path === path &&
      e.fieldErrors?.[0]?.code === code,
  );
}

async function row(date: string) {
  return must((await getDayView(ctx, company, date)).products.find((p) => p.productId === alpha));
}
async function balance(date: string) {
  return toDecimal(must((await getDayView(ctx, company, date)).company).balance);
}
const prices = async (id: string) => {
  const b = await db.productBatch.findUniqueOrThrow({ where: { id } });
  return [b.costPrice.toString(), b.salePrice.toString()];
};

beforeAll(async () => {
  await resetTestSchema(db, schema);
  const boot = await bootstrapSuperAdmin(db, {
    tenantName: "Test Distributor",
    adminEmail: "admin@example.test",
    adminName: "Admin",
    adminPassword: "one-time-Password-123",
  });
  admin = {
    userId: boot.adminId,
    tenantId: boot.tenantId,
    isSuperAdmin: true,
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
      companyId: company,
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

describe("D68: product batches from orders", () => {
  it("the opening stock is the product's first batch", async () => {
    const opening = await db.productBatch.findMany({ where: { productId: alpha } });
    expect(opening.map((b) => [b.seq, b.source])).toEqual([[1, "opening"]]);
    batch.opening = must(opening[0]).id;
    expect(await prices(batch.opening)).toEqual(["10", "12"]);
  });

  it("rejects an order without a rate or sale price, and a receipt without a batch", async () => {
    const attempt = (line: Record<string, string>) =>
      postStockEntries(ctx, company, {
        date: "2026-08-02",
        lines: [{ kind: "order", productId: alpha, pieces: "24", ...line } as never],
        prices: [],
      });
    await expect(attempt({ salePrice: "30" })).rejects.toThrow();
    await expect(attempt({ cartonRate: "480" })).rejects.toThrow();
    await expect(attempt({ pieces: "0", cartonRate: "480", salePrice: "30" })).rejects.toThrow();
    await expect(
      postStockEntries(ctx, company, {
        date: "2026-08-02",
        lines: [{ kind: "receipt", productId: alpha, pieces: "24" } as never],
        prices: [],
      }),
    ).rejects.toThrow();
  });

  it("the owner example bills 4800 and puts its free pieces in the same batch", async () => {
    const before = await balance("2026-08-02");
    const entry = must(
      (
        await postStockEntries(ctx, company, {
          date: "2026-08-02",
          lines: [
            {
              kind: "order",
              productId: alpha,
              pieces: "240",
              freePieces: "24",
              cartonRate: "480",
              salePrice: "30",
            },
          ],
          prices: [],
        })
      )[0],
    );
    // Effective cost 4800 / 264 ≈ 18.181818; free pieces share that batch (no separate free batch).
    expect([entry.batchSeq, entry.costPrice, entry.salePrice]).toEqual([2, "18.181818", "30"]);
    batch.paid = must(entry.batchId);
    expect(await prices(batch.paid)).toEqual(["18.181818", "30"]);
    const day = await row("2026-08-02");
    expect([day.ordered, day.orderValue, day.dueFromCompany]).toEqual(["240", "4800", "264"]);
    expect(day.lots.map((l) => [l.seq, l.undelivered])).toEqual([
      [1, "0"],
      [2, "264"],
    ]);
    expect((await balance("2026-08-02")).toString()).toBe(before.sub(4800).toString());
  });

  it("receives a batch at its prices, free pieces too, never more than is due", async () => {
    await expectField(
      postStockEntries(ctx, company, {
        date: "2026-08-03",
        lines: [{ kind: "receipt", productId: alpha, pieces: "265", batchId: batch.paid }],
        prices: [],
      }),
      "lines.0.pieces",
      "validation.daily.batchOverDue",
    );
    await postStockEntries(ctx, company, {
      date: "2026-08-03",
      lines: [{ kind: "receipt", productId: alpha, pieces: "264", batchId: batch.paid }],
      prices: [],
    });
    const day = await row("2026-08-03");
    expect([day.received, day.receiptValue, day.receiptBill, day.dueFromCompany]).toEqual([
      "264",
      "4800",
      "0",
      "0",
    ]);
    expect(day.batches.map((b) => [b.seq, b.costPrice, b.salePrice, b.quantity])).toEqual([
      [1, "10", "12", "24"],
      [2, "18.181818", "30", "264"],
    ]);
    // Opening 24 × 10 + 264 × 18.181818 (6dp; 4800/264 truncated → 4799.999952).
    expect(day.stockValue).toBe("5039.999952");
  });

  it("a DSR sheet takes each line from its batch; an edited price stays on the batch", async () => {
    const draft = await saveDsrDay(ctx, company, {
      date: "2026-08-04",
      staffId: mamun,
      version: 0,
      marketDueNew: "0",
      marketDueCollected: "0",
      lines: [
        {
          productId: alpha,
          dsrStaffId: mamun,
          batchKey: batch.opening,
          issued: "24",
          returned: "0",
          damaged: "0",
        },
        {
          productId: alpha,
          dsrStaffId: mamun,
          batchKey: batch.paid,
          issued: "14",
          returned: "0",
          damaged: "0",
          salePrice: "25",
        },
      ],
    });
    expect(draft.lines.map((l) => [l.batchSeq, l.salePrice])).toEqual([
      [1, "12"],
      [2, "25"],
    ]);
    expect(await prices(batch.paid)).toEqual(["18.181818", "25"]);
    await postDsrDay(ctx, company, draft.id, { version: draft.version });
    const day = await row("2026-08-04");
    // Sales 24 × 12 + 14 × 25; cost 24 × 10 + 14 × 18.181818.
    expect([day.issued, day.sales, day.cost]).toEqual(["38", "638", "494.545452"]);
    // The emptied opening batch drops out of the stock (D49).
    expect(day.batches.map((b) => [b.seq, b.salePrice, b.quantity])).toEqual([[2, "25", "250"]]);
    expect(day.stockValue).toBe("4545.4545");
  });

  it("the same prices reuse the latest batch, changed prices or free mix start a new one", async () => {
    // Latest batch is still 18.181818 / 25; a paid-only order at carton 480 costs 20 → new batch.
    const paidOnly = must(
      (
        await postStockEntries(ctx, company, {
          date: "2026-08-05",
          lines: [{ kind: "order", productId: alpha, pieces: "24", cartonRate: "480", salePrice: "25" }],
          prices: [],
        })
      ).at(-1),
    );
    expect(paidOnly.batchSeq).toBe(3);
    expect(await prices(must(paidOnly.batchId))).toEqual(["20", "25"]);
    // Same paid-only prices reuse batch 3.
    const same = must(
      (
        await postStockEntries(ctx, company, {
          date: "2026-08-05",
          lines: [{ kind: "order", productId: alpha, pieces: "24", cartonRate: "480", salePrice: "25" }],
          prices: [],
        })
      ).at(-1),
    );
    expect([same.batchId, same.batchSeq]).toEqual([paidOnly.batchId, 3]);
    const changed = must(
      (
        await postStockEntries(ctx, company, {
          date: "2026-08-05",
          lines: [{ kind: "order", productId: alpha, pieces: "24", cartonRate: "480", salePrice: "32" }],
          prices: [],
        })
      ).at(-1),
    );
    expect(changed.batchSeq).toBe(4);
    expect(await prices(must(changed.batchId))).toEqual(["20", "32"]);
    // Free goods on the same carton/sale open another batch (effective cost differs).
    const withFree = must(
      (
        await postStockEntries(ctx, company, {
          date: "2026-08-05",
          lines: [
            {
              kind: "order",
              productId: alpha,
              pieces: "24",
              freePieces: "12",
              cartonRate: "480",
              salePrice: "32",
            },
          ],
          prices: [],
        })
      ).at(-1),
    );
    expect(withFree.batchSeq).toBe(5);
    expect(withFree.costPrice).toBe("13.333333");
    // A free-only order without a rate joins the latest batch at its purchase price.
    const freeOnly = must(
      (
        await postStockEntries(ctx, company, {
          date: "2026-08-05",
          lines: [
            { kind: "order", productId: alpha, pieces: "0", freePieces: "12", salePrice: "32" },
          ],
          prices: [],
        })
      ).at(-1),
    );
    expect([freeOnly.batchId, freeOnly.costPrice]).toEqual([withFree.batchId, "13.333333"]);
    const lot = must((await row("2026-08-05")).lots.find((l) => l.id === withFree.batchId));
    // withFree due 36 + free-only 12 = 48.
    expect(lot.undelivered).toBe("48");
  });

  it("an order is reversible until goods arrive in its batch", async () => {
    const before = await balance("2026-08-06");
    const [entry] = await postStockEntries(ctx, company, {
      date: "2026-08-06",
      lines: [
        {
          kind: "order",
          productId: alpha,
          pieces: "24",
          freePieces: "24",
          cartonRate: "600",
          salePrice: "40",
        },
      ],
      prices: [],
    });
    const open = must(entry);
    expect((await balance("2026-08-06")).toString()).toBe(before.sub(600).toString());
    await reverseStockEntry(ctx, company, open.id);
    expect((await balance("2026-08-06")).toString()).toBe(before.toString());

    // Same paid + free + rates as the reversed order → its batch is reused.
    const again = await postStockEntries(ctx, company, {
      date: "2026-08-06",
      lines: [
        {
          kind: "order",
          productId: alpha,
          pieces: "24",
          freePieces: "24",
          cartonRate: "600",
          salePrice: "40",
        },
      ],
      prices: [],
    });
    const received = must(again.at(-1));
    expect(received.batchId).toBe(open.batchId);
    await postStockEntries(ctx, company, {
      date: "2026-08-06",
      lines: [
        {
          kind: "receipt",
          productId: alpha,
          pieces: "48",
          batchId: must(received.batchId),
        },
      ],
      prices: [],
    });
    await expectField(
      reverseStockEntry(ctx, company, received.id),
      "",
      "validation.daily.batchReceived",
    );
  });

  it("receives paid and free pieces separately against the batch due (D118)", async () => {
    const ordered = must(
      (
        await postStockEntries(ctx, company, {
          date: "2026-08-07",
          lines: [
            {
              kind: "order",
              productId: alpha,
              pieces: "48",
              freePieces: "24",
              cartonRate: "480",
              salePrice: "30",
            },
          ],
          prices: [],
        })
      )[0],
    );
    const lotId = must(ordered.batchId);
    const before = must((await row("2026-08-07")).lots.find((l) => l.id === lotId));
    expect([before.undeliveredPaid, before.undeliveredFree]).toEqual(["48", "24"]);

    await postStockEntries(ctx, company, {
      date: "2026-08-07",
      lines: [{ kind: "receipt", productId: alpha, pieces: "48", batchId: lotId }],
      prices: [],
    });
    const mid = must((await row("2026-08-07")).lots.find((l) => l.id === lotId));
    expect([mid.undeliveredPaid, mid.undeliveredFree]).toEqual(["0", "24"]);

    await postStockEntries(ctx, company, {
      date: "2026-08-07",
      lines: [
        { kind: "receipt", productId: alpha, pieces: "0", freePieces: "24", batchId: lotId },
      ],
      prices: [],
    });
    const after = (await row("2026-08-07")).lots.find((l) => l.id === lotId);
    expect(after ? after.undelivered : "0").toBe("0");
  });
});
