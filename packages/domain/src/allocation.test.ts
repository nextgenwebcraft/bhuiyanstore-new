import { describe, expect, it } from "vitest";
import { allocateByPriority, sortByAllocationPriority } from "./allocation";

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

  it("breaks ties on the same date by stable ID", () => {
    const items = [
      { id: "z", receivedDate: "2026-01-01" },
      { id: "a", receivedDate: "2026-01-01" },
    ];
    expect(sortByAllocationPriority(items).map((i) => i.id)).toEqual(["a", "z"]);
  });
});

describe("allocateByPriority", () => {
  const layerA = { id: "A", receivedDate: "2026-01-01", availableQuantity: "100", unitCost: "10" };
  const layerB = { id: "B", receivedDate: "2026-02-01", availableQuantity: "100", unitCost: "12" };

  it("spans layers in FIFO order (guide 9.6: 120 units = 100 from A + 20 from B)", () => {
    const result = allocateByPriority([layerB, layerA], "120");
    expect(result.shortfall).toBe("0");
    expect(result.allocations).toEqual([
      { batchId: "A", quantity: "100", unitCost: "10" },
      { batchId: "B", quantity: "20", unitCost: "12" },
    ]);
  });

  it("reports a shortfall instead of over-allocating", () => {
    const result = allocateByPriority([layerA], "130");
    expect(result.shortfall).toBe("30");
    expect(result.allocations).toEqual([{ batchId: "A", quantity: "100", unitCost: "10" }]);
  });

  it("excludes layers already expired on the business date", () => {
    const expired = { ...layerA, expiryDate: "2026-03-01" };
    const result = allocateByPriority([expired, layerB], "50", "2026-03-02");
    expect(result.allocations).toEqual([{ batchId: "B", quantity: "50", unitCost: "12" }]);
  });

  it("skips empty layers", () => {
    const empty = { ...layerA, availableQuantity: "0" };
    const result = allocateByPriority([empty, layerB], "10");
    expect(result.allocations.map((a) => a.batchId)).toEqual(["B"]);
  });
});
