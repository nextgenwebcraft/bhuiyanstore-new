import type { EngineWarningDto } from "@bsd/contracts";

type WarningGroup = {
  code: string;
  /** Distinct business dates the warning was raised on. */
  days: number;
  firstDate: string;
  lastDate: string;
  /** Affected products and people, each once, in first-seen order. */
  productIds: string[];
  staffIds: string[];
};

/**
 * The engine raises one warning per day per product or person, so a month range repeats the same
 * line hundreds of times. One group per code, in first-seen order.
 */
export function groupWarnings(warnings: readonly EngineWarningDto[]): WarningGroup[] {
  const groups = new Map<
    string,
    { dates: Set<string>; first: string; last: string; products: Set<string>; staff: Set<string> }
  >();
  for (const w of warnings) {
    let g = groups.get(w.code);
    if (!g) {
      g = { dates: new Set(), first: w.date, last: w.date, products: new Set(), staff: new Set() };
      groups.set(w.code, g);
    }
    g.dates.add(w.date);
    if (w.date < g.first) g.first = w.date;
    if (w.date > g.last) g.last = w.date;
    if (w.productId) g.products.add(w.productId);
    if (w.staffId) g.staff.add(w.staffId);
  }
  return [...groups].map(([code, g]) => ({
    code,
    days: g.dates.size,
    firstDate: g.first,
    lastDate: g.last,
    productIds: [...g.products],
    staffIds: [...g.staff],
  }));
}
