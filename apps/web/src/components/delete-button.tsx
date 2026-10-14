"use client";

import { t } from "@bsd/i18n";
import { useState } from "react";
import { describeError } from "@/data/ports/service-error";
import { Button } from "./button";
import { FormDialog } from "./form-dialog";

/**
 * Delete action with a confirm dialog (D51). The server refuses a record that was ever used and
 * answers with a Bangla message (suggesting deactivation), which is shown inside the dialog.
 */
export function DeleteButton({
  name,
  message,
  onDelete,
  className = "",
}: {
  /** The record's name, shown in the dialog title. */
  name: string;
  /** The confirmation question. */
  message: string;
  onDelete: () => Promise<unknown>;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  function close() {
    setOpen(false);
    setError(undefined);
  }

  async function confirm() {
    setPending(true);
    setError(undefined);
    try {
      await onDelete();
      setOpen(false);
    } catch (e) {
      setError(describeError(e, []).form);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button className={className} onClick={() => setOpen(true)}>
        {t("common.delete")}
      </Button>
      <FormDialog
        open={open}
        title={`${t("common.delete")}: ${name}`}
        error={error}
        pending={pending}
        submitLabel={t("common.delete")}
        onSubmit={() => void confirm()}
        onClose={close}
      >
        <p className="text-sm text-text-muted">{message}</p>
      </FormDialog>
    </>
  );
}
