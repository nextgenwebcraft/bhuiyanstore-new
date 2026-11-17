import { Decimal, toDecimal, type DecimalInput } from "../decimal";
import { roundSettlement } from "../money";
import type { DayResult } from "./types";

/** One DSR line for the profit (D69): its pieces, shop commission and batch prices per piece. */
export type ProfitLine = {
  issued: DecimalInput;
  returned: DecimalInput;
  damaged: DecimalInput;
  commission: DecimalInput;
  salePrice: DecimalInput;
  costPrice: DecimalInput;
  /**
   * D119: taka per damaged piece for মোট বিক্রি / damage cards. Absent = sale price (D109 default).
   */
  damageRate?: DecimalInput;
};

/** The parts of the profit, each a positive amount, and the pieces behind them. */
export type ProfitParts = {
  issued: string;
  returned: string;
  damaged: string;
  /** samari − firot (damaged pieces count as delivered). */
  delivered: string;
  issuedValue: string;
  returnValue: string;
  damageValue: string;
  commission: string;
  /** D74 মোট বিক্রি: delivered × sale − damage × sale − commission. */
  netSales: string;
  deliveredCost: string;
  /** damaged × (sale price − purchase price). */
  damageMargin: string;
  profit: string;
};

const ZERO = new Decimal(0);

/**
 * D69, amended by D74 / D119: profit of DSR lines =
 * samari × sale − firot × sale − commission − delivered × purchase − damage × (sale − purchase),
 * where delivered = samari − firot. Damage money cards / মোট বিক্রি use ড্যামেজ দর (else sale).
 */
export function salesProfit(lines: readonly ProfitLine[]): ProfitParts {
  const t = {
    issued: ZERO,
    returned: ZERO,
    damaged: ZERO,
    issuedValue: ZERO,
    returnValue: ZERO,
    damageValue: ZERO,
    commission: ZERO,
    deliveredCost: ZERO,
    damageMargin: ZERO,
  };
  for (const l of lines) {
    const issued = toDecimal(l.issued);
    const returned = toDecimal(l.returned);
    const damaged = toDecimal(l.damaged);
    const sale = toDecimal(l.salePrice);
    const cost = toDecimal(l.costPrice);
    const damageRate =
      l.damageRate === undefined || l.damageRate === "" ? sale : toDecimal(l.damageRate);
    t.issued = t.issued.add(issued);
    t.returned = t.returned.add(returned);
    t.damaged = t.damaged.add(damaged);
    t.issuedValue = t.issuedValue.add(issued.mul(sale));
    t.returnValue = t.returnValue.add(returned.mul(sale));
    t.damageValue = t.damageValue.add(damaged.mul(damageRate));
    t.commission = t.commission.add(toDecimal(l.commission));
    t.deliveredCost = t.deliveredCost.add(issued.sub(returned).mul(cost));
    t.damageMargin = t.damageMargin.add(damaged.mul(sale.sub(cost)));
  }
  const deliveredValue = t.issuedValue.sub(t.returnValue);
  const profit = deliveredValue.sub(t.commission).sub(t.deliveredCost).sub(t.damageMargin);
  return {
    issued: t.issued.toString(),
    returned: t.returned.toString(),
    damaged: t.damaged.toString(),
    delivered: t.issued.sub(t.returned).toString(),
    issuedValue: roundSettlement(t.issuedValue),
    returnValue: roundSettlement(t.returnValue),
    damageValue: roundSettlement(t.damageValue),
    commission: roundSettlement(t.commission),
    netSales: roundSettlement(deliveredValue.sub(t.damageValue).sub(t.commission)),
    deliveredCost: roundSettlement(t.deliveredCost),
    damageMargin: roundSettlement(t.damageMargin),
    profit: roundSettlement(profit),
  };
}

/** A posted day's DSR lines at the prices of the batch each line took from. */
export function profitLinesOf(day: DayResult): ProfitLine[] {
  return day.persons.map((p) => {
    const product = day.products.find((x) => x.productId === p.productId);
    const batch = p.allocations[0];
    return {
      issued: p.issued,
      returned: p.returned,
      damaged: p.damaged,
      commission: p.commission,
      salePrice: batch?.salePrice ?? product?.salePrice ?? "0",
      costPrice: batch?.costPrice ?? product?.costPrice ?? "0",
      ...(p.damageRate === null || p.damageRate === undefined
        ? {}
        : { damageRate: p.damageRate }),
    };
  });
}

/**
 * D133: value of damaged pieces still held (product × rate lots). Uses `amount` when present,
 * otherwise pieces × rate.
 */
export function heldDamageValue(
  lots: readonly { rate: DecimalInput; pieces: DecimalInput; amount?: DecimalInput }[],
): string {
  return roundSettlement(
    lots.reduce((total, lot) => {
      const line =
        lot.amount !== undefined && lot.amount !== ""
          ? toDecimal(lot.amount)
          : toDecimal(lot.pieces).mul(toDecimal(lot.rate));
      return total.add(line);
    }, ZERO),
  );
}

/**
 * D133 মোট ড্যামেজ card: held lots at range end + damage/floor deposits in the range.
 * হাতে জমা still subtracts only sheet `damageSaleValue` (D107).
 */
export function dashboardDamageTotal(input: {
  lots: readonly { rate: DecimalInput; pieces: DecimalInput; amount?: DecimalInput }[];
  /** Σ damageDeposit + floorDamageDeposit money in the range (`companyPayable.damageRefunds`). */
  depositValue: DecimalInput;
}): string {
  return roundSettlement(toDecimal(heldDamageValue(input.lots)).add(toDecimal(input.depositValue)));
}

/**
 * D69 (amended D106, D107): the dashboard. মোট খরচ = কমিশন + অপারেটিং খরচ + ডিএসআর খরচ (বেতনসহ)
 * (shown only); profitCost = অপারেটিং খরচ + ডিএসআর খরচ; নিট প্রফিট = মোট প্রফিট − profitCost (ফেরত
 * and কমিশন are already in the profit). D107 মোট বিক্রি = মোট সামারি − মোট ফেরত. হাতে জমা = মোট বিক্রি
 * − মোট ড্যামেজ − মোট কমিশন − অপারেটিং খরচ − ডিএসআর খরচ − নতুন বকেয়া + বকেয়া জমা (দোকানের আদায়).
 * D133: the মোট ড্যামেজ *card* may show `dashboardDamageTotal` (held + deposits); cash still uses
 * `damageSaleValue` here.
 */
export function dashboardTotals(input: {
  issuedValue: DecimalInput;
  returnValue: DecimalInput;
  damageSaleValue: DecimalInput;
  commission: DecimalInput;
  expenses: DecimalInput;
  staffCost: DecimalInput;
  /** New shop credit given in the range (নতুন বকেয়া). */
  marketDueCreated: DecimalInput;
  /** Old shop dues collected in the range (বকেয়া জমা / দোকানের আদায়). */
  oldDuesCollected: DecimalInput;
  salesProfit?: DecimalInput;
}): {
  totalCost: string;
  profitCost: string;
  totalSales: string;
  cashInHand: string;
  netProfit: string | null;
} {
  const running = toDecimal(input.expenses).add(toDecimal(input.staffCost));
  const totalCost = running.add(toDecimal(input.commission));
  const totalSales = toDecimal(input.issuedValue).sub(toDecimal(input.returnValue));
  const cashInHand = totalSales
    .sub(toDecimal(input.damageSaleValue))
    .sub(toDecimal(input.commission))
    .sub(running)
    .sub(toDecimal(input.marketDueCreated))
    .add(toDecimal(input.oldDuesCollected));
  return {
    profitCost: roundSettlement(running),
    totalCost: roundSettlement(totalCost),
    totalSales: roundSettlement(totalSales),
    cashInHand: roundSettlement(cashInHand),
    netProfit:
      input.salesProfit === undefined
        ? null
        : roundSettlement(toDecimal(input.salesProfit).sub(running)),
  };
}
