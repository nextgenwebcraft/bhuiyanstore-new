import { describe, expect, it } from "vitest";
import { sortByAllocationPriority } from "./allocation";

describe("sortByAllocationPriority", () => {
  it("orders known expiries earliest first (FEFO)", () => {
    const items = [
      { id: "b", expiryDate: "2026-12-01", receivedDate: "2026-01-01" },
      { id: "a", expiryDate: "2026-06-01", receivedDate: "2026-02-01" },
    ];
    expect(sortByAllocationPriority(items).map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("puts a known expiry before an unknown one, regardless of receipt order", () => {
    const items = [
      { id: "no-expiry", receivedDate: "2026-01-01" },
      { id: "has-expiry", expiryDate: "2026-12-01", receivedDate: "2026-06-01" },
    ];
    expect(sortByAllocationPriority(items).map((i) => i.id)).toEqual(["has-expiry", "no-expiry"]);
  });

  it("falls back to FIFO by receivedDate when neither has an expiry", () => {
    const items = [
      { id: "later", receivedDate: "2026-03-01" },
      { id: "earlier", receivedDate: "2026-01-01" },
    ];
    expect(sortByAllocationPriority(items).map((i) => i.id)).toEqual(["earlier", "later"]);
  });

  it("does not mutate the input array", () => {
    const items = [
      { id: "b", receivedDate: "2026-02-01" },
      { id: "a", receivedDate: "2026-01-01" },
    ];
    const result = sortByAllocationPriority(items);
    expect(result).not.toBe(items);
    expect(items.map((i) => i.id)).toEqual(["b", "a"]);
  });
});
