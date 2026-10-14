import { reportQuerySchema } from "@bsd/contracts";
import { daysBetween, todayBusinessDate } from "@bsd/domain";
import { invalid, parseInput } from "./errors";

export const MAX_REPORT_DAYS = 366;

/**
 * A report or statement range: from ≤ to, `to` stopped at today, at most a year. `allTime`
 * lifts the limit (D48 company account: go-live cutoff → today; the ledger moves `from` up to
 * the cutoff, so the run never covers more than the go-live period).
 */
export function parseReportRange(
  query: unknown,
  options: { allTime?: boolean } = {},
): { from: string; to: string } {
  const range = parseInput(reportQuerySchema, query);
  const today = todayBusinessDate();
  const to = range.to > today ? today : range.to;
  if (range.from > to) throw invalid("from", "validation.daily.future");
  if (!options.allTime && daysBetween(range.from, to) >= MAX_REPORT_DAYS) {
    throw invalid("to", "validation.report.rangeTooLong");
  }
  return { from: range.from, to };
}
