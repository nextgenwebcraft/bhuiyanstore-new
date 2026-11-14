import ExcelJS from "exceljs";
import { readMonthSheet, type SheetReadResult } from "./month-sheet";

/** Reads one month sheet from a workbook file (local only, D45; the workbook is never copied). */
export async function readMonthSheetFile(path: string, sheet: string): Promise<SheetReadResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  return readMonthSheet(workbook, sheet);
}
