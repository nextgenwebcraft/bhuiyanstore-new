import { t } from "@bsd/i18n";
import { errorCodeOf } from "@/data/ports/service-error";
import { Button } from "./button";
import { StatePanel } from "./state-panel";

/** The shared failed-read state with a retry action (guide 5.5). */
export function QueryError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <StatePanel
      tone="error"
      title={t(`error.${errorCodeOf(error)}`)}
      action={<Button onClick={onRetry}>{t("state.retry")}</Button>}
    />
  );
}
