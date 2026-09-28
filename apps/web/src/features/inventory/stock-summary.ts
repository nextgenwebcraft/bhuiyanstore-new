import type { Batch } from "@bsd/contracts";
import { sumQuantities } from "@bsd/domain";

export type ProductStockSummary = {
  productId: string;
  /** Sum of availableQuantity only: reserved and quarantine are separate named buckets. */
  availableQuantity: string;
  batchCount: number;
};

/**
 * Client-side rollup of already-authorized batch reads (guide section 21.2 R04): a rebuildable
 * display value, not a second stock total. The server/mock adapter remains the single writer of
 * batch records.
 */
export function summarizeStockByProduct(batches: readonly Batch[]): ProductStockSummary[] {
  const byProduct = new Map<string, Batch[]>();
  for (const batch of batches) {
    const group = byProduct.get(batch.productId);
    if (group) group.push(batch);
    else byProduct.set(batch.productId, [batch]);
  }
  return [...byProduct.entries()].map(([productId, productBatches]) => ({
    productId,
    availableQuantity: sumQuantities(productBatches.map((b) => b.availableQuantity)),
    batchCount: productBatches.length,
  }));
}
