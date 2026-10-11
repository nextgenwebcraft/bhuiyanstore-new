import { Decimal, computeMonth } from "@bsd/domain";
import { readMonthSheet } from "@bsd/importer";
import { syntheticWorkbook } from "../../../importer/src/synthetic-workbook";
import { describe, expect, it } from "vitest";
import { addDays, buildSeedPlan, summarizePlan } from "./seed-demo-plan";

const read = readMonthSheet(syntheticWorkbook(), "Nov 2026");
const plan = buildSeedPlan(read, { companyName: "Demo", cutoff: "2026-10-01" });

const REQUIRED = [
  "marketDueNew",
  "marketDueCollected",
  "expense",
  "staffAdvance",
  "staffRepayment",
  "supplierDeposit",
  "companyIncentive",
  "srLoan",
  "srRepayment",
  "srIncentive",
];

describe("buildSeedPlan (synthetic workbook)", () => {
  it("plans every sheet product with a generated SKU and a carton fallback", () => {
    expect(plan.products.map((p) => p.name)).toEqual(read.products.map((p) => p.name));
    expect(plan.products.map((p) => p.sku)).toEqual(["DRK-01", "DRK-02"]);
    expect(plan.products.every((p) => /^[1-9]\d*$/.test(p.piecesPerCarton))).toBe(true);
  });

  it("creates DSRs, other people as managers, two samples SRs and two shops per DSR", () => {
    const kinds = (k: string) => plan.people.filter((p) => p.roleKind === k).length;
    expect(kinds("dsr")).toBe(1);
    expect(kinds("general")).toBe(1);
    expect(kinds("sr")).toBe(2);
    expect(plan.shops).toHaveLength(2);
  });

  it("splits the market due over the shops exactly", () => {
    const total = plan.opening.shopDue.reduce((sum, l) => sum.add(l.amount), new Decimal(0));
    expect(plan.opening.shopDue).toHaveLength(plan.shops.length);
    const closing = computeMonth(read.input).closing.marketDue;
    const expected = Object.values(closing).reduce((sum, v) => sum.add(v), new Decimal(0));
    expect(expected.gt(0)).toBe(true);
    expect(total.toFixed(2)).toBe(expected.toFixed(2));
  });

  it("puts every required money kind on both days, dated cutoff and cutoff + 1", () => {
    expect(plan.days.map((d) => d.date)).toEqual(["2026-10-01", addDays("2026-10-01", 1)]);
    for (const day of plan.days) {
      const kinds = new Set(day.money.map((m) => m.kind));
      for (const kind of REQUIRED) expect(kinds.has(kind as never), kind).toBe(true);
      const stock = new Set(day.stock.map((l) => l.kind));
      for (const kind of ["order", "receipt", "incentive"])
        expect(stock.has(kind as never)).toBe(true);
      expect(day.dsrSheets.length).toBeGreaterThan(0);
    }
    expect(plan.days[1]?.stock.some((l) => l.kind === "damage")).toBe(true);
    expect(plan.days[1]?.damageCases).toHaveLength(1);
  });

  it("has no negative pieces and only 2-dp money strings", () => {
    const pieces = [
      ...plan.opening.stock.map((s) => s.pieces),
      ...plan.days.flatMap((d) => [
        ...d.stock.map((l) => l.pieces),
        ...d.dsrSheets.flatMap((s) => s.lines.flatMap((l) => [l.issued, l.returned, l.damaged])),
      ]),
    ];
    for (const p of pieces) expect(p).toMatch(/^(0|[1-9]\d*)$/);
    const amounts = [
      ...Object.values(plan.opening)
        .flat()
        .flatMap((l) => ("amount" in l ? [l.amount] : [])),
      ...plan.days.flatMap((d) => [
        ...d.money.map((m) => m.amount),
        ...d.dsrSheets.flatMap((s) => s.lines.map((l) => l.commission)),
      ]),
    ];
    for (const a of amounts) expect(a).toMatch(/^\d+\.\d{2}$/);
    for (const d of plan.days) {
      for (const s of d.dsrSheets) {
        for (const l of s.lines) expect(Number(l.returned)).toBeLessThanOrEqual(Number(l.issued));
      }
    }
  });

  it("prints counts only", () => {
    const text = summarizePlan(plan).join("\n");
    expect(text).toContain("products: 2");
    expect(text).not.toContain("Alpha");
  });
});
