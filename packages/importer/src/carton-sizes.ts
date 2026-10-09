import ExcelJS from "exceljs";
import { readMonthSheet } from "./month-sheet";

export type SheetCartonSize = {
  name: string;
  row: number;
  /** The first factor the person grids use; null when the sheet has none for this product. */
  size: string | null;
  /** Every distinct factor seen; more than one is a conflict to resolve by hand (P04). */
  seen: string[];
};

/** Carton sizes of one month sheet, read from its person-grid formulas (D37, local only). */
export async function readCartonSizes(path: string, sheet: string): Promise<SheetCartonSize[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const read = readMonthSheet(workbook, sheet);
  return read.products.map((p) => ({
    name: p.name,
    row: p.row,
    size: p.cartonSize ?? null,
    seen: p.cartonSizesSeen ?? [],
  }));
}
