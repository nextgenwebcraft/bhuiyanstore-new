import { describe, expect, it } from "vitest";
import { dashboardChain } from "./day-summary";
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

  it("chains the dashboard to net balance and net profit", () => {
    expect(
      dashboardChain({
        issuedValue: "10000",
        returnValue: "1500",
        damageSaleValue: "200",
        commission: "300",
        expenses: "400",
        staffCost: "1000",
        srCost: "100",
        costOfSold: "5000",
      }),
    ).toEqual({ netBalance: "6500.00", netProfit: "1500.00" });
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
