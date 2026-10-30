import { describe, expect, it } from "vitest";
import { srCost } from "./day-summary";
import { dashboardTotals, salesProfit } from "./sales-profit";
import { MONEY_KIND_EFFECTS, staffCost } from "./money-kinds";
import { cashPay, proposeRecovery, salaryAfterAbsence } from "./payroll";

describe("staff cost (D67)", () => {
  it("counts money paid out for staff, net of what came back", () => {
    expect(
      staffCost([
        { kind: "staffAdvance", amount: "3000" },
        { kind: "staffShortage", amount: "500" },
        { kind: "staffRepayment", amount: "1000" },
        { kind: "salaryPaid", amount: "7500" },
        { kind: "srLoan", amount: "900" },
        { kind: "staffAbsent", amount: "400" },
      ]),
    ).toBe("10000");
  });

  it("works out the DSR-line profit part by part (D69)", () => {
    const parts = salesProfit([
      {
        issued: "100",
        returned: "10",
        damaged: "5",
        commission: "50",
        salePrice: "25",
        costPrice: "20",
      },
    ]);
    // D74: 2500 − 250 − 50 − 90 × 20 − 5 × (25 − 20) = 375; মোট বিক্রি 2500 − 250 − 125 − 50.
    expect(parts).toMatchObject({
      delivered: "90",
      issuedValue: "2500.00",
      returnValue: "250.00",
      damageValue: "125.00",
      commission: "50.00",
      netSales: "2075.00",
      deliveredCost: "1800.00",
      damageMargin: "25.00",
      profit: "375.00",
    });
  });

  it("totals the dashboard costs and the cash chain (D69, D106, D107)", () => {
    expect(
      dashboardTotals({
        issuedValue: "2500",
        returnValue: "250",
        damageSaleValue: "125",
        commission: "50",
        expenses: "400",
        staffCost: "1000",
        marketDueCreated: "200",
        oldDuesCollected: "80",
        salesProfit: "250",
      }),
    ).toEqual({
      totalCost: "1450.00",
      profitCost: "1400.00",
      // মোট বিক্রি = 2500 − 250. হাতে জমা = 2250 − 125 − 50 − 400 − 1000 − 200 + 80.
      totalSales: "2250.00",
      cashInHand: "555.00",
      netProfit: "-1150.00",
    });
  });

  it("counts a single day's SR loan change, a longer range's SR loan at its end", () => {
    const staff = [
      { opening: { srLoan: "8000" }, closing: { srLoan: "10000" } },
      { opening: { srLoan: "5000" }, closing: { srLoan: "4500" } },
    ];
    expect(srCost(staff, true)).toBe("1500.00");
    expect(srCost(staff, false)).toBe("14500.00");
    expect(srCost(staff.slice(1), true)).toBe("-500.00");
  });

  it("takes the absent fee off the salary, never below zero", () => {
    expect(salaryAfterAbsence("10000", "400")).toBe("9600");
    expect(salaryAfterAbsence("300", "400")).toBe("0");
    const net = salaryAfterAbsence("10000", "400");
    expect(cashPay(net, proposeRecovery(net, { advance: "2000", shortage: "500" }))).toBe("7100");
  });

  it("keeps the absent fee out of cash and balances", () => {
    expect(MONEY_KIND_EFFECTS.staffAbsent).toEqual({ cash: 0, requiresStaff: true });
  });
});
