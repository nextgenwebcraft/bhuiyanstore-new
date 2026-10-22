import { describe, expect, it } from "vitest";
import { computeMonth } from "./compute-month";
import { damageCaseSettled, damageEventError, damageLineProgress } from "./damage-case";
import { cashPay, checkRecovery, proposeRecovery, recoveryTotal } from "./payroll";
import type { MoneyEntryInput, MonthInput } from "./types";

const oneDay = (money: MoneyEntryInput[], staff: MonthInput["opening"]["staff"] = {}) =>
  computeMonth({
    products: [{ id: "A", piecesPerCarton: "24" }],
    opening: { products: { A: { stock: "0", dueFromCompany: "0" } }, staff },
    days: [{ date: "2026-11-02", money }],
  });

describe("staff money accounts (D27, guide §11.9)", () => {
  it("T58: same-day advance, repayment, shortage and excess are never netted", () => {
    const out = oneDay([
      { kind: "staffAdvance", amount: "500", staffId: "p" },
      { kind: "staffRepayment", amount: "200", staffId: "p" },
      { kind: "staffShortage", amount: "100", staffId: "p" },
      { kind: "staffExcess", amount: "50", staffId: "p" },
    ]);
    expect(out.days[0]?.money.cashLeft).toBe("-350");
    const p = out.month.staff.find((s) => s.staffId === "p");
    expect(p?.owesUs).toBe("400");
    expect(p?.weOwe).toBe("50");
    expect(p?.closing).toMatchObject({ advance: "300", shortage: "100", credit: "50" });
  });

  it("emits one ledger line per entry with its signed change and running balances", () => {
    const out = oneDay([
      { kind: "staffAdvance", amount: "500", staffId: "p", ref: "e1" },
      { kind: "staffRepayment", amount: "200", staffId: "p", ref: "e2" },
      { kind: "marketDueNew", amount: "90", staffId: "p", ref: "e3" },
    ]);
    expect(out.staffEntries.map((e) => e.ref)).toEqual(["e1", "e2"]);
    expect(out.staffEntries[1]).toMatchObject({
      kind: "staffRepayment",
      change: { advance: "-200" },
      balances: { advance: "300" },
    });
  });

  it("D75: lists an absent fee without moving any balance or the cash", () => {
    const out = oneDay([
      { kind: "staffAdvance", amount: "500", staffId: "p", ref: "e1" },
      { kind: "staffAbsent", amount: "300", staffId: "p", ref: "e2" },
    ]);
    expect(out.staffEntries[1]).toMatchObject({
      ref: "e2",
      kind: "staffAbsent",
      amount: "300",
      change: { advance: "0", shortage: "0", salaryPayable: "0" },
      balances: { advance: "500" },
    });
    expect(out.days[0]?.money.cashLeft).toBe("-500");
    expect(out.month.staff.find((s) => s.staffId === "p")?.owesUs).toBe("500");
  });

  it("T25: SR loan 1,000 and repayment 400 leave a 600 receivable with no revenue or expense", () => {
    const out = oneDay([
      { kind: "srLoan", amount: "1000", staffId: "sr" },
      { kind: "srRepayment", amount: "400", staffId: "sr" },
    ]);
    expect(out.month.staff[0]?.closing.srLoan).toBe("600");
    expect(out.days[0]?.money).toMatchObject({ cashIn: "400", cashOut: "1000", sales: "0" });
    expect(out.month.profit).toMatchObject({ salaries: "0", expenses: "0", net: "0" });
    expect(out.month.staff[0]?.closing.salaryPayable).toBe("0");
  });

  it("offsets credit against owed, and owed-to-SR against SR loan, only when entered", () => {
    const out = oneDay(
      [
        { kind: "staffOffset", amount: "40", staffId: "p" },
        { kind: "srOffset", amount: "30", staffId: "sr" },
      ],
      { p: { loan: "100", credit: "50" }, sr: { srLoan: "80", owedToSr: "30" } },
    );
    const by = new Map(out.month.staff.map((s) => [s.staffId, s.closing]));
    expect(by.get("p")).toMatchObject({ loan: "60", credit: "10" });
    expect(by.get("sr")).toMatchObject({ srLoan: "50", owedToSr: "0" });
    expect(out.days[0]?.money.cashLeft).toBe("0");
  });
});

describe("payroll recovery (D11, D24, D25)", () => {
  it("T56: manager salary 10,500 recovers advance → loan → shortage; Cash Pabe 7,000", () => {
    const owed = { advance: "2000", loan: "1000", shortage: "500" };
    const recovery = proposeRecovery("10500", owed);
    expect(recovery).toEqual({ advance: "2000", loan: "1000", shortage: "500" });
    expect(cashPay("10500", recovery)).toBe("7000");
    const out = oneDay(
      [
        { kind: "salaryAccrual", amount: "10500", staffId: "m" },
        {
          kind: "salaryRecovery",
          amount: recoveryTotal(recovery),
          staffId: "m",
          allocation: recovery,
        },
        { kind: "salaryPaid", amount: "7000", staffId: "m" },
      ],
      { m: owed },
    );
    expect(out.month.staff[0]?.closing).toMatchObject({
      advance: "0",
      loan: "0",
      shortage: "0",
      salaryPayable: "0",
    });
  });

  it("T57: helper salary 3,250 with advance 4,000 recovers 3,250, pays 0, carries 750", () => {
    const recovery = proposeRecovery("3250", { advance: "4000" });
    expect(recovery.advance).toBe("3250");
    expect(cashPay("3250", recovery)).toBe("0");
    const out = oneDay(
      [
        { kind: "salaryAccrual", amount: "3250", staffId: "h" },
        { kind: "salaryRecovery", amount: "3250", staffId: "h", allocation: recovery },
      ],
      { h: { advance: "4000" } },
    );
    expect(out.month.staff[0]?.closing).toMatchObject({ advance: "750", salaryPayable: "0" });
  });

  it("T26: DSR salary 12,000 with approved due 1,500 pays 10,500 and clears the due", () => {
    const recovery = proposeRecovery("12000", { shortage: "1500" });
    expect(recoveryTotal(recovery)).toBe("1500");
    expect(cashPay("12000", recovery)).toBe("10500");
  });

  it("T27: due above available pay is capped; the rest carries; never negative cash", () => {
    const recovery = proposeRecovery("1000", { shortage: "1500" });
    expect(recovery.shortage).toBe("1000");
    expect(cashPay("1000", recovery)).toBe("0");
    expect(checkRecovery("1000", { shortage: "1500" }, { shortage: "1200" })).toEqual([
      { code: "exceedsSalary" },
    ]);
    expect(checkRecovery("5000", { loan: "100" }, { loan: "200" })).toEqual([
      { code: "exceedsOwed", bucket: "loan" },
    ]);
    expect(checkRecovery("5000", { loan: "300" }, { loan: "200" })).toEqual([]);
  });
});

describe("damage case legs (D17, guide §9.7)", () => {
  it("buyer and company legs progress independently (3 damaged: 2+1 replaced, 1+2 back)", () => {
    const events: { kind: Parameters<typeof damageEventError>[2]; quantity: string }[] = [];
    const progress = () => damageLineProgress("buyerExchange", "3", events);
    events.push({ kind: "buyerReplacement", quantity: "2" });
    expect(progress().buyerPending).toBe("1");
    events.push(
      { kind: "companyDispatch", quantity: "3" },
      { kind: "companyAccept", quantity: "3" },
    );
    events.push({ kind: "companyReplacement", quantity: "1" });
    expect(progress()).toMatchObject({ buyerPending: "1", companyPending: "2", stillHere: "0" });
    events.push({ kind: "buyerReplacement", quantity: "1" });
    events.push({ kind: "companyReplacement", quantity: "2" });
    expect(progress()).toMatchObject({ buyerPending: "0", companyPending: "0" });
    expect(damageCaseSettled([progress()])).toBe(true);
  });

  it("a company money return settles accepted pieces like a replacement (D33)", () => {
    const sent = [
      { kind: "companyDispatch" as const, quantity: "4" },
      { kind: "companyAccept" as const, quantity: "4" },
    ];
    const p = damageLineProgress("ownedStock", "4", [
      ...sent,
      { kind: "companyRefund", quantity: "3" },
      { kind: "companyReplacement", quantity: "1" },
    ]);
    expect(p).toMatchObject({ companyRefunded: "3", companyReplaced: "1", companyPending: "0" });
    expect(damageCaseSettled([p])).toBe(true);
    const open = damageLineProgress("ownedStock", "4", sent);
    expect(damageEventError("ownedStock", open, "companyRefund", "5")).toBe(
      "overCompanyReplacement",
    );
    expect(damageEventError("ownedStock", open, "companyRefund", "4")).toBeNull();
  });

  it("refund plus replacement never exceeds the accepted pieces, so a repeat cannot credit twice", () => {
    const legs = [
      { kind: "companyDispatch" as const, quantity: "4" },
      { kind: "companyAccept" as const, quantity: "4" },
      { kind: "companyRefund" as const, quantity: "3" },
    ];
    const p = damageLineProgress("ownedStock", "4", legs);
    expect(damageEventError("ownedStock", p, "companyRefund", "3")).toBe("overCompanyReplacement");
    expect(damageEventError("ownedStock", p, "companyReplacement", "2")).toBe(
      "overCompanyReplacement",
    );
    expect(damageEventError("ownedStock", p, "companyReplacement", "1")).toBeNull();
    const done = damageLineProgress("ownedStock", "4", [
      ...legs,
      { kind: "companyReplacement", quantity: "1" },
    ]);
    expect(damageEventError("ownedStock", done, "companyRefund", "0.5")).toBe(
      "overCompanyReplacement",
    );
  });

  it("refuses over-dispatch, over-replacement and a buyer leg on owned-stock damage", () => {
    const p = damageLineProgress("buyerExchange", "3", [
      { kind: "companyDispatch", quantity: "2" },
    ]);
    expect(damageEventError("buyerExchange", p, "companyDispatch", "2")).toBe("overDispatch");
    expect(damageEventError("buyerExchange", p, "companyAccept", "3")).toBe("overAcceptance");
    expect(damageEventError("buyerExchange", p, "companyReplacement", "1")).toBe(
      "overCompanyReplacement",
    );
    expect(damageEventError("buyerExchange", p, "buyerReplacement", "4")).toBe("overReplacement");
    const owned = damageLineProgress("ownedStock", "5", []);
    expect(damageEventError("ownedStock", owned, "buyerReplacement", "1")).toBe("noBuyerLeg");
    expect(damageEventError("ownedStock", owned, "writeOff", "5")).toBeNull();
  });

  it("company replacement adds saleable stock without a bill, due or payable", () => {
    const out = computeMonth({
      products: [{ id: "A", piecesPerCarton: "24" }],
      opening: {
        products: { A: { stock: "10", dueFromCompany: "5", orderPrice: "8", costPrice: "7" } },
        companyPayable: "100",
      },
      days: [
        {
          date: "2026-11-02",
          products: {
            A: {
              replacements: [
                { quantity: "1", unitCost: "7" },
                { quantity: "2", unitCost: "7" },
              ],
            },
          },
        },
      ],
    });
    expect(out.closing.products.A).toMatchObject({ stock: "13", dueFromCompany: "5" });
    expect(out.month.companyPayable.closing).toBe("100");
    expect(out.month.totals).toMatchObject({ receiptTotal: "0", replacementValue: "21" });
  });

  it("a buyer replacement from the godown leaves stock as damage, not as a sale", () => {
    const out = computeMonth({
      products: [{ id: "A", piecesPerCarton: "24" }],
      opening: {
        products: { A: { stock: "10", dueFromCompany: "0", costPrice: "7", salePrice: "9" } },
      },
      days: [{ date: "2026-11-02", products: { A: { replacedFromStock: "2" } } }],
    });
    expect(out.closing.products.A?.stock).toBe("8");
    expect(out.month.products[0]).toMatchObject({
      sold: "0",
      salesTotal: "0",
      damaged: "0",
      replacedFromStock: "2",
      damageValue: "14",
    });
  });
});
