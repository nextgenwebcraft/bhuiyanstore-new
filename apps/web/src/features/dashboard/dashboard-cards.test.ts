import { describe, expect, it } from "vitest";
import type { DashboardSummary } from "@bsd/contracts";
import { chainCards, summaryCards } from "./dashboard-page";

/** Minimal dashboard figures: held+deposit damage ≠ sheet damage (D133 vs D107). */
function summary(over: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    from: "2026-11-17",
    to: "2026-11-17",
    cutoffDate: "2026-11-01",
    netSales: "100000.00",
    salesCash: "90000.00",
    oldDuesCollected: "3332.00",
    cashCollected: "93332.00",
    marketDueCreated: "42364.00",
    marketDueOpening: "0.00",
    marketDueOutstanding: "42364.00",
    issuedValue: "150000.00",
    returnValue: "6227.04",
    commission: "0.00",
    expenses: "0.00",
    staffCost: "0.00",
    damageSaleValue: "0.00",
    damageTotal: "416.43",
    handoverShort: "0.00",
    totalCost: "0.00",
    profitCost: "0.00",
    totalSales: "143772.96",
    cashInHand: "104740.96",
    undeliveredValue: "0.00",
    stockValue: "0.00",
    salesProfit: "0.00",
    netProfit: "0.00",
    postedSummaryCount: 1,
    postedReceiptCount: 0,
    byDsr: [],
    damageLots: [],
    ...over,
  };
}

describe("dashboard cards (D107 / D133)", () => {
  it("cash chain subtracts sheet damage, not damageTotal (formula matches cashInHand)", () => {
    const d = summary({
      damageSaleValue: "100.00",
      damageTotal: "500.00",
      commission: "0.00",
      expenses: "0.00",
      staffCost: "0.00",
      marketDueCreated: "0.00",
      oldDuesCollected: "0.00",
      totalSales: "1000.00",
      cashInHand: "900.00",
    });
    const chain = chainCards(d);
    expect(chain.find((c) => c.label === "dashboard.card.sheetDamage")).toMatchObject({
      value: "100.00",
      op: "minus",
    });
    expect(chain.find((c) => c.label === "dashboard.card.damage")).toBeUndefined();
    expect(chain.find((c) => c.label === "dashboard.card.cashInHand")?.value).toBe("900.00");
  });

  it("মোট ড্যামেজ card shows all-kinds damageTotal outside the cash chain", () => {
    const d = summary({ damageTotal: "416.43", damageSaleValue: "0.00" });
    expect(summaryCards(d, true).find((c) => c.label === "dashboard.card.damage")).toMatchObject({
      value: "416.43",
    });
  });
});
