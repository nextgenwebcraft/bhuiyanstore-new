import { Decimal } from "../decimal";

/**
 * Batch layers of one product (D49, D68). Pure helpers over a mutable list kept oldest-first by
 * the month engine; the engine is the only caller. Nothing here rounds.
 *
 * D68: a batch chosen by the user (an order lot) has the stored batch id as its `key`; receipts
 * and DSR lines name it. Company free goods and replacements join the newest named batch. Pieces
 * that arrive or leave without a batch (godown damage, history, free goods before any named
 * batch) use the automatic FIFO layers, keyed `auto:<seq>`.
 */

const ZERO = new Decimal(0);

export type BatchLayer = {
  key: string;
  seq: number;
  startDate: string;
  costPrice: Decimal;
  salePrice: Decimal;
  /** Negative only while stock is short (deficit). */
  quantity: Decimal;
};

/** Pieces of one DSR line taken from one batch. */
export type LayerAllocation = {
  key: string;
  seq: number;
  quantity: Decimal;
  costPrice: Decimal;
  salePrice: Decimal;
};

export type PriceFallback = { costPrice: Decimal; salePrice: Decimal };

export const autoKey = (seq: number): string => `auto:${seq}`;

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
  batches.reduce((max, b) => Math.max(max, b.seq), 0) + 1;

function newLayer(
  batches: readonly BatchLayer[],
  date: string,
  prices: PriceFallback,
  quantity: Decimal,
): BatchLayer {
  const seq = nextSeq(batches);
  return { key: autoKey(seq), seq, startDate: date, ...prices, quantity };
}

/**
 * Pieces arrive without a batch. A deficit on the newest batch is filled first; the rest merges
 * into the newest batch when its cost AND sale price are equal, otherwise it starts a new
 * automatic batch.
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
      batches.push(newLayer(batches, date, { costPrice, salePrice }, rest));
    }
  }
  prune(batches);
}

/**
 * D68: company free goods and replacements join the newest named batch at its prices. Before any
 * named batch they arrive like other unbatched pieces, at zero cost.
 */
export function receiveFree(
  batches: BatchLayer[],
  quantity: Decimal,
  salePrice: Decimal,
  date: string,
): void {
  if (quantity.lte(0)) return;
  const named = batches.findLast((b) => !b.key.startsWith("auto:"));
  if (!named) {
    receiveInto(batches, quantity, ZERO, salePrice, date);
    return;
  }
  named.quantity = named.quantity.add(quantity);
  prune(batches);
}

/** The layer of a named batch, opened at 0 pieces (after the others) when it holds none yet. */
function layerOf(
  batches: BatchLayer[],
  batch: { key: string; seq: number },
  prices: PriceFallback,
  date: string,
): BatchLayer {
  let layer = batches.find((b) => b.key === batch.key);
  if (!layer) {
    layer = { key: batch.key, seq: batch.seq, startDate: date, ...prices, quantity: ZERO };
    batches.push(layer);
  }
  return layer;
}

/**
 * D68: pieces received into a named batch at the receipt's prices. The prices become the batch's
 * from now on, so its remaining pieces are valued at them; pieces already sold keep theirs.
 */
export function receiveIntoBatch(
  batches: BatchLayer[],
  batch: { key: string; seq: number },
  quantity: Decimal,
  prices: PriceFallback,
  date: string,
): void {
  const layer = layerOf(batches, batch, prices, date);
  layer.quantity = layer.quantity.add(quantity);
  layer.costPrice = prices.costPrice;
  layer.salePrice = prices.salePrice;
  prune(batches);
}

/**
 * D68: a DSR line's net pieces (issued − returned) leave its named batch at the line's prices; a
 * negative net brings them back. The line's prices become the batch's from now on.
 */
export function takeFromBatch(
  batches: BatchLayer[],
  batch: { key: string; seq: number },
  net: Decimal,
  prices: PriceFallback,
  date: string,
): LayerAllocation[] {
  const layer = layerOf(batches, batch, prices, date);
  layer.quantity = layer.quantity.sub(net);
  layer.costPrice = prices.costPrice;
  layer.salePrice = prices.salePrice;
  prune(batches);
  if (net.isZero()) return [];
  return [{ key: batch.key, seq: batch.seq, quantity: net, ...prices }];
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
    if (last && last.key === b.key) last.quantity = last.quantity.add(q);
    else
      out.push({
        key: b.key,
        seq: b.seq,
        quantity: q,
        costPrice: b.costPrice,
        salePrice: b.salePrice,
      });
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
      newest = newLayer(batches, date, fallback, ZERO);
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
    oldest = newLayer(batches, date, fallback, ZERO);
    batches.push(oldest);
  }
  oldest.quantity = oldest.quantity.add(quantity);
  const entry = {
    key: oldest.key,
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
  // D68: a named batch keeps the prices its receipts and lines gave it.
  if (!newest.key.startsWith("auto:")) return;
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
