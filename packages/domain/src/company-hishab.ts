import { toDecimal, type DecimalInput } from "./decimal";
import { roundSettlement } from "./money";

/** দান is always 2% of its base. */
export const DAN_RATE = "0.02";

const LAKH = "100000";

export type CompanyFigures = {
  companyId: string;
  companyName: string;
  profit: DecimalInput;
  khoroch: DecimalInput;
};

export type CompanyHishabRow = {
  companyId: string;
  companyName: string;
  profit: string;
  khoroch: string;
  dan: string;
  totalProfit: string;
};

/** দান on a base amount: 2%, rounded to paisa. */
export function danOf(base: DecimalInput): string {
  return roundSettlement(toDecimal(base).mul(DAN_RATE));
}

/**
 * Company Hishab Reports: one row per company for a month. Profit and khoroch come from that
 * company's dashboard (profit = মোট প্রফিট, khoroch = অপারেটিং খরচ + ডিএসআর খরচ). দান is 2% of
 * the net (profit − khoroch); totalProfit is the net after দান. A loss stays negative.
 */
export function companyHishabMonth(companies: readonly CompanyFigures[]): CompanyHishabRow[] {
  return companies.map((company) => {
    const profit = toDecimal(company.profit);
    const khoroch = toDecimal(company.khoroch);
    const net = profit.sub(khoroch);
    const dan = danOf(net);
    return {
      companyId: company.companyId,
      companyName: company.companyName,
      profit: roundSettlement(profit),
      khoroch: roundSettlement(khoroch),
      dan,
      totalProfit: roundSettlement(net.sub(toDecimal(dan))),
    };
  });
}

/** Profit for every lakh (100,000) invested; "0.00" when nothing is invested. */
export function profitPerLakh(totalProfit: DecimalInput, invest: DecimalInput): string {
  const investDecimal = toDecimal(invest);
  if (investDecimal.lte(0)) return "0.00";
  return roundSettlement(toDecimal(totalProfit).div(investDecimal.div(LAKH)));
}

/**
 * One shareholder's exact share of totalProfit: their invest against everyone's combined invest,
 * so every taka of profit is split in proportion to invest. "0.00" when nothing is invested in
 * total. The rate this implies (share ÷ invest) always equals `profitPerLakh(totalProfit,
 * totalInvest)`, so the two figures agree no matter who is selected.
 */
export function investShare(
  totalProfit: DecimalInput,
  invest: DecimalInput,
  totalInvest: DecimalInput,
): string {
  const totalInvestDecimal = toDecimal(totalInvest);
  if (totalInvestDecimal.lte(0)) return "0.00";
  return roundSettlement(toDecimal(totalProfit).mul(toDecimal(invest)).div(totalInvestDecimal));
}

/**
 * Open Previous Due amounts (D128): sum every positive amount; zero and negative rows do not
 * reduce the pool. Used only on the master shareholder split, after দান.
 */
export function previousDueOpenTotal(amounts: readonly DecimalInput[]): string {
  let sum = toDecimal("0");
  for (const amount of amounts) {
    const value = toDecimal(amount);
    if (value.gt(0)) sum = sum.add(value);
  }
  return roundSettlement(sum);
}

/**
 * Distributable pool after Previous Due (D128): when totalProfit is positive, subtract open dues
 * and floor at zero; when totalProfit is already ≤ 0, leave it alone (dues do not deepen a loss
 * for the share). Operating totalProfit and দান stay unchanged.
 */
export function distributableProfit(
  totalProfit: DecimalInput,
  previousDueTotal: DecimalInput,
): string {
  const profit = toDecimal(totalProfit);
  if (profit.lte(0)) return roundSettlement(profit);
  const remaining = profit.sub(toDecimal(previousDueTotal));
  return roundSettlement(remaining.gt(0) ? remaining : toDecimal("0"));
}
