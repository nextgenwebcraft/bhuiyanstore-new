"use client";

import type { TranslationKey } from "@bsd/i18n";
import { t } from "@bsd/i18n";
import { useState } from "react";
import { useConfirm } from "@/components/confirm-dialog";
import { describeError } from "@/data/ports/service-error";

/**
 * Runs one user action: optional confirm dialog, then the async work, keeping the form-level
 * error message and a busy flag. Resolves `false` when cancelled or failed.
 */
export function useAsyncAction() {
  const confirm = useConfirm();
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function run(
    action: () => Promise<unknown>,
    options?: { confirm?: TranslationKey; confirmDetail?: string },
  ): Promise<boolean> {
    setError(undefined);
    if (options?.confirm) {
      const ok = await confirm({
        title: t("common.confirmTitle"),
        message: t(options.confirm),
        ...(options.confirmDetail ? { detail: options.confirmDetail } : {}),
        confirmLabel: t("common.confirm"),
      });
      if (!ok) return false;
    }
    setBusy(true);
    try {
      await action();
      return true;
    } catch (e) {
      setError(describeError(e, []).form);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { run, error, busy };
}
