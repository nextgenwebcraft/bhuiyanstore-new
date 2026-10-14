import { Decimal, type MonthOutput } from "@bsd/domain";
import { withinTolerance, type Expectation } from "./month-sheet";

export type Difference = { where: string; engine: string; excel: string; knownMistake?: string };

export type CheckResult = {
  check: string;
  compared: number;
  matched: number;
  /** Differences explained by a known workbook mistake (PLAN §2.6). */
  known: Difference[];
  /** Differences that are owner decisions (D47, D48), not mistakes; the reason is in `knownMistake`. */
  intended: Difference[];
  unexplained: Difference[];
};

/** Compares engine output with Excel's saved values, check by check (PLAN §8 step 4). */
export function compareWithSaved(
  out: MonthOutput,
  expectations: readonly Expectation[],
): CheckResult[] {
  const results = new Map<string, CheckResult>();
  for (const e of expectations) {
    const result = results.get(e.check) ?? {
      check: e.check,
      compared: 0,
      matched: 0,
      known: [],
      intended: [],
      unexplained: [],
    };
    results.set(e.check, result);
    result.compared++;
    const raw = e.engine(out);
    const engine = new Decimal(raw ?? "0");
    if (withinTolerance(engine, e.excel)) {
      result.matched++;
      continue;
    }
    if (e.intended?.accepts(engine, out)) {
      result.intended.push({
        where: e.where,
        engine: engine.toString(),
        excel: e.excel.toString(),
        knownMistake: e.intended.reason,
      });
      continue;
    }
    const diff: Difference = {
      where: e.where,
      engine: engine.toString(),
      excel: e.excel.toString(),
      ...(e.knownMistake ? { knownMistake: e.knownMistake } : {}),
    };
    (e.knownMistake ? result.known : result.unexplained).push(diff);
  }
  return [...results.values()];
}
