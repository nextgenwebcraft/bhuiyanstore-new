import { Decimal, toDecimal, type DecimalInput } from "../decimal";
import type { MoneyKind, StaffBalances } from "./types";

type Direction = 1 | -1 | 0;

export type MoneyKindEffect = {
  /** Effect on the day's cash left (PLAN §2.4). Supplier deposits are reported as banked instead. */
  cash: Direction;
  marketDue?: Direction;
  /** Balance increased (+1) or decreased (−1); `owed` reduces advance → loan → shortage. */
  staff?: { balance: keyof StaffBalances | "owed"; direction: 1 | -1 };
  /** A second balance moved by the same entry (salary recovery also settles salary payable). */
  staffAlso?: { balance: keyof StaffBalances; direction: 1 | -1 };
  expense?: "category" | "salary" | "srIncentive";
  /** Lowers what we owe the company: a bank deposit (D19) or a cash incentive (D33). */
  company?: "deposit" | "incentive";
  /**
   * Cash and bank book (D52) for kinds that do not move the daily cash left: a supplier deposit
   * leaves an account (-1); a transfer leaves one account and enters another.
   */
  book?: -1 | "transfer";
  requiresStaff: boolean;
};

/**
 * The single owner of every money entry's direction (D27, guide §11.9). Users never type signs.
 *
 * Cash left is derived from sales (PLAN §2.4), so a shortage reduces it: the sales money it
 * represents never reached the cash box. That matches the workbook's subtraction of Sort columns.
 */
export const MONEY_KIND_EFFECTS: Readonly<Record<MoneyKind, MoneyKindEffect>> = {
  marketDueNew: { cash: -1, marketDue: 1, requiresStaff: false },
  marketDueCollected: { cash: 1, marketDue: -1, requiresStaff: false },
  srIncentive: { cash: -1, expense: "srIncentive", requiresStaff: false },
  expense: { cash: -1, expense: "category", requiresStaff: false },
  staffAdvance: { cash: -1, staff: { balance: "advance", direction: 1 }, requiresStaff: true },
  staffLoan: { cash: -1, staff: { balance: "loan", direction: 1 }, requiresStaff: true },
  staffShortage: { cash: -1, staff: { balance: "shortage", direction: 1 }, requiresStaff: true },
  staffRepayment: { cash: 1, staff: { balance: "owed", direction: -1 }, requiresStaff: true },
  staffExcess: { cash: 1, staff: { balance: "credit", direction: 1 }, requiresStaff: true },
  staffCostPaid: {
    cash: 0,
    staff: { balance: "credit", direction: 1 },
    expense: "category",
    requiresStaff: true,
  },
  staffCreditPaid: { cash: -1, staff: { balance: "credit", direction: -1 }, requiresStaff: true },
  /** D67: absent fee, a record only; payroll takes it off that month's salary. */
  staffAbsent: { cash: 0, requiresStaff: true },
  salaryAccrual: {
    cash: 0,
    staff: { balance: "salaryPayable", direction: 1 },
    expense: "salary",
    requiresStaff: true,
  },
  salaryRecovery: {
    cash: 0,
    staff: { balance: "owed", direction: -1 },
    staffAlso: { balance: "salaryPayable", direction: -1 },
    requiresStaff: true,
  },
  salaryPaid: { cash: -1, staff: { balance: "salaryPayable", direction: -1 }, requiresStaff: true },
  srLoan: { cash: -1, staff: { balance: "srLoan", direction: 1 }, requiresStaff: true },
  srRepayment: { cash: 1, staff: { balance: "srLoan", direction: -1 }, requiresStaff: true },
  /** D55: incentive the SR earned and we have not paid yet: an expense now, no cash. */
  srOwed: {
    cash: 0,
    staff: { balance: "owedToSr", direction: 1 },
    expense: "srIncentive",
    requiresStaff: true,
  },
  /** D55: paying what is owed lowers it with no expense (it was accrued by `srOwed`). */
  srPayment: { cash: -1, staff: { balance: "owedToSr", direction: -1 }, requiresStaff: true },
  /** Explicit offset of staff credit against what the person owes; never automatic (D27). */
  staffOffset: {
    cash: 0,
    staff: { balance: "owed", direction: -1 },
    staffAlso: { balance: "credit", direction: -1 },
    requiresStaff: true,
  },
  /** Explicit offset of money owed to an SR against the SR's loan (D18, guide §11.2). */
  srOffset: {
    cash: 0,
    staff: { balance: "srLoan", direction: -1 },
    staffAlso: { balance: "owedToSr", direction: -1 },
    requiresStaff: true,
  },
  /** D52: leaves an account in the cash book but stays outside the daily cash left. */
  supplierDeposit: { cash: 0, company: "deposit", book: -1, requiresStaff: false },
  /** D52: moves money between two accounts; no cash left, profit, staff or company effect. */
  cashTransfer: { cash: 0, book: "transfer", requiresStaff: false },
  /** Incentive the company credits to our account in money (D33): no cash, no profit effect. */
  companyIncentive: { cash: 0, company: "incentive", requiresStaff: false },
};

/**
 * How a kind moves the cash book (D52): +1 into its account, -1 out of it, "transfer" between two
 * accounts, 0 when it never touches an account.
 */
export function cashBookEffect(kind: MoneyKind): 1 | -1 | "transfer" | 0 {
  const effect = MONEY_KIND_EFFECTS[kind];
  return effect.cash !== 0 ? effect.cash : (effect.book ?? 0);
}

/**
 * D67: কর্মীর খরচ, the money the sales paid out for distributor staff, net of what came back:
 * advance, loan, shortage, salary paid and credit paid count in; repayments and excess count out.
 */
export const STAFF_COST_SIGN: Readonly<Partial<Record<MoneyKind, 1 | -1>>> = {
  staffAdvance: 1,
  staffLoan: 1,
  staffShortage: 1,
  salaryPaid: 1,
  staffCreditPaid: 1,
  staffRepayment: -1,
  staffExcess: -1,
};

type Entry = { kind: MoneyKind; amount: DecimalInput };

function signedSum(entries: readonly Entry[], signs: Partial<Record<MoneyKind, 1 | -1>>): string {
  let total = new Decimal(0);
  for (const entry of entries) {
    const sign = signs[entry.kind];
    if (sign) total = total.add(toDecimal(entry.amount).mul(sign));
  }
  return total.toString();
}

/** Σ signed staff cost of the entries (D67). */
export function staffCost(entries: readonly Entry[]): string {
  return signedSum(entries, STAFF_COST_SIGN);
}
/** The kinds that name a cash account on entry: everything that moves one. */
export const moneyKindsWithAccount: readonly MoneyKind[] = (
  Object.keys(MONEY_KIND_EFFECTS) as MoneyKind[]
).filter((kind) => cashBookEffect(kind) !== 0);
