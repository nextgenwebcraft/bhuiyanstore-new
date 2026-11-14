import DecimalJs from "decimal.js";

/**
 * The single Decimal configuration for all domain arithmetic. Never use JavaScript numbers
 * for money or quantities (guide sections 10.4, 20.3).
 *
 * ROUND_HALF_UP is a provisional default; the rounding policy is an open decision
 * (see docs/decisions.md, P01).
 */
export const Decimal = DecimalJs.clone({
  precision: 40,
  rounding: DecimalJs.ROUND_HALF_UP,
});

export type Decimal = InstanceType<typeof Decimal>;
export type DecimalInput = Decimal | string;

export function toDecimal(value: DecimalInput): Decimal {
  return new Decimal(value);
}
