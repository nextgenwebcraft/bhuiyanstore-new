import { Decimal, toDecimal, type DecimalInput } from "../decimal";
import type { CompanyFund } from "./types";

const ZERO = new Decimal(0);

/**
 * D63: how an order's bill is paid: from the damage part first, then the incentive part (each only
 * when named and up to what it holds), the rest from মোট জমা.
 */
export function fundOrder(
  bill: Decimal,
  fundFrom: readonly CompanyFund[],
  held: { damage: Decimal; incentive: Decimal },
): { fromDamage: Decimal; fromIncentive: Decimal; fromDeposit: Decimal } {
  const fromDamage = fundFrom.includes("damage")
    ? Decimal.min(bill, Decimal.max(held.damage, ZERO))
    : ZERO;
  const fromIncentive = fundFrom.includes("incentive")
    ? Decimal.min(bill.sub(fromDamage), Decimal.max(held.incentive, ZERO))
    : ZERO;
  return { fromDamage, fromIncentive, fromDeposit: bill.sub(fromDamage).sub(fromIncentive) };
}

/**
 * D63: the part of a deposit beyond the total cash and bank balance (never below zero) is money
 * put in first, so a deposit never takes the total below zero; 0 when the cash covers it.
 */
export function depositInvestment(amount: Decimal, totalCash: Decimal): Decimal {
  return Decimal.max(amount.sub(Decimal.max(totalCash, ZERO)), ZERO);
}

/** The deposit form's preview of `depositInvestment`. */
export function depositInvestmentPreview(amount: DecimalInput, totalCash: DecimalInput): string {
  return depositInvestment(toDecimal(amount), toDecimal(totalCash)).toString();
}

/** The order page's preview of `fundOrder` (amounts as strings). */
export function orderFundingPreview(
  bill: DecimalInput,
  fundFrom: readonly CompanyFund[],
  held: { damage: DecimalInput; incentive: DecimalInput },
): { damage: string; incentive: string; deposit: string } {
  const split = fundOrder(toDecimal(bill), fundFrom, {
    damage: toDecimal(held.damage),
    incentive: toDecimal(held.incentive),
  });
  return {
    damage: split.fromDamage.toString(),
    incentive: split.fromIncentive.toString(),
    deposit: split.fromDeposit.toString(),
  };
}
