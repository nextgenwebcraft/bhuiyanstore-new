import { describe, expect, it } from "vitest";
import { companyHishabMonth, danOf, profitPerLakh } from "./company-hishab";

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
