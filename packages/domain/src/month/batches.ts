import { Decimal } from "../decimal";

/**
 * FIFO batch layers of one product (D49). Pure helpers over a mutable list kept oldest-first by
 * the month engine; the engine is the only caller. Nothing here rounds.
 */

const ZERO = new Decimal(0);

export type BatchLayer = {
  seq: number;
  startDate: string;
  costPrice: Decimal;
  salePrice: Decimal;
  /** Negative only for the newest batch while stock is short (deficit). */
  quantity: Decimal;
};

/** Pieces of one DSR line taken from one batch. */
export type LayerAllocation = {
  seq: number;
  quantity: Decimal;
  costPrice: Decimal;
  salePrice: Decimal;
};

export type PriceFallback = { costPrice: Decimal; salePrice: Decimal };

export const totalQuantity = (batches: readonly BatchLayer[]): Decimal =>
  batches.reduce((sum, b) => sum.add(b.quantity), ZERO);

export const totalValue = (batches: readonly BatchLayer[]): Decimal =>
  batches.reduce((sum, b) => sum.add(b.quantity.mul(b.costPrice)), ZERO);

export const totalAtSale = (batches: readonly BatchLayer[]): Decimal =>
  batches.reduce((sum, b) => sum.add(b.quantity.mul(b.salePrice)), ZERO);

/** Empty older batches go; the newest stays (even at 0) so a same-price receipt merges into it. */
function prune(batches: BatchLayer[]): void {
  for (let i = batches.length - 2; i >= 0; i--) {
    if ((batches[i] as BatchLayer).quantity.isZero()) batches.splice(i, 1);
  }
}

const nextSeq = (batches: readonly BatchLayer[]): number =>
  batches.length === 0 ? 1 : (batches[batches.length - 1] as BatchLayer).seq + 1;

/**
 * Pieces arrive. A deficit on the newest batch is filled first; the rest merges into the newest
 * batch when its cost AND sale price are equal, otherwise it starts a new batch (seq + 1).
 */
export function receiveInto(
  batches: BatchLayer[],
  quantity: Decimal,
  costPrice: Decimal,
  salePrice: Decimal,
  date: string,
): void {
  if (quantity.lte(0)) return;
  let rest = quantity;
  const newest = batches[batches.length - 1];
  if (newest && newest.quantity.isNegative()) {
    const fill = Decimal.min(rest, newest.quantity.neg());
    newest.quantity = newest.quantity.add(fill);
    rest = rest.sub(fill);
  }
  if (rest.gt(0)) {
    const last = batches[batches.length - 1];
    if (last && last.costPrice.eq(costPrice) && last.salePrice.eq(salePrice)) {
      last.quantity = last.quantity.add(rest);
    } else {
      batches.push({
        seq: nextSeq(batches),
        startDate: date,
        costPrice,
        salePrice,
        quantity: rest,
      });
    }
  }
  prune(batches);
}

/**
 * Pieces leave oldest batch first. When every batch is used up the rest makes the newest batch
 * negative (a deficit valued at its prices); with no batch at all one is opened at the fallback
 * prices. Returns the allocation in FIFO order, one entry per batch.
 */
export function consumeFifo(
  batches: BatchLayer[],
  quantity: Decimal,
  fallback: PriceFallback,
  date: string,
): LayerAllocation[] {
  const out: LayerAllocation[] = [];
  if (quantity.lte(0)) return out;
  const push = (b: BatchLayer, q: Decimal): void => {
    const last = out[out.length - 1];
    if (last && last.seq === b.seq) last.quantity = last.quantity.add(q);
    else out.push({ seq: b.seq, quantity: q, costPrice: b.costPrice, salePrice: b.salePrice });
  };
  let rest = quantity;
  for (const b of batches) {
    if (rest.lte(0)) break;
    if (b.quantity.lte(0)) continue;
    const take = Decimal.min(b.quantity, rest);
    b.quantity = b.quantity.sub(take);
    rest = rest.sub(take);
    push(b, take);
  }
  if (rest.gt(0)) {
    let newest = batches[batches.length - 1];
    if (!newest) {
      newest = { seq: 1, startDate: date, ...fallback, quantity: ZERO };
      batches.push(newest);
    }
    newest.quantity = newest.quantity.sub(rest);
    push(newest, rest);
  }
  prune(batches);
  return out;
}

/**
 * A DSR line with net < 0 brings pieces back: they return to the oldest existing batch (or a new
 * batch at the fallback prices when there is none). The allocation is one negative entry.
 */
export function returnToOldest(
  batches: BatchLayer[],
  quantity: Decimal,
  fallback: PriceFallback,
  date: string,
): LayerAllocation[] {
  if (quantity.lte(0)) return [];
  let oldest = batches[0];
  if (!oldest) {
    oldest = { seq: 1, startDate: date, ...fallback, quantity: ZERO };
    batches.push(oldest);
  }
  oldest.quantity = oldest.quantity.add(quantity);
  const entry = {
    seq: oldest.seq,
    quantity: quantity.neg(),
    costPrice: oldest.costPrice,
    salePrice: oldest.salePrice,
  };
  prune(batches);
  return [entry];
}

/** Re-prices the newest batch only (a price change on a day without a receipt). */
export function repriceNewest(
  batches: BatchLayer[],
  prices: { costPrice?: Decimal | undefined; salePrice?: Decimal | undefined },
): void {
  const newest = batches[batches.length - 1];
  if (!newest) return;
  // A zero-cost batch (free goods, company replacement) stays free; only its sale price moves.
  if (prices.costPrice !== undefined && !newest.costPrice.isZero()) {
    newest.costPrice = prices.costPrice;
  }
  if (prices.salePrice !== undefined) newest.salePrice = prices.salePrice;
}

/** The first `quantity` pieces of an allocation as (quantity, sale price) chunks. */
export function firstPieces(
  allocation: readonly LayerAllocation[],
  quantity: Decimal,
): { quantity: Decimal; salePrice: Decimal }[] {
  const out: { quantity: Decimal; salePrice: Decimal }[] = [];
  let rest = quantity;
  for (const a of allocation) {
    if (rest.lte(0)) break;
    if (a.quantity.lte(0)) continue;
    const take = Decimal.min(a.quantity, rest);
    out.push({ quantity: take, salePrice: a.salePrice });
    rest = rest.sub(take);
  }
  return out;
}

/** Σ quantity × sale price of the allocation. */
export const layerAtSale = (allocation: readonly LayerAllocation[]): Decimal =>
  allocation.reduce((sum, a) => sum.add(a.quantity.mul(a.salePrice)), ZERO);

/** Σ quantity × cost price of the allocation. */
export const layerCost = (allocation: readonly LayerAllocation[]): Decimal =>
  allocation.reduce((sum, a) => sum.add(a.quantity.mul(a.costPrice)), ZERO);

/** Cost of the last `quantity` allocated pieces: the exchanged (damaged) ones, sold are first. */
export function lastPiecesCost(
  allocation: readonly LayerAllocation[],
  quantity: Decimal,
  fallbackCost: Decimal,
): Decimal {
  let rest = quantity;
  let cost = ZERO;
  for (let i = allocation.length - 1; i >= 0 && rest.gt(0); i--) {
    const a = allocation[i] as LayerAllocation;
    if (a.quantity.lte(0)) continue;
    const take = Decimal.min(a.quantity, rest);
    cost = cost.add(take.mul(a.costPrice));
    rest = rest.sub(take);
  }
  if (rest.gt(0)) cost = cost.add(rest.mul(allocation[0]?.costPrice ?? fallbackCost));
  return cost;
}
