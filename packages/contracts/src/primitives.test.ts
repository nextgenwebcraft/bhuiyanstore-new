import { describe, expect, it } from "vitest";
import { amountSchema, positiveAmountStringSchema, wholePiecesSchema } from "./primitives";

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: string) =>
  schema.safeParse(v).success;

describe("amountSchema", () => {
  it.each(["0", "12000", "12.5", "12.50"])("accepts %j", (v) => {
    expect(ok(amountSchema, v)).toBe(true);
  });

  it.each(["", "-1", "1.234", "1,000", "abc", "১২"])("rejects %j", (v) => {
    expect(ok(amountSchema, v)).toBe(false);
  });
});

describe("positiveAmountStringSchema", () => {
  const schema = positiveAmountStringSchema("x");

  it.each(["0", "0.00"])("rejects %j", (v) => {
    expect(ok(schema, v)).toBe(false);
  });

  it("accepts 0.01", () => {
    expect(ok(schema, "0.01")).toBe(true);
  });
});

describe("wholePiecesSchema", () => {
  it.each(["0", "48"])("accepts %j", (v) => {
    expect(ok(wholePiecesSchema, v)).toBe(true);
  });

  it.each(["01", "1.5", "-2", ""])("rejects %j", (v) => {
    expect(ok(wholePiecesSchema, v)).toBe(false);
  });
});
