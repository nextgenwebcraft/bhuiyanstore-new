/** What a figure means, as its tile's colour: brand (the old emphasis), a status, or plain. */
export type StatTone = "plain" | "brand" | "success" | "error" | "warning" | "info";

const TONE_CLASS: Record<StatTone, string> = {
  plain: "border-border bg-surface",
  brand: "border-brand/30 bg-brand/8",
  success: "border-success/35 bg-success/10",
  error: "border-error/35 bg-error/10",
  warning: "border-warning/35 bg-warning/10",
  info: "border-info/35 bg-info/10",
};

/** A labelled figure, e.g. a page-level total. */
export function StatTile({
  label,
  value,
  hint,
  emphasis = false,
  tone,
  large = false,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
  /** Overrides `emphasis` when given. */
  tone?: StatTone | undefined;
  /** A bigger value for the one figure the page is about. */
  large?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 shadow-card ${TONE_CLASS[tone ?? (emphasis ? "brand" : "plain")]}`}
    >
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd
        className={`mt-1.5 font-semibold tracking-tight tabular-nums ${large ? "text-3xl" : "text-xl"}`}
      >
        {value}
      </dd>
      {hint ? <dd className="mt-1 text-xs text-text-subtle">{hint}</dd> : null}
    </div>
  );
}
