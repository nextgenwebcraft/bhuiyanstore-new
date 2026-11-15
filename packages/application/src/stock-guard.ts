import { todayBusinessDate } from "@bsd/domain";
import type { CompanyAccess } from "./access";
import type { Tx } from "./context";
import { AppError, type StockShortage } from "./errors";
import { rangeRun } from "./ledger";

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
  const names = await tx.product.findMany({
    where: { id: { in: [...worst.keys()] } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  throw new AppError(
    "INSUFFICIENT_STOCK",
    undefined,
    false,
    [...worst.values()].map((s) => ({ ...s, productName: nameOf.get(s.productId) ?? "" })),
  );
}
