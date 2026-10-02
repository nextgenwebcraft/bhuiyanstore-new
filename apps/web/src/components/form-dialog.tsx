"use client";

import { t } from "@bsd/i18n";
import { useEffect, useRef, type FormEvent } from "react";
import { Button } from "./button";
import { StatePanel } from "./state-panel";

/**
 * Shared create/edit dialog shell (guide 21.6): native `<dialog>` (T13), title, form-level error,
 * cancel and save. Open state is owned by the caller; Escape and cancel both call `onClose`.
 */
export function FormDialog({
  open,
  title,
  error,
  pending,
  submitLabel = t("product.save"),
  onSubmit,
  onClose,
  children,
  wide = false,
}: {
  open: boolean;
  title: string;
  error?: string | undefined;
  pending: boolean;
  submitLabel?: string;
  onSubmit: () => void;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!pending) onSubmit();
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      aria-label={title}
      className={`m-auto w-full ${wide ? "max-w-2xl" : "max-w-md"} rounded-2xl border border-border bg-surface p-0 text-text shadow-raised backdrop:bg-black/30 backdrop:backdrop-blur-sm`}
    >
      {open ? (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-5 sm:p-6" noValidate>
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          {error ? <StatePanel tone="error" title={error} /> : null}
          {children}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? t("product.saving") : submitLabel}
            </Button>
          </div>
        </form>
      ) : null}
    </dialog>
  );
}
