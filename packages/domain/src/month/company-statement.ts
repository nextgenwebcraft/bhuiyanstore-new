import { toDecimal } from "../decimal";
import type { CompanyEntryKind, CompanyEntryResult, ProductId } from "./types";

/** One company statement line (D82): one movement, with the balance after it. */
export type CompanyStatementLine = {
  date: string;
  kind: CompanyEntryKind;
  /** Amount that cuts the company balance (an order bill, or the excess on a receipt). */
  credit: string;
  /**
   * Amount that raises the company balance (a deposit, money incentive or damage return),
   * or the undelivered value released when ordered goods arrive (that part moves no balance).
   */
  debit: string;
  /** Order only: the bill taken from মোট জমা, the incentive part and the damage part. */
  cash: string;
  incentive: string;
  damage: string;
  /** What we owe the company after this line (negative = money deposited with it). */
  balance: string;
  /** Billed value of goods ordered and not yet received, after this line. */
  undelivered: string;
  productIds: ProductId[];
};

const ZERO = "0";

/**
 * The company statement (D82): the ledger in posting order. Orders posted together are one line.
 * The whole bill is credit; cash, incentive and damage are how that bill was paid. A receipt's
 * debit is the ordered goods now in hand, and its credit is only the excess bill.
 */
export function companyStatement(entries: readonly CompanyEntryResult[]): CompanyStatementLine[] {
  const groups = new Map<string, CompanyEntryResult[]>();
  const ordered: (CompanyEntryResult | CompanyEntryResult[])[] = [];
  entries.forEach((entry, index) => {
    if (entry.kind !== "order") return void ordered.push(entry);
    const key = `${entry.date}|${entry.group ?? `#${index}`}`;
    const group = groups.get(key);
    if (group) return void group.push(entry);
    const fresh = [entry];
    groups.set(key, fresh);
    ordered.push(fresh);
  });
  return ordered.map((item) => (Array.isArray(item) ? orderGroupLine(item) : singleLine(item)));
}

function orderGroupLine(group: readonly CompanyEntryResult[]): CompanyStatementLine {
  const first = group[0] as CompanyEntryResult;
  const last = group[group.length - 1] as CompanyEntryResult;
  const total = (pick: (entry: CompanyEntryResult) => string | undefined) =>
    group.reduce((sum, entry) => sum.add(toDecimal(pick(entry) ?? ZERO)), toDecimal(ZERO));
  const credit = total((entry) => entry.amount);
  let cash = total((entry) => entry.fromDeposit);
  const incentive = total((entry) => entry.fromIncentive);
  const damage = total((entry) => entry.fromDamage);
  // An order without a funding split (older rows) is paid from মোট জমা.
  if (cash.isZero() && incentive.isZero() && damage.isZero()) cash = credit;
  return {
    date: first.date,
    kind: "order",
    credit: credit.toString(),
    debit: ZERO,
    cash: cash.toString(),
    incentive: incentive.toString(),
    damage: damage.toString(),
    balance: last.balance,
    undelivered: last.undelivered,
    productIds: [...new Set(group.flatMap((entry) => (entry.productId ? [entry.productId] : [])))],
  };
}

function singleLine(entry: CompanyEntryResult): CompanyStatementLine {
  const raises =
    entry.kind === "deposit" || entry.kind === "incentive" || entry.kind === "damageRefund";
  return {
    date: entry.date,
    kind: entry.kind,
    credit: entry.kind === "receipt" ? entry.amount : ZERO,
    debit: entry.kind === "receipt" ? (entry.released ?? ZERO) : raises ? entry.amount : ZERO,
    cash: ZERO,
    incentive: ZERO,
    damage: ZERO,
    balance: entry.balance,
    undelivered: entry.undelivered,
    productIds: entry.productId ? [entry.productId] : [],
  };
}
