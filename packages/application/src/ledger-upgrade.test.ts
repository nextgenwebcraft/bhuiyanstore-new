import type { MonthClosing } from "@bsd/domain";
import { describe, expect, it } from "vitest";
import { upgradeClosing } from "./ledger";

const closing = (products: MonthClosing["products"], payable: string): MonthClosing => ({
  products,
  marketDue: {},
  shopDue: {},
  staff: {},
  companyPayable: payable,
});

describe("upgradeClosing (month-close snapshots stored before D48)", () => {
  it("bills the undelivered goods into the payable and records their value", () => {
    const old = closing(
      {
        A: { stock: "5", dueFromCompany: "10", orderPrice: "20" },
        B: { stock: "0", dueFromCompany: "0" },
      } as unknown as MonthClosing["products"],
      "1000",
    );
    const upgraded = upgradeClosing(old);
    expect(upgraded.companyPayable).toBe("1200");
    expect(upgraded.products.A?.dueFromCompanyValue).toBe("200");
    expect(upgraded.products.B?.dueFromCompanyValue).toBe("0");
  });

  it("leaves a snapshot that already carries the undelivered value unchanged", () => {
    // D49: "unchanged" now also needs the batches, which a current snapshot carries.
    const current = closing(
      {
        A: {
          stock: "5",
          batches: [
            { seq: 2, startDate: "2026-10-02", costPrice: "9", salePrice: "12", quantity: "5" },
          ],
          dueFromCompany: "10",
          dueFromCompanyValue: "200",
          orderPrice: "20",
        },
      },
      "1200",
    );
    expect(upgradeClosing(current)).toBe(current);
  });

  it("gives a snapshot stored before batches one batch at its closing prices (D49)", () => {
    const old = closing(
      {
        A: {
          stock: "5",
          dueFromCompany: "0",
          dueFromCompanyValue: "0",
          costPrice: "9",
          salePrice: "12",
        },
        B: { stock: "0", dueFromCompany: "0", dueFromCompanyValue: "0" },
      },
      "0",
    );
    const upgraded = upgradeClosing(old);
    expect(upgraded.products.A?.batches).toEqual([
      { seq: 1, startDate: "opening", costPrice: "9", salePrice: "12", quantity: "5" },
    ]);
    expect(upgraded.products.B?.batches).toBeUndefined(); // no stock, no batch
  });
});
