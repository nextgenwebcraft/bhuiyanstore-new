"use client";

import { t } from "@bsd/i18n";
import { forwardRef, useImperativeHandle, useRef } from "react";
import { Button } from "@/components/button";

export type DraftChoice = "save" | "discard" | "stay";
export type DraftSwitchPromptHandle = { ask: () => Promise<DraftChoice> };

/**
 * Save draft / Discard / Stay (guide section 4.2 step 2). One shared prompt, opened by
 * CompanySwitcher whenever a DraftGuard is active; only reports the user's choice — the caller
 * performs the actual save and decides whether to navigate.
 */
export const DraftSwitchPrompt = forwardRef<DraftSwitchPromptHandle>(
  function DraftSwitchPrompt(_props, ref) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const resolveRef = useRef<((choice: DraftChoice) => void) | null>(null);

    useImperativeHandle(ref, () => ({
      ask() {
        dialogRef.current?.showModal();
        return new Promise<DraftChoice>((resolve) => {
          resolveRef.current = resolve;
        });
      },
    }));

    function choose(choice: DraftChoice) {
      dialogRef.current?.close();
      resolveRef.current?.(choice);
      resolveRef.current = null;
    }

    return (
      <dialog
        ref={dialogRef}
        aria-label={t("draftGuard.title")}
        className="m-auto w-full max-w-sm rounded-lg border border-border bg-surface p-0 text-text backdrop:bg-black/40"
      >
        <div className="flex flex-col gap-4 p-4">
          <h2 className="text-lg font-semibold">{t("draftGuard.title")}</h2>
          <p className="text-text-muted">{t("draftGuard.hint")}</p>
          <div className="flex flex-col gap-2">
            <Button variant="primary" onClick={() => choose("save")}>
              {t("draftGuard.save")}
            </Button>
            <Button onClick={() => choose("discard")}>{t("draftGuard.discard")}</Button>
            <Button onClick={() => choose("stay")}>{t("draftGuard.stay")}</Button>
          </div>
        </div>
      </dialog>
    );
  },
);
