import { describe, expect, it } from "vitest";
import { contrastRatio } from "./contrast";

describe("contrastRatio", () => {
  it("is 21 for black on white", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
  });

  it("is 1 for identical colors", () => {
    expect(contrastRatio("#B42318", "#B42318")).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#1D4ED8", "#FFFFFF")).toBeCloseTo(contrastRatio("#FFFFFF", "#1D4ED8"));
  });
});
