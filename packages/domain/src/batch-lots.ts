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
