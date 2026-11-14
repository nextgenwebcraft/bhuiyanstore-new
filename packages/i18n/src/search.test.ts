import { describe, expect, it } from "vitest";
import { matchesSearch } from "./search";

describe("matchesSearch", () => {
  const drinko = ["DR-250", "Drinko 250ml", "ড্রিংকো ২৫০"];

  it("matches Latin names case-insensitively", () => {
    expect(matchesSearch("drinko", drinko)).toBe(true);
  });

  it("matches Bangla aliases", () => {
    expect(matchesSearch("ড্রিংকো", drinko)).toBe(true);
  });

  it("matches Bengali digits against Latin digits and vice versa", () => {
    expect(matchesSearch("২৫০ml", drinko)).toBe(true);
    expect(matchesSearch("ড্রিংকো 250", drinko)).toBe(true);
  });

  it("requires every term to match", () => {
    expect(matchesSearch("drinko 500", drinko)).toBe(false);
  });

  it("treats an empty query as a match", () => {
    expect(matchesSearch("   ", drinko)).toBe(true);
  });
});
