import { describe, expect, it } from "vitest";
import {
  companyHishabMonth,
  danOf,
  distributableProfit,
  investShare,
  previousDueOpenTotal,
  profitPerLakh,
} from "./company-hishab";

const company = (profit: string, khoroch: string) => ({
  companyId: "c",
  companyName: "Pusti",
  profit,
  khoroch,
});

describe("company hishab month", () => {
  it("takes 2% of the net, matching the Pusti sheet", () => {
    const [row] = companyHishabMonth([company("153733", "62065")]);
    expect(row).toMatchObject({ dan: "1833.36", totalProfit: "89834.64" });
  });

  it("keeps a loss negative, matching the Fresh sheet", () => {
    const [row] = companyHishabMonth([company("44309", "50697")]);
    expect(row).toMatchObject({ dan: "-127.76", totalProfit: "-6260.24" });
  });

  it("is always net basis, with no per-company override", () => {
    const [row] = companyHishabMonth([company("22732", "16634")]);
    expect(row).toMatchObject({ dan: "121.96", totalProfit: "5976.04" });
  });
});

describe("danOf", () => {
  it("is 2% rounded to paisa", () => {
    expect(danOf("100")).toBe("2.00");
    expect(danOf("-100")).toBe("-2.00");
  });
});

describe("profitPerLakh", () => {
  it("scales profit to a lakh of invest", () => {
    expect(profitPerLakh("50000", "500000")).toBe("10000.00");
  });

  it("is zero when nothing is invested", () => {
    expect(profitPerLakh("50000", "0")).toBe("0.00");
    expect(profitPerLakh("50000", "-100")).toBe("0.00");
  });
});

describe("investShare", () => {
  it("splits totalProfit in proportion to invest against the combined total", () => {
    expect(investShare("100000", "100000", "500000")).toBe("20000.00");
    expect(investShare("100000", "400000", "500000")).toBe("80000.00");
  });

  it("implies the same rate as profitPerLakh(totalProfit, totalInvest), for any shareholder", () => {
    const totalProfit = "100000";
    const totalInvest = "500000";
    const rate = profitPerLakh(totalProfit, totalInvest);
    const share = investShare(totalProfit, "100000", totalInvest);
    expect(profitPerLakh(share, "100000")).toBe(rate);
  });

  it("is zero when nothing is invested in total", () => {
    expect(investShare("50000", "0", "0")).toBe("0.00");
    expect(investShare("50000", "100000", "-100")).toBe("0.00");
  });
});

describe("previousDueOpenTotal", () => {
  it("sums only positive amounts", () => {
    expect(previousDueOpenTotal(["100.00", "0.00", "50.50", "-1"])).toBe("150.50");
  });

  it("is zero when nothing is open", () => {
    expect(previousDueOpenTotal([])).toBe("0.00");
    expect(previousDueOpenTotal(["0", "0.00"])).toBe("0.00");
  });
});

describe("distributableProfit", () => {
  it("subtracts open dues from a positive totalProfit and floors at zero", () => {
    expect(distributableProfit("100000", "25000")).toBe("75000.00");
    expect(distributableProfit("10000", "25000")).toBe("0.00");
  });

  it("leaves a loss alone", () => {
    expect(distributableProfit("-5000", "1000")).toBe("-5000.00");
    expect(distributableProfit("0", "1000")).toBe("0.00");
  });

  it("keeps investShare consistent on the reduced pool", () => {
    const pool = distributableProfit("100000", "20000");
    expect(pool).toBe("80000.00");
    expect(investShare(pool, "100000", "500000")).toBe("16000.00");
    expect(profitPerLakh(pool, "500000")).toBe("16000.00");
  });
});
