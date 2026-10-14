/** One labelled metric. The value arrives formatted; tiles never calculate (guide 21.1). */
export function StatTile({
  label,
  value,
  hint,
  emphasis = false,
  large = false,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
  /** A bigger value for the one figure the page is about. */
  large?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 shadow-card ${
        emphasis ? "border-brand/30 bg-brand/8" : "border-border bg-surface"
      }`}
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
