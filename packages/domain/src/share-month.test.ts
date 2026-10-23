import { describe, expect, it } from "vitest";
import { sumAmounts } from "./sales";
import { shareMonth, shareYearIncome } from "./share-month";

const company = (
  profit: string,
  khoroch: string,
  danBasis: "net" | "profit" = "net",
) => ({ companyId: "c", companyName: "Pusti", profit, khoroch, danBasis });

describe("share month (D76)", () => {
  it("takes 2% of the net, matching the Pusti sheet", () => {
    const month = shareMonth({
      companies: [company("153733", "62065")],
      shareholders: [{ shareholderId: "a", name: "A", units: "1" }],
    });
    expect(month.companies[0]).toMatchObject({ dan: "1833.36", total: "89834.64" });
    expect(month.shareholders[0]?.income).toBe("89834.64");
    expect(month.totals.unallocated).toBe("0.00");
  });

  it("takes 2% of the profit when the company says so, matching the noodles sheet", () => {
    const month = shareMonth({
      companies: [company("22732", "16634", "profit")],
      shareholders: [],
    });
    expect(month.companies[0]).toMatchObject({ dan: "454.64", total: "5643.36" });
    expect(month.totals.unallocated).toBe("5643.36");
  });

  it("keeps a loss negative, matching the Fresh sheet", () => {
    const month = shareMonth({
      companies: [company("44309", "50697")],
      shareholders: [{ shareholderId: "a", name: "A", units: "8.5" }],
    });
    expect(month.companies[0]).toMatchObject({ dan: "-127.76", total: "-6260.24" });
    expect(month.shareholders[0]?.income).toBe("-6260.24");
  });

  it("splits fractional units and puts the paisa remainder on the largest holding", () => {
    const month = shareMonth({
      companies: [company("110", "0")],
      shareholders: [
        { shareholderId: "b", name: "B", units: "1" },
        { shareholderId: "a", name: "A", units: "1" },
        { shareholderId: "c", name: "C", units: "1" },
      ],
    });
    // Net 110, দান 2.20, distributable 107.80. 107.80 / 3 = 35.9333… → 35.93, remainder 0.01.
    expect(month.totals.distributable).toBe("107.80");
    expect(month.shareholders.map((holder) => holder.income)).toEqual(["35.93", "35.94", "35.93"]);
    expect(sumAmounts(month.shareholders.map((holder) => holder.income))).toBe("107.80");
  });

  it("leaves the profit unallocated when nobody holds units", () => {
    const month = shareMonth({
      companies: [company("100", "0")],
      shareholders: [{ shareholderId: "a", name: "A", units: "0" }],
    });
    expect(month.shareholders[0]?.income).toBe("0.00");
    expect(month.totals.perUnit).toBe("0.00");
    expect(month.totals.unallocated).toBe("98.00");
  });

  it("sums a person's income across the months", () => {
    const january = shareMonth({
      companies: [company("100", "0")],
      shareholders: [{ shareholderId: "a", name: "A", units: "1" }],
    });
    const february = shareMonth({
      companies: [company("50", "0")],
      shareholders: [{ shareholderId: "a", name: "A", units: "1" }],
    });
    expect(shareYearIncome([january, february])).toEqual([
      { shareholderId: "a", income: "147.00" },
    ]);
  });
});
