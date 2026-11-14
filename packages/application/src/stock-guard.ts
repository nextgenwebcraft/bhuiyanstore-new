import { todayBusinessDate } from "@bsd/domain";
import type { CompanyAccess } from "./access";
import type { Tx } from "./context";
import { AppError, type StockShortage } from "./errors";
import { rangeRun } from "./ledger";

/**
 * With the company's negative-stock block on (D34), a posting that takes pieces out of the
 * godown is refused when any product it touches would end a day below zero, from the posting
 * date to today. Runs inside the posting's transaction, after the write.
 */
export async function ensureStockCovers(
  tx: Tx,
  access: CompanyAccess,
  from: string,
  productIds: Iterable<string>,
): Promise<void> {
  const ids = new Set(productIds);
  if (!access.company.blockNegativeStock || ids.size === 0) return;
  const run = await rangeRun(tx, access, from, todayBusinessDate());
  if (!run) return;
  /** The first day each product goes below zero. */
  const worst = new Map<string, StockShortage>();
  for (const day of run.output.days) {
    for (const p of day.products) {
      if (!ids.has(p.productId) || !p.stock.startsWith("-") || worst.has(p.productId)) continue;
      worst.set(p.productId, {
        productId: p.productId,
        productName: "",
        date: day.date,
        stock: p.stock,
      });
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
