import { Decimal, toDecimal } from "./decimal";
import { roundSettlement } from "./money";
import type { MonthOpening, OpeningProduct, StaffBalances } from "./month/types";

type Group = "marketDue" | "owesUs" | "weOwe" | "companyPayable" | "companyAdvance" | "cash";

export type OpeningKindEffect = {
  group: Group;
  /** Who the balance belongs to: a person, optionally a person (legacy bucket), a cash account, or nobody. */
  party: "staff" | "optionalStaff" | "cashAccount" | "none";
  /** The engine's staff balance it opens (D27, guide §11.9). */
  staffBalance?: keyof StaffBalances;
  /** SR-only kinds (D18) and kinds an SR never has (salary, distributor staff money; D02). */
  personKind?: "sr" | "distributor";
};

/**
 * The single owner of what each opening balance means (guide §16.7). Amounts are always positive;
 * the kind decides the side, so nobody types a signed net (D27).
 */
export const OPENING_KIND_EFFECTS = {
  market_due: { group: "marketDue", party: "optionalStaff" },
  advance: { group: "owesUs", party: "staff", staffBalance: "advance", personKind: "distributor" },
  loan: { group: "owesUs", party: "staff", staffBalance: "loan", personKind: "distributor" },
  shortage: {
    group: "owesUs",
    party: "staff",
    staffBalance: "shortage",
    personKind: "distributor",
  },
  credit: { group: "weOwe", party: "staff", staffBalance: "credit", personKind: "distributor" },
  salary_payable: {
    group: "weOwe",
    party: "staff",
    staffBalance: "salaryPayable",
    personKind: "distributor",
  },
  sr_loan: { group: "owesUs", party: "staff", staffBalance: "srLoan", personKind: "sr" },
  owed_to_sr: { group: "weOwe", party: "staff", staffBalance: "owedToSr", personKind: "sr" },
  company_payable: { group: "companyPayable", party: "none" },
  company_advance: { group: "companyAdvance", party: "none" },
  cash: { group: "cash", party: "cashAccount" },
} as const satisfies Record<string, OpeningKindEffect>;

export type OpeningKind = keyof typeof OPENING_KIND_EFFECTS;

export type OpeningStockInput = {
  productId: string;
  pieces: string | null;
  unitCost: string | null;
  salePrice: string | null;
  orderPrice: string | null;
  dueFromCompany: string | null;
  /** The imported value, kept as evidence; a negative one is flagged for review. */
  sourcePieces?: string | null;
};

export type OpeningBalanceInput = {
  kind: OpeningKind;
  amount: string | null;
  staffId: string | null;
  cashAccountId: string | null;
  /** The person's role kind in this company; SR kinds need an SR (D18). */
  personRoleKind?: "dsr" | "sr" | "general" | null;
};

export type OpeningCheckInput = {
  cutoffDate: string | null;
  stock: readonly OpeningStockInput[];
  balances: readonly OpeningBalanceInput[];
};

export type OpeningCheckIssue = {
  code: string;
  severity: "error" | "warning";
  productId?: string;
  kind?: OpeningKind;
  staffId?: string;
  cashAccountId?: string;
};

export type OpeningCheckTotals = {
  stockPieces: string;
  stockValue: string;
  valuedRows: number;
  excludedRows: number;
  dueFromCompanyPieces: string;
  marketDue: string;
  staffOwesUs: string;
  staffWeOwe: string;
  companyPayable: string;
  cash: string;
};

const isWholeNonNegative = (value: string) => /^(0|[1-9]\d*)$/.test(value);

/**
 * Readiness checks and control totals for an opening (guide §16.1, §16.4, §16.6). Blank means
 * unknown: a product's stock must be counted or confirmed as zero before activation, and stock
 * with pieces needs a cost. Errors block approval; warnings are shown for review.
 */
export function checkOpening(input: OpeningCheckInput): {
  issues: OpeningCheckIssue[];
  totals: OpeningCheckTotals;
} {
  const issues: OpeningCheckIssue[] = [];
  if (!input.cutoffDate) issues.push({ code: "opening.issue.cutoffMissing", severity: "error" });

  let pieces = new Decimal(0);
  let value = new Decimal(0);
  let due = new Decimal(0);
  let valuedRows = 0;
  let excludedRows = 0;
  for (const line of input.stock) {
    const rowIssues: OpeningCheckIssue[] = [];
    const add = (code: string, severity: "error" | "warning") =>
      rowIssues.push({ code, severity, productId: line.productId });
    if (line.sourcePieces && toDecimal(line.sourcePieces).isNegative()) {
      add("opening.issue.sourceNegative", "warning");
    }
    if (line.pieces === null) add("opening.issue.stockUnknown", "error");
    else if (!isWholeNonNegative(line.pieces)) add("opening.issue.stockInvalid", "error");
    const hasStock = line.pieces !== null && toDecimal(line.pieces).gt(0);
    if (hasStock && line.unitCost === null) add("opening.issue.costMissing", "error");
    if (hasStock && line.salePrice === null) add("opening.issue.salePriceMissing", "warning");
    if (line.dueFromCompany !== null && !isWholeNonNegative(line.dueFromCompany)) {
      add("opening.issue.dueInvalid", "error");
    }
    issues.push(...rowIssues);

    if (line.dueFromCompany !== null && isWholeNonNegative(line.dueFromCompany)) {
      due = due.add(line.dueFromCompany);
    }
    if (rowIssues.some((i) => i.severity === "error")) {
      excludedRows++;
      continue;
    }
    if (line.pieces !== null) {
      pieces = pieces.add(line.pieces);
      if (line.unitCost !== null) value = value.add(toDecimal(line.pieces).mul(line.unitCost));
      valuedRows++;
    }
  }

  const sums: Record<Group, Decimal> = {
    marketDue: new Decimal(0),
    owesUs: new Decimal(0),
    weOwe: new Decimal(0),
    companyPayable: new Decimal(0),
    companyAdvance: new Decimal(0),
    cash: new Decimal(0),
  };
  const seen = new Set<string>();
  for (const line of input.balances) {
    const effect: OpeningKindEffect = OPENING_KIND_EFFECTS[line.kind];
    const ref = {
      kind: line.kind,
      ...(line.staffId ? { staffId: line.staffId } : {}),
      ...(line.cashAccountId ? { cashAccountId: line.cashAccountId } : {}),
    };
    const key = `${line.kind}|${line.staffId ?? ""}|${line.cashAccountId ?? ""}`;
    if (seen.has(key)) issues.push({ ...ref, code: "opening.issue.duplicate", severity: "error" });
    seen.add(key);
    if (effect.party === "staff" && !line.staffId) {
      issues.push({ ...ref, code: "opening.issue.personMissing", severity: "error" });
    }
    if (effect.party === "cashAccount" && !line.cashAccountId) {
      issues.push({ ...ref, code: "opening.issue.accountMissing", severity: "error" });
    }
    if (effect.personKind === "sr" && line.staffId && line.personRoleKind !== "sr") {
      issues.push({ ...ref, code: "opening.issue.srOnly", severity: "error" });
    }
    if (effect.personKind === "distributor" && line.personRoleKind === "sr") {
      issues.push({ ...ref, code: "opening.issue.notForSr", severity: "error" });
    }
    if (line.amount === null) {
      issues.push({ ...ref, code: "opening.issue.amountUnknown", severity: "warning" });
      continue;
    }
    sums[effect.group] = sums[effect.group].add(line.amount);
  }

  return {
    issues,
    totals: {
      stockPieces: pieces.toFixed(0),
      stockValue: roundSettlement(value),
      valuedRows,
      excludedRows,
      dueFromCompanyPieces: due.toFixed(0),
      marketDue: roundSettlement(sums.marketDue),
      staffOwesUs: roundSettlement(sums.owesUs),
      staffWeOwe: roundSettlement(sums.weOwe),
      companyPayable: roundSettlement(sums.companyPayable.sub(sums.companyAdvance)),
      cash: roundSettlement(sums.cash),
    },
  };
}

/**
 * The month engine's first opening from an activated opening (PLAN §4, §9 Phase D exit check):
 * the engine starts from exactly the entered values. Unknown values are left out, never zeroed.
 */
export function toMonthOpening(input: OpeningCheckInput): MonthOpening {
  const products: Record<string, OpeningProduct> = {};
  for (const line of input.stock) {
    products[line.productId] = {
      stock: line.pieces ?? "0",
      dueFromCompany: line.dueFromCompany ?? "0",
      ...(line.orderPrice !== null ? { orderPrice: line.orderPrice } : {}),
      ...(line.unitCost !== null ? { costPrice: line.unitCost } : {}),
      ...(line.salePrice !== null ? { salePrice: line.salePrice } : {}),
    };
  }
  const marketDue: Record<string, string> = {};
  const staff: Record<string, StaffBalances> = {};
  let companyPayable = new Decimal(0);
  for (const line of input.balances) {
    if (line.amount === null) continue;
    const effect: OpeningKindEffect = OPENING_KIND_EFFECTS[line.kind];
    if (effect.group === "marketDue") {
      const key = line.staffId ?? "";
      marketDue[key] = toDecimal(marketDue[key] ?? "0")
        .add(line.amount)
        .toString();
    } else if (effect.staffBalance && line.staffId) {
      const balances = (staff[line.staffId] ??= {});
      balances[effect.staffBalance] = toDecimal(balances[effect.staffBalance] ?? "0")
        .add(line.amount)
        .toString();
    } else if (effect.group === "companyPayable") {
      companyPayable = companyPayable.add(line.amount);
    } else if (effect.group === "companyAdvance") {
      companyPayable = companyPayable.sub(line.amount);
    }
  }
  return { products, marketDue, staff, companyPayable: companyPayable.toString() };
}
