import { computeMonth, Decimal, type StaffBalances } from "@bsd/domain";
import { t, type TranslationKey } from "@bsd/i18n";
import ExcelJS, { type Workbook, type Worksheet } from "exceljs";
import { cellAt, inputNumber, savedNumber, textOf } from "./cells";
import { monthOfSheetName, readMonthSheet } from "./month-sheet";

/** Largest workbook accepted for upload; the Drinko book is about 21 MB. */
export const MAX_WORKBOOK_BYTES = 40 * 1024 * 1024;

export async function loadWorkbook(data: Uint8Array): Promise<Workbook> {
  const workbook = new ExcelJS.Workbook();
  // exceljs's typings predate the generic Buffer; the bytes are passed through unchanged.
  await workbook.xlsx.load(data as unknown as ArrayBuffer);
  return workbook;
}

/** Month sheets (e.g. "Sep 2026"), newest first. */
export function monthSheetNames(workbook: Workbook): string[] {
  return workbook.worksheets
    .map((ws) => ({ name: ws.name, month: monthOfSheetName(ws.name) }))
    .filter((s): s is { name: string; month: string } => s.month !== null)
    .sort((a, b) => b.month.localeCompare(a.month))
    .map((s) => s.name);
}

export type OpeningProposal = {
  sheet: string;
  products: {
    label: string;
    stock: string;
    dueFromCompany: string;
    orderPrice?: string;
    costPrice?: string;
    salePrice?: string;
  }[];
  /** `label` "" is due not attributed to a DSR (the legacy bucket). */
  marketDue: { label: string; amount: string }[];
  staff: { label: string; balances: Partial<Record<keyof StaffBalances, string>> }[];
  /** Positive = we owe the company; negative = advance with the company. */
  companyPayable: string;
  notes: string[];
};

/**
 * The opening proposed by one completed month sheet (guide §16.2a, D26): the month engine's
 * closing over the sheet's raw inputs, labelled by the sheet's own product and person names.
 * A proposal for review, never posted as is.
 */
export function proposeOpening(workbook: Workbook, sheet: string): OpeningProposal {
  const read = readMonthSheet(workbook, sheet);
  const out = computeMonth(read.input);
  const nameOf = new Map(read.products.map((p) => [p.id, p.name.trim()]));
  const notes = [...read.notes];
  const negative = Object.entries(out.closing.products).filter(([, p]) =>
    new Decimal(p.stock).isNegative(),
  );
  if (negative.length) {
    notes.push(
      `negative closing stock for ${negative.length} product(s): ${negative
        .map(([id]) => nameOf.get(id) ?? id)
        .join(", ")}`,
    );
  }
  return {
    sheet,
    products: Object.entries(out.closing.products).map(([id, p]) => ({
      label: nameOf.get(id) ?? id,
      stock: p.stock,
      dueFromCompany: p.dueFromCompany,
      ...(p.orderPrice !== undefined ? { orderPrice: p.orderPrice } : {}),
      ...(p.costPrice !== undefined ? { costPrice: p.costPrice } : {}),
      ...(p.salePrice !== undefined ? { salePrice: p.salePrice } : {}),
    })),
    marketDue: Object.entries(out.closing.marketDue)
      .filter(([, amount]) => !new Decimal(amount).isZero())
      .map(([label, amount]) => ({ label, amount })),
    staff: Object.entries(out.closing.staff)
      .map(([label, values]) => ({
        label,
        balances: Object.fromEntries(
          Object.entries(values).filter(([, v]) => !new Decimal(v).isZero()),
        ) as Partial<Record<keyof StaffBalances, string>>,
      }))
      .filter((s) => Object.keys(s.balances).length > 0),
    companyPayable: out.closing.companyPayable,
    notes,
  };
}

// ---------------------------------------------------------------- standard template (guide §16.7)

const PRODUCTS = "Products";
const BALANCES = "Balances";
const productKeys = [
  "product_code",
  "name",
  "carton_size",
  "pieces",
  "unit_cost",
  "sale_price",
  "order_price",
  "due_from_company",
  "note",
] as const;
const balanceKeys = ["kind", "kind_label", "person", "cash_account", "amount", "note"] as const;

export type TemplateProductRow = {
  code: string;
  name: string;
  cartonSize: string;
  pieces: string | null;
  unitCost: string | null;
  salePrice: string | null;
  orderPrice: string | null;
  dueFromCompany: string | null;
  note: string;
};

export type TemplateBalanceRow = {
  kind: string;
  person: string;
  cashAccount: string;
  amount: string | null;
  note: string;
};

const productLabels: Record<(typeof productKeys)[number], string> = {
  product_code: t("opening.template.code"),
  name: t("product.name"),
  carton_size: t("opening.template.cartonSize"),
  pieces: t("opening.pieces"),
  unit_cost: t("opening.unitCost"),
  sale_price: t("opening.salePrice"),
  order_price: t("opening.orderPrice"),
  due_from_company: t("opening.dueFromCompany"),
  note: t("opening.note"),
};

const balanceLabels: Record<(typeof balanceKeys)[number], string> = {
  kind: t("opening.template.kindCode"),
  kind_label: t("opening.template.kind"),
  person: t("opening.template.person"),
  cash_account: t("opening.template.cashAccount"),
  amount: t("opening.amount"),
  note: t("opening.note"),
};

const numericKeys = new Set<string>([
  "carton_size",
  "pieces",
  "unit_cost",
  "sale_price",
  "order_price",
  "due_from_company",
  "amount",
]);

/** Numbers are written as numbers so Excel can sum them; codes and names stay text. */
function templateCell(key: string, value: string | null): string | number | null {
  if (value === null) return null;
  return numericKeys.has(key) && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : value;
}

function writeSheet<K extends string>(
  ws: Worksheet,
  keys: readonly K[],
  labels: Record<K, string>,
  rows: Record<K, string | null>[],
) {
  ws.addRow([...keys]);
  ws.addRow(keys.map((k) => labels[k]));
  ws.getRow(1).hidden = true;
  ws.getRow(2).font = { bold: true };
  for (const row of rows) ws.addRow(keys.map((k) => templateCell(k, row[k] ?? null)));
  ws.columns.forEach((column) => {
    column.width = 18;
  });
  ws.views = [{ state: "frozen", ySplit: 2 }];
}

/** The company's opening template, pre-listed with its products and balance rows. */
export async function buildOpeningTemplate(input: {
  products: TemplateProductRow[];
  balances: TemplateBalanceRow[];
}): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  writeSheet(
    workbook.addWorksheet(PRODUCTS),
    productKeys,
    productLabels,
    input.products.map((p) => ({
      product_code: p.code,
      name: p.name,
      carton_size: p.cartonSize,
      pieces: p.pieces,
      unit_cost: p.unitCost,
      sale_price: p.salePrice,
      order_price: p.orderPrice,
      due_from_company: p.dueFromCompany,
      note: p.note,
    })),
  );
  writeSheet(
    workbook.addWorksheet(BALANCES),
    balanceKeys,
    balanceLabels,
    input.balances.map((b) => ({
      kind: b.kind,
      kind_label: t(`opening.kind.${b.kind}` as TranslationKey),
      person: b.person,
      cash_account: b.cashAccount,
      amount: b.amount,
      note: b.note,
    })),
  );
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

export function isOpeningTemplate(workbook: Workbook): boolean {
  const ws = workbook.getWorksheet(PRODUCTS);
  return !!ws && textOf(cellAt(ws, 1, 1)) === "product_code";
}

/** A typed cell as a decimal string; blank is null (unknown), text is kept for validation. */
function cellValue(ws: Worksheet, row: number, col: number): string | null {
  const cell = cellAt(ws, row, col);
  const number = inputNumber(cell) ?? savedNumber(cell);
  if (number) return number.toString();
  const text = textOf(cell).trim();
  return text === "" ? null : text;
}

function readRows<K extends string>(ws: Worksheet | undefined, keys: readonly K[]) {
  const rows: { row: number; values: Record<K, string | null> }[] = [];
  if (!ws) return rows;
  const columns = new Map<K, number>();
  ws.getRow(1).eachCell((cell, col) => {
    const key = textOf(cell).trim() as K;
    if (keys.includes(key)) columns.set(key, col);
  });
  for (let r = 3; r <= ws.rowCount; r++) {
    const values = Object.fromEntries(
      keys.map((k) => [k, columns.has(k) ? cellValue(ws, r, columns.get(k) ?? 0) : null]),
    ) as Record<K, string | null>;
    if (Object.values(values).some((v) => v !== null)) rows.push({ row: r, values });
  }
  return rows;
}

/** Rows of an uploaded template; validation happens in the application with the contract. */
export function readOpeningTemplate(workbook: Workbook): {
  products: (Omit<TemplateProductRow, "name" | "cartonSize"> & { row: number })[];
  balances: (TemplateBalanceRow & { row: number })[];
} {
  return {
    products: readRows(workbook.getWorksheet(PRODUCTS), productKeys).map(({ row, values }) => ({
      row,
      code: values.product_code ?? "",
      pieces: values.pieces,
      unitCost: values.unit_cost,
      salePrice: values.sale_price,
      orderPrice: values.order_price,
      dueFromCompany: values.due_from_company,
      note: values.note ?? "",
    })),
    balances: readRows(workbook.getWorksheet(BALANCES), balanceKeys).map(({ row, values }) => ({
      row,
      kind: values.kind ?? "",
      person: values.person ?? "",
      cashAccount: values.cash_account ?? "",
      amount: values.amount,
      note: values.note ?? "",
    })),
  };
}
