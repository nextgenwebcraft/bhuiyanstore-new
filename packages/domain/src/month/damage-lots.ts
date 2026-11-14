import { Decimal, toDecimal, type DecimalInput } from "../decimal";

const ZERO = new Decimal(0);

/**
 * One damage lot is a product at one per-piece rate (D109). 25, 25.0 and 25.000000 are the same lot.
 */
export function damageRateKey(rate: DecimalInput): string {
  return toDecimal(rate).toDecimalPlaces(6).toFixed(6);
}

export type DamageLot = { rate: string; pieces: string };

export function addDamageLot(
  lots: Map<string, Decimal>,
  rate: DecimalInput,
  pieces: Decimal,
): void {
  if (pieces.isZero()) return;
  const key = damageRateKey(rate);
  lots.set(key, (lots.get(key) ?? ZERO).add(pieces));
}

export function damageLotsFrom(
  rows: readonly { rate: DecimalInput; pieces: DecimalInput }[] | undefined,
): Map<string, Decimal> {
  const lots = new Map<string, Decimal>();
  for (const row of rows ?? []) addDamageLot(lots, row.rate, toDecimal(row.pieces));
  return lots;
}

/** `heldOnly` hides a rate that has already been deposited (pieces ≤ 0). The closing keeps the hole. */
export function damageLotsResult(lots: Map<string, Decimal>, heldOnly: boolean): DamageLot[] {
  return [...lots]
    .filter(([, pieces]) => (heldOnly ? pieces.gt(0) : !pieces.isZero()))
    .sort((a, b) => toDecimal(a[0]).comparedTo(toDecimal(b[0])))
    .map(([rate, pieces]) => ({ rate, pieces: pieces.toString() }));
}
