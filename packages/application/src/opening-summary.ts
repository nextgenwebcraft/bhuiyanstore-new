import {
  openingSectionKinds,
  type OpeningBalanceKind,
  type OpeningBalanceLine,
  type OpeningSectionSummary,
  type OpeningStockLine,
  type OpeningTotals,
} from "@bsd/contracts";
import { Decimal } from "@bsd/domain";

/**
 * What each opening section card shows (D43). The one place that decides a section's entered
 * count and done/pending/optional state, so the opening page and the setup status never disagree.
 * It lives here, not in `@bsd/domain`, because it joins the opening with who exists (staff, shops,
 * accounts) and needs the section map of `@bsd/contracts`; it does no I/O.
 */

/** The parties the opening can have lines for, beyond what is already saved. */
export type OpeningParties = {
  /** DSRs: each can carry a market due. */
  dsrIds: readonly string[];
  /** Everyone assigned to the company: each can carry staff balances. */
  staffIds: readonly string[];
  /** Active shops: each can carry a shop due. */
  shopIds: readonly string[];
  cashAccountIds: readonly string[];
};

const partyOf = (line: OpeningBalanceLine) =>
  line.shopId ?? line.staffId ?? line.cashAccountId ?? "";

const COMPANY_ROWS = openingSectionKinds.company.map((kind) => `${kind}|`);

export function summarizeSections(
  opening: {
    stock: readonly Pick<OpeningStockLine, "pieces">[];
    balances: readonly OpeningBalanceLine[];
    totals: OpeningTotals;
  },
  parties: OpeningParties,
): OpeningSectionSummary[] {
  const savedIn = (kinds: readonly OpeningBalanceKind[]) =>
    opening.balances.filter((b) => kinds.includes(b.kind) && b.amount !== null);
  const sumOf = (lines: readonly OpeningBalanceLine[]) =>
    lines.reduce((sum, b) => sum.plus(b.amount ?? "0"), new Decimal(0)).toFixed(2);

  /** Counts the listed rows plus any saved row for a party that is no longer listed. */
  const rows = (
    kinds: readonly OpeningBalanceKind[],
    listed: readonly string[],
    person = false,
  ) => {
    const keyOf = (b: OpeningBalanceLine) => (person ? partyOf(b) : `${b.kind}|${partyOf(b)}`);
    const saved = new Set(savedIn(kinds).map(keyOf));
    const all = new Set([...listed, ...saved]);
    return { entered: saved.size, total: all.size, lines: savedIn(kinds) };
  };
  const allDone = (r: { entered: number; total: number }) =>
    r.total > 0 && r.entered === r.total ? "done" : "pending";
  const anyDone = (r: { entered: number }, otherwise: "pending" | "optional") =>
    r.entered > 0 ? "done" : otherwise;

  const stockEntered = opening.stock.filter((l) => l.pieces !== null).length;
  const market = rows(
    openingSectionKinds.marketDue,
    ["", ...parties.dsrIds].map((id) => `market_due|${id}`),
  );
  const shop = rows(
    openingSectionKinds.shopDue,
    parties.shopIds.map((id) => `shop_due|${id}`),
  );
  const staff = rows(openingSectionKinds.staff, parties.staffIds, true);
  const company = rows(openingSectionKinds.company, COMPANY_ROWS);
  const cash = rows(
    openingSectionKinds.cash,
    parties.cashAccountIds.map((id) => `cash|${id}`),
  );
  const totals = opening.totals;
  return [
    {
      section: "stock",
      entered: stockEntered,
      total: opening.stock.length,
      state: allDone({ entered: stockEntered, total: opening.stock.length }),
      amounts: [{ key: "total", value: totals.stockValue }],
    },
    {
      section: "marketDue",
      entered: market.entered,
      total: market.total,
      state: anyDone(market, "optional"),
      amounts: [{ key: "total", value: sumOf(market.lines) }],
    },
    {
      section: "shopDue",
      entered: shop.entered,
      total: shop.total,
      state: allDone(shop),
      amounts: [{ key: "total", value: sumOf(shop.lines) }],
    },
    {
      section: "staff",
      entered: staff.entered,
      total: staff.total,
      state: allDone(staff),
      amounts: [
        { key: "owesUs", value: totals.staffOwesUs },
        { key: "weOwe", value: totals.staffWeOwe },
      ],
    },
    {
      section: "company",
      entered: company.entered,
      total: company.total,
      state: anyDone(company, "pending"),
      amounts: [{ key: "total", value: totals.companyPayable }],
    },
    {
      section: "cash",
      entered: cash.entered,
      total: cash.total,
      state: anyDone(cash, "pending"),
      amounts: [{ key: "total", value: totals.cash }],
    },
  ];
}
