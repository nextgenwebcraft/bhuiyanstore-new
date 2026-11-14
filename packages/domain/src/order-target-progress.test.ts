import { describe, expect, it } from "vitest";
import { orderTargetProgress } from "./order-target-progress";

describe("orderTargetProgress", () => {
  it("reports met when ordered reaches the target", () => {
    const result = orderTargetProgress({
      targetAmount: "1000",
      orderedAmount: "1000",
      startDate: "2026-11-01",
      endDate: "2026-11-30",
      today: "2026-11-10",
    });
    expect(result.status).toBe("met");
    expect(result.remaining).toBe("0.00");
    expect(result.ratio).toBe("1");
  });

  it("reports remaining and days left inside the window", () => {
    const result = orderTargetProgress({
      targetAmount: "1000",
      orderedAmount: "250",
      startDate: "2026-11-01",
      endDate: "2026-11-30",
      today: "2026-11-10",
    });
    expect(result.ordered).toBe("250.00");
    expect(result.remaining).toBe("750.00");
    expect(result.daysLeft).toBe(20);
    expect(result.daysTotal).toBe(30);
    expect(result.status).toBe("behind");
  });

  it("reports overdue after the end date when unmet", () => {
    const result = orderTargetProgress({
      targetAmount: "1000",
      orderedAmount: "100",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
      today: "2026-11-04",
    });
    expect(result.status).toBe("overdue");
    expect(result.daysLeft).toBe(0);
  });

  it("caps ratio at 1 when over-ordered", () => {
    const result = orderTargetProgress({
      targetAmount: "100",
      orderedAmount: "150",
      startDate: "2026-11-01",
      endDate: "2026-11-30",
      today: "2026-11-05",
    });
    expect(result.ratio).toBe("1");
    expect(result.status).toBe("met");
  });
});
