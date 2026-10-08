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
