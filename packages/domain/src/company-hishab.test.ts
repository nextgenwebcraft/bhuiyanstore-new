import { describe, expect, it } from "vitest";
import {
  companyHishabMonth,
  danOf,
  distributableProfit,
  investShare,
  partnerShares,
  previousDueOpenTotal,
  profitPerLakh,
  splitEqually,
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

describe("splitEqually (D143)", () => {
  it("splits a lakh-round amount evenly", () => {
    expect(splitEqually("300000", 3)).toEqual(["100000.00", "100000.00", "100000.00"]);
  });

  it("puts leftover paisa on the first parts so the parts add back exactly", () => {
    expect(splitEqually("100000", 3)).toEqual(["33333.34", "33333.33", "33333.33"]);
    expect(splitEqually("0.05", 3)).toEqual(["0.02", "0.02", "0.01"]);
  });

  it("returns nothing for no parts", () => {
    expect(splitEqually("100", 0)).toEqual([]);
  });
});

describe("partnerShares (D143, per-company split)", () => {
  const companies = [
    { companyId: "fresh", totalProfit: "90000.00" },
    { companyId: "pusti", totalProfit: "30000.00" },
  ];

  it("splits each company among its own investors and sums one amount per partner", () => {
    const result = partnerShares({
      companies,
      previousDueTotal: "0",
      partners: [
        { shareholderId: "ali", invest: { fresh: "100000", pusti: "100000" } },
        { shareholderId: "mustafiz", invest: { fresh: "200000" } },
      ],
    });
    const ali = result.partners.find((p) => p.shareholderId === "ali");
    const mustafiz = result.partners.find((p) => p.shareholderId === "mustafiz");
    // Fresh 90,000 split 1:2; Pusti 30,000 all to Ali (only investor there).
    expect(ali?.lines).toEqual([
      { companyId: "fresh", invest: "100000.00", amount: "30000.00" },
      { companyId: "pusti", invest: "100000.00", amount: "30000.00" },
    ]);
    expect(ali?.amount).toBe("60000.00");
    expect(ali?.invest).toBe("200000.00");
    expect(mustafiz?.amount).toBe("60000.00");
    expect(result.allocated).toBe("120000.00");
    expect(result.unallocated).toBe("0.00");
  });

  it("leaves a company nobody invested in unallocated", () => {
    const result = partnerShares({
      companies,
      previousDueTotal: "0",
      partners: [{ shareholderId: "ali", invest: { fresh: "70000" } }],
    });
    expect(result.partners[0]?.amount).toBe("90000.00");
    expect(result.companies.find((c) => c.companyId === "pusti")?.invest).toBe("0.00");
    expect(result.unallocated).toBe("30000.00");
  });

  it("spreads a Previous Due cut over companies in proportion to profit", () => {
    const result = partnerShares({
      companies,
      previousDueTotal: "60000",
      partners: [{ shareholderId: "ali", invest: { fresh: "1", pusti: "1" } }],
    });
    expect(result.distributableProfit).toBe("60000.00");
    expect(result.companies.map((c) => c.distributableProfit)).toEqual(["45000.00", "15000.00"]);
    expect(result.partners[0]?.amount).toBe("60000.00");
  });

  it("passes a company loss to that company's investors and leaves a total loss alone", () => {
    const result = partnerShares({
      companies: [
        { companyId: "fresh", totalProfit: "-6260.24" },
        { companyId: "pusti", totalProfit: "-1000.00" },
      ],
      previousDueTotal: "5000",
      partners: [{ shareholderId: "ali", invest: { fresh: "100", pusti: "100" } }],
    });
    expect(result.distributableProfit).toBe("-7260.24");
    expect(result.partners[0]?.amount).toBe("-7260.24");
  });
});
