import { describe, expect, it } from "vitest";
import { capitalDays, capitalStats } from "./capital";
import { computeMonth } from "./compute-month";
import { monthKhoroch, monthNetProfit } from "./monthly-summary";
import { cashPay, proposeRecovery, salaryAfterAbsence } from "./payroll";

const day = (
  date: string,
  due: string,
  stock: string,
  marketDueNew: string,
  marketDueCollected = "0",
) => ({
  date,
  products: [
    { dueFromCompanyValue: due, stockValue: stock },
    { dueFromCompanyValue: "0", stockValue: "100" },
  ],
  money: { marketDueNew, marketDueCollected },
});

describe("capital per day (D150)", () => {
  it("adds undelivered + stock + the walked market due at each day end", () => {
    const rows = capitalDays(
      [day("2026-11-01", "500", "1000", "200"), day("2026-11-02", "0", "1400", "50", "150")],
      "300",
    );
    expect(rows).toEqual([
      {
        date: "2026-11-01",
        undelivered: "500.00",
        stock: "1100.00",
        marketDue: "500.00",
        total: "2100.00",
      },
      {
        date: "2026-11-02",
        undelivered: "0.00",
        stock: "1500.00",
        marketDue: "400.00",
        total: "1900.00",
      },
    ]);
  });

  it("averages the days and finds the lowest and highest day", () => {
    const rows = capitalDays(
      [
        day("2026-11-01", "0", "900", "0"),
        day("2026-11-02", "0", "1900", "0"),
        day("2026-11-03", "0", "400", "0"),
      ],
      "0",
    );
    expect(capitalStats(rows)).toEqual({
      days: 3,
      average: { undelivered: "0.00", stock: "1166.67", marketDue: "0.00", total: "1166.67" },
      lowest: { date: "2026-11-03", total: "500.00" },
      highest: { date: "2026-11-02", total: "2000.00" },
    });
    expect(capitalStats([])).toBeNull();
  });

  it("ends on the engine's own month closing", () => {
    const out = computeMonth({
      products: [{ id: "A", piecesPerCarton: "24" }],
      opening: {
        products: {
          A: {
            stock: "10",
            dueFromCompany: "5",
            orderPrice: "20",
            costPrice: "20",
            salePrice: "25",
          },
        },
        marketDue: { d1: "1000" },
        staff: {},
      },
      days: [
        { date: "2026-11-01", money: [{ kind: "marketDueNew", amount: "300", staffId: "d1" }] },
        {
          date: "2026-11-02",
          money: [{ kind: "marketDueCollected", amount: "100", staffId: "d1" }],
        },
      ],
    });
    const rows = capitalDays(out.days, out.month.marketDue.opening);
    const last = rows.at(-1);
    expect(last?.marketDue).toBe("1200.00");
    expect(Number(last?.marketDue)).toBe(Number(out.month.marketDue.closing));
    expect(Number(last?.undelivered)).toBe(Number(out.month.companyPayable.undeliveredClosing));
  });
});

describe("month khoroch (D148)", () => {
  const roles = new Map([
    ["m1", { roleId: "rm", roleName: "ম্যানেজার" }],
    ["d1", { roleId: "rd", roleName: "ডিএসআর" }],
    ["v1", { roleId: "rv", roleName: "ড্রাইভার" }],
  ]);

  it("splits salary and staff expenses by role; advances and absent fees are not khoroch", () => {
    const k = monthKhoroch(
      [
        { kind: "expense", amount: "700" },
        { kind: "salaryAccrual", amount: "12000", staffId: "m1" },
        { kind: "salaryAccrual", amount: "10633.34", staffId: "d1" },
        { kind: "staffCostPaid", amount: "150", staffId: "d1" },
        { kind: "staffAdvance", amount: "1292", staffId: "d1" },
        { kind: "staffShortage", amount: "1321", staffId: "d1" },
        { kind: "staffAbsent", amount: "366.66", staffId: "d1" },
        { kind: "salaryRecovery", amount: "2613", staffId: "d1" },
        { kind: "salaryPaid", amount: "8020.34", staffId: "d1" },
        { kind: "staffCostPaid", amount: "400", staffId: "v1" },
      ],
      roles,
    );
    expect(k.operating).toBe("700.00");
    expect(k.roles).toEqual([
      {
        roleId: "rm",
        roleName: "ম্যানেজার",
        salary: "12000.00",
        expenses: "0.00",
        total: "12000.00",
        staff: [{ staffId: "m1", salary: "12000.00", expenses: "0.00", total: "12000.00" }],
      },
      {
        roleId: "rd",
        roleName: "ডিএসআর",
        salary: "10633.34",
        expenses: "150.00",
        total: "10783.34",
        staff: [{ staffId: "d1", salary: "10633.34", expenses: "150.00", total: "10783.34" }],
      },
      {
        roleId: "rv",
        roleName: "ড্রাইভার",
        salary: "0.00",
        expenses: "400.00",
        total: "400.00",
        staff: [{ staffId: "v1", salary: "0.00", expenses: "400.00", total: "400.00" }],
      },
    ]);
    expect(k.staffTotal).toBe("23183.34");
    expect(monthNetProfit("30000", k)).toBe("6116.66");
  });
});

describe("salary with absent fee (screenshot: Sojib)", () => {
  it("absent fee only lowers the payable; recovery comes from advance and shortage", () => {
    const net = salaryAfterAbsence("11000", "366.66");
    expect(net).toBe("10633.34");
    const recovery = proposeRecovery(net, { advance: "1292", loan: "0", shortage: "1321" });
    expect(recovery).toEqual({ advance: "1292", loan: "0", shortage: "1321" });
    expect(cashPay(net, recovery)).toBe("8020.34");
  });
});
