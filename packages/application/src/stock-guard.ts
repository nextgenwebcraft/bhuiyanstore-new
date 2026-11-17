import { toDecimal, todayBusinessDate } from "@bsd/domain";
import type { CompanyAccess } from "./access";
import type { Tx } from "./context";
import { AppError, type StockShortage } from "./errors";
import { rangeRun } from "./ledger";

export type DraftStockTake = {
  productId: string;
  batchKey: string;
  /** Pieces leaving the godown: issued − returned (ড্যামেজ stays out of saleable). */
  issued: string;
  returned: string;
};

/**
 * Net pieces a draft/post would take from each product and named batch (D34 / D136).
 * Negative nets (more return than issue) count as zero take.
 */
export function draftStockTakes(
  lines: readonly DraftStockTake[],
): { byProduct: Map<string, string>; byBatch: Map<string, { productId: string; net: string }> } {
  const byProduct = new Map<string, ReturnType<typeof toDecimal>>();
  const byBatch = new Map<string, { productId: string; net: ReturnType<typeof toDecimal> }>();
  for (const line of lines) {
    const net = toDecimal(line.issued).sub(toDecimal(line.returned));
    if (net.lte(0)) continue;
    byProduct.set(line.productId, (byProduct.get(line.productId) ?? toDecimal("0")).add(net));
    if (!line.batchKey) continue;
    const key = `${line.productId}|${line.batchKey}`;
    const prev = byBatch.get(key);
    byBatch.set(key, {
      productId: line.productId,
      net: (prev?.net ?? toDecimal("0")).add(net),
    });
  }
  return {
    byProduct: new Map([...byProduct].map(([id, n]) => [id, n.toFixed()])),
    byBatch: new Map(
      [...byBatch].map(([key, v]) => [key, { productId: v.productId, net: v.net.toFixed() }]),
    ),
  };
}

type LedgerDay = {
  date: string;
  products: readonly {
    productId: string;
    stock: string;
    batches: readonly { key: string; quantity: string; seq: number }[];
  }[];
};

/**
 * Shortages if `takes` were applied on `from` and carried through each ledger day (draft is not in
 * the engine yet, so we subtract from posted balances).
 */
export function draftStockShortages(
  days: readonly LedgerDay[],
  lines: readonly DraftStockTake[],
): StockShortage[] {
  const { byProduct, byBatch } = draftStockTakes(lines);
  if (byProduct.size === 0) return [];
  const worst = new Map<string, StockShortage>();
  for (const day of days) {
    for (const p of day.products) {
      const take = byProduct.get(p.productId);
      if (!take || worst.has(p.productId)) continue;
      // Named batch first (D34): overdraw on one batch even when another still has stock.
      let batchHit = false;
      for (const [key, batchTake] of byBatch) {
        if (batchTake.productId !== p.productId) continue;
        const batchKey = key.slice(p.productId.length + 1);
        const batch = p.batches.find((b) => b.key === batchKey);
        const qty = toDecimal(batch?.quantity ?? "0");
        if (qty.sub(toDecimal(batchTake.net)).lt(0)) {
          worst.set(p.productId, {
            productId: p.productId,
            productName: "",
            date: day.date,
            stock: qty.sub(toDecimal(batchTake.net)).toFixed(),
            ...(batch ? { batchSeq: batch.seq } : {}),
          });
          batchHit = true;
          break;
        }
      }
      if (batchHit) continue;
      if (toDecimal(p.stock).sub(toDecimal(take)).lt(0)) {
        worst.set(p.productId, {
          productId: p.productId,
          productName: "",
          date: day.date,
          stock: toDecimal(p.stock).sub(toDecimal(take)).toFixed(),
        });
      }
    }
  }
  return [...worst.values()];
}

/**
 * D34 (always on): a posting that takes pieces out of the godown is refused when any product it
 * touches would end a day below zero, or any of that product's batches would, from the posting
 * date to today. Runs inside the posting's transaction, after the write. Receipts are never
 * checked here.
 */
export async function ensureStockCovers(
  tx: Tx,
  access: CompanyAccess,
  from: string,
  productIds: Iterable<string>,
): Promise<void> {
  const ids = new Set(productIds);
  if (ids.size === 0) return;
  const run = await rangeRun(tx, access, from, todayBusinessDate());
  if (!run) return;
  /** The first day each product (or one of its batches) goes below zero. */
  const worst = new Map<string, StockShortage>();
  for (const day of run.output.days) {
    for (const p of day.products) {
      if (!ids.has(p.productId) || worst.has(p.productId)) continue;
      if (p.stock.startsWith("-")) {
        worst.set(p.productId, {
          productId: p.productId,
          productName: "",
          date: day.date,
          stock: p.stock,
        });
        continue;
      }
      const negBatch = p.batches.find((b) => b.quantity.startsWith("-"));
      if (negBatch) {
        worst.set(p.productId, {
          productId: p.productId,
          productName: "",
          date: day.date,
          stock: negBatch.quantity,
          batchSeq: negBatch.seq,
        });
      }
    }
  }
  if (worst.size === 0) return;
  await throwInsufficient(tx, [...worst.values()]);
}

/**
 * D136: draft দৈনিক বিক্রয় হিসাব save also refuses when the sheet's issued−returned would take a
 * product or named batch below zero from the sheet date through today (drafts are not in the
 * ledger, so we subtract the draft take from posted balances).
 */
export async function ensureDraftSalesCover(
  tx: Tx,
  access: CompanyAccess,
  from: string,
  lines: readonly DraftStockTake[],
): Promise<void> {
  const { byProduct } = draftStockTakes(lines);
  if (byProduct.size === 0) return;
  const run = await rangeRun(tx, access, from, todayBusinessDate());
  if (!run) return;
  const shortages = draftStockShortages(run.output.days, lines);
  if (shortages.length === 0) return;
  await throwInsufficient(tx, shortages);
}

async function throwInsufficient(tx: Tx, shortages: StockShortage[]): Promise<never> {
  const names = await tx.product.findMany({
    where: { id: { in: [...new Set(shortages.map((s) => s.productId))] } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  throw new AppError(
    "INSUFFICIENT_STOCK",
    undefined,
    false,
    shortages.map((s) => ({ ...s, productName: nameOf.get(s.productId) ?? "" })),
  );
}
