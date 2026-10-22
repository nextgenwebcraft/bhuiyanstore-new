/** One summary figure above a table. Values arrive formatted; the panel never calculates (guide 21.1). */
export type SummaryItem = {
  label: string;
  value: React.ReactNode;
  /** A small second line under the value, e.g. the pieces behind an amount. */
  hint?: React.ReactNode;
  emphasis?: boolean;
};

/** A compact strip of totals shown above a table, e.g. row count and column totals. */
export function TableSummary({ items, label }: { items: SummaryItem[]; label?: string }) {
  if (items.length === 0) return null;
  return (
    <dl aria-label={label} className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
      {items.map((item) => (
        <div
          key={item.label}
          className={`rounded-xl border px-3 py-2 shadow-card ${
            item.emphasis ? "border-brand/30 bg-brand/8" : "border-border bg-surface"
          }`}
        >
          <dt className="truncate text-[11px] text-text-muted" title={item.label}>
            {item.label}
          </dt>
          <dd className="mt-0.5 text-base font-semibold tabular-nums">{item.value}</dd>
          {item.hint ? (
            <dd className="text-[11px] text-text-subtle tabular-nums">{item.hint}</dd>
          ) : null}
        </div>
      ))}
    </dl>
  );
}
