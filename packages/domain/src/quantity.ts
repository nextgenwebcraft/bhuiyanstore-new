import { Decimal, toDecimal, type DecimalInput } from "./decimal";

/**
 * base_quantity = cartons × pieces_per_carton_snapshot + loose_pieces (guide section 9.2).
 * The carton factor is a per-product, per-transaction snapshot; never assume 24.
 */
export function toBaseQuantity(
  cartons: DecimalInput,
  loosePieces: DecimalInput,
  piecesPerCarton: DecimalInput,
): string {
  const factor = toDecimal(piecesPerCarton);
  if (!factor.isInteger() || factor.lte(0)) {
    throw new RangeError("piecesPerCarton must be a positive integer");
  }
  return toDecimal(cartons).mul(factor).add(toDecimal(loosePieces)).toString();
}

/** Normalizes a base quantity into whole cartons plus loose pieces for display only. */
export function toCartonDisplay(
  baseQuantity: DecimalInput,
  piecesPerCarton: DecimalInput,
): { cartons: string; loosePieces: string } {
  const base = toDecimal(baseQuantity);
  const factor = toDecimal(piecesPerCarton);
  const cartons = base.div(factor).floor();
  return {
    cartons: cartons.toString(),
    loosePieces: base.sub(cartons.mul(factor)).toString(),
  };
}

/** Net quantity kept by a DSR: Samari (issued) minus Firot (unsold returned). Confirmed D04. */
export function netIssuedQuantity(samari: DecimalInput, firot: DecimalInput): string {
  const net = toDecimal(samari).sub(toDecimal(firot));
  if (net.lt(new Decimal(0))) {
    throw new RangeError("Firot cannot exceed Samari");
  }
  return net.toString();
}
