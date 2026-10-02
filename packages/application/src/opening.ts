import { createHash } from "node:crypto";
import {
  openingBalanceKinds,
  openingSaveRequestSchema,
  openingSchema,
  openingSourceSchema,
  openingStockSourceSchema,
  openingTransitionRequestSchema,
  openingWorkbookSheetsSchema,
  type Opening,
  type OpeningBalanceKind,
  type OpeningBalanceLine,
  type OpeningSource,
  type OpeningStockLine,
  type OpeningStockSource,
  type OpeningWorkbookSheets,
} from "@bsd/contracts";
import type { Prisma } from "@bsd/database";
import { OPENING_KIND_EFFECTS, checkOpening, type OpeningKindEffect } from "@bsd/domain";
import {
  MAX_WORKBOOK_BYTES,
  buildOpeningTemplate,
  isOpeningTemplate,
  loadWorkbook,
  monthSheetNames,
  proposeOpening,
  readOpeningTemplate,
} from "@bsd/importer";
import { requirePermission, type CompanyAccess } from "./access";
import { recordAudit } from "./audit";
import type { AppContext, Tx } from "./context";
import { fromDbDate, toDbDate, todayInDhaka } from "./dates";
import { AppError, parseInput, type FieldError } from "./errors";
import { runIdempotent } from "./idempotency";
import { plain } from "./numeric";
import { packOn } from "./products";

export const MAX_OPENING_WORKBOOK_BYTES = MAX_WORKBOOK_BYTES;

type Db = AppContext["db"] | Tx;

const invalid = (path: string, code: string) => new AppError("VALIDATION_FAILED", [{ path, code }]);

const WHOLE = /^(0|[1-9]\d*)$/;
const UNIT_PRICE = /^\d+(\.\d{1,6})?$/;
const AMOUNT = /^\d+(\.\d{1,2})?$/;
const accept = (value: string | null | undefined, pattern: RegExp) =>
  value !== null && value !== undefined && pattern.test(value) ? value : null;

const nameKey = (name: string) => name.replace(/\s+/g, " ").trim().toLowerCase();
const partyKey = (line: { staffId: string | null; cashAccountId: string | null }) =>
  line.staffId ?? line.cashAccountId ?? "";
const lineKey = (line: { kind: string; staffId: string | null; cashAccountId: string | null }) =>
  `${line.kind}|${partyKey(line)}`;

// ---------------------------------------------------------------- reading

type Catalog = {
  products: {
    id: string;
    sku: string;
    name: string;
    aliases: string[];
    status: string;
    piecesPerCarton: string;
  }[];
  staff: { id: string; name: string; roleKind: "dsr" | "sr" | "general" }[];
  cashAccounts: { id: string; name: string }[];
};

async function loadCatalog(
  db: Db,
  access: CompanyAccess,
  cutoffDate: string | null,
): Promise<Catalog> {
  const companyId = access.company.id;
  const onDate = cutoffDate ?? todayInDhaka();
  const [products, staff, cashAccounts] = await Promise.all([
    db.product.findMany({
      where: { companyId },
      include: { packs: true },
      orderBy: { sku: "asc" },
    }),
    db.staff.findMany({
      where: { tenantId: access.company.tenantId, assignments: { some: { companyId } } },
      include: { assignments: { where: { companyId }, include: { role: true } } },
      orderBy: { name: "asc" },
    }),
    db.cashAccount.findMany({
      where: { legalEntityId: access.company.legalEntityId, active: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return {
    products: products.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      aliases: p.aliases,
      status: p.status,
      piecesPerCarton: String(packOn(p.packs, onDate)?.piecesPerCarton ?? ""),
    })),
    staff: staff.map((s) => {
      const covering =
        s.assignments.find(
          (a) => fromDbDate(a.from) <= onDate && (a.to === null || fromDbDate(a.to) >= onDate),
        ) ?? s.assignments.at(-1);
      return {
        id: s.id,
        name: s.name,
        roleKind: (covering?.role.kind ?? "general") as "dsr" | "sr" | "general",
      };
    }),
    cashAccounts: cashAccounts.map((a) => ({ id: a.id, name: a.name })),
  };
}

const sessionInclude = { stock: true, balances: true } as const;

async function findSession(db: Db, companyId: string) {
  return db.openingSession.findUnique({ where: { companyId }, include: sessionInclude });
}

type SessionRow = NonNullable<Awaited<ReturnType<typeof findSession>>>;

function sourceOf(session: SessionRow | null): OpeningSource | null {
  if (!session?.sourceFileName || !session.sourceSheet || !session.sourceHash) return null;
  const report = openingSourceSchema
    .pick({ notes: true, unmatchedProducts: true, unmatchedPersons: true })
    .safeParse(session.sourceReport);
  return {
    fileName: session.sourceFileName,
    sheet: session.sourceSheet,
    fileHash: session.sourceHash,
    importedAt: session.sourceImportedAt?.toISOString() ?? "",
    notes: report.success ? report.data.notes : [],
    unmatchedProducts: report.success ? report.data.unmatchedProducts : [],
    unmatchedPersons: report.success ? report.data.unmatchedPersons : [],
  };
}

function toView(companyId: string, session: SessionRow | null, catalog: Catalog): Opening {
  const lines = new Map(session?.stock.map((l) => [l.productId, l]) ?? []);
  const stock: OpeningStockLine[] = catalog.products
    .filter((p) => p.status === "active" || lines.has(p.id))
    .map((p) => {
      const line = lines.get(p.id);
      const source = openingStockSourceSchema.safeParse(line?.source);
      return {
        productId: p.id,
        sku: p.sku,
        productName: p.name,
        piecesPerCarton: p.piecesPerCarton,
        pieces: plain(line?.pieces ?? null),
        unitCost: plain(line?.unitCost ?? null),
        salePrice: plain(line?.salePrice ?? null),
        orderPrice: plain(line?.orderPrice ?? null),
        dueFromCompany: plain(line?.dueFromCompany ?? null),
        note: line?.note ?? "",
        source: source.success ? source.data : null,
      };
    });
  const balances: OpeningBalanceLine[] = (session?.balances ?? [])
    .map((b) => ({
      kind: b.kind as OpeningBalanceKind,
      staffId: b.staffId,
      cashAccountId: b.cashAccountId,
      amount: b.amount === null ? null : b.amount.toFixed(2),
      sourceAmount: plain(b.sourceAmount),
      note: b.note,
    }))
    .sort(
      (a, b) =>
        openingBalanceKinds.indexOf(a.kind) - openingBalanceKinds.indexOf(b.kind) ||
        partyKey(a).localeCompare(partyKey(b)),
    );
  const roleOf = new Map(catalog.staff.map((s) => [s.id, s.roleKind]));
  const cutoffDate = session?.cutoffDate ? fromDbDate(session.cutoffDate) : null;
  const { issues, totals } = checkOpening({
    cutoffDate,
    stock: stock.map((l) => ({ ...l, sourcePieces: l.source?.pieces ?? null })),
    balances: balances.map((b) => ({
      ...b,
      personRoleKind: b.staffId ? (roleOf.get(b.staffId) ?? null) : null,
    })),
  });
  return openingSchema.parse({
    companyId,
    status: session?.status ?? "draft",
    version: session?.version ?? 0,
    cutoffDate,
    source: sourceOf(session),
    stock,
    balances,
    issues,
    totals,
    approvedAt: session?.approvedAt?.toISOString() ?? null,
    activatedAt: session?.activatedAt?.toISOString() ?? null,
  });
}

async function viewOf(db: Db, access: CompanyAccess): Promise<Opening> {
  const session = await findSession(db, access.company.id);
  const cutoff = session?.cutoffDate ? fromDbDate(session.cutoffDate) : null;
  return toView(access.company.id, session, await loadCatalog(db, access, cutoff));
}

export async function getOpening(ctx: AppContext, companyId: string): Promise<Opening> {
  const access = await requirePermission(ctx, companyId, "opening.prepare");
  return viewOf(ctx.db, access);
}

// ---------------------------------------------------------------- writing

async function ensureSession(tx: Tx, access: CompanyAccess) {
  return tx.openingSession.upsert({
    where: { companyId: access.company.id },
    create: { tenantId: access.company.tenantId, companyId: access.company.id },
    update: {},
    include: sessionInclude,
  });
}

/**
 * Claims the version the user edited: one atomic update, so two saves of the same version can't
 * both win. Any change returns the opening to draft and clears its approval.
 */
async function claimVersion(
  tx: Tx,
  session: { id: string; status: string; version: number },
  version: number,
  data: Prisma.OpeningSessionUpdateManyMutationInput = {},
) {
  const claimed = await tx.openingSession.updateMany({
    where: { id: session.id, version, status: { not: "active" } },
    data: {
      ...data,
      version: { increment: 1 },
      status: "draft",
      approvedAt: null,
      approvedById: null,
    },
  });
  if (claimed.count === 1) return;
  if (session.status === "active") throw invalid("", "validation.opening.locked");
  throw invalid("version", "validation.opening.stale");
}

function checkParty(
  effect: OpeningKindEffect,
  line: { staffId: string | null; cashAccountId: string | null },
): string | null {
  if (effect.party === "staff" && (!line.staffId || line.cashAccountId)) {
    return "validation.opening.personRequired";
  }
  if (effect.party === "cashAccount" && (!line.cashAccountId || line.staffId)) {
    return "validation.opening.accountRequired";
  }
  if (effect.party === "none" && (line.staffId || line.cashAccountId)) {
    return "validation.opening.noParty";
  }
  if (effect.party === "optionalStaff" && line.cashAccountId) return "validation.opening.noParty";
  return null;
}

type BalanceWrite = Omit<OpeningBalanceLine, "sourceAmount">;

function validateRefs(
  catalog: Catalog,
  stock: { productId: string }[],
  balances: BalanceWrite[],
): void {
  const errors: FieldError[] = [];
  const productIds = new Set(catalog.products.map((p) => p.id));
  const staffIds = new Set(catalog.staff.map((s) => s.id));
  const accountIds = new Set(catalog.cashAccounts.map((a) => a.id));
  const seenProducts = new Set<string>();
  stock.forEach((line, i) => {
    if (!productIds.has(line.productId) || seenProducts.has(line.productId)) {
      errors.push({ path: `stock.${i}.productId`, code: "validation.product.unknown" });
    }
    seenProducts.add(line.productId);
  });
  const seen = new Set<string>();
  balances.forEach((line, i) => {
    const party = checkParty(OPENING_KIND_EFFECTS[line.kind], line);
    if (party) errors.push({ path: `balances.${i}.kind`, code: party });
    if (line.staffId && !staffIds.has(line.staffId)) {
      errors.push({ path: `balances.${i}.staffId`, code: "validation.staff.unknown" });
    }
    if (line.cashAccountId && !accountIds.has(line.cashAccountId)) {
      errors.push({ path: `balances.${i}.cashAccountId`, code: "validation.cashAccount.unknown" });
    }
    const key = lineKey(line);
    if (seen.has(key))
      errors.push({ path: `balances.${i}.kind`, code: "validation.opening.duplicate" });
    seen.add(key);
  });
  if (errors.length) throw new AppError("VALIDATION_FAILED", errors);
}

async function replaceBalances(tx: Tx, session: SessionRow, balances: BalanceWrite[]) {
  const sources = new Map(session.balances.map((b) => [lineKey(b), b.sourceAmount]));
  await tx.openingBalanceLine.deleteMany({ where: { sessionId: session.id } });
  if (!balances.length) return;
  await tx.openingBalanceLine.createMany({
    data: balances.map((b) => ({
      sessionId: session.id,
      kind: b.kind,
      staffId: b.staffId,
      cashAccountId: b.cashAccountId,
      partyKey: partyKey(b),
      amount: b.amount,
      sourceAmount: sources.get(lineKey(b)) ?? null,
      note: b.note,
    })),
  });
}

/** Full replace of the editable values; imported evidence (`source`) is kept as it was. */
export async function saveOpening(
  ctx: AppContext,
  companyId: string,
  input: unknown,
  requestKey?: string,
): Promise<Opening> {
  const access = await requirePermission(ctx, companyId, "opening.prepare", { write: true });
  const data = parseInput(openingSaveRequestSchema, input);
  return runIdempotent(
    ctx,
    { scope: companyId, action: "opening.save", requestKey },
    data,
    async (tx) => {
      const session = await ensureSession(tx, access);
      await claimVersion(tx, session, data.version, {
        cutoffDate: data.cutoffDate ? toDbDate(data.cutoffDate) : null,
      });
      validateRefs(await loadCatalog(tx, access, data.cutoffDate), data.stock, data.balances);
      const keep = data.stock.map((l) => l.productId);
      await tx.openingStockLine.deleteMany({
        where: { sessionId: session.id, productId: { notIn: keep } },
      });
      for (const line of data.stock) {
        const values = {
          pieces: line.pieces,
          unitCost: line.unitCost,
          salePrice: line.salePrice,
          orderPrice: line.orderPrice,
          dueFromCompany: line.dueFromCompany,
          note: line.note,
        };
        await tx.openingStockLine.upsert({
          where: { sessionId_productId: { sessionId: session.id, productId: line.productId } },
          create: { sessionId: session.id, productId: line.productId, ...values },
          update: values,
        });
      }
      await replaceBalances(tx, session, data.balances);
      await recordAudit(tx, ctx, {
        companyId,
        action: "opening.save",
        resourceType: "opening",
        resourceId: session.id,
        after: data,
      });
      return viewOf(tx, access);
    },
  );
}

// ---------------------------------------------------------------- import

type ProposedStock = {
  productId: string;
  source: OpeningStockSource;
  pieces: string | null;
  unitCost: string | null;
  salePrice: string | null;
  orderPrice: string | null;
  dueFromCompany: string | null;
  note?: string;
};

type ProposedBalance = BalanceWrite & { sourceAmount: string | null };

type ImportResult = {
  stock: ProposedStock[];
  balances: ProposedBalance[];
  report: Pick<OpeningSource, "notes" | "unmatchedProducts" | "unmatchedPersons">;
  /** Template uploads are the owner's own entries and replace adjusted values. */
  overwrite: boolean;
};

function readWorkbookBytes(data: Uint8Array): void {
  if (data.byteLength === 0) throw invalid("file", "validation.opening.fileEmpty");
  if (data.byteLength > MAX_WORKBOOK_BYTES)
    throw invalid("file", "validation.opening.fileTooLarge");
}

async function openWorkbook(data: Uint8Array) {
  readWorkbookBytes(data);
  try {
    return await loadWorkbook(data);
  } catch {
    throw invalid("file", "validation.opening.fileUnreadable");
  }
}

/** Month sheets of an uploaded workbook, or `template: true` for the standard template. */
export async function inspectOpeningWorkbook(
  ctx: AppContext,
  companyId: string,
  data: Uint8Array,
): Promise<OpeningWorkbookSheets> {
  await requirePermission(ctx, companyId, "opening.prepare");
  const workbook = await openWorkbook(data);
  return openingWorkbookSheetsSchema.parse(
    isOpeningTemplate(workbook)
      ? { sheets: [], template: true }
      : { sheets: monthSheetNames(workbook), template: false },
  );
}

function matchPerson(label: string, staff: Catalog["staff"]) {
  const key = nameKey(label);
  return staff.find((s) => {
    const name = nameKey(s.name);
    return key === name || key.endsWith(` ${name}`) || key.split(" ").includes(name);
  });
}

const STAFF_KIND_OF: Record<string, OpeningBalanceKind> = {
  advance: "advance",
  loan: "loan",
  shortage: "shortage",
  credit: "credit",
  salaryPayable: "salary_payable",
  srLoan: "sr_loan",
  owedToSr: "owed_to_sr",
};

function fromMonthSheet(
  workbook: Awaited<ReturnType<typeof loadWorkbook>>,
  sheet: string,
  catalog: Catalog,
): ImportResult {
  if (!monthSheetNames(workbook).includes(sheet))
    throw invalid("sheet", "validation.opening.sheet");
  let proposal;
  try {
    proposal = proposeOpening(workbook, sheet);
  } catch {
    throw invalid("sheet", "validation.opening.sheetLayout");
  }
  const byName = new Map<string, string>();
  for (const p of catalog.products) {
    for (const name of [p.name, ...p.aliases]) byName.set(nameKey(name), p.id);
  }
  const unmatchedProducts: string[] = [];
  const stock: ProposedStock[] = [];
  for (const p of proposal.products) {
    const productId = byName.get(nameKey(p.label));
    if (!productId) {
      unmatchedProducts.push(p.label);
      continue;
    }
    stock.push({
      productId,
      source: {
        label: p.label,
        pieces: p.stock,
        unitCost: p.costPrice ?? null,
        salePrice: p.salePrice ?? null,
        orderPrice: p.orderPrice ?? null,
        dueFromCompany: p.dueFromCompany,
      },
      pieces: accept(p.stock, WHOLE),
      unitCost: accept(p.costPrice, UNIT_PRICE),
      salePrice: accept(p.salePrice, UNIT_PRICE),
      orderPrice: accept(p.orderPrice, UNIT_PRICE),
      dueFromCompany: accept(p.dueFromCompany, WHOLE),
    });
  }

  const unmatchedPersons: OpeningSource["unmatchedPersons"] = [];
  const balances: ProposedBalance[] = [];
  const add = (kind: OpeningBalanceKind, staffId: string | null, value: string) => {
    balances.push({
      kind,
      staffId,
      cashAccountId: null,
      amount: accept(value, AMOUNT),
      sourceAmount: value,
      note: "",
    });
  };
  for (const due of proposal.marketDue) {
    const person = due.label ? matchPerson(due.label, catalog.staff) : undefined;
    if (due.label && !person) {
      unmatchedPersons.push({ label: due.label, detail: `market_due ${due.amount}` });
      continue;
    }
    add("market_due", person?.id ?? null, due.amount);
  }
  for (const s of proposal.staff) {
    const person = matchPerson(s.label, catalog.staff);
    if (!person) {
      unmatchedPersons.push({
        label: s.label,
        detail: Object.entries(s.balances)
          .map(([k, v]) => `${k} ${v}`)
          .join("; "),
      });
      continue;
    }
    for (const [key, value] of Object.entries(s.balances)) {
      const kind = STAFF_KIND_OF[key];
      if (kind && value) add(kind, person.id, value);
    }
  }
  if (proposal.companyPayable && !/^-?0(\.0+)?$/.test(proposal.companyPayable)) {
    const negative = proposal.companyPayable.startsWith("-");
    add(
      negative ? "company_advance" : "company_payable",
      null,
      proposal.companyPayable.replace(/^-/, ""),
    );
  }
  return {
    stock,
    balances,
    report: { notes: proposal.notes, unmatchedProducts, unmatchedPersons },
    overwrite: false,
  };
}

function fromTemplate(
  workbook: Awaited<ReturnType<typeof loadWorkbook>>,
  catalog: Catalog,
): ImportResult {
  const rows = readOpeningTemplate(workbook);
  const notes: string[] = [];
  const unmatchedProducts: string[] = [];
  const unmatchedPersons: OpeningSource["unmatchedPersons"] = [];
  const bySku = new Map(catalog.products.map((p) => [p.sku, p.id]));
  const check = (row: number, column: string, value: string | null, pattern: RegExp) => {
    if (value === null || pattern.test(value)) return value;
    notes.push(`Products row ${row}: ${column} "${value}" is not valid; left blank`);
    return null;
  };
  const stock: ProposedStock[] = [];
  for (const r of rows.products) {
    const productId = bySku.get(r.code);
    if (!productId) {
      unmatchedProducts.push(r.code || `row ${r.row}`);
      continue;
    }
    const values = {
      pieces: check(r.row, "pieces", r.pieces, WHOLE),
      unitCost: check(r.row, "unit_cost", r.unitCost, UNIT_PRICE),
      salePrice: check(r.row, "sale_price", r.salePrice, UNIT_PRICE),
      orderPrice: check(r.row, "order_price", r.orderPrice, UNIT_PRICE),
      dueFromCompany: check(r.row, "due_from_company", r.dueFromCompany, WHOLE),
    };
    stock.push({
      productId,
      source: {
        label: r.code,
        pieces: r.pieces,
        unitCost: r.unitCost,
        salePrice: r.salePrice,
        orderPrice: r.orderPrice,
        dueFromCompany: r.dueFromCompany,
      },
      ...values,
      note: r.note,
    });
  }
  const balances: ProposedBalance[] = [];
  for (const r of rows.balances) {
    const kind = openingBalanceKinds.find((k) => k === r.kind);
    if (!kind) {
      notes.push(`Balances row ${r.row}: unknown kind "${r.kind}"`);
      continue;
    }
    const effect: OpeningKindEffect = OPENING_KIND_EFFECTS[kind];
    const person = r.person ? matchPerson(r.person, catalog.staff) : undefined;
    if (r.person && !person) {
      unmatchedPersons.push({ label: r.person, detail: `${kind} ${r.amount ?? ""}`.trim() });
      continue;
    }
    const account = r.cashAccount
      ? catalog.cashAccounts.find((a) => nameKey(a.name) === nameKey(r.cashAccount))
      : undefined;
    if (r.cashAccount && !account) {
      notes.push(`Balances row ${r.row}: unknown cash account "${r.cashAccount}"`);
      continue;
    }
    const line = {
      kind,
      staffId:
        effect.party === "staff" || effect.party === "optionalStaff" ? (person?.id ?? null) : null,
      cashAccountId: effect.party === "cashAccount" ? (account?.id ?? null) : null,
    };
    if (checkParty(effect, line)) {
      notes.push(`Balances row ${r.row}: ${kind} needs ${effect.party}`);
      continue;
    }
    if (r.amount !== null && !AMOUNT.test(r.amount)) {
      notes.push(`Balances row ${r.row}: amount "${r.amount}" is not valid; left blank`);
    }
    balances.push({ ...line, amount: accept(r.amount, AMOUNT), sourceAmount: null, note: r.note });
  }
  return {
    stock,
    balances,
    report: { notes, unmatchedProducts, unmatchedPersons },
    overwrite: true,
  };
}

const stockFields = ["pieces", "unitCost", "salePrice", "orderPrice", "dueFromCompany"] as const;

/**
 * Re-importing never wipes the owner's adjustments: a value is replaced only where it still
 * equals what the previous import proposed (or is blank and nothing was proposed before).
 */
async function applyImport(tx: Tx, session: SessionRow, result: ImportResult) {
  for (const p of result.stock) {
    const existing = session.stock.find((l) => l.productId === p.productId);
    const before = openingStockSourceSchema.safeParse(existing?.source);
    const values: Record<(typeof stockFields)[number], string | null> = {
      pieces: null,
      unitCost: null,
      salePrice: null,
      orderPrice: null,
      dueFromCompany: null,
    };
    for (const field of stockFields) {
      const current = plain(existing?.[field] ?? null);
      const proposedBefore = before.success ? before.data[field] : null;
      const untouched = !existing || current === null || current === proposedBefore;
      values[field] = result.overwrite || untouched ? p[field] : current;
    }
    const data = {
      ...values,
      source: p.source as Prisma.InputJsonValue,
      ...(p.note !== undefined ? { note: p.note } : {}),
    };
    await tx.openingStockLine.upsert({
      where: { sessionId_productId: { sessionId: session.id, productId: p.productId } },
      create: { sessionId: session.id, productId: p.productId, ...data },
      update: data,
    });
  }
  for (const b of result.balances) {
    const existing = session.balances.find((l) => lineKey(l) === lineKey(b));
    const current = existing?.amount ? existing.amount.toFixed(2) : null;
    const before = existing?.sourceAmount ? accept(plain(existing.sourceAmount), AMOUNT) : null;
    const untouched = !existing || current === null || current === before;
    const amount = result.overwrite || untouched ? b.amount : current;
    const data = {
      amount,
      sourceAmount: b.sourceAmount,
      ...(b.note ? { note: b.note } : {}),
    };
    if (existing) {
      await tx.openingBalanceLine.update({ where: { id: existing.id }, data });
    } else {
      await tx.openingBalanceLine.create({
        data: {
          sessionId: session.id,
          kind: b.kind,
          staffId: b.staffId,
          cashAccountId: b.cashAccountId,
          partyKey: partyKey(b),
          note: b.note,
          ...data,
        },
      });
    }
  }
}

/**
 * Imports a completed month sheet (its closing becomes the proposed opening, D26) or a filled
 * standard template (guide §16.7). The workbook itself is never stored, only its hash and the
 * extracted values with their source.
 */
export async function importOpeningWorkbook(
  ctx: AppContext,
  companyId: string,
  input: { data: Uint8Array; fileName: string; sheet: string | null; version: number },
  requestKey?: string,
): Promise<Opening> {
  const access = await requirePermission(ctx, companyId, "opening.prepare", { write: true });
  const fileHash = createHash("sha256").update(input.data).digest("hex");
  const fileName = input.fileName.slice(0, 200) || "workbook.xlsx";
  const workbook = await openWorkbook(input.data);
  const template = isOpeningTemplate(workbook);
  if (!template && !input.sheet) throw invalid("sheet", "validation.opening.sheet");
  const sheet = template ? "template" : (input.sheet ?? "");
  const before = await findSession(ctx.db, companyId);
  const cutoff = before?.cutoffDate ? fromDbDate(before.cutoffDate) : null;
  const result = template
    ? fromTemplate(workbook, await loadCatalog(ctx.db, access, cutoff))
    : fromMonthSheet(workbook, sheet, await loadCatalog(ctx.db, access, cutoff));
  return runIdempotent(
    ctx,
    { scope: companyId, action: "opening.import", requestKey },
    { fileHash, sheet, version: input.version },
    async (tx) => {
      const session = await ensureSession(tx, access);
      await claimVersion(tx, session, input.version, {
        sourceFileName: fileName,
        sourceSheet: sheet,
        sourceHash: fileHash,
        sourceImportedAt: new Date(),
        sourceReport: result.report as Prisma.InputJsonValue,
      });
      await applyImport(tx, session, result);
      await recordAudit(tx, ctx, {
        companyId,
        action: "opening.import",
        resourceType: "opening",
        resourceId: session.id,
        after: {
          fileName,
          fileHash,
          sheet,
          products: result.stock.length,
          balances: result.balances.length,
          ...result.report,
        },
      });
      return viewOf(tx, access);
    },
  );
}

/** The company's standard opening template with its current values (guide §16.7). */
export async function openingTemplate(
  ctx: AppContext,
  companyId: string,
): Promise<{ fileName: string; data: Uint8Array }> {
  const access = await requirePermission(ctx, companyId, "opening.prepare");
  const session = await findSession(ctx.db, companyId);
  const catalog = await loadCatalog(
    ctx.db,
    access,
    session?.cutoffDate ? fromDbDate(session.cutoffDate) : null,
  );
  const view = toView(companyId, session, catalog);
  const staffName = new Map(catalog.staff.map((s) => [s.id, s.name]));
  const accountName = new Map(catalog.cashAccounts.map((a) => [a.id, a.name]));
  const existing = new Map(view.balances.map((b) => [lineKey(b), b]));
  const rows: { kind: OpeningBalanceKind; staffId: string | null; cashAccountId: string | null }[] =
    [{ kind: "market_due", staffId: null, cashAccountId: null }];
  for (const s of catalog.staff) {
    if (s.roleKind === "dsr") rows.push({ kind: "market_due", staffId: s.id, cashAccountId: null });
  }
  for (const s of catalog.staff) {
    for (const kind of openingBalanceKinds) {
      const effect: OpeningKindEffect = OPENING_KIND_EFFECTS[kind];
      if (effect.party !== "staff") continue;
      if ((effect.personKind === "sr") !== (s.roleKind === "sr")) continue;
      rows.push({ kind, staffId: s.id, cashAccountId: null });
    }
  }
  rows.push(
    { kind: "company_payable", staffId: null, cashAccountId: null },
    { kind: "company_advance", staffId: null, cashAccountId: null },
  );
  for (const a of catalog.cashAccounts)
    rows.push({ kind: "cash", staffId: null, cashAccountId: a.id });
  for (const b of view.balances) if (!rows.some((r) => lineKey(r) === lineKey(b))) rows.push(b);

  const data = await buildOpeningTemplate({
    products: view.stock.map((l) => ({
      code: l.sku,
      name: l.productName,
      cartonSize: l.piecesPerCarton,
      pieces: l.pieces,
      unitCost: l.unitCost,
      salePrice: l.salePrice,
      orderPrice: l.orderPrice,
      dueFromCompany: l.dueFromCompany,
      note: l.note,
    })),
    balances: rows.map((r) => {
      const current = existing.get(lineKey(r));
      return {
        kind: r.kind,
        person: r.staffId ? (staffName.get(r.staffId) ?? "") : "",
        cashAccount: r.cashAccountId ? (accountName.get(r.cashAccountId) ?? "") : "",
        amount: current?.amount ?? null,
        note: current?.note ?? "",
      };
    }),
  });
  const safeName = access.company.name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
  return { fileName: `opening-${safeName || "company"}.xlsx`, data };
}

// ---------------------------------------------------------------- approval and activation

async function requireSession(tx: Tx, companyId: string, version: number, status: string) {
  const session = await findSession(tx, companyId);
  if (!session) throw invalid("version", "validation.opening.stale");
  if (session.status === "active" && status !== "active") {
    throw invalid("", "validation.opening.locked");
  }
  if (session.version !== version || session.status !== status) {
    throw invalid("version", "validation.opening.stale");
  }
  return session;
}

/** Approves the exact version reviewed; blocked while any readiness error remains. */
export async function approveOpening(
  ctx: AppContext,
  companyId: string,
  input: unknown,
  requestKey?: string,
): Promise<Opening> {
  const access = await requirePermission(ctx, companyId, "opening.approve", { write: true });
  const { version } = parseInput(openingTransitionRequestSchema, input);
  return runIdempotent(
    ctx,
    { scope: companyId, action: "opening.approve", requestKey },
    { version },
    async (tx) => {
      const session = await requireSession(tx, companyId, version, "draft");
      const view = await viewOf(tx, access);
      if (view.issues.some((i) => i.severity === "error")) {
        throw invalid("", "validation.opening.hasErrors");
      }
      const updated = await tx.openingSession.updateMany({
        where: { id: session.id, version, status: "draft" },
        data: { status: "approved", approvedAt: new Date(), approvedById: ctx.actor.userId },
      });
      if (updated.count !== 1) throw invalid("version", "validation.opening.stale");
      await recordAudit(tx, ctx, {
        companyId,
        action: "opening.approve",
        resourceType: "opening",
        resourceId: session.id,
        after: { version, totals: view.totals },
      });
      return viewOf(tx, access);
    },
  );
}

/**
 * Activates the approved opening once, atomically (guide §16.5): the snapshot is locked and its
 * prices become the catalog prices from the go-live date. Cash and bank balances belong to the
 * whole distributor, so an account can be opened by one company only.
 */
export async function activateOpening(
  ctx: AppContext,
  companyId: string,
  input: unknown,
  requestKey?: string,
): Promise<Opening> {
  const access = await requirePermission(ctx, companyId, "opening.activate", { write: true });
  const { version } = parseInput(openingTransitionRequestSchema, input);
  return runIdempotent(
    ctx,
    { scope: companyId, action: "opening.activate", requestKey },
    { version },
    async (tx) => {
      const session = await requireSession(tx, companyId, version, "approved");
      const view = await viewOf(tx, access);
      if (!view.cutoffDate || view.issues.some((i) => i.severity === "error")) {
        throw invalid("", "validation.opening.hasErrors");
      }
      const cashIds = view.balances
        .filter((b) => b.kind === "cash" && b.cashAccountId)
        .map((b) => b.cashAccountId as string);
      if (cashIds.length) {
        // Row locks serialise two companies activating the same account at once.
        await tx.$queryRaw`SELECT id FROM cash_account WHERE id = ANY(${cashIds}::text[]) FOR UPDATE`;
        const elsewhere = await tx.openingBalanceLine.count({
          where: {
            kind: "cash",
            cashAccountId: { in: cashIds },
            session: {
              status: "active",
              tenantId: access.company.tenantId,
              companyId: { not: companyId },
            },
          },
        });
        if (elsewhere) throw invalid("balances", "validation.opening.cashElsewhere");
      }
      const effectiveFrom = toDbDate(view.cutoffDate);
      let prices = 0;
      for (const line of view.stock) {
        for (const [kind, price] of [
          ["cost", line.unitCost],
          ["sale", line.salePrice],
          ["order", line.orderPrice],
        ] as const) {
          if (price === null) continue;
          await tx.priceChange.upsert({
            where: {
              productId_kind_effectiveFrom: { productId: line.productId, kind, effectiveFrom },
            },
            create: { productId: line.productId, kind, price, effectiveFrom },
            update: { price },
          });
          prices++;
        }
      }
      const updated = await tx.openingSession.updateMany({
        where: { id: session.id, version, status: "approved" },
        data: { status: "active", activatedAt: new Date(), activatedById: ctx.actor.userId },
      });
      if (updated.count !== 1) throw invalid("version", "validation.opening.stale");
      await recordAudit(tx, ctx, {
        companyId,
        action: "opening.activate",
        resourceType: "opening",
        resourceId: session.id,
        after: { version, cutoffDate: view.cutoffDate, totals: view.totals, pricesSet: prices },
      });
      return viewOf(tx, access);
    },
  );
}
