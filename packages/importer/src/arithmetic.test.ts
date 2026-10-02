import { describe, expect, it } from "vitest";
import { evaluateArithmetic } from "./arithmetic";

describe("evaluateArithmetic", () => {
  it("evaluates typed arithmetic exactly", () => {
    expect(evaluateArithmetic("=20+30")?.toString()).toBe("50");
    expect(evaluateArithmetic("(5*24)+3")?.toString()).toBe("123");
    expect(evaluateArithmetic("0.1+0.2")?.toString()).toBe("0.3");
    expect(evaluateArithmetic("-4+10/4")?.toString()).toBe("-1.5");
  });

  it("never executes formulas that read cells or call functions", () => {
    expect(evaluateArithmetic("A1+2")).toBeNull();
    expect(evaluateArithmetic("SUM(1,2)")).toBeNull();
    expect(evaluateArithmetic("1/0")).toBeNull();
    expect(evaluateArithmetic("(1+2")).toBeNull();
  });
});
