import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { computeMonth } from "@bsd/domain";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { compareWithSaved } from "./compare";
import { monthOfSheetName, readMonthSheet } from "./month-sheet";

/**
 * Local-only comparison against the real workbook (PLAN §4). The workbook holds real business
 * data and is gitignored, so this never runs in `pnpm check` and prints to the console only.
 *
 *   pnpm verify:workbook                         # docs/*.xlsx, sheets in BSD_SHEETS
 *   BSD_WORKBOOK=path BSD_SHEETS="Aug 2026" pnpm verify:workbook
 *
 * Sheets listed in BSD_STRICT must have no unexplained difference.
 */
const docs = resolve(import.meta.dirname, "../../../docs");
const workbookPath =
  process.env.BSD_WORKBOOK ??
  (() => {
    try {
      const file = readdirSync(docs).find((f) => f.endsWith(".xlsx") && !f.startsWith("~$"));
      return file ? join(docs, file) : undefined;
    } catch {
      return undefined;
    }
  })();
const sheets = (process.env.BSD_SHEETS ?? "Aug 2026,Sep 2026").split(",").map((s) => s.trim());
const strict = new Set(
  (process.env.BSD_STRICT ?? "Aug 2026,Sep 2026").split(",").map((s) => s.trim()),
);

describe.skipIf(!workbookPath)("workbook verification (local only)", () => {
  it("recalculates each month from raw inputs and matches Excel's saved values", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(workbookPath as string);
    const failures: string[] = [];
    for (const sheet of sheets) {
      if (!monthOfSheetName(sheet) || !workbook.getWorksheet(sheet)) {
        failures.push(`${sheet}: not a month sheet in the workbook`);
        continue;
      }
      const read = readMonthSheet(workbook, sheet);
      const out = computeMonth(read.input);
      const results = compareWithSaved(out, read.expectations);
      const lines = [
        `\n=== ${sheet}: ${read.input.days.length} days, ${read.products.length} products, persons ${read.persons.join(", ")} ===`,
      ];
      for (const r of results) {
        const status = r.unexplained.length
          ? "DIFF "
          : r.known.length
            ? "KNOWN"
            : r.intended.length
              ? "DESIGN"
              : "MATCH";
        lines.push(
          `${status} ${r.check}: ${r.matched}/${r.compared}${r.known.length ? ` (+${r.known.length} known Excel mistakes)` : ""}${r.intended.length ? ` (+${r.intended.length} intended differences)` : ""}`,
        );
        for (const d of r.intended.slice(0, 1))
          lines.push(`      intended: ${d.where}: ${d.knownMistake}`);
        for (const d of r.unexplained.slice(0, 3))
          lines.push(`      ${d.where}: engine ${d.engine} vs excel ${d.excel}`);
        for (const d of r.known.slice(0, 2))
          lines.push(`      known: ${d.where}: ${d.knownMistake}`);
        if (r.unexplained.length && strict.has(sheet)) failures.push(`${sheet}: ${r.check}`);
      }
      lines.push(
        `Month sales ${out.month.totals.salesTotal}, gross profit ${out.month.totals.profitTotal}, market due ${out.month.marketDue.closing}`,
      );
      const counts = new Map<string, number>();
      for (const w of out.warnings) counts.set(w.code, (counts.get(w.code) ?? 0) + 1);
      if (counts.size)
        lines.push(`Engine warnings: ${[...counts].map(([k, v]) => `${k} ×${v}`).join(", ")}`);
      for (const n of read.notes) lines.push(`Note: ${n}`);
      process.stdout.write(`${lines.join("\n")}\n`);
    }
    expect(failures).toEqual([]);
  }, 600_000);
});
