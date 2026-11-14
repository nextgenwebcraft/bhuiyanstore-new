"use client";

import type { StaffDeleteImpact } from "@bsd/contracts";
import { t, toBengaliDigits } from "@bsd/i18n";
import { useState } from "react";
import { Button } from "@/components/button";
import { FormDialog } from "@/components/form-dialog";
import { describeError } from "@/data/ports/service-error";
import { useDeleteStaff, useStaffDeleteImpact } from "@/data/queries";

const IMPACT_KEYS = [
  ["moneyEntries", "staff.delete.impact.moneyEntries"],
  ["openingBalances", "staff.delete.impact.openingBalances"],
  ["payrollLines", "staff.delete.impact.payrollLines"],
  ["dsrDays", "staff.delete.impact.dsrDays"],
  ["fieldVisits", "staff.delete.impact.fieldVisits"],
  ["fieldReports", "staff.delete.impact.fieldReports"],
  ["damageCases", "staff.delete.impact.damageCases"],
  ["shopsAdded", "staff.delete.impact.shopsAdded"],
] as const;

function impactLines(impact: StaffDeleteImpact): string[] {
  const lines = IMPACT_KEYS.flatMap(([field, key]) => {
    const n = impact[field];
    return n > 0 ? [t(key).replace("{n}", toBengaliDigits(String(n)))] : [];
  });
  if (impact.hasLogin) lines.push(t("staff.delete.impact.login"));
  return lines;
}

/**
 * Delete with a live impact preview (D116): the alert lists every hishab bucket that will be
 * wiped so balances and stock recalculate without this person.
 */
export function StaffDeleteButton({
  companyId,
  staffId,
  name,
  variant = "staff",
}: {
  companyId: string;
  staffId: string;
  name: string;
  /** SR list uses stronger copy about wiping এসআর হিসাব. */
  variant?: "staff" | "sr";
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const deleteStaff = useDeleteStaff(companyId);
  const impactQuery = useStaffDeleteImpact(companyId, open ? staffId : null);

  function close() {
    setOpen(false);
    setError(undefined);
  }

  async function confirm() {
    setPending(true);
    setError(undefined);
    try {
      await deleteStaff.mutateAsync(staffId);
      setOpen(false);
    } catch (e) {
      setError(describeError(e, []).form);
    } finally {
      setPending(false);
    }
  }

  const lines = impactQuery.data ? impactLines(impactQuery.data) : [];

  return (
    <>
      <Button onClick={() => setOpen(true)}>{t("common.delete")}</Button>
      <FormDialog
        open={open}
        title={`${t("common.delete")}: ${name}`}
        error={error}
        pending={pending || impactQuery.isPending || impactQuery.isError}
        submitLabel={t("common.delete")}
        onSubmit={() => void confirm()}
        onClose={close}
      >
        <div className="flex flex-col gap-2 text-sm text-text-muted">
          <p>{t(variant === "sr" ? "sr.delete.confirm" : "staff.delete.confirm")}</p>
          {impactQuery.isError ? (
            <p className="text-sm text-error" role="alert">
              {describeError(impactQuery.error, []).form}
            </p>
          ) : null}
          {impactQuery.isPending ? <p>{t("staff.delete.impact.loading")}</p> : null}
          {impactQuery.data && lines.length === 0 ? (
            <p>{t("staff.delete.impact.none")}</p>
          ) : null}
          {lines.length > 0 ? (
            <>
              <p className="font-medium text-text">{t("staff.delete.impact.intro")}</p>
              <ul className="list-disc space-y-1 pl-5">
                {lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </FormDialog>
    </>
  );
}
