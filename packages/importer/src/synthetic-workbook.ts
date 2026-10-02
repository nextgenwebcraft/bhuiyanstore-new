import ExcelJS from "exceljs";

/* Test-only fixture (no real data): a two-day month sheet in the workbook layout. */
const HEADERS_19 = [
  "Due Quantity",
  "Balance Quantity",
  "Due price",
  "Due Total Price",
  "Receive",
  "Purchase Unit Price",
  "Total Price",
  "Total Due Receive sales Price",
  "Samari",
  "Firot",
  "Delevary",
  "DAMAGE PRODUCT",
  "Sales Unit Price",
  "Total Price Sales Price",
  "Total Purchase Price",
  "Firot Product Price",
  "total profit",
  "present stock Per Pice",
  "present stock amount",
];
/** The workbook's wide blocks insert a blank column after Firot. */
const HEADERS_20 = [...HEADERS_19.slice(0, 10), "", ...HEADERS_19.slice(10)];
const GRID_19 = ["Amount", "Caton", "Pice", "Total", "Firot Caton +", "Pice", "Total", "Mamun"];
const GRID_20 = ["Amount", "Caton", "Pice", "", "Total", "Firot Caton +", "Pice", "Total", "Mamun"];

/** A synthetic two-day sheet in the workbook layout; no real data. */
export function syntheticWorkbook(
  names: { sheet: string; previous: string } = { sheet: "Nov 2026", previous: "Oct 2026" },
): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  const previous = wb.addWorksheet(names.previous);
  previous.getCell("VR7").value = 100;
  const ws = wb.addWorksheet(names.sheet);
  const set = (r: number, c: number, value: ExcelJS.CellValue) => {
    ws.getCell(r, c).value = value;
  };
  const f = (formula: string, result?: number): ExcelJS.CellValue =>
    result === undefined
      ? ({ formula } as ExcelJS.CellValue)
      : ({ formula, result } as ExcelJS.CellValue);

  set(5, 2, "Product Name");
  HEADERS_19.forEach((h, i) => set(5, 3 + i, h));
  HEADERS_20.forEach((h, i) => set(5, 22 + i, h));
  [
    "Per Day sales in amount",
    "Due",
    "Credit",
    "SR Rohim Sort",
    "SR Rohim Over",
    "Total Amount",
    "Operating Cost",
  ].forEach((h, i) => set(5, 42 + i, h));

  // Products on rows 7 and 9; row 8 is blank, as in real sheets.
  set(7, 2, "Alpha 250ml");
  set(9, 2, "Beta 1lt");
  set(10, 16, f("SUM(P7:P9)", 528));

  // Day 1 (block at C): opening from literal / previous sheet, typed prices and arithmetic.
  set(7, 4, f("5+C7-G7", -43));
  set(7, 5, 10);
  set(7, 7, 48);
  set(7, 8, 9.5);
  set(7, 11, f("F15+0", 60));
  set(7, 15, 11);
  set(7, 16, f("(M7-N7)*O7", 528));
  set(7, 20, f(`'${names.previous}'!VR7+G7-M7`, 100));
  set(9, 4, f("C9-G9", 0));
  set(9, 5, 20);
  set(9, 8, f("18+1", 19));
  set(9, 15, 22.5);
  set(9, 20, f("0+G9-M9", 0));

  // Day 2 (20-column block at V): Alpha's sale price changes; other prices carry forward.
  set(7, 24, f("E7", 10));
  set(7, 27, f("H7", 9.5));
  set(7, 35, 12);
  set(9, 24, f("E9", 20));
  set(9, 27, f("H9", 19));
  set(9, 35, f("O9", 22.5));
  set(9, 36, f("(AF9-AG9)*AI9", 270));
  set(9, 40, f("T9+Z9-AG9", -12));

  // Person grid: header row 14, rows 15..17 mirror product rows 7..9.
  GRID_19.forEach((h, i) => set(14, 3 + i, h));
  GRID_20.forEach((h, i) => set(14, 22 + i, h));
  set(15, 2, "Alpha 250ml");
  set(17, 2, "Beta 1lt");
  set(15, 4, 2);
  set(15, 5, 12);
  set(15, 6, f("(D15*24)+E15", 60));
  set(15, 8, 12);
  set(15, 9, f("(G15*24)+H15", 12));
  set(15, 10, f("F15-I15", 48));
  set(17, 26, 12); // typed total, no carton formula
  set(17, 30, f("Z17-AD17", 12));

  // Money: day rows 7 and 8; month rows 10 (sum), 11 (salary adjustment), 12 (net).
  set(6, 43, 25);
  set(7, 43, 100);
  set(7, 44, 50);
  set(7, 45, 40);
  set(7, 42, f("P10", 528));
  set(7, 47, f("(AP7+AR7+AT7)-(AQ7+AS7+AV7)", 438));
  set(8, 46, f("4+6", 10));
  set(8, 42, f("AJ10", 270));
  set(8, 48, 30);
  set(8, 47, f("(AP8+AR8+AT8)-(AQ8+AS8+AV8)", 250));
  set(12, 43, f("AQ6+AQ10-AR10", 75));
  set(12, 45, f("(AS10-AT10)-AS11", 30));
  return wb;
}
