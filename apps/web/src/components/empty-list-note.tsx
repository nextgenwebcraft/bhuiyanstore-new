import { t, type TranslationKey } from "@bsd/i18n";

/** The dashed note shown in place of an empty table. */
export function EmptyListNote({ textKey }: { textKey: TranslationKey }) {
  return (
    <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-text-muted">
      {t(textKey)}
    </p>
  );
}
