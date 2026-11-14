import { labelOf } from "@bsd/i18n";
import ExcelJS from "exceljs";

/** The parts of a report DTO the exports need (structurally the contracts `Report`). */
export type ExportableReport = {
  report: string;
  from: string;
  to: string;
  tables: {
    title: string;
    columns: { key: string; label: string; kind: string }[];
    rows: { cells: Record<string, string | null> }[];
    totals: Record<string, string | null> | null;
  }[];
};

const NUMERIC = new Set(["quantity", "cartons", "money", "rate"]);

function cellText(kind: string, value: string | null): string {
  if (value === null) return "";
  return kind === "label" ? labelOf(value) : value;
}

function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** UTF-8 CSV (with BOM so Excel reads Bangla); tables follow each other after a blank line. */
export function reportCsv(report: ExportableReport): string {
  const lines: string[] = [];
  for (const table of report.tables) {
    if (lines.length) lines.push("");
    lines.push(csvField(labelOf(table.title)));
    lines.push(table.columns.map((c) => csvField(labelOf(c.label))).join(","));
    for (const row of table.rows) {
      lines.push(
        table.columns.map((c) => csvField(cellText(c.kind, row.cells[c.key] ?? null))).join(","),
      );
    }
    if (table.totals) {
      const totals = table.totals;
      lines.push(
        table.columns
          .map((c, i) => csvField(i === 0 ? labelOf("common.total") : (totals[c.key] ?? "")))
          .join(","),
      );
    }
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/**
 * One sheet per table. Numeric cells are written as Excel numbers for the owner's own sums; the
 * exact decimal strings stay the source of truth in the API and CSV.
 */
export async function buildReportWorkbook(report: ExportableReport): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  report.tables.forEach((table, index) => {
    const name = `${index + 1} ${labelOf(table.title)}`.replace(/[\\/?*[\]:]/g, " ").slice(0, 31);
    const ws = workbook.addWorksheet(name);
    ws.addRow([labelOf(table.title), `${report.from} – ${report.to}`]).font = { bold: true };
    ws.addRow(table.columns.map((c) => labelOf(c.label))).font = { bold: true };
    const value = (kind: string, raw: string | null) => {
      if (raw === null) return null;
      return NUMERIC.has(kind) && /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : cellText(kind, raw);
    };
    for (const row of table.rows) {
      ws.addRow(table.columns.map((c) => value(c.kind, row.cells[c.key] ?? null)));
    }
    if (table.totals) {
      const totals = table.totals;
      ws.addRow(
        table.columns.map((c, i) =>
          i === 0 ? labelOf("common.total") : value(c.kind, totals[c.key] ?? null),
        ),
      ).font = { bold: true };
    }
    ws.columns.forEach((column) => {
      column.width = 18;
    });
    ws.views = [{ state: "frozen", ySplit: 2 }];
  });
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
