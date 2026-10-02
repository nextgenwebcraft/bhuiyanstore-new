import { errorCodes } from "@bsd/contracts";
import { bn, t } from "@bsd/i18n";
import { describe, expect, it } from "vitest";
import { describeError, errorCodeOf, ServiceError } from "./service-error";

describe("error codes", () => {
  it("has a Bangla message for every contract error code", () => {
    for (const code of errorCodes) expect(bn[`error.${code}`]).toBeTruthy();
  });

  it("maps unknown failures to INTERNAL", () => {
    expect(errorCodeOf(new Error("boom"))).toBe("INTERNAL");
    expect(errorCodeOf(new ServiceError("FORBIDDEN"))).toBe("FORBIDDEN");
  });
});

describe("describeError", () => {
  it("puts known codes under the fields the form shows", () => {
    const error = new ServiceError("VALIDATION_FAILED", false, [
      { path: "name", code: "validation.supplier.duplicateName" },
    ]);
    expect(describeError(error, ["name"])).toEqual({
      fields: { name: t("validation.supplier.duplicateName") },
    });
  });

  it("shows errors on paths the form lacks at form level", () => {
    const error = new ServiceError("VALIDATION_FAILED", false, [
      { path: "id", code: "validation.staff.unknown" },
    ]);
    expect(describeError(error, ["name"])).toEqual({
      fields: {},
      form: t("validation.staff.unknown"),
    });
  });

  it("falls back to the generic message for codes without a translation", () => {
    const error = new ServiceError("VALIDATION_FAILED", false, [
      { path: "name", code: "Too small: expected string to have >=1 characters" },
    ]);
    expect(describeError(error, ["name"]).fields.name).toBe(t("error.VALIDATION_FAILED"));
  });

  it("uses the error code when there are no field errors", () => {
    expect(describeError(new ServiceError("FORBIDDEN"), [])).toEqual({
      fields: {},
      form: t("error.FORBIDDEN"),
    });
    expect(describeError(new Error("boom"), []).form).toBe(t("error.INTERNAL"));
  });
});
