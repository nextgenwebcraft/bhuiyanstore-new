import { toDecimal } from "../decimal";
import type { CompanyEntryKind, CompanyEntryResult, ProductId } from "./types";

export type CompanyStatementKind =
  | Exclude<CompanyEntryKind, "order">
  | "orderFromDamage"
  | "orderFromIncentive"
  | "orderFromDeposit";

/** One company statement line (D63): a ledger entry, or one balance part of an order group. */
export type CompanyStatementLine = Omit<CompanyEntryResult, "kind" | "productId"> & {
  kind: CompanyStatementKind;
  /** The products of the line (an order group may hold several). */
  productIds: ProductId[];
};

const FUND_PARTS = [
  ["fromDamage", "orderFromDamage"],
  ["fromIncentive", "orderFromIncentive"],
  ["fromDeposit", "orderFromDeposit"],
] as const;

/**
 * The company statement (D63): the ledger in posting order, with each day's orders posted together
 * (one group) shown as one line per balance part that paid them â€” damage, incentive, à¦®à§‹à¦Ÿ à¦œà¦®à¦¾ â€”
 * each with the balances after it. A group of a single order keeps its quantities and rate.
 */
export function companyStatement(entries: readonly CompanyEntryResult[]): CompanyStatementLine[] {
  const groups = new Map<string, CompanyEntryResult[]>();
  const ordered: (CompanyEntryResult | CompanyEntryResult[])[] = [];
  entries.forEach((e, index) => {
    if (e.kind !== "order") return void ordered.push(e);
    const key = `${e.date}|${e.group ?? `#${index}`}`;
    const group = groups.get(key);
    if (group) return void group.push(e);
    const fresh = [e];
    groups.set(key, fresh);
    ordered.push(fresh);
  });
  return ordered.flatMap((item): CompanyStatementLine[] => {
    if (!Array.isArray(item)) {
      const { productId, kind, ...rest } = item;
      return [
        {
          ...rest,
          kind: kind as CompanyStatementLine["kind"],
          productIds: productId ? [productId] : [],
        },
      ];
    }
    return orderGroupLines(item);
  });
}

function orderGroupLines(group: readonly CompanyEntryResult[]): CompanyStatementLine[] {
  const first = group[0] as CompanyEntryResult;
  const last = group[group.length - 1] as CompanyEntryResult;
  const total = (pick: (e: CompanyEntryResult) => string | undefined) =>
    group.reduce((sum, e) => sum.add(toDecimal(pick(e) ?? "0")), toDecimal("0"));
  const parts = FUND_PARTS.map(([field, kind]) => ({
    kind,
    // An order line without funding (older rows) is paid from à¦®à§‹à¦Ÿ à¦œà¦®à¦¾.
    amount: total((e) => e[field] ?? (field === "fromDeposit" ? e.amount : "0")),
  }));
  const shown = parts.filter((p) => !p.amount.isZero());
  const single = group.length === 1;
  const productIds = [...new Set(group.flatMap((e) => (e.productId ? [e.productId] : [])))];
  let payable = toDecimal(first.balance).sub(toDecimal(first.amount));
  let incentiveLeft = total((e) => e.fromIncentive);
  return (shown.length ? shown : parts.slice(-1)).map((p) => {
    payable = payable.add(p.amount);
    if (p.kind === "orderFromIncentive") incentiveLeft = toDecimal("0");
    return {
      date: first.date,
      kind: p.kind,
      amount: p.amount.toString(),
      ...(first.ref === undefined ? {} : { ref: first.ref }),
      productIds,
      ...(single && first.quantity !== undefined ? { quantity: first.quantity } : {}),
      ...(single && first.freeQuantity !== undefined ? { freeQuantity: first.freeQuantity } : {}),
      ...(single && first.cartonRate !== undefined ? { cartonRate: first.cartonRate } : {}),
      ...(first.group === undefined ? {} : { group: first.group }),
      balance: payable.toString(),
      damageBalance: last.damageBalance,
      incentiveBalance: toDecimal(last.incentiveBalance).add(incentiveLeft).toString(),
      undelivered: last.undelivered,
    };
  });
}
