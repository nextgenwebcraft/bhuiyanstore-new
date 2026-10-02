/** One labelled metric. The value arrives formatted; tiles never calculate (guide 21.1). */
export function StatTile({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string;
  value: string;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border p-4 shadow-card ${
        emphasis ? "border-brand/25 bg-brand/5" : "border-border bg-surface"
      }`}
    >
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="mt-1.5 text-xl font-semibold tracking-tight tabular-nums">{value}</dd>
      {hint ? <dd className="mt-1 text-xs text-text-subtle">{hint}</dd> : null}
    </div>
  );
}
