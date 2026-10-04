"use client";

import { useEffect } from "react";
import { t } from "@bsd/i18n";
import { Button } from "@/components/button";
import { StatePanel } from "@/components/state-panel";

export default function CompanyPageError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col gap-3">
      <StatePanel
        tone="error"
        title={t("error.pageCrashed")}
        hint={t("error.pageCrashedHint")}
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => retry()}>
              {t("state.retry")}
            </Button>
            <Button onClick={() => window.location.reload()}>{t("error.reload")}</Button>
          </div>
        }
      />
      <pre className="overflow-auto rounded-lg border border-border bg-surface-muted p-3 text-xs whitespace-pre-wrap text-text-muted">
        {error.digest ? `${error.message} (${error.digest})` : error.message}
      </pre>
    </div>
  );
}
