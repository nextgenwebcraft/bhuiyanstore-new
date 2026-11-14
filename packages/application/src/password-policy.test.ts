import { MIN_PASSWORD_LENGTH as authMinimum } from "@bsd/auth";
import { MIN_PASSWORD_LENGTH as contractMinimum } from "@bsd/contracts";
import { describe, expect, it } from "vitest";

describe("password policy", () => {
  it("validates the same minimum length in the contracts and on the auth server", () => {
    expect(contractMinimum).toBe(authMinimum);
  });
});
