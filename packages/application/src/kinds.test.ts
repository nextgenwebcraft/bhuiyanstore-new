import {
  damageEventKinds as contractDamageKinds,
  damageOrigins as contractOrigins,
  moneyEntryKinds,
  moneyKindPermission,
  owedAllocationSchema,
  staffBalanceKeys,
} from "@bsd/contracts";
import {
  MONEY_KIND_EFFECTS,
  computeMonth,
  damageEventKinds,
  damageOrigins,
  owedBuckets,
} from "@bsd/domain";
import { describe, expect, it } from "vitest";

/** Contracts restate engine lists for the wire; they must never drift apart. */
describe("contract lists match the month engine", () => {
  it("money entry kinds", () => {
    expect([...moneyEntryKinds].sort()).toEqual(Object.keys(MONEY_KIND_EFFECTS).sort());
    expect(Object.keys(moneyKindPermission).sort()).toEqual([...moneyEntryKinds].sort());
  });

  it("damage origins and event kinds", () => {
    expect([...contractOrigins]).toEqual([...damageOrigins]);
    expect([...contractDamageKinds]).toEqual([...damageEventKinds]);
  });

  it("owed buckets, in recovery order", () => {
    expect(Object.keys(owedAllocationSchema.shape)).toEqual([...owedBuckets]);
  });

  it("staff balance keys", () => {
    const out = computeMonth({
      products: [],
      opening: { products: {}, staff: { p: {} } },
      days: [],
    });
    expect(Object.keys(out.closing.staff.p ?? {}).sort()).toEqual([...staffBalanceKeys].sort());
  });
});
