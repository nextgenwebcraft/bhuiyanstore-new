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

/**
 * Splits an amount equally across `count` parts, in paisa (D143). Leftover paisa go one each to
 * the first parts, so the parts always add back to the amount exactly. Used by the শেয়ারহোল্ডার
 * screen's "same amount in every company" field.
 */
export function splitEqually(amount: DecimalInput, count: number): string[] {
  if (!Number.isInteger(count) || count <= 0) return [];
  const paisa = toDecimal(roundSettlement(amount)).mul(100);
  const base = paisa.divToInt(count);
  const leftover = paisa.sub(base.mul(count)).toNumber();
  return Array.from({ length: count }, (_, index) =>
    roundSettlement(base.add(index < leftover ? 1 : 0).div(100)),
  );
}

export type PartnerInvest = {
  shareholderId: string;
  /** Invest in force for the month, keyed by company id; a missing company is zero. */
  invest: Readonly<Record<string, DecimalInput>>;
};

export type PartnerSharesInput = {
  /** Each company's totalProfit for the month (profit − khoroch − দান). */
  companies: readonly { companyId: string; totalProfit: DecimalInput }[];
  /** Previous Due applied against this month (D128). */
  previousDueTotal: DecimalInput;
  /** Active partners only; closed partners get no share and add no invest. */
  partners: readonly PartnerInvest[];
};

export type PartnerShareLine = { companyId: string; invest: string; amount: string };

export type PartnerSharesResult = {
  totalProfit: string;
  distributableProfit: string;
  companies: {
    companyId: string;
    totalProfit: string;
    /** This company's part of the distributable pool after the Previous Due cut. */
    distributableProfit: string;
    /** Every active partner's invest in this company. */
    invest: string;
  }[];
  partners: {
    shareholderId: string;
    invest: string;
    /** The partner's share from every company, summed: the one amount they are paid. */
    amount: string;
    lines: PartnerShareLine[];
  }[];
  /** Sum of every partner's amount. */
  allocated: string;
  /** distributableProfit − allocated: companies nobody invested in, plus paisa rounding. */
  unallocated: string;
};

/**
 * A month's partner profit, company by company (D143, replaces the D88 pooled split): each
 * company's distributable profit is split among the partners who invested in that company, in
 * proportion to their invest there; a partner's amount is the sum over every company. The D128
 * Previous Due cut is spread over the companies in proportion to their totalProfit (one factor =
 * distributable ÷ totalProfit), so the per-company parts still add up to the distributable pool.
 * A company with no invest has nobody to receive its profit; that stays in `unallocated`.
 */
export function partnerShares(input: PartnerSharesInput): PartnerSharesResult {
  const total = input.companies.reduce(
    (sum, company) => sum.add(toDecimal(company.totalProfit)),
    toDecimal("0"),
  );
  const pool = distributableProfit(total, input.previousDueTotal);
  const factor = total.gt(0) ? toDecimal(pool).div(total) : toDecimal("1");
  const investOf = (partner: PartnerInvest, companyId: string) =>
    toDecimal(roundSettlement(partner.invest[companyId] ?? "0"));

  const companies = input.companies.map((company) => {
    const share = toDecimal(company.totalProfit).mul(factor);
    const invest = input.partners.reduce(
      (sum, partner) => sum.add(investOf(partner, company.companyId)),
      toDecimal("0"),
    );
    return { companyId: company.companyId, share, invest };
  });

  const partners = input.partners.map((partner) => {
    const lines = companies.map((company) => {
      const invest = investOf(partner, company.companyId);
      return {
        companyId: company.companyId,
        invest: roundSettlement(invest),
        amount: investShare(company.share, invest, company.invest),
      };
    });
    return {
      shareholderId: partner.shareholderId,
      invest: roundSettlement(
        lines.reduce((sum, line) => sum.add(toDecimal(line.invest)), toDecimal("0")),
      ),
      amount: roundSettlement(
        lines.reduce((sum, line) => sum.add(toDecimal(line.amount)), toDecimal("0")),
      ),
      lines,
    };
  });

  const allocated = partners.reduce(
    (sum, partner) => sum.add(toDecimal(partner.amount)),
    toDecimal("0"),
  );
  return {
    totalProfit: roundSettlement(total),
    distributableProfit: pool,
    companies: companies.map((company) => ({
      companyId: company.companyId,
      totalProfit: roundSettlement(
        input.companies.find((row) => row.companyId === company.companyId)?.totalProfit ?? "0",
      ),
      distributableProfit: roundSettlement(company.share),
      invest: roundSettlement(company.invest),
    })),
    partners,
    allocated: roundSettlement(allocated),
    unallocated: roundSettlement(toDecimal(pool).sub(allocated)),
  };
}
