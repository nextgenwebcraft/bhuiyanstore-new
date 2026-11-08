import { Decimal, toDecimal, type DecimalInput } from "./decimal";

/**
 * D68: a batch is one order lot of a product at one purchase and one sale price per piece. These
 * helpers keep the order and receipt screens and the server on the same arithmetic.
 */

/** Per-piece price from a carton price (6 decimals, as stored). */
export function pieceFromCarton(cartonPrice: DecimalInput, piecesPerCarton: DecimalInput): string {
  return toDecimal(cartonPrice).div(toDecimal(piecesPerCarton)).toDecimalPlaces(6).toFixed();
}

/** Carton price from a per-piece price (2 decimals, taka). */
export function cartonFromPiece(piecePrice: DecimalInput, piecesPerCarton: DecimalInput): string {
  return toDecimal(piecePrice).mul(toDecimal(piecesPerCarton)).toDecimalPlaces(2).toFixed();
}

/** Two per-piece prices are the same batch price when equal to 6 decimals. */
export function samePiecePrice(a: DecimalInput, b: DecimalInput): boolean {
  return toDecimal(a).toDecimalPlaces(6).eq(toDecimal(b).toDecimalPlaces(6));
}

export type OrderBatchCostInput = {
  paid: DecimalInput;
  free?: DecimalInput;
  cartonRate: DecimalInput;
  piecesPerCarton: DecimalInput;
};

/**
 * Purchase price per piece for the order's batch (D68, amended 2026-11-08):
 * `bill ÷ (paid + free)` when there are free pieces (D57 effective cost), else
 * `cartonRate ÷ piecesPerCarton`. Free-only (paid 0) returns null so `orderBatch` joins the
 * latest batch at its purchase price. Free pieces still share the order's batch (no separate
 * free batch); a different free mix that changes this cost opens a new batch.
 */
export function orderBatchCostPrice(input: OrderBatchCostInput): string | null {
  const paid = toDecimal(input.paid);
  if (paid.lte(0)) return null;
  const free = toDecimal(input.free ?? "0");
  const bill = paid.mul(input.cartonRate).div(input.piecesPerCarton);
  if (free.gt(0)) {
    const total = paid.add(free);
    return bill.div(total).toDecimalPlaces(6).toFixed();
  }
  return pieceFromCarton(input.cartonRate, input.piecesPerCarton);
}

/**
 * Whether an order line joins the product's latest batch: same purchase cost (orderBatchCostPrice)
 * and sale price. Free-only lines join when the sale price matches (purchase taken from latest).
 */
export function orderJoinsLatestBatch(
  latest: { costPrice: string | null; salePrice: string } | undefined,
  line: OrderBatchCostInput & { salePrice: DecimalInput },
): boolean {
  if (latest === undefined || latest.costPrice === null) return false;
  const cost = orderBatchCostPrice(line);
  if (cost === null) return samePiecePrice(latest.salePrice, line.salePrice);
  return (
    samePiecePrice(latest.costPrice, cost) && samePiecePrice(latest.salePrice, line.salePrice)
  );
}

export type BatchMove = {
  batchId: string;
  /** Pieces ordered into the batch (paid or free), or due at the opening. */
  ordered?: DecimalInput;
  /** Pieces received from the company into the batch. */
  received?: DecimalInput;
};

/** Pieces of each batch still due from the company: ordered − received, per batch id. */
export function batchUndelivered(moves: readonly BatchMove[]): Map<string, string> {
  const due = new Map<string, Decimal>();
  for (const m of moves) {
    const current = due.get(m.batchId) ?? new Decimal(0);
    due.set(m.batchId, current.add(toDecimal(m.ordered ?? "0")).sub(toDecimal(m.received ?? "0")));
  }
  return new Map([...due].map(([id, q]) => [id, q.toString()]));
}

/**
 * D118: one batch's order/receipt moves with paid and free kept apart. A legacy receipt that only
 * stored a combined `pieces` (no freePieces) is `receivedCombined` and is allocated paid-first.
 */
export type BatchDueMove = {
  batchId: string;
  orderedPaid?: DecimalInput;
  orderedFree?: DecimalInput;
  receivedPaid?: DecimalInput;
  receivedFree?: DecimalInput;
  receivedCombined?: DecimalInput;
};

export type BatchDueParts = {
  undelivered: string;
  undeliveredPaid: string;
  undeliveredFree: string;
};

/** Paid and free pieces still due per batch (D118). */
export function batchDueParts(moves: readonly BatchDueMove[]): Map<string, BatchDueParts> {
  type Acc = {
    orderedPaid: Decimal;
    orderedFree: Decimal;
    receivedPaid: Decimal;
    receivedFree: Decimal;
    receivedCombined: Decimal;
  };
  const acc = new Map<string, Acc>();
  const of = (id: string): Acc => {
    const cur = acc.get(id);
    if (cur) return cur;
    const next: Acc = {
      orderedPaid: new Decimal(0),
      orderedFree: new Decimal(0),
      receivedPaid: new Decimal(0),
      receivedFree: new Decimal(0),
      receivedCombined: new Decimal(0),
    };
    acc.set(id, next);
    return next;
  };
  for (const m of moves) {
    const a = of(m.batchId);
    a.orderedPaid = a.orderedPaid.add(toDecimal(m.orderedPaid ?? "0"));
    a.orderedFree = a.orderedFree.add(toDecimal(m.orderedFree ?? "0"));
    a.receivedPaid = a.receivedPaid.add(toDecimal(m.receivedPaid ?? "0"));
    a.receivedFree = a.receivedFree.add(toDecimal(m.receivedFree ?? "0"));
    a.receivedCombined = a.receivedCombined.add(toDecimal(m.receivedCombined ?? "0"));
  }
  const out = new Map<string, BatchDueParts>();
  for (const [id, a] of acc) {
    let paidLeft = a.orderedPaid.sub(a.receivedPaid);
    let freeLeft = a.orderedFree.sub(a.receivedFree);
    let combined = a.receivedCombined;
    const takePaid = Decimal.min(combined, Decimal.max(paidLeft, new Decimal(0)));
    paidLeft = paidLeft.sub(takePaid);
    combined = combined.sub(takePaid);
    const takeFree = Decimal.min(combined, Decimal.max(freeLeft, new Decimal(0)));
    freeLeft = freeLeft.sub(takeFree);
    combined = combined.sub(takeFree);
    // Any leftover combined (over-receive) keeps total undelivered aligned with batchUndelivered.
    paidLeft = paidLeft.sub(combined);
    const undeliveredPaid = paidLeft.toString();
    const undeliveredFree = freeLeft.toString();
    out.set(id, {
      undeliveredPaid,
      undeliveredFree,
      undelivered: paidLeft.add(freeLeft).toString(),
    });
  }
  return out;
}
