import {
  Decimal,
  type DayInput,
  type DsrLineInput,
  type MoneyEntryInput,
  type MoneyKind,
  type MonthInput,
  type MonthOutput,
  type OpeningProduct,
  type ProductDayInput,
  type StaffBalances,
} from "@bsd/domain";
import type { Workbook, Worksheet } from "exceljs";
import {
  cellAt,
  columnNumber,
  formulaOf,
  headerKey,
  inputNumber,
  savedNumber,
  textOf,
} from "./cells";

/** A saved Excel value and how to find the same figure in the engine output. */
export type Expectation = {
  check: string;
  where: string;
  excel: Decimal;
  engine: (out: MonthOutput) => string | null | undefined;
  /** Set when the workbook cell itself is known to be wrong (PLAN §2.6). */
  knownMistake?: string;
};

export type SheetProduct = { id: string; name: string; row: number };

export type MoneyColumn = {
  header: string;
  col: number;
  kind: MoneyKind | null;
  staffId?: string;
  category?: string;
};

export type SheetReadResult = {
  sheet: string;
  month: string;
  input: MonthInput;
  expectations: Expectation[];
  products: SheetProduct[];
  persons: string[];
  moneyColumns: MoneyColumn[];
  notes: string[];
};

const BLOCK_START = "due quantity";
const BLOCK_FIELDS = {
  dueQty: "due quantity",
  balance: "balance quantity",
  duePrice: "due price",
  receive: "receive",
  purchasePrice: "purchase unit price",
  samari: "samari",
  firot: "firot",
  damage: "damage product",
  salePrice: "sales unit price",
  salesTotal: "total price sales price",
  profit: "total profit",
  stock: "present stock per pice",
  stockAmount: "present stock amount",
} as const;
type BlockField = keyof typeof BLOCK_FIELDS;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const TOLERANCE = new Decimal("0.01");

export function monthOfSheetName(name: string): string | null {
  const m = /^([A-Za-z]{3})\w*\s+(\d{4})$/.exec(name.trim());
  const index = m ? MONTHS.indexOf((m[1] ?? "").toLowerCase()) : -1;
  return m && index >= 0 ? `${m[2]}-${String(index + 1).padStart(2, "0")}` : null;
}

export function withinTolerance(a: Decimal, b: Decimal): boolean {
  return a.sub(b).abs().lte(TOLERANCE);
}

/**
 * Reads one month sheet by its header text (PLAN §8): daily blocks by their row headers (19 or
 * 20 columns wide), person grids by their Caton/Total labels, and right-side money columns by
 * name. Only raw inputs feed the engine; Excel's saved results become expectations to compare.
 */
export function readMonthSheet(workbook: Workbook, sheetName: string): SheetReadResult {
  const ws = workbook.getWorksheet(sheetName);
  if (!ws) throw new RangeError(`sheet not found: ${sheetName}`);
  const month = monthOfSheetName(sheetName);
  if (!month) throw new RangeError(`sheet name is not a month: ${sheetName}`);
  const [year, monthNumber] = month.split("-").map(Number) as [number, number];
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const notes: string[] = [];
  const expectations: Expectation[] = [];

  const headerRow = findRow(
    ws,
    1,
    12,
    (r) => headerKey(textOf(cellAt(ws, r, 2))) === "product name",
  );
  if (headerRow === null) throw new RangeError(`no "Product Name" header in ${sheetName}`);

  const headerCells: { col: number; key: string }[] = [];
  ws.getRow(headerRow).eachCell((cell, col) => {
    headerCells.push({ col, key: headerKey(textOf(cell)) });
  });

  // The product rows are the range of the first block's sales total, e.g. =SUM(P7:P39).
  const salesTotalCol = headerCells.find((h) => h.key === "total price sales price")?.col;
  let firstRow = headerRow + 2;
  let totalsRow = 0;
  for (let r = headerRow + 1; salesTotalCol !== undefined && r <= headerRow + 120; r++) {
    const m = /^SUM\(\$?[A-Z]+\$?(\d+):\$?[A-Z]+\$?(\d+)\)$/i.exec(
      formulaOf(cellAt(ws, r, salesTotalCol)) ?? "",
    );
    if (m) {
      firstRow = Number(m[1]);
      totalsRow = Number(m[2]) + 1;
      break;
    }
  }
  if (!totalsRow) throw new RangeError(`no sales total row (=SUM(...)) in ${sheetName}`);
  const products: SheetProduct[] = [];
  for (let r = firstRow; r < totalsRow; r++) {
    const name = textOf(cellAt(ws, r, 2));
    if (name) products.push({ id: `p${r}`, name, row: r });
  }
  const starts = headerCells.filter((h) => h.key === BLOCK_START).map((h) => h.col);
  if (!starts.length) throw new RangeError(`no daily blocks in ${sheetName}`);

  const blocks = starts.map((start, i) => {
    const end = starts[i + 1] ?? start + 21;
    const cols: Partial<Record<BlockField, number>> = {};
    for (const h of headerCells) {
      if (h.col < start || h.col >= end) continue;
      for (const [field, key] of Object.entries(BLOCK_FIELDS) as [BlockField, string][]) {
        if (h.key === key && cols[field] === undefined) cols[field] = h.col;
      }
    }
    return { start, end: (cols.stockAmount ?? end - 1) + 1, cols };
  });
  const widths = new Set(blocks.map((b) => b.end - b.start));
  if (widths.size > 1) notes.push(`daily blocks have mixed widths: ${[...widths].join(", ")}`);
  const lastBlockEnd = blocks.at(-1)?.end ?? 0;

  // Person grids sit below the products: header rows with "Caton" labels.
  const grids: { headerRow: number; rows: Map<string, number> }[] = [];
  for (let r = totalsRow + 1; r <= totalsRow + 200; r++) {
    const firstBlock = blocks[0];
    if (!firstBlock) break;
    let isGrid = false;
    for (let c = firstBlock.start; c < firstBlock.end; c++) {
      if (headerKey(textOf(cellAt(ws, r, c))) === "caton") isGrid = true;
    }
    if (!isGrid) continue;
    // Grid rows follow the product order; names can repeat, so match by position.
    const rows = new Map<string, number>();
    products.forEach((product) => {
      const gr = r + 1 + (product.row - firstRow);
      const name = textOf(cellAt(ws, gr, 2));
      if (name && headerKey(name) !== headerKey(product.name)) {
        notes.push(`grid row ${gr} "${name}" differs from product "${product.name}"`);
      }
      rows.set(product.id, gr);
    });
    grids.push({ headerRow: r, rows });
    r += totalsRow - firstRow;
  }
  if (!grids.length) notes.push("no person grids found");

  const cartonSize = new Map<string, Decimal>();
  const persons = new Set<string>();
  let gridFallbacks = 0;
  const gridQuantity = (row: number, totalCol: number, productId: string): Decimal => {
    const cell = cellAt(ws, row, totalCol);
    const f = formulaOf(cell);
    if (f === null) return inputNumber(cell) ?? new Decimal(0);
    const m = /^\(?\s*([A-Z]+)(\d+)\s*\*\s*(\d+)\s*\)?\s*\+\s*([A-Z]+)(\d+)$/.exec(f.trim());
    if (m) {
      const factor = new Decimal(m[3] ?? "1");
      if (!cartonSize.has(productId)) cartonSize.set(productId, factor);
      const cartons = inputNumber(cellAt(ws, Number(m[2]), columnNumber(m[1] ?? "A")));
      const pieces = inputNumber(cellAt(ws, Number(m[5]), columnNumber(m[4] ?? "A")));
      return (cartons ?? new Decimal(0)).mul(factor).add(pieces ?? new Decimal(0));
    }
    gridFallbacks++;
    return savedNumber(cell) ?? new Decimal(0);
  };

  // Opening from the first block: "<opening>+C-G" where opening is a literal or another sheet's cell.
  const opening: Record<string, OpeningProduct> = {};
  const firstBlock = blocks[0];
  const openingFrom = (row: number, col: number | undefined): Decimal | null => {
    if (col === undefined) return null;
    const f = formulaOf(cellAt(ws, row, col));
    if (f === null) return null;
    const literal = /^\s*(-?\d+(?:\.\d+)?)\s*[+-]/.exec(f);
    if (literal) return new Decimal(literal[1] ?? "0");
    const ref = /^'?([^'!]+)'?!\$?([A-Z]+)\$?(\d+)/.exec(f);
    if (ref) {
      const other = workbook.getWorksheet(ref[1] ?? "");
      if (!other) return null;
      const cell = other.getCell(`${ref[2]}${ref[3]}`);
      // A blank cell in the previous month is zero, as in Excel.
      return savedNumber(cell) ?? (textOf(cell) === "" ? new Decimal(0) : null);
    }
    return /^[A-Z]+\d+\s*[+-]/.test(f.trim()) ? new Decimal(0) : null;
  };

  const days: (DayInput & { money: MoneyEntryInput[] })[] = [];
  blocks.slice(0, daysInMonth).forEach((block, index) => {
    const date = `${month}-${String(index + 1).padStart(2, "0")}`;
    const where = (label: string) => `${sheetName} day ${index + 1} ${label}`;
    const { cols } = block;
    const dayProducts: Record<string, ProductDayInput> = {};
    const dsrLines: DsrLineInput[] = [];

    for (const p of products) {
      const day: ProductDayInput = {};
      const num = (field: BlockField): Decimal | null =>
        cols[field] === undefined ? null : inputNumber(cellAt(ws, p.row, cols[field]));
      const ordered = num("dueQty");
      const received = num("receive");
      const damaged = num("damage");
      if (ordered && !ordered.isZero()) day.ordered = ordered.toString();
      if (received && !received.isZero()) day.received = received.toString();
      if (damaged && !damaged.isZero()) day.damaged = damaged.toString();
      for (const [kind, field] of [
        ["orderPrice", "duePrice"],
        ["costPrice", "purchasePrice"],
        ["salePrice", "salePrice"],
      ] as const) {
        const col = cols[field];
        if (col === undefined) continue;
        const cell = cellAt(ws, p.row, col);
        const typed = inputNumber(cell);
        const f = formulaOf(cell);
        const crossSheet = f !== null && f.includes("!") ? savedNumber(cell) : null;
        const price = typed ?? crossSheet;
        if (price) day[kind] = price.toString();
      }
      if (Object.keys(day).length) dayProducts[p.id] = day;

      // Saved per-product values for this day.
      const expect = (
        check: string,
        field: BlockField,
        pick: (out: MonthOutput) => string | null | undefined,
      ) => {
        const col = cols[field];
        if (col === undefined) return;
        const saved = savedNumber(cellAt(ws, p.row, col));
        if (saved)
          expectations.push({
            check,
            where: where(`${p.name} (${ws.getCell(p.row, col).address})`),
            excel: saved,
            engine: pick,
          });
      };
      const dayOf = (out: MonthOutput) =>
        out.days[index]?.products.find((x) => x.productId === p.id);
      expect("Samari", "samari", (o) => dayOf(o)?.issued);
      expect("Firot", "firot", (o) => dayOf(o)?.returned);
      expect("Sales amount", "salesTotal", (o) => dayOf(o)?.sales);
      expect("Gross profit", "profit", (o) => dayOf(o)?.grossProfit);
      expect("Goods due from company", "balance", (o) => dayOf(o)?.dueFromCompany);
      expect("Stock pieces", "stock", (o) => dayOf(o)?.stock);
      expect("Stock value", "stockAmount", (o) => dayOf(o)?.stockValue);

      if (index === 0 && firstBlock) {
        const stock = openingFrom(p.row, firstBlock.cols.stock);
        const due = openingFrom(p.row, firstBlock.cols.balance);
        if (stock === null) notes.push(`${p.name}: opening stock not found in block 1, using 0`);
        opening[p.id] = {
          stock: (stock ?? new Decimal(0)).toString(),
          dueFromCompany: (due ?? new Decimal(0)).toString(),
        };
      }
    }

    for (const grid of grids) {
      for (let c = block.start; c < block.end; c++) {
        if (headerKey(textOf(cellAt(ws, grid.headerRow, c))) !== "caton") continue;
        const label = (col: number) => headerKey(textOf(cellAt(ws, grid.headerRow, col)));
        const next = (from: number, test: (key: string) => boolean): number | null => {
          for (let x = from; x < block.end + 2; x++) if (test(label(x))) return x;
          return null;
        };
        const issueTotal = next(c + 1, (k) => k === "total");
        const returnStart = issueTotal && next(issueTotal + 1, (k) => k.startsWith("firot"));
        const returnTotal = returnStart && next(returnStart + 1, (k) => k === "total");
        const nameCol =
          returnTotal && next(returnTotal + 1, (k) => k !== "" && k !== "amount" && k !== "pice");
        if (!issueTotal || !returnTotal || !nameCol) continue;
        const person = textOf(cellAt(ws, grid.headerRow, nameCol));
        const staffId = headerKey(person);
        persons.add(person);
        for (const [productId, row] of grid.rows) {
          const issued = gridQuantity(row, issueTotal, productId);
          const returned = gridQuantity(row, returnTotal, productId);
          if (!issued.isZero() || !returned.isZero()) {
            dsrLines.push({
              staffId,
              productId,
              ...(issued.isZero() ? {} : { issued: issued.toString() }),
              ...(returned.isZero() ? {} : { returned: returned.toString() }),
            });
          }
          const netCell = cellAt(ws, row, nameCol);
          const saved = savedNumber(netCell);
          const netFormula = formulaOf(netCell) ?? "";
          if (saved) {
            expectations.push({
              check: "Person net (issue − return)",
              where: where(
                `${person} ${products.find((p) => p.id === productId)?.name ?? productId} (${netCell.address})`,
              ),
              excel: saved,
              engine: (o) =>
                o.days[index]?.persons.find(
                  (x) => x.staffId === staffId && x.productId === productId,
                )?.net ?? "0",
              ...(netFormula.includes("*")
                ? { knownMistake: `net multiplies: =${netFormula}` }
                : {}),
            });
          }
        }
        c = nameCol;
      }
    }

    days.push({ date, products: dayProducts, dsrLines, money: [] });
  });
  if (gridFallbacks)
    notes.push(`${gridFallbacks} grid totals were not "(cartons*size)+pieces"; used saved values`);

  for (const p of products) {
    const first = days[0]?.products?.[p.id];
    const o = opening[p.id];
    if (o && first) {
      // Day-1 prices taken from another sheet are the previous month's last prices.
      for (const kind of ["orderPrice", "costPrice", "salePrice"] as const) {
        if (first[kind] !== undefined) o[kind] = first[kind];
      }
    }
  }

  // Blocks after the month's last day are not days; Excel's month totals still add them up.
  let extraInputs = 0;
  for (const block of blocks.slice(daysInMonth)) {
    for (const p of products) {
      for (const field of ["dueQty", "receive", "damage"] as const) {
        const col = block.cols[field];
        const v = col === undefined ? null : inputNumber(cellAt(ws, p.row, col));
        if (v && !v.isZero()) extraInputs++;
      }
    }
    for (const grid of grids) {
      for (const row of grid.rows.values()) {
        for (let c = block.start; c < block.end; c++) {
          const v = cellAt(ws, row, c).value;
          if (typeof v === "number" && v !== 0) extraInputs++;
        }
      }
    }
  }
  const beyondMonthEnd =
    extraInputs > 0
      ? `month totals include ${blocks.length - daysInMonth} block(s) after day ${daysInMonth}`
      : undefined;
  if (beyondMonthEnd) {
    notes.push(
      `${extraInputs} typed values sit in block(s) after day ${daysInMonth}; they are not imported. Confirm which real date they belong to`,
    );
  }
  const monthMistake = beyondMonthEnd ? { knownMistake: beyondMonthEnd } : {};

  // Right-side money columns, by header text.
  const right = headerCells.filter((h) => h.col >= lastBlockEnd);
  const rightCol = (key: string) => right.find((h) => h.key === key)?.col;
  const monthChecks: [string, string, keyof MonthOutput["month"]["products"][number]][] = [
    ["Month receipt amount", "total receive amount in tk", "receiptTotal"],
    ["Month sales", "total sale in tk", "salesTotal"],
    ["Month gross profit", "total profit", "profitTotal"],
    ["Month damage amount", "dmage product amount", "damageValue"],
    ["Month sales in cartons", "total sales per product", "salesCartons"],
    ["Closing cartons", "present stock per caton", "closingCartons"],
  ];
  for (const p of products) {
    const lastIndex = Math.min(blocks.length, daysInMonth) - 1;
    const last = blocks[lastIndex];
    const pick = (o: MonthOutput) => o.month.products.find((x) => x.productId === p.id);
    for (const [check, field, key] of [
      ["Closing stock", "stock", "closingStock"],
      ["Closing goods due from company", "balance", "dueFromCompany"],
    ] as const) {
      const col = last?.cols[field];
      const saved = col === undefined ? null : savedNumber(cellAt(ws, p.row, col));
      if (saved)
        expectations.push({
          check,
          where: `${sheetName} ${p.name}`,
          excel: saved,
          engine: (o) => pick(o)?.[key],
        });
    }
    for (const [check, header, key] of monthChecks) {
      const col = rightCol(header);
      if (col === undefined) continue;
      const cell = cellAt(ws, p.row, col);
      const saved = savedNumber(cell);
      if (!saved) continue;
      const divisor = /\/\s*(\d+(?:\.\d+)?)\s*$/.exec(formulaOf(cell) ?? "")?.[1];
      const size = cartonSize.get(p.id);
      const sizeMistake =
        divisor && size && !size.eq(divisor)
          ? {
              knownMistake: `carton size conflict: =${formulaOf(cell)} but person grids use ×${size.toString()}`,
            }
          : {};
      expectations.push({
        check,
        where: `${sheetName} ${p.name} (${cell.address})`,
        excel: saved,
        engine: (o) => pick(o)?.[key],
        ...monthMistake,
        ...sizeMistake,
      });
    }
  }
  for (const [check, header, key] of [
    ["Month total sales", "total sale in tk", "salesTotal"],
    ["Month total gross profit", "total profit", "profitTotal"],
  ] as const) {
    const col = rightCol(header);
    const saved = col === undefined ? null : savedNumber(cellAt(ws, totalsRow, col));
    if (saved)
      expectations.push({
        check,
        where: `${sheetName} row ${totalsRow}`,
        excel: saved,
        engine: (o) => o.month.totals[key],
        ...monthMistake,
      });
  }

  const salesCol = rightCol("per day sales in amount");
  const cashCol = rightCol("total amount");
  const moneyColumns: MoneyColumn[] = [];
  const signs = new Map<number, 1 | -1>();
  const rowSigns: Map<number, 1 | -1>[] = [];
  if (cashCol !== undefined) {
    for (let d = 0; d < daysInMonth; d++) {
      const f = formulaOf(cellAt(ws, firstRow + d, cashCol)) ?? "";
      const m = /^\(([^()]*)\)-\(([^()]*)\)$/.exec(f.replace(/\s+/g, ""));
      const rowMap = new Map<number, 1 | -1>();
      if (m) {
        for (const [part, sign] of [
          [m[1] ?? "", 1],
          [m[2] ?? "", -1],
        ] as const) {
          for (const ref of part.split("+")) {
            const letters = /^\$?([A-Z]+)/.exec(ref)?.[1];
            if (!letters) continue;
            const col = columnNumber(letters);
            rowMap.set(col, sign);
            if (!signs.has(col)) signs.set(col, sign);
          }
        }
      }
      rowSigns.push(rowMap);
    }
  } else notes.push('no "Total Amount" column; daily cash not compared');

  const dueCol = rightCol("due");
  const staffIdOf = (header: string) => headerKey(header.replace(/\s+(sort|over)$/i, ""));
  const pairedOver = new Map<number, string>();
  for (const h of right) {
    if (!/ sort$/.test(h.key)) continue;
    const f = formulaOf(cellAt(ws, totalsRow + 2, h.col)) ?? "";
    for (const m of f.matchAll(/\$?([A-Z]+)\$?\d+/g)) {
      const col = columnNumber(m[1] ?? "");
      if (col !== h.col) pairedOver.set(col, staffIdOf(textOf(cellAt(ws, headerRow, h.col))));
    }
  }
  for (const [col, sign] of signs) {
    if (col === salesCol) continue;
    const header = textOf(cellAt(ws, headerRow, col));
    const key = headerKey(header);
    let column: MoneyColumn;
    if (key === "due") column = { header, col, kind: "marketDueNew" };
    else if (key === "credit") column = { header, col, kind: "marketDueCollected" };
    else if (key === "d:comition") column = { header, col, kind: "srIncentive" };
    else if (key === "operating cost")
      column = { header, col, kind: "expense", category: "operating" };
    else if (/ sort$/.test(key))
      column = { header, col, kind: "staffShortage", staffId: staffIdOf(header) };
    else if (/ over$/.test(key))
      column = {
        header,
        col,
        kind: "staffRepayment",
        staffId: pairedOver.get(col) ?? staffIdOf(header),
      };
    else column = { header, col, kind: sign === -1 ? "staffAdvance" : "staffExcess", staffId: key };
    moneyColumns.push(column);
  }
  const ignored = right
    .filter(
      (h) =>
        h.col > (salesCol ?? 0) &&
        h.col < (cashCol ?? 0) &&
        !signs.has(h.col) &&
        h.col !== salesCol,
    )
    .map((h) => textOf(cellAt(ws, headerRow, h.col)));
  if (ignored.length)
    notes.push(`money columns outside the daily cash formula, not imported: ${ignored.join(", ")}`);

  const reverse: Partial<Record<MoneyKind, MoneyKind>> = {
    marketDueNew: "marketDueCollected",
    marketDueCollected: "marketDueNew",
    staffShortage: "staffRepayment",
    staffAdvance: "staffRepayment",
    staffRepayment: "staffShortage",
    staffExcess: "staffShortage",
  };
  const staffOpening: Record<string, StaffBalances> = {};
  const wrongSalesDays = new Set<number>();
  days.forEach((day, d) => {
    const money: MoneyEntryInput[] = [];
    const row = firstRow + d;
    for (const column of moneyColumns) {
      const value = inputNumber(cellAt(ws, row, column.col));
      if (!value || value.isZero() || !column.kind) continue;
      const kind = value.isNegative() ? reverse[column.kind] : column.kind;
      if (!kind) {
        notes.push(`${sheetName} day ${d + 1}: negative ${column.header} skipped`);
        continue;
      }
      money.push({
        kind,
        amount: value.abs().toString(),
        ...(column.staffId ? { staffId: column.staffId } : {}),
        ...(column.category ? { category: column.category } : {}),
      });
    }
    day.money.push(...money);

    if (salesCol !== undefined) {
      const cell = cellAt(ws, row, salesCol);
      const saved = savedNumber(cell);
      const f = formulaOf(cell) ?? "";
      const ref = /^\$?([A-Z]+)\$?(\d+)$/.exec(f.trim());
      const refHeader = ref
        ? headerKey(textOf(cellAt(ws, headerRow, columnNumber(ref[1] ?? ""))))
        : "";
      if (ref && refHeader !== BLOCK_FIELDS.salesTotal) wrongSalesDays.add(d);
      if (saved) {
        expectations.push({
          check: "Daily sales",
          where: `${sheetName} day ${d + 1} (${cell.address})`,
          excel: saved,
          engine: (o) => o.days[d]?.money.sales,
          ...(ref && refHeader !== BLOCK_FIELDS.salesTotal
            ? { knownMistake: `reads "${refHeader}": =${f}` }
            : {}),
        });
      }
    }
    if (cashCol !== undefined) {
      const cell = cellAt(ws, row, cashCol);
      const saved = savedNumber(cell);
      const rowMap = rowSigns[d] ?? new Map();
      const differs = moneyColumns.filter((c) => {
        const v = inputNumber(cellAt(ws, row, c.col));
        return v && !v.isZero() && rowMap.get(c.col) !== signs.get(c.col);
      });
      const reasons = [
        ...(differs.length
          ? [`row formula differs for: ${differs.map((c) => c.header).join(", ")}`]
          : []),
        ...(wrongSalesDays.has(d) ? ["uses the day's wrong sales cell"] : []),
      ];
      if (saved) {
        expectations.push({
          check: "Daily cash left (Total Amount)",
          where: `${sheetName} day ${d + 1} (${cell.address})`,
          excel: saved,
          engine: (o) => o.days[d]?.money.cashLeft,
          ...(reasons.length ? { knownMistake: reasons.join("; ") } : {}),
        });
      }
    }
  });

  // Staff: row above the first day is the opening; two rows below the totals is the month net.
  const lastDay = days.at(-1);
  for (const column of moneyColumns) {
    if (column.kind !== "staffShortage" || !column.staffId) continue;
    const openingValue =
      inputNumber(cellAt(ws, firstRow - 1, column.col)) ??
      savedNumber(cellAt(ws, firstRow - 1, column.col));
    if (openingValue && !openingValue.isZero()) {
      staffOpening[column.staffId] = { shortage: openingValue.toString() };
    }
    const adjustment = inputNumber(cellAt(ws, totalsRow + 1, column.col));
    if (adjustment && !adjustment.isZero() && lastDay) {
      const staffId = column.staffId;
      lastDay.money.push(
        { kind: "salaryAccrual", amount: adjustment.toString(), staffId },
        { kind: "salaryRecovery", amount: adjustment.toString(), staffId },
      );
    }
    const saved = savedNumber(cellAt(ws, totalsRow + 2, column.col));
    if (saved) {
      const staffId = column.staffId;
      expectations.push({
        check: "Staff net (owes us − we owe)",
        where: `${sheetName} ${column.header} (${ws.getCell(totalsRow + 2, column.col).address})`,
        excel: saved,
        engine: (o) => {
          const s = o.month.staff.find((x) => x.staffId === staffId);
          return s ? new Decimal(s.owesUs).sub(s.weOwe).toString() : "0";
        },
      });
    }
  }

  let marketDueOpening = new Decimal(0);
  if (dueCol !== undefined) {
    const openingDue = savedNumber(cellAt(ws, firstRow - 1, dueCol));
    if (openingDue) marketDueOpening = openingDue;
    else notes.push("market due opening (row above day 1) is blank; using 0");
    const saved = savedNumber(cellAt(ws, totalsRow + 2, dueCol));
    if (saved) {
      expectations.push({
        check: "Market due closing",
        where: `${sheetName} (${ws.getCell(totalsRow + 2, dueCol).address})`,
        excel: saved,
        engine: (o) => o.month.marketDue.closing,
      });
    }
  }

  const input: MonthInput = {
    products: products.map((p) => ({
      id: p.id,
      piecesPerCarton: (cartonSize.get(p.id) ?? new Decimal(1)).toString(),
    })),
    opening: {
      products: opening,
      marketDue: { "": marketDueOpening.toString() },
      staff: staffOpening,
    },
    days,
  };
  const noSize = products.filter((p) => !cartonSize.has(p.id)).map((p) => p.name);
  if (noSize.length) notes.push(`carton size not found (using 1) for: ${noSize.join(", ")}`);

  return {
    sheet: sheetName,
    month,
    input,
    expectations,
    products,
    persons: [...persons],
    moneyColumns,
    notes,
  };
}

function findRow(
  ws: Worksheet,
  from: number,
  to: number,
  test: (r: number) => boolean,
): number | null {
  for (let r = from; r <= to; r++) if (test(r)) return r;
  return null;
}
