import { describe, expect, it } from "vitest";
import {
  cashCheckSales,
  dsrCashSettlement,
  fieldRemaining,
  fieldVisitTotals,
  handoverShortOf,
} from "./field";

describe("field visits (D40)", () => {
  it("sells delivered pieces at the day price; the unpaid part is the shop's new due", () => {
    const totals = fieldVisitTotals(
      [
        { delivered: "24", exchanged: "2", unitPrice: "12.5" },
        { delivered: "5", exchanged: "0", unitPrice: "21.6454" },
      ],
      "300",
    );
    expect(totals.salesValue).toBe("408.23");
    expect(totals.dueCreated).toBe("108.23");
  });

  it("exchanged pieces carry no sales value", () => {
    expect(fieldVisitTotals([{ delivered: "0", exchanged: "6", unitPrice: "10" }], "0")).toEqual({
      salesValue: "0.00",
      dueCreated: "0.00",
    });
  });

  it("remaining samari is issued − delivered − exchanged", () => {
    expect(
      fieldRemaining("48", [
        { delivered: "20", exchanged: "2" },
        { delivered: "10", exchanged: "0" },
      ]),
    ).toBe("16");
  });
});

describe("DSR cash handover (D39)", () => {
  it("expected cash and the difference are shown, never posted", () => {
    expect(
      dsrCashSettlement({
        sales: "5000",
        dueGiven: "800",
        dueCollected: "300",
        expenses: "150",
        handedOver: "4300",
      }),
    ).toEqual({ expected: "4350.00", handedOver: "4300.00", difference: "-50.00" });
    expect(handoverShortOf("-50.00")).toBe("50.00");
    expect(handoverShortOf("10.00")).toBeNull();
    expect(handoverShortOf("0.00")).toBeNull();
    expect(handoverShortOf(null)).toBeNull();
  });

  it("without a handover only the expected cash is known", () => {
    expect(
      dsrCashSettlement({
        sales: "100",
        dueGiven: "0",
        dueCollected: "0",
        expenses: "0",
        handedOver: null,
      }),
    ).toEqual({ expected: "100.00", handedOver: null, difference: null });
  });

  it("বিক্রি minus damage equals মোট বিক্রি, with no leftover paisa (D107)", () => {
    const sales = cashCheckSales("27716.79", "777.82");
    expect(sales).toBe("28494.61");
    expect(
      dsrCashSettlement({
        sales,
        damage: "777.82",
        dueGiven: "0",
        dueCollected: "0",
        expenses: "0",
        handedOver: "27716.79",
      }),
    ).toEqual({ expected: "27716.79", handedOver: "27716.79", difference: "0.00" });
  });

  it("takes damage at the sale price off the expected cash (D107)", () => {
    expect(
      dsrCashSettlement({
        sales: "5000",
        damage: "200",
        dueGiven: "800",
        dueCollected: "300",
        expenses: "150",
        handedOver: "4150",
      }),
    ).toEqual({ expected: "4150.00", handedOver: "4150.00", difference: "0.00" });
  });

  it("staff advances and shortages lower the expected cash, repayments raise it (D62)", () => {
    expect(
      dsrCashSettlement({
        sales: "5000",
        dueGiven: "0",
        dueCollected: "0",
        expenses: "0",
        staffMoney: "-300",
        handedOver: "4700",
      }),
    ).toEqual({ expected: "4700.00", handedOver: "4700.00", difference: "0.00" });
  });
});
