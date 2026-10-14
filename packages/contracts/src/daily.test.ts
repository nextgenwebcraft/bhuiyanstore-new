import { describe, expect, it } from "vitest";
import { companyCreateRequestSchema } from "./organization";
import { moneyEntryPostRequestSchema } from "./daily";

const base = { date: "2026-10-14", kind: "marketDueNew", amount: "100", staffId: "staff-1" };

function issues(input: unknown): { path: string; message: string }[] {
  const result = moneyEntryPostRequestSchema.safeParse(input);
  return result.success
    ? []
    : result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

describe("money entry newShop (D50)", () => {
  it("accepts a shop id or a new shop name, and trims the name", () => {
    expect(issues({ ...base, shopId: "shop-1" })).toEqual([]);
    const parsed = moneyEntryPostRequestSchema.parse({ ...base, newShop: { name: "  আলফা  " } });
    expect(parsed.newShop).toEqual({ name: "আলফা" });
    expect(parsed.shopId).toBeNull();
  });

  it("refuses shopId and newShop together", () => {
    expect(issues({ ...base, shopId: "shop-1", newShop: { name: "আলফা" } })).toEqual([
      { path: "newShop", message: "validation.shop.newShopExclusive" },
    ]);
  });

  it("allows both market due kinds and no other kind", () => {
    expect(issues({ ...base, kind: "marketDueCollected", newShop: { name: "আলফা" } })).toEqual([]);
    expect(issues({ ...base, kind: "expense", newShop: { name: "আলফা" } })).toEqual([
      { path: "newShop", message: "validation.shop.notForKind" },
    ]);
  });

  it("refuses an empty name", () => {
    expect(issues({ ...base, newShop: { name: "   " } })).not.toEqual([]);
  });
});

describe("company create request (D51)", () => {
  const company = {
    name: "Drinko",
    theme: { primary: "#0F766E", primaryForeground: "#FFFFFF" },
    modules: ["sales"],
  };

  it("starts from the starter dataset unless switched off", () => {
    expect(companyCreateRequestSchema.parse(company).starterData).toBe(true);
    expect(companyCreateRequestSchema.parse({ ...company, starterData: false }).starterData).toBe(
      false,
    );
  });
});
