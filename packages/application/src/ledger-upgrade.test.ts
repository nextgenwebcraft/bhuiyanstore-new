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
    const current = closing(
      { A: { stock: "5", dueFromCompany: "10", dueFromCompanyValue: "200", orderPrice: "20" } },
      "1200",
    );
    expect(upgradeClosing(current)).toBe(current);
  });
});
