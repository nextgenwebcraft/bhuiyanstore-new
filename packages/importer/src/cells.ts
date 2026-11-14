import { Decimal } from "@bsd/domain";
import type { Cell, Worksheet } from "exceljs";
import { evaluateArithmetic } from "./arithmetic";

export function cellAt(ws: Worksheet, row: number, col: number): Cell {
  return ws.getCell(row, col);
}

/** Formula text without `=`, including translated shared formulas; null for typed values. */
export function formulaOf(cell: Cell): string | null {
  const v = cell.value;
  if (v && typeof v === "object" && ("formula" in v || "sharedFormula" in v)) {
    return cell.formula ?? null;
  }
  return null;
}

/** Excel's saved result: typed numbers, or the cached result of a formula. */
export function savedNumber(cell: Cell): Decimal | null {
  const v = cell.value;
  if (typeof v === "number") return new Decimal(String(v));
  if (v && typeof v === "object" && "result" in v && typeof v.result === "number") {
    return new Decimal(String(v.result));
  }
  return null;
}

/** A raw input: a typed number or typed arithmetic (`=20+30`). Formulas that read cells are not inputs. */
export function inputNumber(cell: Cell): Decimal | null {
  const v = cell.value;
  if (typeof v === "number") return new Decimal(String(v));
  if (typeof v === "string") return evaluateArithmetic(v.trim());
  const f = formulaOf(cell);
  return f === null ? null : evaluateArithmetic(f);
}

export function textOf(cell: Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (typeof v === "object" && "richText" in v)
    return v.richText
      .map((t) => t.text)
      .join("")
      .trim();
  return "";
}

/** Lower-case, single-spaced header text for matching. */
export function headerKey(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function columnNumber(letters: string): number {
  return [...letters.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
}
