import { describe, expect, it } from "vitest";
import { computeMonth } from "./compute-month";
import type { MonthInput } from "./types";

/** Synthetic golden month; every expected value below was worked out by hand from PLAN §2. */
const golden: MonthInput = {
  products: [
    { id: "A", piecesPerCarton: "24" },
    { id: "B", piecesPerCarton: "12" },
  ],
  opening: {
    products: {
      A: {
        stock: "100",
        dueFromCompany: "50",
        orderPrice: "10",
        costPrice: "9.5",
        salePrice: "11",
      },
      B: { stock: "0", dueFromCompany: "0" },
    },
    marketDue: { d1: "200" },
    staff: { d1: { shortage: "30" } },
    companyPayable: "1000",
  },
  days: [
    {
      date: "2026-11-01",
      products: {
        A: { received: "48", damaged: "2" },
        B: { ordered: "24", orderPrice: "20", costPrice: "19", salePrice: "22.5" },
      },
      dsrLines: [
        { staffId: "d1", productId: "A", issued: "60", returned: "12" },
        { staffId: "d2", productId: "A", issued: "24" },
      ],
      money: [
        { kind: "marketDueNew", amount: "100", staffId: "d1" },
        { kind: "marketDueCollected", amount: "50", staffId: "d1" },
        { kind: "srIncentive", amount: "20" },
        { kind: "expense", amount: "30", category: "operating" },
        { kind: "staffAdvance", amount: "40", staffId: "m1" },
        { kind: "staffRepayment", amount: "10", staffId: "d1" },
      ],
    },
    {
      date: "2026-11-02",
      products: { A: { salePrice: "12" }, B: { received: "24" } },
      dsrLines: [
        {
          staffId: "d1",
          productId: "B",
          issued: "12",
          priceSplits: [{ quantity: "2", unitPrice: "20" }],
        },
        { staffId: "d1", productId: "A", issued: "24", returned: "4", damaged: "1" },
      ],
      money: [
        { kind: "supplierDeposit", amount: "500" },
        { kind: "staffShortage", amount: "15", staffId: "d2" },
        { kind: "salaryAccrual", amount: "1000", staffId: "m1" },
        { kind: "salaryRecovery", amount: "40", staffId: "m1" },
        { kind: "staffExcess", amount: "5", staffId: "d2" },
      ],
    },
  ],
};

describe("computeMonth golden month", () => {
  const out = computeMonth(golden);
  const [day1, day2] = out.days;

  it("gives each DSR's day money for the cash check (D39)", () => {
    expect(day1?.dsrs).toEqual([
      { staffId: "d1", sales: "528", marketDueNew: "100", marketDueCollected: "50", costPaid: "0" },
      { staffId: "d2", sales: "264", marketDueNew: "0", marketDueCollected: "0", costPaid: "0" },
    ]);
    // Day 2: B 12 sold at 22.5 with 2 at 20 (−5); A 24 − 4 − 1 = 19 at 12.
    expect(day2?.dsrs).toEqual([
      { staffId: "d1", sales: "493", marketDueNew: "0", marketDueCollected: "0", costPaid: "0" },
    ]);
    expect(day2?.persons.find((p) => p.productId === "A")).toMatchObject({
      sold: "19",
      soldValue: "228",
      amount: "240",
    });
  });

  it("calculates each day's product block like the workbook", () => {
    expect(day1?.products[0]).toMatchObject({
      productId: "A",
      issued: "84",
      returned: "12",
      delivered: "72",
      damaged: "2",
      sold: "70",
      sales: "770",
      cost: "665",
      grossProfit: "105",
      dueFromCompany: "2",
      stock: "76",
      stockValue: "722",
      receiptBill: "480",
      returnValue: "132",
      damageValue: "19",
    });
    expect(day1?.products[1]).toMatchObject({ dueFromCompany: "24", orderValue: "480" });
    expect(day2?.products[0]).toMatchObject({
      salePrice: "12",
      costPrice: "9.5",
      sold: "19",
      sales: "228",
      cost: "180.5",
      grossProfit: "47.5",
      stock: "56",
      dueFromCompany: "2",
    });
    expect(day2?.products[1]).toMatchObject({
      dueFromCompany: "0",
      stock: "12",
      sales: "265",
      cost: "228",
      grossProfit: "37",
      receiptBill: "480",
    });
  });

  it("calculates each person's net and amount, including price splits", () => {
    expect(day1?.persons).toEqual([
      expect.objectContaining({ staffId: "d1", productId: "A", net: "48", amount: "528" }),
      expect.objectContaining({ staffId: "d2", productId: "A", net: "24", amount: "264" }),
    ]);
    expect(day2?.persons[0]).toMatchObject({ staffId: "d1", productId: "B", amount: "265" });
    const d1 = out.month.persons.find((p) => p.staffId === "d1");
    expect(d1?.amount).toBe("1033");
    expect(d1?.products).toContainEqual({
      productId: "A",
      net: "68",
      cartons: "2.833333",
      amount: "768",
    });
  });

  it("derives daily cash left from sales and typed money entries", () => {
    expect(day1?.money).toMatchObject({
      sales: "770",
      cashIn: "60",
      cashOut: "190",
      cashLeft: "640",
      banked: "0",
    });
    expect(day2?.money).toMatchObject({ sales: "493", cashLeft: "483", banked: "500" });
    expect(out.month.cashLeftTotal).toBe("1123");
  });

  it("calculates month totals, profit and balances", () => {
    expect(out.month.products[0]).toMatchObject({
      salesTotal: "998",
      costTotal: "845.5",
      profitTotal: "152.5",
      salesCartons: "3.833333",
      closingStock: "56",
      closingValue: "532",
      closingAtSale: "672",
      closingCartons: "2.333333",
    });
    expect(out.month.profit).toEqual({
      gross: "189.5",
      salaries: "1000",
      expenses: "30",
      expensesByCategory: { operating: "30" },
      srIncentive: "20",
      net: "-860.5",
      netWithoutIncentive: "-840.5",
    });
    expect(out.month.marketDue).toMatchObject({
      opening: "200",
      added: "100",
      collected: "50",
      closing: "250",
    });
    expect(out.month.companyPayable).toEqual({
      opening: "1000",
      receipts: "960",
      deposits: "500",
      incentives: "0",
      damageRefunds: "0",
      closing: "1460",
    });
    const staff = Object.fromEntries(out.month.staff.map((s) => [s.staffId, s]));
    expect(staff.d1?.closing.shortage).toBe("20");
    expect(staff.m1?.closing).toMatchObject({ advance: "0", salaryPayable: "960" });
    expect(staff.d2).toMatchObject({ owesUs: "15", weOwe: "5" });
    expect(out.warnings).toEqual([]);
  });

  it("tracks shop due alongside the DSR's market due and the day's cash (D35)", () => {
    const out = computeMonth({
      products: [],
      opening: { products: {}, marketDue: { d1: "100" }, shopDue: { s1: "100" } },
      days: [
        {
          date: "2026-11-01",
          money: [
            { kind: "marketDueNew", amount: "80", staffId: "d1", shopId: "s1", ref: "e1" },
            { kind: "marketDueNew", amount: "20", staffId: "d1", shopId: "s2", ref: "e2" },
          ],
        },
        {
          date: "2026-11-02",
          money: [
            { kind: "marketDueCollected", amount: "150", staffId: "d1", shopId: "s1", ref: "e3" },
          ],
        },
      ],
    });
    expect(out.days.map((d) => d.money.cashLeft)).toEqual(["-100", "150"]);
    expect(out.month.marketDue.closing).toBe("50");
    expect(out.month.marketDue.byShop).toEqual([
      { shopId: "s1", opening: "100", added: "80", collected: "150", closing: "30" },
      { shopId: "s2", opening: "0", added: "20", collected: "0", closing: "20" },
    ]);
    expect(out.closing.shopDue).toEqual({ s1: "30", s2: "20" });
    expect(out.shopEntries.map((e) => [e.ref, e.shopId, e.balance])).toEqual([
      ["e1", "s1", "180"],
      ["e2", "s2", "20"],
      ["e3", "s1", "30"],
    ]);
  });

  it("produces a closing that is the next month's opening", () => {
    expect(out.closing.products.A).toEqual({
      stock: "56",
      dueFromCompany: "2",
      orderPrice: "10",
      costPrice: "9.5",
      salePrice: "12",
    });
    const [first, second] = golden.days;
    if (!first || !second) throw new Error("fixture");
    const split = computeMonth({
      ...golden,
      opening: computeMonth({ ...golden, days: [first] }).closing,
      days: [second],
    });
    expect(split.closing).toEqual(out.closing);
  });
});

describe("computeMonth company account (D33)", () => {
  const out = computeMonth({
    products: [{ id: "A", piecesPerCarton: "24" }],
    opening: {
      products: { A: { stock: "10", dueFromCompany: "48", orderPrice: "10", costPrice: "9" } },
      companyPayable: "1000",
    },
    days: [
      {
        date: "2026-11-01",
        products: { A: { received: "48", companyRefunds: [{ quantity: "5", unitCost: "9.5" }] } },
        money: [
          { kind: "supplierDeposit", amount: "300", ref: "dep" },
          { kind: "companyIncentive", amount: "120", ref: "inc" },
        ],
      },
    ],
  });

  it("lowers what we owe by deposits, cash incentives and damage money returns", () => {
    expect(out.month.companyPayable).toEqual({
      opening: "1000",
      receipts: "480",
      deposits: "300",
      incentives: "120",
      damageRefunds: "47.5",
      closing: "1012.5",
    });
    expect(out.closing.companyPayable).toBe("1012.5");
  });

  it("keeps cash, banked, stock and profit out of incentives and refunds", () => {
    expect(out.days[0]?.money).toMatchObject({ cashIn: "0", cashOut: "0", banked: "300" });
    expect(out.days[0]?.products[0]).toMatchObject({ stock: "58", grossProfit: "0" });
    expect(out.month.profit.gross).toBe("0");
  });

  it("lists every movement with the balance after it", () => {
    expect(out.companyEntries).toEqual([
      { date: "2026-11-01", kind: "receipt", amount: "480", balance: "1480" },
      {
        date: "2026-11-01",
        kind: "damageRefund",
        amount: "47.5",
        productId: "A",
        balance: "1432.5",
      },
      { date: "2026-11-01", kind: "deposit", amount: "300", ref: "dep", balance: "1132.5" },
      { date: "2026-11-01", kind: "incentive", amount: "120", ref: "inc", balance: "1012.5" },
    ]);
  });
});

describe("computeMonth free goods (D16)", () => {
  const out = computeMonth({
    products: [{ id: "A", piecesPerCarton: "24" }],
    opening: {
      products: { A: { stock: "10", dueFromCompany: "48", orderPrice: "10", costPrice: "9" } },
      companyPayable: "1000",
    },
    days: [{ date: "2026-11-01", products: { A: { incentiveReceived: "24" } } }],
  });

  it("adds saleable stock with no bill, no due from company and no payable", () => {
    expect(out.days[0]?.products[0]).toMatchObject({
      stock: "34",
      incentiveReceived: "24",
      received: "0",
      receiptBill: "0",
      dueFromCompany: "48",
    });
    expect(out.month.products[0]).toMatchObject({ incentiveReceived: "24", receiptTotal: "0" });
    expect(out.month.companyPayable.closing).toBe("1000");
  });

  it("shows a memo line without an amount on the company ledger", () => {
    expect(out.companyEntries).toEqual([
      {
        date: "2026-11-01",
        kind: "freeGoods",
        amount: "0",
        productId: "A",
        quantity: "24",
        balance: "1000",
      },
    ]);
  });
});

describe("computeMonth data problems", () => {
  const base: MonthInput = {
    products: [{ id: "A", piecesPerCarton: "24" }],
    opening: { products: { A: { stock: "5", dueFromCompany: "0" } } },
    days: [],
  };

  it("warns on negative stock and missing prices instead of failing", () => {
    const out = computeMonth({
      ...base,
      days: [{ date: "2026-11-01", dsrLines: [{ staffId: "d1", productId: "A", issued: "10" }] }],
    });
    expect(out.days[0]?.products[0]?.stock).toBe("-5");
    expect(out.warnings.map((w) => w.code)).toEqual([
      "MISSING_PRICE",
      "MISSING_PRICE",
      "NEGATIVE_STOCK",
    ]);
  });

  it("moves a repayment beyond what is owed to staff credit with a warning", () => {
    const out = computeMonth({
      ...base,
      opening: { ...base.opening, staff: { s1: { advance: "10", loan: "5" } } },
      days: [
        {
          date: "2026-11-01",
          money: [{ kind: "staffRepayment", amount: "20", staffId: "s1" }],
        },
      ],
    });
    expect(out.closing.staff.s1).toMatchObject({ advance: "0", loan: "0", credit: "5" });
    expect(out.warnings[0]).toMatchObject({ code: "REPAYMENT_EXCEEDS_DUE", detail: "5" });
  });

  it("honours an explicit recovery allocation", () => {
    const out = computeMonth({
      ...base,
      opening: { ...base.opening, staff: { s1: { advance: "10", shortage: "10" } } },
      days: [
        {
          date: "2026-11-01",
          money: [
            { kind: "salaryAccrual", amount: "100", staffId: "s1" },
            {
              kind: "salaryRecovery",
              amount: "8",
              staffId: "s1",
              allocation: { shortage: "8" },
            },
          ],
        },
      ],
    });
    expect(out.closing.staff.s1).toMatchObject({
      advance: "10",
      shortage: "2",
      salaryPayable: "92",
    });
  });

  it("rejects malformed input", () => {
    expect(() =>
      computeMonth({ ...base, days: [{ date: "2026-11-02" }, { date: "2026-11-01" }] }),
    ).toThrow(/ascending/);
    expect(() =>
      computeMonth({
        ...base,
        days: [{ date: "2026-11-01", dsrLines: [{ staffId: "d1", productId: "X", issued: "1" }] }],
      }),
    ).toThrow(/unknown product/);
    expect(() =>
      computeMonth({
        ...base,
        days: [{ date: "2026-11-01", money: [{ kind: "staffAdvance", amount: "1" }] }],
      }),
    ).toThrow(/requires staffId/);
    expect(() =>
      computeMonth({
        ...base,
        days: [
          {
            date: "2026-11-01",
            dsrLines: [
              {
                staffId: "d1",
                productId: "A",
                issued: "2",
                priceSplits: [{ quantity: "3", unitPrice: "1" }],
              },
            ],
          },
        ],
      }),
    ).toThrow(/price splits exceed/);
  });
});

describe("shop commission on DSR lines (D41)", () => {
  const out = computeMonth({
    products: [{ id: "A", piecesPerCarton: "24" }],
    opening: {
      products: { A: { stock: "100", dueFromCompany: "0", costPrice: "9", salePrice: "11" } },
    },
    days: [
      {
        date: "2026-11-01",
        dsrLines: [
          { staffId: "d1", productId: "A", issued: "24", returned: "4", commission: "15.5" },
          { staffId: "d2", productId: "A", issued: "10", commission: "0" },
        ],
      },
    ],
  });
  const day = out.days[0];

  it("takes the commission out of the line's sold value, sales, cash and profit", () => {
    // d1: 20 × 11 = 220 − 15.5; d2: 10 × 11 = 110.
    expect(day?.persons[0]).toMatchObject({
      commission: "15.5",
      soldValue: "204.5",
      amount: "204.5",
    });
    expect(day?.dsrs[0]).toMatchObject({ staffId: "d1", sales: "204.5" });
    expect(day?.products[0]).toMatchObject({
      sold: "30",
      commission: "15.5",
      sales: "314.5",
      cost: "270",
      grossProfit: "44.5",
    });
    expect(day?.money).toMatchObject({ sales: "314.5", commission: "15.5", cashLeft: "314.5" });
    expect(out.month.totals).toMatchObject({ commissionTotal: "15.5", salesTotal: "314.5" });
  });

  it("refuses a negative commission", () => {
    expect(() =>
      computeMonth({
        products: [{ id: "A", piecesPerCarton: "1" }],
        opening: { products: {} },
        days: [
          { date: "2026-11-01", dsrLines: [{ staffId: "d1", productId: "A", commission: "-1" }] },
        ],
      }),
    ).toThrow(/commission must not be negative/);
  });
});

describe("computeMonth goods due floors at 0 (D46)", () => {
  const run = (opening: string, days: MonthInput["days"]) =>
    computeMonth({
      products: [{ id: "A", piecesPerCarton: "24" }],
      opening: {
        products: { A: { stock: "0", dueFromCompany: opening, orderPrice: "10", costPrice: "9" } },
        companyPayable: "0",
      },
      days,
    });

  it("leaves a normal partial receipt unchanged", () => {
    const out = run("0", [
      { date: "2026-11-01", products: { A: { ordered: "48", received: "20" } } },
    ]);
    expect(out.days[0]?.products[0]?.dueFromCompany).toBe("28");
    expect(out.closing.products.A?.dueFromCompany).toBe("28");
  });

  it("floors an excess receipt at 0 and still bills every received piece", () => {
    const out = run("10", [{ date: "2026-11-01", products: { A: { received: "30" } } }]);
    expect(out.days[0]?.products[0]?.dueFromCompany).toBe("0");
    expect(out.closing.products.A?.dueFromCompany).toBe("0");
    expect(out.month.totals.receiptTotal).toBe("300");
    expect(out.month.companyPayable.receipts).toBe("300");
    expect(out.month.companyPayable.closing).toBe("300");
  });

  it("does not let an excess receipt offset a later order", () => {
    const out = run("0", [
      { date: "2026-11-01", products: { A: { received: "20" } } },
      { date: "2026-11-02", products: { A: { ordered: "24" } } },
    ]);
    expect(out.days[0]?.products[0]?.dueFromCompany).toBe("0");
    expect(out.days[1]?.products[0]?.dueFromCompany).toBe("24");
    expect(out.closing.products.A?.dueFromCompany).toBe("24");
  });

  it("treats a negative opening due as 0", () => {
    const out = run("-5", [{ date: "2026-11-01", products: { A: { ordered: "6" } } }]);
    expect(out.closing.products.A?.dueFromCompany).toBe("6");
  });
});
