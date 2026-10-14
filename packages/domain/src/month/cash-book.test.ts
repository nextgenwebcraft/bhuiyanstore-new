import { describe, expect, it } from "vitest";
import { toMonthOpening } from "../opening";
import { computeMonth } from "./compute-month";
import { cashBookEffect, moneyKindsWithAccount } from "./money-kinds";
import type { MonthInput } from "./types";

/** D52 cash and bank book: every figure below is worked out by hand. */
const product = { id: "A", piecesPerCarton: "24" };
const base = (days: MonthInput["days"], cashAccounts?: Record<string, string>): MonthInput => ({
  products: [product],
  opening: {
    products: { A: { stock: "100", dueFromCompany: "0", costPrice: "9", salePrice: "11" } },
    ...(cashAccounts ? { cashAccounts } : {}),
  },
  days,
});

describe("cash book (D52)", () => {
  it("opens each account from the opening cash lines", () => {
    const opening = toMonthOpening({
      cutoffDate: "2026-11-01",
      stock: [],
      balances: [
        { kind: "cash", amount: "5000", staffId: null, cashAccountId: "cashbox" },
        { kind: "cash", amount: "20000", staffId: null, cashAccountId: "bank" },
      ],
    });
    expect(opening.cashAccounts).toEqual({ cashbox: "5000", bank: "20000" });
    const out = computeMonth({ products: [], opening, days: [{ date: "2026-11-01" }] });
    expect(out.closing.cashAccounts).toEqual({ cashbox: "5000", bank: "20000" });
    expect(out.month.cashBook).toEqual([
      { accountId: "cashbox", opening: "5000", in: "0", out: "0", closing: "5000" },
      { accountId: "bank", opening: "20000", in: "0", out: "0", closing: "20000" },
    ]);
  });

  it("puts the day's sales cash into the default account", () => {
    const out = computeMonth(
      base(
        [
          {
            date: "2026-11-01",
            defaultCashAccount: "cashbox",
            dsrLines: [{ staffId: "d1", productId: "A", issued: "10", returned: "2" }],
          },
        ],
        { cashbox: "100" },
      ),
    );
    // 8 pieces x 11 = 88 of sales.
    expect(out.cashEntries).toEqual([
      { date: "2026-11-01", type: "sales", account: "cashbox", in: "88", out: "0", balance: "188" },
    ]);
    expect(out.closing.cashAccounts).toEqual({ cashbox: "188" });
  });

  it("moves each money entry with a cash effect by its direction, to its own account", () => {
    const out = computeMonth(
      base(
        [
          {
            date: "2026-11-01",
            defaultCashAccount: "cashbox",
            money: [
              { kind: "expense", amount: "30", category: "operating", ref: "e1" },
              { kind: "marketDueCollected", amount: "70", staffId: "d1", account: "bkash" },
              { kind: "marketDueNew", amount: "20", staffId: "d1" },
              // No cash effect on the daily view and no account: never touches the book.
              { kind: "salaryAccrual", amount: "500", staffId: "m1" },
            ],
          },
        ],
        { cashbox: "1000" },
      ),
    );
    expect(out.month.cashBook).toEqual([
      { accountId: "cashbox", opening: "1000", in: "0", out: "50", closing: "950" }, // -30 -20
      { accountId: "bkash", opening: "0", in: "70", out: "0", closing: "70" },
    ]);
    expect(out.cashEntries.map((e) => [e.type, e.account, e.in, e.out, e.balance])).toEqual([
      ["expense", "cashbox", "0", "30", "970"],
      ["marketDueCollected", "bkash", "70", "0", "70"],
      ["marketDueNew", "cashbox", "0", "20", "950"],
    ]);
  });

  it("takes a supplier deposit out of its account without touching the daily cash left", () => {
    const out = computeMonth(
      base(
        [
          {
            date: "2026-11-01",
            defaultCashAccount: "cashbox",
            defaultDepositAccount: "bank",
            money: [
              { kind: "supplierDeposit", amount: "300" },
              { kind: "supplierDeposit", amount: "50", account: "cashbox" },
            ],
          },
        ],
        { cashbox: "100", bank: "1000" },
      ),
    );
    expect(out.closing.cashAccounts).toEqual({ cashbox: "50", bank: "700" });
    // The Excel "banking" stays outside the daily cash left; the book is the real balance.
    expect(out.days[0]?.money).toMatchObject({ cashIn: "0", cashOut: "0", cashLeft: "0" });
    expect(out.days[0]?.money.banked).toBe("350");
  });

  it("falls back to the default cash account for a deposit without a bank default", () => {
    const out = computeMonth(
      base(
        [
          {
            date: "2026-11-01",
            defaultCashAccount: "cashbox",
            money: [{ kind: "supplierDeposit", amount: "40" }],
          },
        ],
        { cashbox: "100" },
      ),
    );
    expect(out.closing.cashAccounts).toEqual({ cashbox: "60" });
  });

  it("transfers between two accounts with no cash left, profit, staff or company effect", () => {
    const out = computeMonth(
      base(
        [
          {
            date: "2026-11-01",
            defaultCashAccount: "cashbox",
            money: [{ kind: "cashTransfer", amount: "400", account: "cashbox", toAccount: "bank" }],
          },
        ],
        { cashbox: "1000", bank: "0" },
      ),
    );
    expect(out.closing.cashAccounts).toEqual({ cashbox: "600", bank: "400" });
    expect(out.cashEntries.map((e) => [e.account, e.in, e.out, e.counterAccount])).toEqual([
      ["cashbox", "0", "400", "bank"],
      ["bank", "400", "0", "cashbox"],
    ]);
    expect(out.days[0]?.money).toMatchObject({ cashIn: "0", cashOut: "0", cashLeft: "0" });
    expect(out.month.profit.net).toBe("0");
    expect(out.month.companyPayable.closing).toBe("0");
    expect(out.staffEntries).toEqual([]);
    expect(out.companyEntries).toEqual([]);
  });

  it("refuses a transfer to the same account or without a destination", () => {
    const transfer = (toAccount?: string) =>
      computeMonth(
        base([
          {
            date: "2026-11-01",
            money: [
              {
                kind: "cashTransfer",
                amount: "1",
                account: "a",
                ...(toAccount === undefined ? {} : { toAccount }),
              },
            ],
          },
        ]),
      );
    expect(() => transfer("a")).toThrow(RangeError);
    expect(() => transfer()).toThrow(RangeError);
  });

  it('uses the "" bucket when the company has no account at all', () => {
    const out = computeMonth(
      base([
        {
          date: "2026-11-01",
          dsrLines: [{ staffId: "d1", productId: "A", issued: "10" }],
          money: [{ kind: "expense", amount: "10", category: "operating" }],
        },
      ]),
    );
    expect(out.closing.cashAccounts).toEqual({ "": "100" }); // 110 of sales - 10
  });

  it("carries the closing into the next month as exactly its opening", () => {
    const days = [
      {
        date: "2026-11-01",
        defaultCashAccount: "cashbox",
        dsrLines: [{ staffId: "d1", productId: "A", issued: "10" }],
        money: [{ kind: "cashTransfer", amount: "50", account: "cashbox", toAccount: "bank" }],
      },
      {
        date: "2026-11-02",
        defaultCashAccount: "cashbox",
        money: [{ kind: "supplierDeposit", amount: "20", account: "bank" }],
      },
    ] as const;
    const whole = computeMonth(base([...days], { cashbox: "10" }));
    const first = computeMonth(base([days[0]], { cashbox: "10" }));
    const second = computeMonth({
      ...base([days[1]]),
      opening: first.closing,
    });
    expect(second.closing.cashAccounts).toEqual(whole.closing.cashAccounts);
    expect(whole.closing.cashAccounts).toEqual({ cashbox: "70", bank: "30" });
    // Closing = opening + movements, account by account.
    for (const a of whole.month.cashBook) {
      const opening = Number(a.opening);
      expect(String(opening + Number(a.in) - Number(a.out))).toBe(a.closing);
    }
  });

  it("starts accounts at 0 and warns once for a snapshot stored before the cash book", () => {
    const out = computeMonth({
      products: [],
      opening: { products: {}, cashSnapshotMissing: true },
      days: [
        { date: "2026-12-01", money: [{ kind: "expense", amount: "5", category: "operating" }] },
        { date: "2026-12-02" },
      ],
    });
    expect(out.warnings).toEqual([{ code: "CASH_SNAPSHOT_MISSING", date: "2026-12-01" }]);
    expect(out.closing.cashAccounts).toEqual({ "": "-5" });
  });

  it("lists the kinds that move an account", () => {
    expect(cashBookEffect("expense")).toBe(-1);
    expect(cashBookEffect("marketDueCollected")).toBe(1);
    expect(cashBookEffect("supplierDeposit")).toBe(-1);
    expect(cashBookEffect("cashTransfer")).toBe("transfer");
    expect(cashBookEffect("salaryAccrual")).toBe(0);
    expect(cashBookEffect("staffCostPaid")).toBe(0);
    expect(cashBookEffect("companyIncentive")).toBe(0);
    expect(moneyKindsWithAccount).toContain("cashTransfer");
    expect(moneyKindsWithAccount).not.toContain("companyIncentive");
  });
});

describe("SR owed is an accrued SR incentive (D55)", () => {
  const sr = (money: NonNullable<MonthInput["days"][number]["money"]>) =>
    computeMonth({
      products: [],
      opening: { products: {} },
      days: [{ date: "2026-11-01", money }],
    });

  it("srOwed is an expense and raises what we owe the SR, with no cash", () => {
    const out = sr([{ kind: "srOwed", amount: "300", staffId: "s1" }]);
    expect(out.month.profit.srIncentive).toBe("300");
    expect(out.month.profit.net).toBe("-300");
    expect(out.month.profit.netWithoutIncentive).toBe("0");
    expect(out.closing.staff.s1?.owedToSr).toBe("300");
    expect(out.days[0]?.money).toMatchObject({ cashOut: "0", cashLeft: "0", srIncentive: "300" });
    expect(out.closing.cashAccounts).toEqual({});
  });

  it("srPayment lowers what we owe with cash out and no expense", () => {
    const out = sr([
      { kind: "srOwed", amount: "300", staffId: "s1" },
      { kind: "srPayment", amount: "100", staffId: "s1" },
    ]);
    expect(out.month.profit.srIncentive).toBe("300"); // only the accrual
    expect(out.closing.staff.s1?.owedToSr).toBe("200");
    expect(out.days[0]?.money).toMatchObject({ cashOut: "100", cashLeft: "-100" });
    expect(out.closing.cashAccounts).toEqual({ "": "-100" });
  });

  it("srIncentive paid directly in cash is unchanged", () => {
    const out = sr([{ kind: "srIncentive", amount: "80" }]);
    expect(out.month.profit.srIncentive).toBe("80");
    expect(out.days[0]?.money).toMatchObject({ cashOut: "80" });
  });
});

describe("company money incentive stays out of profit and the book (rule 6)", () => {
  it("lowers the company payable only", () => {
    const out = computeMonth({
      products: [],
      opening: { products: {}, companyPayable: "1000" },
      days: [{ date: "2026-11-01", money: [{ kind: "companyIncentive", amount: "120" }] }],
    });
    expect(out.month.companyPayable.closing).toBe("880");
    expect(out.month.profit.net).toBe("0");
    expect(out.closing.cashAccounts).toEqual({});
  });
});
