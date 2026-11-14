"use client";

import { t } from "@bsd/i18n";
import { useId, useState } from "react";
import { Field, inputClass } from "@/components/field";
import { FormDialog } from "@/components/form-dialog";
import { describeError } from "@/data/ports/service-error";
import { useDeleteCompany } from "@/data/queries";

/**
 * Super-admin-only hard delete of a company with no activity (D90). Two typed confirmations
 * (the fixed phrase, then the company's own name) guard the irreversible action; the server
 * still refuses a company that has any product, shop, staff assignment, stock, DSR day or
 * money entry.
 */
export function DeleteCompanyDialog({
  company,
  onClose,
}: {
  company: { id: string; name: string };
  onClose: () => void;
}) {
  const id = useId();
  const del = useDeleteCompany();
  const [phrase, setPhrase] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>();
  const requiredPhrase = t("company.delete.phrase");
  const ready = phrase === requiredPhrase && name === company.name;

  async function confirm() {
    setError(undefined);
    try {
      await del.mutateAsync(company.id);
      onClose();
    } catch (e) {
      setError(describeError(e, []).form);
    }
  }

  return (
    <FormDialog
      open
      title={`${t("common.delete")}: ${company.name}`}
      error={error}
      pending={del.isPending}
      submitDisabled={!ready}
      submitLabel={t("common.delete")}
      onSubmit={() => void confirm()}
      onClose={onClose}
    >
      <p className="text-sm text-text-muted">{t("company.delete.warning")}</p>
      <Field id={`${id}-phrase`} label={`${t("company.delete.phraseLabel")}: ${requiredPhrase}`}>
        <input
          id={`${id}-phrase`}
          value={phrase}
          onChange={(event) => setPhrase(event.target.value)}
          className={inputClass}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <Field id={`${id}-name`} label={`${t("company.delete.nameLabel")}: ${company.name}`}>
        <input
          id={`${id}-name`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={inputClass}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
    </FormDialog>
  );
}
