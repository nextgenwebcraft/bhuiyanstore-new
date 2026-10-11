import {
  openingBalanceKinds,
  openingSectionKinds,
  type OpeningBalanceLine,
  type OpeningTotals,
} from "@bsd/contracts";
import { OPENING_KIND_EFFECTS } from "@bsd/domain";
import { describe, expect, it } from "vitest";
import { summarizeSections } from "./opening-summary";

const totals: OpeningTotals = {
  stockPieces: "0",
  stockValue: "0.00",
  valuedRows: 0,
  excludedRows: 0,
  dueFromCompanyPieces: "0",
  marketDue: "0.00",
  staffOwesUs: "0.00",
  staffWeOwe: "0.00",
  companyPayable: "0.00",
  cash: "0.00",
};

const line = (
  kind: OpeningBalanceLine["kind"],
  amount: string | null,
  party: Partial<Pick<OpeningBalanceLine, "staffId" | "cashAccountId" | "shopId">> = {},
): OpeningBalanceLine => ({
  kind,
  staffId: null,
  cashAccountId: null,
  shopId: null,
  amount,
  note: "",
  ...party,
});

const parties = {
  dsrIds: ["d1"],
  staffIds: ["d1", "p2"],
  shopIds: ["s1", "s2"],
  cashAccountIds: ["c1"],
};

const stateOf = (
  section: string,
  balances: OpeningBalanceLine[],
  stock: { pieces: string | null }[] = [],
) => summarizeSections({ stock, balances, totals }, parties).find((s) => s.section === section);

describe("opening section kinds", () => {
  it("put every balance kind in exactly one section, by who the balance belongs to", () => {
    const all = Object.values(openingSectionKinds).flat();
    expect([...all].sort()).toEqual([...openingBalanceKinds].sort());
    expect(new Set(all).size).toBe(all.length);
    const party = {
      marketDue: "optionalStaff",
      shopDue: "shop",
      staff: "staff",
      company: "none",
      cash: "cashAccount",
    };
    for (const [section, kinds] of Object.entries(openingSectionKinds)) {
      for (const kind of kinds) {
        expect(OPENING_KIND_EFFECTS[kind].party).toBe(party[section as keyof typeof party]);
      }
    }
  });
});

describe("summarizeSections", () => {
  it("lists the sections in screen order", () => {
    expect(
      summarizeSections({ stock: [], balances: [], totals }, parties).map((s) => s.section),
    ).toEqual(["stock", "marketDue", "shopDue", "staff", "company", "cash"]);
  });

  it("marks stock done only when every product has a count", () => {
    expect(stateOf("stock", [], [{ pieces: "5" }, { pieces: null }])).toMatchObject({
      entered: 1,
      total: 2,
      state: "pending",
    });
    expect(stateOf("stock", [], [{ pieces: "5" }, { pieces: "0" }])?.state).toBe("done");
    expect(stateOf("stock", [])?.state).toBe("pending");
  });

  it("treats market due as optional and the legacy bucket as one row", () => {
    expect(stateOf("marketDue", [])).toMatchObject({ entered: 0, total: 2, state: "optional" });
    expect(stateOf("marketDue", [line("market_due", "75")])).toMatchObject({
      entered: 1,
      state: "done",
    });
  });

  it("needs every shop for shop due and sums the amounts", () => {
    const one = [line("shop_due", "100", { shopId: "s1" })];
    expect(stateOf("shopDue", one)).toMatchObject({
      entered: 1,
      total: 2,
      state: "pending",
      amounts: [{ key: "total", value: "100.00" }],
    });
    expect(stateOf("shopDue", [...one, line("shop_due", "50.5", { shopId: "s2" })])).toMatchObject({
      state: "done",
      amounts: [{ key: "total", value: "150.50" }],
    });
  });

  it("counts a blank amount as not entered and a person once across kinds", () => {
    expect(stateOf("staff", [line("advance", null, { staffId: "d1" })])?.entered).toBe(0);
    expect(
      stateOf("staff", [
        line("advance", "10", { staffId: "d1" }),
        line("loan", "5", { staffId: "d1" }),
      ]),
    ).toMatchObject({ entered: 1, total: 2, state: "pending" });
  });

  it("still counts saved rows for a party that is no longer listed", () => {
    expect(stateOf("cash", [line("cash", "5", { cashAccountId: "gone" })])).toMatchObject({
      entered: 1,
      total: 2,
      state: "done",
    });
  });

  it("is pending for company and cash until something is entered", () => {
    expect(stateOf("company", [])?.state).toBe("pending");
    expect(stateOf("company", [line("company_advance", "0")])).toMatchObject({
      entered: 1,
      state: "done",
    });
    expect(stateOf("cash", [])?.state).toBe("pending");
  });
});
