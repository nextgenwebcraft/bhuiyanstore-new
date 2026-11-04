import { Decimal, toDecimal, type DecimalInput } from "./decimal";
import { roundSettlement } from "./money";
import { toCartonDisplay } from "./quantity";

/** Fields needed to show carton count and money value of one stock entry (History / godown). */
export type StockEntryDisplayInput = {
  kind: string;
  pieces: DecimalInput;
  cartonRate: DecimalInput | null;
  piecesPerCarton: DecimalInput | null;
  costPrice: DecimalInput | null;
  unitPrice: DecimalInput | null;
};

/**
 * Money value of a stock line for History display (D57 order bill; receipt at cost;
 * damage deposit at unit price; incentive/damage = 0).
 */
export function stockEntryAmount(entry: StockEntryDisplayInput): string {
  if (entry.kind === "order") {
    if (entry.cartonRate === null || entry.piecesPerCarton === null) return "0";
    const ppc = toDecimal(entry.piecesPerCarton);
    if (ppc.lte(0)) return "0";
    return roundSettlement(toDecimal(entry.pieces).mul(entry.cartonRate).div(ppc));
  }
  if (entry.kind === "receipt") {
    if (entry.costPrice === null) return "0";
    return roundSettlement(toDecimal(entry.pieces).mul(entry.costPrice));
  }
  if (entry.kind === "damageDeposit") {
    if (entry.unitPrice === null) return "0";
    return roundSettlement(toDecimal(entry.pieces).mul(entry.unitPrice));
  }
  return "0";
}

/**
 * Split a stored base quantity into whole cartons and loose pieces (খুচরা).
 * Cartons and pieces stay separate — cartons are not converted into the piece total.
 * Unknown carton size → 0 cartons, all quantity as loose pieces.
 */
export function stockEntryCartonParts(
  pieces: DecimalInput,
  piecesPerCarton: DecimalInput | null,
): { cartons: string; loosePieces: string } {
  if (piecesPerCarton === null) {
    return { cartons: "0", loosePieces: toDecimal(pieces).toString() };
  }
  const ppc = toDecimal(piecesPerCarton);
  if (!ppc.isInteger() || ppc.lte(0)) {
    return { cartons: "0", loosePieces: toDecimal(pieces).toString() };
  }
  return toCartonDisplay(pieces, ppc);
}

/** Sum whole-carton or loose-piece counts (each line kept separate — mixed carton sizes). */
export function sumCartons(values: readonly DecimalInput[]): string {
  return values.reduce<Decimal>((total, v) => total.add(toDecimal(v)), new Decimal(0)).toString();
}

/**
 * Whole cartons from a posted order line's paid pieces (D115 product-wise progress).
 * Loose pieces do not count; unknown carton size → 0.
 */
export function stockEntryOrderCartons(
  pieces: DecimalInput,
  piecesPerCarton: DecimalInput | null,
): string {
  return stockEntryCartonParts(pieces, piecesPerCarton).cartons;
}
