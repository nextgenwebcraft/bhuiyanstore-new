import { describe, expect, it } from "vitest";
import { toDecimal } from "./decimal";
import { roundCost, roundSettlement } from "./money";

describe("money precision", () => {
  it("avoids floating-point error (0.1 + 0.2)", () => {
    expect(toDecimal("0.1").add("0.2").toString()).toBe("0.3");
  });

  it("rounds settlement amounts to 2 places", () => {
    expect(roundSettlement("2817.605")).toBe("2817.61");
  });

  it("keeps 6-place unit cost precision", () => {
    expect(roundCost("21.6454")).toBe("21.645400");
  });
});
