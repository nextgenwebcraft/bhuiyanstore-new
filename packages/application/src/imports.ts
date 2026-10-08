import { createHash } from "node:crypto";
import {
  businessDateSchema,
  importCommitRequestSchema,
  importDiscardRequestSchema,
  importJobSchema,
  importJobSummarySchema,
  importMappingRequestSchema,
  importMappingSchema,
  importWorkbookSheetsSchema,
  moneyKindPermission,
  moneyKindPerson,
  type ImportCheck,
  type ImportCommitMode,
  type ImportIssue,
  type ImportJob,
  type ImportJobSummary,
  type ImportMapping,
  type ImportOpeningDifference,
  type ImportWorkbookSheets,
  type PermissionId,
} from "@bsd/contracts";
import type { Prisma } from "@bsd/database";
import {
  computeMonth,
  Decimal,
  shiftBusinessDate,
  toDecimal,
  type CatalogProduct,
  type DayInput,
  type DecimalInput,
  type DsrLineInput,
  type MoneyEntryInput,
  type MonthInput,
  type MonthOpening,
  type MonthOutput,
  type PriceKind,
  type ProductDayInput,
  type StaffBalances,
} from "@bsd/domain";
import {
  MAX_WORKBOOK_BYTES,
  compareWithSaved,
  loadWorkbook,
  monthSheetNames,
  readMonthSheet,
  type SheetLabel,
} from "@bsd/importer";
import { requirePermission, type CompanyAccess } from "./access";
import { recordAudit } from "./audit";
import type { AppContext, Tx } from "./context";
import { requireAll } from "./daily";
import { fromDbDate, toDbDate, todayInDhaka } from "./dates";
import { AppError, parseInput } from "./errors";
import { runIdempotent } from "./idempotency";
import {
  activeOpening,
  firstOfMonth,
  lastOfMonth,
  monthOf,
  nextMonth,
  runLedger,
  type ActiveOpening,
} from "./ledger";
import { closeBlocker, previousMonth } from "./month";
import { plain } from "./numeric";
import { importOpeningFromClosing, matchPerson, nameKey } from "./opening";
import { packOn } from "./products";

/**
 * Excel month import (PLAN §8, §9 Phase H). The sheet is read once by headers; its raw inputs
 * (sheet-local keys) and the comparison with Excel's saved values are stored on the job. The
 * owner maps keys to catalog records; the commit turns the mapped inputs into the same documents
 * as manual entry and proves the ledger then reproduces the preview exactly.
 */

type Db = AppContext["db"] | Tx;

export const MAX_IMPORT_WORKBOOK_BYTES = MAX_WORKBOOK_BYTES;

const invalid = (path: string, code: string) => new AppError("VALIDATION_FAILED", [{ path, code }]);

const WHOLE = /^(0|[1-9]\d*)$/;
const PRICE = /^\d+(\.\d{1,6})?$/;
const AMOUNT = /^\d+(\.\d{1,2})?$/;
const DIFFERENCES_KEPT = 50;
const ISSUES_SHOWN = 200;
const JOBS_LISTED = 20;
const reference = (jobId: string) => `import:${jobId}`;

const PRICE_KINDS: [PriceKind, "order" | "cost" | "sale"][] = [
  ["orderPrice", "order"],
  ["costPrice", "cost"],
  ["salePrice", "sale"],
];
const STOCK_KINDS = [
  ["ordered", "order"],
  ["received", "receipt"],
  ["damaged", "damage"],
] as const;
const STOCK_PERMISSION: Record<(typeof STOCK_KINDS)[number][1], PermissionId> = {
  order: "purchase.create",
  receipt: "purchase.post",
  damage: "damage.report",
};

type StoredLabels = {
  products: { key: string; label: string; cartonSize: string | null }[];
  people: SheetLabel[];
  categories: SheetLabel[];
};
type StoredReport = {
  checks: ImportCheck[];
  notes: string[];
  unexplained: number;
  /** Last imported date of a month still in progress; the commit then leaves the month open. */
  through?: string;
};

/** The job's last date: its `through` date, else the month's last day. */
const lastDateOf = (row: JobRow) =>
  (row.report as unknown as StoredReport).through ?? lastOfMonth(row.month);

const isZero = (value: DecimalInput | undefined) =>
  value === undefined || toDecimal(value).isZero();

// ---------------------------------------------------------------- catalog

type RoleKind = "dsr" | "sr" | "general";

async function loadCatalog(db: Db, access: CompanyAccess, month: string) {
  const companyId = access.company.id;
  const [products, assignments, categories] = await Promise.all([
    db.product.findMany({
      where: { companyId },
      include: { packs: true },
      orderBy: { sku: "asc" },
    }),
    db.staffAssignment.findMany({
      where: { companyId },
      include: { role: true, staff: { select: { id: true, name: true } } },
      orderBy: { from: "asc" },
    }),
    db.expenseCategory.findMany({
      where: { tenantId: access.company.tenantId, active: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const first = firstOfMonth(month);
  const last = lastOfMonth(month);
  const covers = (a: (typeof assignments)[number], date: string) =>
    fromDbDate(a.from) <= date && (a.to === null || fromDbDate(a.to) >= date);
  // The role on the month's last day, else the latest assignment.
  const staff = new Map<string, { id: string; name: string; roleKind: RoleKind; atEnd: boolean }>();
  for (const a of assignments) {
    const current = staff.get(a.staffId);
    const atEnd = covers(a, last);
    if (!current || atEnd || !current.atEnd) {
      staff.set(a.staffId, {
        id: a.staffId,
        name: a.staff.name,
        roleKind: a.role.kind as RoleKind,
        atEnd,
      });
    }
  }
  return {
    products: products.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      aliases: p.aliases,
      piecesPerCarton: String(packOn(p.packs, first)?.piecesPerCarton ?? 1),
      packOn: (date: string) => packOn(p.packs, date)?.piecesPerCarton ?? 1,
    })),
    staff: [...staff.values()].sort((a, b) => a.name.localeCompare(b.name)),
    categories: categories.map((c) => ({ id: c.id, name: c.name })),
    roleOn(staffId: string, date: string): RoleKind | null {
      const a = assignments.find((x) => x.staffId === staffId && covers(x, date));
      return a ? (a.role.kind as RoleKind) : null;
    },
  };
}

type Catalog = Awaited<ReturnType<typeof loadCatalog>>;

function mapperFor(mapping: ImportMapping, catalog: Catalog) {
  const productIds = new Set(catalog.products.map((p) => p.id));
  const staffIds = new Set(catalog.staff.map((s) => s.id));
  const categoryIds = new Set(catalog.categories.map((c) => c.id));
  const pick = (ids: Set<string>, value: string | null | undefined) =>
    value && ids.has(value) ? value : null;
  return {
    product: (key: string) => pick(productIds, mapping.products[key]),
    staff: (key: string) => pick(staffIds, mapping.staff[key]),
    category: (key: string) => pick(categoryIds, mapping.categories[key]),
  };
}

type Mapper = ReturnType<typeof mapperFor>;

/** Name and alias matches only; anything ambiguous or unknown stays for the owner to map. */
function proposeMapping(labels: StoredLabels, catalog: Catalog): ImportMapping {
  const byName = new Map<string, string | null>();
  for (const p of catalog.products) {
    for (const name of [p.name, ...p.aliases]) {
      const key = nameKey(name);
      byName.set(key, byName.has(key) && byName.get(key) !== p.id ? null : p.id);
    }
  }
  const categoryByName = new Map(catalog.categories.map((c) => [nameKey(c.name), c.id]));
  return {
    products: Object.fromEntries(
      labels.products.map((p) => [p.key, byName.get(nameKey(p.label)) ?? null]),
    ),
    staff: Object.fromEntries(
      labels.people.map((p) => [p.key, matchPerson(p.label, catalog.staff)?.id ?? null]),
    ),
    categories: Object.fromEntries(
      labels.categories.map((c) => [c.key, categoryByName.get(nameKey(c.label)) ?? null]),
    ),
  };
}

// ---------------------------------------------------------------- sheet input → catalog input

/** Keys that carry data: only these must be mapped. */
function usedKeys(input: MonthInput) {
  const products = new Set<string>();
  const people = new Set<string>();
  const categories = new Set<string>();
  for (const [key, o] of Object.entries(input.opening.products)) {
    if (!isZero(o.stock) || !isZero(o.dueFromCompany)) products.add(key);
  }
  for (const [key, balances] of Object.entries(input.opening.staff ?? {})) {
    if (Object.values(balances).some((v) => !isZero(v))) people.add(key);
  }
  for (const [key, amount] of Object.entries(input.opening.marketDue ?? {})) {
    if (key && !isZero(amount)) people.add(key);
  }
  for (const day of input.days) {
    for (const [key, p] of Object.entries(day.products ?? {})) {
      if (STOCK_KINDS.some(([field]) => !isZero(p[field]))) products.add(key);
    }
    for (const line of day.dsrLines ?? []) {
      products.add(line.productId);
      people.add(line.staffId);
    }
    for (const entry of day.money ?? []) {
      if (entry.staffId) people.add(entry.staffId);
      if (entry.category) categories.add(entry.category);
    }
  }
  return { products, people, categories };
}

function addBalances(a: StaffBalances | undefined, b: StaffBalances): StaffBalances {
  const sum: Record<string, string> = {};
  for (const key of new Set([...Object.keys(a ?? {}), ...Object.keys(b)])) {
    const x = (a as Record<string, DecimalInput | undefined> | undefined)?.[key] ?? "0";
    const y = (b as Record<string, DecimalInput | undefined>)[key] ?? "0";
    sum[key] = toDecimal(x).add(toDecimal(y)).toString();
  }
  return sum;
}

function mapOpening(opening: MonthOpening, m: Mapper): MonthOpening {
  const products: Record<string, MonthOpening["products"][string]> = {};
  for (const [key, value] of Object.entries(opening.products)) {
    const id = m.product(key);
    if (id) products[id] = { ...value };
  }
  const marketDue: Record<string, string> = {};
  for (const [key, amount] of Object.entries(opening.marketDue ?? {})) {
    const id = key ? m.staff(key) : "";
    if (id === null) continue;
    marketDue[id] = toDecimal(marketDue[id] ?? "0")
      .add(toDecimal(amount))
      .toString();
  }
  const staff: Record<string, StaffBalances> = {};
  for (const [key, balances] of Object.entries(opening.staff ?? {})) {
    const id = m.staff(key);
    if (id) staff[id] = addBalances(staff[id], balances);
  }
  return {
    products,
    marketDue,
    staff,
    ...(opening.companyPayable !== undefined ? { companyPayable: opening.companyPayable } : {}),
  };
}

type MappedDay = {
  date: string;
  products: Record<string, ProductDayInput>;
  dsrLines: DsrLineInput[];
  money: MoneyEntryInput[];
};

function mapDays(days: readonly DayInput[], m: Mapper): MappedDay[] {
  return days.map((day) => {
    const products: Record<string, ProductDayInput> = {};
    for (const [key, p] of Object.entries(day.products ?? {})) {
      const id = m.product(key);
      if (id) products[id] = { ...p };
    }
    const dsrLines = (day.dsrLines ?? []).flatMap((line) => {
      const staffId = m.staff(line.staffId);
      const productId = m.product(line.productId);
      return staffId && productId ? [{ ...line, staffId, productId }] : [];
    });
    const money = (day.money ?? []).flatMap((entry) => {
      const staffId = entry.staffId ? m.staff(entry.staffId) : undefined;
      const category = entry.category ? m.category(entry.category) : undefined;
      if (staffId === null || category === null) return [];
      return [
        {
          ...entry,
          ...(staffId ? { staffId } : {}),
          ...(category ? { category } : {}),
        },
      ];
    });
    return { date: day.date, products, dsrLines, money };
  });
}

function engineProducts(catalog: Catalog, only?: Set<string>): CatalogProduct[] {
  return catalog.products
    .filter((p) => !only || only.has(p.id))
    .map((p) => ({ id: p.id, piecesPerCarton: p.piecesPerCarton }));
}

// ---------------------------------------------------------------- documents

type Documents = {
  stock: {
    date: string;
    kind: "order" | "receipt" | "damage";
    productId: string;
    pieces: string;
  }[];
  prices: { date: string; productId: string; kind: "order" | "cost" | "sale"; price: string }[];
  dsrDays: {
    date: string;
    staffId: string;
    lines: Map<string, { issued: string; returned: string; damaged: string }>;
  }[];
  money: { date: string; entry: MoneyEntryInput }[];
};

const add = (a: string, b: DecimalInput | undefined) =>
  toDecimal(a)
    .add(toDecimal(b ?? "0"))
    .toString();

function documentsOf(days: MappedDay[]): Documents {
  const docs: Documents = { stock: [], prices: [], dsrDays: [], money: [] };
  for (const day of days) {
    for (const [productId, p] of Object.entries(day.products)) {
      for (const [field, kind] of STOCK_KINDS) {
        if (!isZero(p[field])) {
          docs.stock.push({ date: day.date, kind, productId, pieces: String(p[field]) });
        }
      }
      for (const [field, kind] of PRICE_KINDS) {
        const price = p[field];
        if (price !== undefined) {
          docs.prices.push({ date: day.date, productId, kind, price: String(price) });
        }
      }
    }
    const sheets = new Map<string, Documents["dsrDays"][number]>();
    for (const line of day.dsrLines) {
      const sheet = sheets.get(line.staffId) ?? {
        date: day.date,
        staffId: line.staffId,
        lines: new Map(),
      };
      sheets.set(line.staffId, sheet);
      const current = sheet.lines.get(line.productId) ?? {
        issued: "0",
        returned: "0",
        damaged: "0",
      };
      sheet.lines.set(line.productId, {
        issued: add(current.issued, line.issued),
        returned: add(current.returned, line.returned),
        damaged: add(current.damaged, line.damaged),
      });
    }
    docs.dsrDays.push(...sheets.values());
    for (const entry of day.money) docs.money.push({ date: day.date, entry });
  }
  return docs;
}

function permissionsFor(docs: Documents): PermissionId[] {
  const needed = new Set<PermissionId>(["period.close"]);
  for (const s of docs.stock) needed.add(STOCK_PERMISSION[s.kind]);
  if (docs.prices.length) needed.add("product.edit");
  if (docs.dsrDays.length) {
    needed.add("sale.create");
    needed.add("sale.post");
  }
  for (const { entry } of docs.money) needed.add(moneyKindPermission[entry.kind]);
  return [...needed];
}

// ---------------------------------------------------------------- preview

type Preview = {
  mode: ImportCommitMode | null;
  issues: ImportIssue[];
  docs: Documents;
  days: MappedDay[];
  openingDifferences: ImportOpeningDifference[];
  openingVersion: number | null;
  active: ActiveOpening | null;
  /** Documents mode: the engine input the ledger must reproduce after posting. */
  expected: MonthInput | null;
};

function valueIssues(input: MonthInput, issue: (i: ImportIssue) => void) {
  for (const day of input.days) {
    for (const [key, p] of Object.entries(day.products ?? {})) {
      for (const [field] of STOCK_KINDS) {
        const v = p[field];
        if (v !== undefined && !WHOLE.test(String(v))) {
          issue({
            code: "import.issue.quantity",
            severity: "error",
            key,
            date: day.date,
            detail: `${field} ${String(v)}`,
          });
        }
      }
      for (const [field] of PRICE_KINDS) {
        const v = p[field];
        if (v !== undefined && !PRICE.test(String(v))) {
          issue({
            code: "import.issue.price",
            severity: "error",
            key,
            date: day.date,
            detail: `${field} ${String(v)}`,
          });
        }
      }
    }
    for (const line of day.dsrLines ?? []) {
      for (const field of ["issued", "returned", "damaged"] as const) {
        const v = line[field];
        if (v !== undefined && !WHOLE.test(String(v))) {
          issue({
            code: "import.issue.quantity",
            severity: "error",
            key: line.productId,
            date: day.date,
            detail: `${line.staffId} ${field} ${String(v)}`,
          });
        }
      }
    }
    for (const entry of day.money ?? []) {
      if (!AMOUNT.test(String(entry.amount))) {
        issue({
          code: "import.issue.amount",
          severity: "error",
          ...(entry.staffId ? { key: entry.staffId } : {}),
          date: day.date,
          detail: `${entry.kind} ${String(entry.amount)}`,
        });
      }
    }
  }
}

/** Existing price changes inside the month that the import does not replace (ledger parity). */
async function withExistingPrices(
  db: Db,
  companyId: string,
  month: string,
  last: string,
  opening: MonthOpening,
  days: MappedDay[],
): Promise<{ opening: MonthOpening; days: MappedDay[] }> {
  const first = firstOfMonth(month);
  const existing = await db.priceChange.findMany({
    where: {
      product: { companyId },
      effectiveFrom: { gte: toDbDate(first), lte: toDbDate(last) },
    },
    orderBy: { effectiveFrom: "asc" },
  });
  const products = { ...opening.products };
  const byDate = new Map(days.map((d) => [d.date, d]));
  const all: MappedDay[] = [];
  for (let date = first; date <= last; date = shiftBusinessDate(date, 1)) {
    const day = byDate.get(date);
    all.push({
      date,
      products: Object.fromEntries(
        Object.entries(day?.products ?? {}).map(([id, p]) => [id, { ...p }]),
      ),
      dsrLines: day?.dsrLines ?? [],
      money: day?.money ?? [],
    });
  }
  const dayOf = new Map(all.map((d) => [d.date, d]));
  for (const change of existing) {
    const field = PRICE_KINDS.find(([, kind]) => kind === change.kind)?.[0];
    if (!field) continue;
    const date = fromDbDate(change.effectiveFrom);
    const day = dayOf.get(date);
    if (!day || day.products[change.productId]?.[field] !== undefined) continue;
    if (date === first) {
      const current = products[change.productId] ?? { stock: "0", dueFromCompany: "0" };
      products[change.productId] = { ...current, [field]: plain(change.price) };
    } else {
      day.products[change.productId] = {
        ...day.products[change.productId],
        [field]: plain(change.price),
      };
    }
  }
  return { opening: { ...opening, products }, days: all };
}

async function monthHasDocuments(db: Db, companyId: string, month: string): Promise<boolean> {
  const date = { gte: toDbDate(firstOfMonth(month)), lte: toDbDate(lastOfMonth(month)) };
  const counts = await Promise.all([
    db.stockEntry.count({ where: { companyId, status: "posted", date } }),
    db.dsrDay.count({ where: { companyId, status: { not: "reversed" }, date } }),
    db.moneyEntry.count({ where: { companyId, status: "posted", date } }),
    db.damageEvent.count({ where: { companyId, status: "posted", date } }),
    db.payrollRun.count({ where: { companyId, month, status: { not: "reversed" } } }),
  ]);
  return counts.some((n) => n > 0);
}

function staffDifferences(
  catalog: Catalog,
  sheet: MonthOpening,
  system: MonthOpening,
  ids: Set<string>,
): ImportOpeningDifference[] {
  const out: ImportOpeningDifference[] = [];
  for (const person of catalog.staff) {
    if (!ids.has(person.id)) continue;
    const a = (sheet.staff?.[person.id] ?? {}) as Record<string, DecimalInput | undefined>;
    const b = (system.staff?.[person.id] ?? {}) as Record<string, DecimalInput | undefined>;
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const x = toDecimal(a[key] ?? "0");
      const y = toDecimal(b[key] ?? "0");
      if (!x.eq(y)) {
        out.push({
          kind: "staff",
          label: `${person.name} · ${key}`,
          system: y.toString(),
          sheet: x.toString(),
        });
      }
    }
  }
  return out;
}

async function buildPreview(
  db: Db,
  access: CompanyAccess,
  row: JobRow,
  catalog: Catalog,
  mapping: ImportMapping,
): Promise<Preview> {
  const companyId = access.company.id;
  const input = row.input as unknown as MonthInput;
  const labels = row.labels as unknown as StoredLabels;
  const report = row.report as unknown as StoredReport;
  const m = mapperFor(mapping, catalog);
  const used = usedKeys(input);
  const issues: ImportIssue[] = [];
  const issue = (i: ImportIssue) => issues.push(i);

  const seenProducts = new Map<string, string>();
  for (const p of labels.products) {
    const id = m.product(p.key);
    if (id && seenProducts.has(id)) {
      issue({ code: "import.issue.productDuplicate", severity: "error", key: p.key });
    }
    if (id) seenProducts.set(id, p.key);
    if (!id && used.products.has(p.key)) {
      issue({ code: "import.issue.productUnmapped", severity: "error", key: p.key });
    }
    const catalogSize = id ? catalog.products.find((c) => c.id === id)?.piecesPerCarton : null;
    if (id && p.cartonSize && catalogSize && p.cartonSize !== catalogSize) {
      issue({
        code: "import.issue.cartonSize",
        severity: "warning",
        key: p.key,
        detail: `${p.cartonSize} / ${catalogSize}`,
      });
    }
  }
  for (const key of used.people) {
    if (!m.staff(key)) issue({ code: "import.issue.personUnmapped", severity: "error", key });
  }
  for (const key of used.categories) {
    if (!m.category(key)) issue({ code: "import.issue.categoryUnmapped", severity: "error", key });
  }
  valueIssues(input, issue);
  if (report.unexplained > 0) {
    issue({
      code: "import.issue.unexplained",
      severity: "warning",
      detail: String(report.unexplained),
    });
  }

  const days = mapDays(input.days, m);
  const docs = documentsOf(days);
  const active = await activeOpening(db, companyId);
  const month = row.month;
  const first = firstOfMonth(month);
  let mode: ImportCommitMode | null = null;
  let openingDifferences: ImportOpeningDifference[] = [];
  let openingVersion: number | null = null;
  let expected: MonthInput | null = null;

  const flagged = new Set<string>();
  const flagOnce = (code: string, key: string, date?: string) => {
    if (flagged.has(`${code}|${key}`)) return;
    flagged.add(`${code}|${key}`);
    issue({ code, severity: "error", key, ...(date ? { date } : {}) });
  };
  const checkPeople = (
    roleOf: (staffId: string, date: string) => RoleKind | null,
    dsr: boolean,
  ) => {
    for (const day of input.days) {
      if (dsr) {
        for (const line of day.dsrLines ?? []) {
          const staffId = m.staff(line.staffId);
          if (!staffId) continue;
          const role = roleOf(staffId, day.date);
          if (role === null) flagOnce("import.issue.notAssigned", line.staffId, day.date);
          else if (role !== "dsr") flagOnce("import.issue.notDsr", line.staffId, day.date);
        }
      }
      for (const entry of day.money ?? []) {
        const staffId = entry.staffId ? m.staff(entry.staffId) : null;
        if (!staffId || !entry.staffId) continue;
        const role = roleOf(staffId, day.date);
        if (role === null) {
          if (dsr) flagOnce("import.issue.notAssigned", entry.staffId, day.date);
        } else if (role === "sr" && moneyKindPerson[entry.kind] === "distributor") {
          flagOnce("import.issue.srColumn", entry.staffId);
        }
      }
    }
  };

  if (active && first >= active.cutoffDate) {
    mode = "documents";
    const closed = await db.monthClose.findUnique({
      where: { companyId_month: { companyId, month } },
      select: { id: true },
    });
    if (closed) issue({ code: "validation.month.alreadyClosed", severity: "error" });
    else if (report.through) {
      if (report.through > todayInDhaka()) {
        issue({ code: "import.issue.throughFuture", severity: "error" });
      }
      const previous = previousMonth(month);
      const previousClosed =
        previous < monthOf(active.cutoffDate) ||
        (await db.monthClose.findUnique({
          where: { companyId_month: { companyId, month: previous } },
          select: { id: true },
        }));
      if (!previousClosed) issue({ code: "validation.month.previousOpen", severity: "error" });
    } else {
      const blocker = await closeBlocker(db, companyId, month, active);
      if (blocker) issue({ code: blocker, severity: "error" });
    }
    if (await monthHasDocuments(db, companyId, month)) {
      issue({ code: "import.issue.monthHasDocuments", severity: "error" });
    }
    checkPeople((staffId, date) => catalog.roleOn(staffId, date), true);

    let system = active.opening;
    if (first > active.cutoffDate) {
      const before = await runLedger(db, access, shiftBusinessDate(first, -1), active);
      if (before) system = before.output.closing;
    }
    const sheet = mapOpening(input.opening, m);
    const productName = new Map(catalog.products.map((p) => [p.id, `${p.sku} ${p.name}`]));
    for (const [id, s] of Object.entries(sheet.products)) {
      const sys = system.products[id];
      for (const field of ["stock", "dueFromCompany"] as const) {
        const x = toDecimal(s[field]);
        const y = toDecimal(sys?.[field] ?? "0");
        if (!x.eq(y)) {
          openingDifferences.push({
            kind: field,
            label: productName.get(id) ?? id,
            system: y.toString(),
            sheet: x.toString(),
          });
        }
      }
    }
    const total = (o: MonthOpening) =>
      Object.values(o.marketDue ?? {}).reduce<Decimal>(
        (sum, v) => sum.add(toDecimal(v)),
        new Decimal(0),
      );
    if (!total(sheet).eq(total(system))) {
      openingDifferences.push({
        kind: "marketDue",
        label: "",
        system: total(system).toString(),
        sheet: total(sheet).toString(),
      });
    }
    const mappedPeople = new Set(
      [...used.people].map((k) => m.staff(k)).filter((id): id is string => id !== null),
    );
    openingDifferences = [
      ...openingDifferences,
      ...staffDifferences(catalog, sheet, system, mappedPeople),
    ];
    if (openingDifferences.length) {
      issue({
        code: "import.issue.openingDiffers",
        severity: "warning",
        detail: String(openingDifferences.length),
      });
    }
    const withPrices = await withExistingPrices(
      db,
      companyId,
      month,
      lastDateOf(row),
      system,
      days,
    );
    expected = {
      products: engineProducts(catalog),
      opening: withPrices.opening,
      days: withPrices.days,
    };
  } else if (active) {
    issue({
      code:
        month >= monthOf(active.cutoffDate)
          ? "import.issue.partialMonth"
          : "import.issue.openingActive",
      severity: "error",
    });
  } else if (report.through) {
    issue({ code: "import.issue.partialOpening", severity: "error" });
  } else {
    mode = "opening";
    const session = await db.openingSession.findUnique({
      where: { companyId },
      select: { version: true },
    });
    openingVersion = session?.version ?? 0;
    const roleNow = new Map(catalog.staff.map((s) => [s.id, s.roleKind]));
    checkPeople((staffId) => roleNow.get(staffId) ?? null, false);
  }

  return { mode, issues, docs, days, openingDifferences, openingVersion, active, expected };
}

// ---------------------------------------------------------------- views

type JobRow = NonNullable<Awaited<ReturnType<Db["importJob"]["findFirst"]>>>;

function toSummary(row: JobRow): ImportJobSummary {
  const report = row.report as unknown as StoredReport;
  return importJobSummarySchema.parse({
    id: row.id,
    status: row.status,
    fileName: row.fileName,
    sheet: row.sheet,
    month: row.month,
    through: report.through ?? null,
    unexplained: report.unexplained,
    createdAt: row.createdAt.toISOString(),
    committedAt: row.committedAt?.toISOString() ?? null,
    committedMode: row.committedMode,
  });
}

async function toView(db: Db, access: CompanyAccess, row: JobRow): Promise<ImportJob> {
  const catalog = await loadCatalog(db, access, row.month);
  const mapping = importMappingSchema.parse(row.mapping);
  const labels = row.labels as unknown as StoredLabels;
  const report = row.report as unknown as StoredReport;
  const used = usedKeys(row.input as unknown as MonthInput);
  const preview =
    row.status === "ready" ? await buildPreview(db, access, row, catalog, mapping) : null;
  const errors = preview?.issues.some((i) => i.severity === "error") ?? true;
  return importJobSchema.parse({
    ...toSummary(row),
    version: row.version,
    fileHash: row.fileHash,
    products: labels.products.map((p) => ({
      key: p.key,
      label: p.label,
      cartonSize: p.cartonSize,
      active: used.products.has(p.key),
      productId: mapping.products[p.key] ?? null,
    })),
    people: labels.people.map((p) => ({
      key: p.key,
      label: p.label,
      staffId: mapping.staff[p.key] ?? null,
    })),
    categories: labels.categories.map((c) => ({
      key: c.key,
      label: c.label,
      categoryId: mapping.categories[c.key] ?? null,
    })),
    checks: report.checks,
    notes: report.notes,
    mode: preview?.mode ?? null,
    issues: (preview?.issues ?? []).slice(0, ISSUES_SHOWN),
    documents: {
      stockEntries: preview?.docs.stock.length ?? 0,
      prices: preview?.docs.prices.length ?? 0,
      dsrDays: preview?.docs.dsrDays.length ?? 0,
      moneyEntries: preview?.docs.money.length ?? 0,
    },
    openingDifferences: preview?.openingDifferences ?? [],
    openingVersion: preview?.openingVersion ?? null,
    options: {
      products: catalog.products.map((p) => ({ id: p.id, sku: p.sku, name: p.name })),
      staff: catalog.staff.map((s) => ({ id: s.id, name: s.name, roleKind: s.roleKind })),
      categories: catalog.categories,
    },
    canCommit: preview !== null && preview.mode !== null && !errors,
  });
}

async function findJob(db: Db, companyId: string, jobId: string): Promise<JobRow> {
  const row = await db.importJob.findFirst({ where: { id: jobId, companyId } });
  if (!row) throw invalid("", "validation.import.notFound");
  return row;
}

// ---------------------------------------------------------------- use cases

async function openWorkbook(data: Uint8Array) {
  if (data.byteLength === 0) throw invalid("file", "validation.import.fileEmpty");
  if (data.byteLength > MAX_WORKBOOK_BYTES) throw invalid("file", "validation.import.fileTooLarge");
  try {
    return await loadWorkbook(data);
  } catch {
    throw invalid("file", "validation.import.fileUnreadable");
  }
}

/** The uploaded workbook's month sheets, newest first. */
export async function inspectImportWorkbook(
  ctx: AppContext,
  companyId: string,
  data: Uint8Array,
): Promise<ImportWorkbookSheets> {
  await requirePermission(ctx, companyId, "period.close");
  return importWorkbookSheetsSchema.parse({ sheets: monthSheetNames(await openWorkbook(data)) });
}

export async function listImportJobs(
  ctx: AppContext,
  companyId: string,
): Promise<ImportJobSummary[]> {
  await requirePermission(ctx, companyId, "period.close");
  const rows = await ctx.db.importJob.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    take: JOBS_LISTED,
  });
  return rows.map(toSummary);
}

export async function getImportJob(
  ctx: AppContext,
  companyId: string,
  jobId: string,
): Promise<ImportJob> {
  const access = await requirePermission(ctx, companyId, "period.close");
  return toView(ctx.db, access, await findJob(ctx.db, companyId, jobId));
}

/**
 * Reads one month sheet (PLAN §8 steps 1–4): raw inputs only, recalculated by the month engine
 * and compared with Excel's saved values. Labels are matched to the catalog by name as a proposal.
 */
export async function createImportJob(
  ctx: AppContext,
  companyId: string,
  input: {
    data: Uint8Array;
    fileName: string;
    sheet: string;
    /** "lastDay" adds blocks after the month's last day to that day (owner's confirmation). */
    extraBlocks?: "ignore" | "lastDay";
    /** Imports days up to this date only and leaves the month open. */
    through?: string;
  },
  requestKey?: string,
): Promise<ImportJob> {
  const access = await requirePermission(ctx, companyId, "period.close", { write: true });
  const fileHash = createHash("sha256").update(input.data).digest("hex");
  const fileName = input.fileName.slice(0, 200) || "workbook.xlsx";
  const workbook = await openWorkbook(input.data);
  if (!monthSheetNames(workbook).includes(input.sheet)) {
    throw invalid("sheet", "validation.import.sheet");
  }
  const through = input.through || undefined;
  if (through !== undefined && !businessDateSchema.safeParse(through).success) {
    throw invalid("through", "validation.date.invalid");
  }
  let read;
  try {
    read = readMonthSheet(workbook, input.sheet, {
      extraBlocks: input.extraBlocks ?? "ignore",
      ...(through ? { through } : {}),
    });
  } catch (error) {
    if (error instanceof RangeError) throw invalid("through", "validation.import.through");
    throw invalid("sheet", "validation.import.sheetLayout");
  }
  const partial = through !== undefined && through < lastOfMonth(read.month);
  const checks: ImportCheck[] = compareWithSaved(computeMonth(read.input), read.expectations).map(
    (c) => ({
      check: c.check,
      compared: c.compared,
      matched: c.matched,
      knownCount: c.known.length,
      unexplainedCount: c.unexplained.length,
      known: c.known.slice(0, DIFFERENCES_KEPT),
      unexplained: c.unexplained.slice(0, DIFFERENCES_KEPT),
    }),
  );
  const labels: StoredLabels = {
    products: read.products.map((p) => ({
      key: p.id,
      label: p.name.trim(),
      cartonSize: p.cartonSize ?? null,
    })),
    people: read.people,
    categories: read.categories,
  };
  const report: StoredReport = {
    checks,
    notes: read.notes,
    unexplained: checks.reduce((n, c) => n + c.unexplainedCount, 0),
    ...(partial ? { through } : {}),
  };
  const catalog = await loadCatalog(ctx.db, access, read.month);
  const mapping = proposeMapping(labels, catalog);

  return runIdempotent(
    ctx,
    { scope: companyId, action: "import.create", requestKey },
    {
      fileHash,
      sheet: input.sheet,
      extraBlocks: input.extraBlocks ?? "ignore",
      through: partial ? through : null,
    },
    async (tx) => {
      const row = await tx.importJob.create({
        data: {
          tenantId: access.company.tenantId,
          companyId,
          fileName,
          fileHash,
          sheet: input.sheet,
          month: read.month,
          input: read.input as unknown as Prisma.InputJsonValue,
          labels: labels as unknown as Prisma.InputJsonValue,
          report: report as unknown as Prisma.InputJsonValue,
          mapping: mapping as Prisma.InputJsonValue,
          createdById: ctx.actor.userId,
        },
      });
      await recordAudit(tx, ctx, {
        companyId,
        action: "import.create",
        resourceType: "import_job",
        resourceId: row.id,
        after: {
          fileName,
          fileHash,
          sheet: input.sheet,
          month: read.month,
          unexplained: report.unexplained,
          through: report.through ?? null,
        },
      });
      return toView(tx, access, row);
    },
  );
}

/** Claims the job version the user reviewed; only a ready job changes. */
async function claimJob(
  tx: Tx,
  row: JobRow,
  version: number,
  data: Prisma.ImportJobUpdateManyMutationInput,
) {
  if (row.status !== "ready") throw invalid("", "validation.import.notReady");
  const claimed = await tx.importJob.updateMany({
    where: { id: row.id, version, status: "ready" },
    data: { ...data, version: { increment: 1 } },
  });
  if (claimed.count !== 1) throw invalid("version", "validation.import.stale");
}

export async function saveImportMapping(
  ctx: AppContext,
  companyId: string,
  jobId: string,
  input: unknown,
  requestKey?: string,
): Promise<ImportJob> {
  const access = await requirePermission(ctx, companyId, "period.close", { write: true });
  const request = parseInput(importMappingRequestSchema, input);
  return runIdempotent(
    ctx,
    { scope: companyId, action: `import.mapping:${jobId}`, requestKey },
    request,
    async (tx) => {
      const row = await findJob(tx, companyId, jobId);
      const labels = row.labels as unknown as StoredLabels;
      const catalog = await loadCatalog(tx, access, row.month);
      const known = {
        products: [new Set(labels.products.map((p) => p.key)), catalog.products],
        staff: [new Set(labels.people.map((p) => p.key)), catalog.staff],
        categories: [new Set(labels.categories.map((c) => c.key)), catalog.categories],
      } as const;
      for (const group of ["products", "staff", "categories"] as const) {
        const [keys, targets] = known[group];
        const ids = new Set(targets.map((t) => t.id));
        for (const [key, id] of Object.entries(request.mapping[group])) {
          if (!keys.has(key)) throw invalid(`mapping.${group}`, "validation.import.unknownKey");
          if (id !== null && !ids.has(id)) {
            throw invalid(`mapping.${group}.${key}`, "validation.import.unknownTarget");
          }
        }
      }
      await claimJob(tx, row, request.version, {
        mapping: request.mapping as Prisma.InputJsonValue,
      });
      await recordAudit(tx, ctx, {
        companyId,
        action: "import.mapping",
        resourceType: "import_job",
        resourceId: jobId,
        before: { mapping: row.mapping },
        after: { mapping: request.mapping },
      });
      return toView(tx, access, await findJob(tx, companyId, jobId));
    },
  );
}

export async function discardImportJob(
  ctx: AppContext,
  companyId: string,
  jobId: string,
  input: unknown,
  requestKey?: string,
): Promise<ImportJob> {
  const access = await requirePermission(ctx, companyId, "period.close", { write: true });
  const { version } = parseInput(importDiscardRequestSchema, input);
  return runIdempotent(
    ctx,
    { scope: companyId, action: `import.discard:${jobId}`, requestKey },
    { version },
    async (tx) => {
      const row = await findJob(tx, companyId, jobId);
      await claimJob(tx, row, version, { status: "discarded" });
      await recordAudit(tx, ctx, {
        companyId,
        action: "import.discard",
        resourceType: "import_job",
        resourceId: jobId,
        before: { status: "ready", version },
        after: { status: "discarded" },
      });
      return toView(tx, access, await findJob(tx, companyId, jobId));
    },
  );
}

const NUMBER = /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i;

/** Equal when every number matches as a decimal; a missing value counts as zero. */
function sameNumbers(a: unknown, b: unknown): boolean {
  const zero = (v: unknown): boolean =>
    v === undefined ||
    (typeof v === "string" && NUMBER.test(v) && toDecimal(v).isZero()) ||
    (typeof v === "object" && v !== null && Object.values(v).every(zero));
  if (typeof a === "string" && typeof b === "string") {
    return NUMBER.test(a) && NUMBER.test(b) ? toDecimal(a).eq(toDecimal(b)) : a === b;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const x = a as Record<string, unknown>;
    const y = b as Record<string, unknown>;
    for (const key of new Set([...Object.keys(x), ...Object.keys(y)])) {
      if (x[key] === undefined || y[key] === undefined) {
        if (!zero(x[key] ?? y[key])) return false;
      } else if (!sameNumbers(x[key], y[key])) return false;
    }
    return true;
  }
  return a === b || (zero(a) && zero(b));
}

async function postDocuments(
  tx: Tx,
  ctx: AppContext,
  access: CompanyAccess,
  row: JobRow,
  catalog: Catalog,
  docs: Documents,
): Promise<Record<string, unknown>> {
  const companyId = access.company.id;
  const tenantId = access.company.tenantId;
  const ref = reference(row.id);
  const createdById = ctx.actor.userId;
  if (docs.stock.length) {
    await tx.stockEntry.createMany({
      data: docs.stock.map((s) => ({
        tenantId,
        companyId,
        date: toDbDate(s.date),
        kind: s.kind,
        productId: s.productId,
        pieces: s.pieces,
        reference: ref,
        createdById,
      })),
    });
  }
  const before: Record<string, string> = {};
  if (docs.prices.length) {
    const existing = await tx.priceChange.findMany({
      where: {
        product: { companyId },
        effectiveFrom: {
          gte: toDbDate(firstOfMonth(row.month)),
          lte: toDbDate(lastOfMonth(row.month)),
        },
      },
    });
    const replaced = new Set(docs.prices.map((p) => `${p.productId}|${p.kind}|${p.date}`));
    const stale = existing.filter((e) =>
      replaced.has(`${e.productId}|${e.kind}|${fromDbDate(e.effectiveFrom)}`),
    );
    for (const e of stale) {
      before[`${e.productId}|${e.kind}|${fromDbDate(e.effectiveFrom)}`] = plain(e.price);
    }
    if (stale.length) {
      await tx.priceChange.deleteMany({ where: { id: { in: stale.map((e) => e.id) } } });
    }
    await tx.priceChange.createMany({
      data: docs.prices.map((p) => ({
        productId: p.productId,
        kind: p.kind,
        price: p.price,
        effectiveFrom: toDbDate(p.date),
      })),
    });
  }
  if (docs.dsrDays.length) {
    const now = new Date();
    const sheets = await tx.dsrDay.createManyAndReturn({
      data: docs.dsrDays.map((d) => ({
        tenantId,
        companyId,
        staffId: d.staffId,
        date: toDbDate(d.date),
        status: "posted",
        note: ref,
        createdById,
        postedById: createdById,
        postedAt: now,
      })),
      select: { id: true, staffId: true, date: true },
    });
    const idOf = new Map(sheets.map((s) => [`${s.staffId}|${fromDbDate(s.date)}`, s.id]));
    const packOf = new Map(catalog.products.map((p) => [p.id, p.packOn]));
    await tx.dsrLine.createMany({
      data: docs.dsrDays.flatMap((d) =>
        [...d.lines].map(([productId, q]) => ({
          dsrDayId: idOf.get(`${d.staffId}|${d.date}`) ?? "",
          productId,
          piecesPerCarton: packOf.get(productId)?.(d.date) ?? 1,
          issued: q.issued,
          returned: q.returned,
          damaged: q.damaged,
        })),
      ),
    });
  }
  if (docs.money.length) {
    await tx.moneyEntry.createMany({
      data: docs.money.map(({ date, entry }) => ({
        tenantId,
        companyId,
        date: toDbDate(date),
        kind: entry.kind,
        amount: String(entry.amount),
        staffId: entry.staffId ?? null,
        expenseCategoryId: entry.category ?? null,
        reference: ref,
        createdById,
      })),
    });
  }
  return {
    stockEntries: docs.stock.length,
    prices: docs.prices.length,
    dsrDays: docs.dsrDays.length,
    moneyEntries: docs.money.length,
    ...(Object.keys(before).length ? { replacedPrices: before } : {}),
  };
}

async function closeImportedMonth(
  tx: Tx,
  ctx: AppContext,
  access: CompanyAccess,
  row: JobRow,
  output: MonthOutput,
) {
  const close = await tx.monthClose.create({
    data: {
      tenantId: access.company.tenantId,
      companyId: access.company.id,
      month: row.month,
      closing: output.closing as unknown as Prisma.InputJsonValue,
      closedById: ctx.actor.userId,
    },
  });
  await recordAudit(tx, ctx, {
    companyId: access.company.id,
    action: "month.close",
    resourceType: "month_close",
    resourceId: close.id,
    after: {
      month: row.month,
      importJobId: row.id,
      salesTotal: output.month.totals.salesTotal,
      profitTotal: output.month.totals.profitTotal,
      marketDue: output.month.marketDue.closing,
      cashLeftTotal: output.month.cashLeftTotal,
    },
  });
}

/**
 * Commits a ready job (PLAN §8 step 5). Documents mode posts the month's documents with
 * reference `import:{id}`, checks that the ledger reproduces the previewed engine run exactly,
 * then closes the month (a job with a `through` date leaves it open). Opening mode writes the month's closing into the draft opening (the
 * next month's first day becomes the go-live date).
 */
export async function commitImportJob(
  ctx: AppContext,
  companyId: string,
  jobId: string,
  input: unknown,
  requestKey?: string,
): Promise<ImportJob> {
  const access = await requirePermission(ctx, companyId, "period.close", { write: true });
  const request = parseInput(importCommitRequestSchema, input);
  if (request.mode === "opening") requireAll(access, ["opening.prepare"]);
  return runIdempotent(
    ctx,
    { scope: companyId, action: `import.commit:${jobId}`, requestKey },
    request,
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM company WHERE id = ${companyId} FOR UPDATE`;
      const row = await findJob(tx, companyId, jobId);
      if (row.status !== "ready") throw invalid("", "validation.import.notReady");
      if (row.version !== request.version) throw invalid("version", "validation.import.stale");
      const catalog = await loadCatalog(tx, access, row.month);
      const mapping = importMappingSchema.parse(row.mapping);
      const preview = await buildPreview(tx, access, row, catalog, mapping);
      if (preview.mode !== request.mode) throw invalid("mode", "validation.import.mode");
      if (preview.issues.some((i) => i.severity === "error")) {
        throw invalid("", "validation.import.hasErrors");
      }
      if (preview.issues.some((i) => i.severity === "warning") && !request.acceptDifferences) {
        throw invalid("acceptDifferences", "validation.import.acceptDifferences");
      }

      let summary: Record<string, unknown>;
      if (request.mode === "documents") {
        requireAll(access, permissionsFor(preview.docs));
        const active = preview.active;
        const expectedInput = preview.expected;
        if (!active || !expectedInput) throw invalid("mode", "validation.import.mode");
        summary = await postDocuments(tx, ctx, access, row, catalog, preview.docs);
        const expected = computeMonth(expectedInput);
        const through = (row.report as unknown as StoredReport).through;
        const after = await runLedger(tx, access, lastDateOf(row), active);
        if (
          !after ||
          !sameNumbers(after.output.closing, expected.closing) ||
          !sameNumbers(after.output.month.totals, expected.month.totals)
        ) {
          throw invalid("", "validation.import.roundTrip");
        }
        if (through) summary = { ...summary, through };
        else await closeImportedMonth(tx, ctx, access, row, after.output);
      } else {
        if (request.openingVersion === null) {
          throw invalid("openingVersion", "validation.required");
        }
        const input = row.input as unknown as MonthInput;
        const m = mapperFor(mapping, catalog);
        const labels = row.labels as unknown as StoredLabels;
        const mapped = labels.products.flatMap((p) => {
          const productId = m.product(p.key);
          return productId ? [{ productId, label: p.label }] : [];
        });
        const closing = computeMonth({
          products: engineProducts(catalog, new Set(mapped.map((p) => p.productId))),
          opening: mapOpening(input.opening, m),
          days: preview.days,
        }).closing;
        const report = row.report as unknown as StoredReport;
        await importOpeningFromClosing(tx, ctx, access, {
          version: request.openingVersion,
          cutoffDate: firstOfMonth(nextMonth(row.month)),
          fileName: row.fileName,
          sheet: row.sheet,
          fileHash: row.fileHash,
          jobId: row.id,
          closing,
          products: mapped,
          notes: report.notes,
        });
        summary = { products: mapped.length, cutoffDate: firstOfMonth(nextMonth(row.month)) };
      }

      await claimJob(tx, row, request.version, {
        status: "committed",
        committedMode: request.mode,
        committedAt: new Date(),
        committedById: ctx.actor.userId,
      });
      await recordAudit(tx, ctx, {
        companyId,
        action: "import.commit",
        resourceType: "import_job",
        resourceId: row.id,
        after: {
          mode: request.mode,
          month: row.month,
          sheet: row.sheet,
          fileHash: row.fileHash,
          acceptDifferences: request.acceptDifferences,
          ...summary,
        },
      });
      return toView(tx, access, await findJob(tx, companyId, jobId));
    },
  );
}
