import { Decimal, toDecimal, type DecimalInput } from "./decimal";
import { roundSettlement } from "./money";
import { sumAmounts } from "./sales";

/** D76: দান is 2% of the chosen base. */
export const DAN_RATE = "0.02";

export type DanBasis = "net" | "profit";

export type ShareCompanyInput = {
  companyId: string;
  companyName: string;
  profit: DecimalInput;
  khoroch: DecimalInput;
  danBasis: DanBasis;
};

export type ShareHolderInput = {
  shareholderId: string;
  name: string;
  units: DecimalInput;
};

export type ShareCompanyResult = {
  companyId: string;
  companyName: string;
  profit: string;
  khoroch: string;
  danBasis: DanBasis;
  dan: string;
  total: string;
};

export type ShareHolderResult = {
  shareholderId: string;
  name: string;
  units: string;
  income: string;
};

export type ShareMonthResult = {
  companies: ShareCompanyResult[];
  shareholders: ShareHolderResult[];
  totals: {
    profit: string;
    khoroch: string;
    dan: string;
    distributable: string;
    units: string;
    /** Quotient used before paisa rounding, shown to 6 places. */
    perUnit: string;
    /** Distributable left over when nobody holds units. */
    unallocated: string;
  };
};

const ZERO = new Decimal(0);

/**
 * D76: one month of the master account. Company totals are profit − khoroch − দান. দান is 2% of
 * the net, or of the profit when that company says so. The distributable total is split by units;
 * each income is rounded to paisa and the remainder lands on the largest holding (lowest id on a
 * tie) so the incomes add up to the distributable total.
 */
export function shareMonth(input: {
  companies: readonly ShareCompanyInput[];
  shareholders: readonly ShareHolderInput[];
}): ShareMonthResult {
  const companies = input.companies.map((company) => {
    const profit = toDecimal(company.profit);
    const khoroch = toDecimal(company.khoroch);
    const net = profit.sub(khoroch);
    const dan = toDecimal(
      roundSettlement((company.danBasis === "profit" ? profit : net).mul(DAN_RATE)),
    );
    return {
      companyId: company.companyId,
      companyName: company.companyName,
      profit: roundSettlement(profit),
      khoroch: roundSettlement(khoroch),
      danBasis: company.danBasis,
      dan: dan.toFixed(2),
      total: roundSettlement(net.sub(dan)),
    };
  });
  const distributable = toDecimal(sumAmounts(companies.map((company) => company.total)));
  const holders = input.shareholders.map((holder) => ({
    ...holder,
    units: toDecimal(holder.units),
  }));
  const totalUnits = holders.reduce((sum, holder) => sum.add(holder.units), ZERO);
  const sharing = holders.filter((holder) => holder.units.gt(0));
  const perUnit = totalUnits.isZero() ? ZERO : distributable.div(totalUnits);
  const income = new Map<string, Decimal>();
  for (const holder of holders) {
    income.set(
      holder.shareholderId,
      holder.units.gt(0) ? toDecimal(roundSettlement(perUnit.mul(holder.units))) : ZERO,
    );
  }
  if (sharing.length > 0) {
    const rounded = [...income.values()].reduce((sum, value) => sum.add(value), ZERO);
    const remainder = distributable.sub(rounded);
    const target = [...sharing].sort((a, b) => {
      const byUnits = b.units.cmp(a.units);
      if (byUnits !== 0) return byUnits;
      return a.shareholderId < b.shareholderId ? -1 : 1;
    })[0];
    if (target) {
      income.set(target.shareholderId, (income.get(target.shareholderId) ?? ZERO).add(remainder));
    }
  }
  return {
    companies,
    shareholders: holders.map((holder) => ({
      shareholderId: holder.shareholderId,
      name: holder.name,
      units: holder.units
        .toFixed(5)
        .replace(/(\.\d*?)0+$/, "$1")
        .replace(/\.$/, ""),
      income: (income.get(holder.shareholderId) ?? ZERO).toFixed(2),
    })),
    totals: {
      profit: sumAmounts(companies.map((company) => company.profit)),
      khoroch: sumAmounts(companies.map((company) => company.khoroch)),
      dan: sumAmounts(companies.map((company) => company.dan)),
      distributable: distributable.toFixed(2),
      units: totalUnits
        .toFixed(5)
        .replace(/(\.\d*?)0+$/, "$1")
        .replace(/\.$/, ""),
      perUnit: totalUnits.isZero() ? "0.00" : perUnit.toFixed(6),
      unallocated: sharing.length > 0 ? "0.00" : distributable.toFixed(2),
    },
  };
}

/** D76: a person's income from January through the selected month, one result per id seen. */
export function shareYearIncome(
  months: readonly { shareholders: readonly { shareholderId: string; income: DecimalInput }[] }[],
): { shareholderId: string; income: string }[] {
  const order: string[] = [];
  const totals = new Map<string, string[]>();
  for (const month of months) {
    for (const holder of month.shareholders) {
      if (!totals.has(holder.shareholderId)) {
        order.push(holder.shareholderId);
        totals.set(holder.shareholderId, []);
      }
      totals.get(holder.shareholderId)?.push(String(holder.income));
    }
  }
  return order.map((shareholderId) => ({
    shareholderId,
    income: sumAmounts(totals.get(shareholderId) ?? []),
  }));
}
