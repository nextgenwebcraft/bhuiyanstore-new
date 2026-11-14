import { describe, expect, it } from "vitest";
import { monthGrid, presetRange } from "./calendar-math";

describe("calendar math", () => {
  it("lays a month out in six Saturday-first weeks", () => {
    const grid = monthGrid("2026-10");
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe("2026-09-26");
    expect(grid.indexOf("2026-10-01")).toBe(5);
    expect(monthGrid("2026-08")[0]).toBe("2026-08-01");
  });

  it("builds preset ranges from today", () => {
    expect(presetRange("last7", "2026-10-03")).toEqual({ from: "2026-09-27", to: "2026-10-03" });
    expect(presetRange("lastMonth", "2026-01-15")).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
    expect(presetRange("thisMonth", "2026-10-03")).toEqual({
      from: "2026-10-01",
      to: "2026-10-03",
    });
  });
});
