import { errorCodes } from "@bsd/contracts";
import { bn } from "@bsd/i18n";
import { describe, expect, it } from "vitest";
import { errorCodeOf, ServiceError } from "./service-error";

describe("error codes", () => {
  it("has a Bangla message for every contract error code", () => {
    for (const code of errorCodes) expect(bn[`error.${code}`]).toBeTruthy();
  });

  it("maps unknown failures to INTERNAL", () => {
    expect(errorCodeOf(new Error("boom"))).toBe("INTERNAL");
    expect(errorCodeOf(new ServiceError("FORBIDDEN"))).toBe("FORBIDDEN");
  });
});
