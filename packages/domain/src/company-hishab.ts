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
