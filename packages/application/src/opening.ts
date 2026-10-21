import {
  openingBalanceKinds,
  openingCutoffRequestSchema,
  openingSchema,
  openingSectionKinds,
  openingSectionSaveRequestSchema,
  type Opening,
  type OpeningBalanceKind,
  type OpeningBalanceLine,
  type OpeningSectionSaveRequest,
  type OpeningStockLine,
} from "@bsd/contracts";
import type { Prisma } from "@bsd/database";
import {
  OPENING_KIND_EFFECTS,
  checkOpening,
  type OpeningKindEffect,
  todayBusinessDate,
} from "@bsd/domain";
import { requirePermission, type CompanyAccess } from "./access";
import { recordAudit } from "./audit";
import type { AppContext, Tx } from "./context";
import { fromDbDate, toDbDate } from "./dates";
import { AppError, invalid, parseInput, type FieldError } from "./errors";
import { runIdempotent } from "./idempotency";
import { staffCompanyIds } from "./master";
import { plain } from "./numeric";
import { isLocked } from "./opening-lock";
import { summarizeSections } from "./opening-summary";
import { packOn } from "./products";

type Db = AppContext["db"] | Tx;

type PartyRef = { staffId: string | null; cashAccountId: string | null; shopId?: string | null };

const partyKey = (line: PartyRef) => line.shopId ?? line.staffId ?? line.cashAccountId ?? "";
const lineKey = (line: PartyRef & { kind: string }) => `${line.kind}|${partyKey(line)}`;

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
  shops: { id: string; active: boolean }[];
};

async function loadCatalog(
  db: Db,
  access: CompanyAccess,
  cutoffDate: string | null,
): Promise<Catalog> {
  const companyId = access.company.id;
  const onDate = cutoffDate ?? todayBusinessDate();
  // D65: global staff (the master's) count in every company, e.g. a DSR's market due.
  const companyIds = await staffCompanyIds(db, companyId);
  const [products, staff, cashAccounts, shops] = await Promise.all([
    db.product.findMany({
      where: { companyId },
      include: { packs: true },
      orderBy: { sku: "asc" },
    }),
    db.staff.findMany({
      where: {
        tenantId: access.company.tenantId,
        assignments: { some: { companyId: { in: companyIds } } },
      },
      include: {
        assignments: { where: { companyId: { in: companyIds } }, include: { role: true } },
      },
      orderBy: { name: "asc" },
    }),
    db.cashAccount.findMany({
      where: { legalEntityId: access.company.legalEntityId, active: true },
      orderBy: { name: "asc" },
    }),
    db.shop.findMany({ where: { companyId }, select: { id: true, status: true } }),
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
    shops: shops.map((s) => ({ id: s.id, active: s.status === "active" })),
  };
}

const sessionInclude = { stock: true, balances: true } as const;

async function findSession(db: Db, companyId: string) {
  return db.openingSession.findUnique({ where: { companyId }, include: sessionInclude });
}

type SessionRow = NonNullable<Awaited<ReturnType<typeof findSession>>>;

type Flags = { locked: boolean; cutoffEditable: boolean };

/** Every table whose rows are daily records; once one exists for the company the cutoff is fixed. */
async function hasDailyRecords(db: Db, companyId: string): Promise<boolean> {
  const where = { where: { companyId }, select: { id: true } } as const;
  const found = await Promise.all([
    db.stockEntry.findFirst(where),
    db.dsrDay.findFirst(where),
    db.moneyEntry.findFirst(where),
    db.damageCase.findFirst(where),
    db.damageEvent.findFirst(where),
    db.payrollRun.findFirst(where),
    db.fieldVisit.findFirst(where),
  ]);
  return found.some((row) => row !== null);
}

async function flagsOf(db: Db, companyId: string): Promise<Flags> {
  const [locked, used] = await Promise.all([
    isLocked(db, companyId),
    hasDailyRecords(db, companyId),
  ]);
  return { locked, cutoffEditable: !locked && !used };
}

function toView(
  companyId: string,
  session: SessionRow | null,
  catalog: Catalog,
  flags: Flags,
): Opening {
  const lines = new Map(session?.stock.map((l) => [l.productId, l]) ?? []);
  const stock: OpeningStockLine[] = catalog.products
    .filter((p) => p.status === "active" || lines.has(p.id))
    .map((p) => {
      const line = lines.get(p.id);
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
      };
    });
  const balances: OpeningBalanceLine[] = (session?.balances ?? [])
    .map((b) => ({
      kind: b.kind as OpeningBalanceKind,
      staffId: b.staffId,
      cashAccountId: b.cashAccountId,
      shopId: b.shopId,
      amount: b.amount === null ? null : b.amount.toFixed(2),
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
    stock,
    balances: balances.map((b) => ({
      ...b,
      personRoleKind: b.staffId ? (roleOf.get(b.staffId) ?? null) : null,
    })),
  });
  return openingSchema.parse({
    companyId,
    version: session?.version ?? 0,
    cutoffDate,
    stock,
    balances,
    issues,
    totals,
    sections: summarizeSections(
      { stock, balances, totals },
      {
        dsrIds: catalog.staff.filter((m) => m.roleKind === "dsr").map((m) => m.id),
        staffIds: catalog.staff.map((m) => m.id),
        shopIds: catalog.shops.filter((x) => x.active).map((x) => x.id),
        cashAccountIds: catalog.cashAccounts.map((a) => a.id),
      },
    ),
    ...flags,
  });
}

export async function openingView(db: Db, access: CompanyAccess): Promise<Opening> {
  const session = await findSession(db, access.company.id);
  const cutoff = session?.cutoffDate ? fromDbDate(session.cutoffDate) : null;
  const [catalog, flags] = await Promise.all([
    loadCatalog(db, access, cutoff),
    flagsOf(db, access.company.id),
  ]);
  return toView(access.company.id, session, catalog, flags);
}

export async function getOpening(ctx: AppContext, companyId: string): Promise<Opening> {
  const access = await requirePermission(ctx, companyId, "opening.prepare");
  return openingView(ctx.db, access);
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
 * both win. The company row is share-locked first, so a month close waits for the save (and the
 * lock check below cannot go stale).
 */
async function claimVersion(
  tx: Tx,
  companyId: string,
  session: { id: string },
  version: number,
  data: Prisma.OpeningSessionUpdateManyMutationInput = {},
) {
  if (await isLocked(tx, companyId)) throw invalid("", "validation.opening.locked");
  const claimed = await tx.openingSession.updateMany({
    where: { id: session.id, version },
    data: { ...data, version: { increment: 1 } },
  });
  if (claimed.count !== 1) throw invalid("version", "validation.opening.stale");
}

const lockCompany = (tx: Tx, companyId: string) =>
  tx.$queryRaw`SELECT id FROM company WHERE id = ${companyId} FOR SHARE`;

function checkParty(effect: OpeningKindEffect, line: PartyRef): string | null {
  if (effect.party === "shop") {
    return !line.shopId || line.staffId || line.cashAccountId
      ? "validation.opening.shopRequired"
      : null;
  }
  if (line.shopId) return "validation.opening.noParty";
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

function validateRefs(
  catalog: Catalog,
  stock: { productId: string }[],
  balances: OpeningBalanceLine[],
): void {
  const errors: FieldError[] = [];
  const productIds = new Set(catalog.products.map((p) => p.id));
  const staffIds = new Set(catalog.staff.map((s) => s.id));
  const accountIds = new Set(catalog.cashAccounts.map((a) => a.id));
  const shopIds = new Set(catalog.shops.map((s) => s.id));
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
    if (line.shopId && !shopIds.has(line.shopId)) {
      errors.push({ path: `balances.${i}.shopId`, code: "validation.shop.unknown" });
    }
    const key = lineKey(line);
    if (seen.has(key))
      errors.push({ path: `balances.${i}.kind`, code: "validation.opening.duplicate" });
    seen.add(key);
  });
  if (errors.length) throw new AppError("VALIDATION_FAILED", errors);
}

/** Replaces only the section's own kinds; other sections' lines are never touched. */
async function replaceBalances(
  tx: Tx,
  session: { id: string },
  kinds: readonly OpeningBalanceKind[],
  balances: OpeningBalanceLine[],
) {
  await tx.openingBalanceLine.deleteMany({
    where: { sessionId: session.id, kind: { in: [...kinds] } },
  });
  if (!balances.length) return;
  await tx.openingBalanceLine.createMany({
    data: balances.map((b) => ({
      sessionId: session.id,
      kind: b.kind,
      staffId: b.staffId,
      cashAccountId: b.cashAccountId,
      shopId: b.shopId,
      partyKey: partyKey(b),
      amount: b.amount,
      note: b.note,
    })),
  });
}

/**
 * The opening's prices become the catalog prices from the go-live date (D43), so they are
 * rewritten whenever the stock lines or the cutoff change: the rows the opening wrote before
 * (`source = 'opening'`) go, and one row per entered cost/sale/order price takes their place.
 */
async function writeOpeningPrices(
  tx: Tx,
  companyId: string,
  sessionId: string,
  cutoffDate: string | null,
): Promise<number> {
  await tx.priceChange.deleteMany({ where: { source: "opening", product: { companyId } } });
  if (!cutoffDate) return 0;
  const effectiveFrom = toDbDate(cutoffDate);
  const lines = await tx.openingStockLine.findMany({ where: { sessionId } });
  let written = 0;
  for (const line of lines) {
    for (const [kind, price] of [
      ["cost", line.unitCost],
      ["sale", line.salePrice],
      ["order", line.orderPrice],
    ] as const) {
      if (price === null) continue;
      const key = {
        productId_kind_effectiveFrom: { productId: line.productId, kind, effectiveFrom },
      };
      // The owner's opening price replaces the starter sample price of the same product and kind
      // (D51), whatever its date, so a sample price never overrides it later.
      await tx.priceChange.deleteMany({
        where: { productId: line.productId, kind, source: "starter" },
      });
      // A daily/manual price on the go-live date always wins over the opening price.
      const existing = await tx.priceChange.findUnique({ where: key });
      if (existing?.source === "manual") continue;
      await tx.priceChange.upsert({
        where: key,
        create: { productId: line.productId, kind, price, effectiveFrom, source: "opening" },
        update: { price, source: "opening" },
      });
      written++;
    }
  }
  return written;
}

export type SeededOpening = {
  cutoffDate: string;
  stock: Omit<OpeningStockLine, "sku" | "productName" | "piecesPerCarton">[];
  balances: (OpeningBalanceLine & { personRoleKind: "dsr" | "sr" | "general" | null })[];
};

/**
 * A complete opening written while a company is created (D59, starter dataset). It runs in the
 * creating transaction, so there is no version to claim; the caller only names cash accounts no
 * other company has opened. Anything `checkOpening` calls a mistake is a bug in the seed and throws.
 */
export async function writeSeededOpening(
  tx: Tx,
  company: { id: string; tenantId: string },
  opening: SeededOpening,
): Promise<{ sessionId: string; pricesSet: number }> {
  const { issues } = checkOpening(opening);
  const mistakes = issues.filter((i) => i.severity === "error");
  if (mistakes.length) {
    throw new Error(`seeded opening is invalid: ${mistakes.map((i) => i.code).join(", ")}`);
  }
  const session = await tx.openingSession.create({
    data: {
      tenantId: company.tenantId,
      companyId: company.id,
      cutoffDate: toDbDate(opening.cutoffDate),
      version: 1,
    },
  });
  if (opening.stock.length) {
    await tx.openingStockLine.createMany({
      data: opening.stock.map((line) => ({ sessionId: session.id, ...line })),
    });
  }
  await replaceBalances(tx, session, openingBalanceKinds, opening.balances);
  const pricesSet = await writeOpeningPrices(tx, company.id, session.id, opening.cutoffDate);
  return { sessionId: session.id, pricesSet };
}
/** Saves the go-live date. It cannot change once a daily record exists (D43). */
export async function saveOpeningCutoff(
  ctx: AppContext,
  companyId: string,
  input: unknown,
  requestKey?: string,
): Promise<Opening> {
  const access = await requirePermission(ctx, companyId, "opening.prepare", { write: true });
  const data = parseInput(openingCutoffRequestSchema, input);
  return runIdempotent(
    ctx,
    { scope: companyId, action: "opening.cutoff", requestKey },
    data,
    async (tx) => {
      await lockCompany(tx, companyId);
      const session = await ensureSession(tx, access);
      const before = session.cutoffDate ? fromDbDate(session.cutoffDate) : null;
      await claimVersion(tx, companyId, session, data.version, {
        cutoffDate: toDbDate(data.cutoffDate),
      });
      if (before !== data.cutoffDate && (await hasDailyRecords(tx, companyId))) {
        throw invalid("cutoffDate", "validation.opening.cutoffInUse");
      }
      const prices = await writeOpeningPrices(tx, companyId, session.id, data.cutoffDate);
      await recordAudit(tx, ctx, {
        companyId,
        action: "opening.cutoff",
        resourceType: "opening",
        resourceId: session.id,
        before: { cutoffDate: before },
        after: { cutoffDate: data.cutoffDate, pricesSet: prices },
      });
      return openingView(tx, access);
    },
  );
}

/** Real mistakes in the stock lines; a blank count only warns and never blocks (D43). */
function stockMistakes(
  cutoffDate: string | null,
  stock: Extract<OpeningSectionSaveRequest, { section: "stock" }>["stock"],
): FieldError[] {
  const { issues } = checkOpening({ cutoffDate, stock, balances: [] });
  return issues
    .filter((i) => i.severity === "error" && i.productId)
    .map((i) => ({
      path: `stock.${stock.findIndex((l) => l.productId === i.productId)}.pieces`,
      code: i.code,
    }));
}

function balanceMistakes(catalog: Catalog, balances: OpeningBalanceLine[]): FieldError[] {
  const roleOf = new Map(catalog.staff.map((m) => [m.id, m.roleKind]));
  const { issues } = checkOpening({
    cutoffDate: null,
    stock: [],
    balances: balances.map((b) => ({
      ...b,
      personRoleKind: b.staffId ? (roleOf.get(b.staffId) ?? null) : null,
    })),
  });
  return issues
    .filter((i) => i.severity === "error" && i.kind)
    .map((i) => ({
      path: `balances.${balances.findIndex(
        (b) =>
          b.kind === i.kind &&
          b.staffId === (i.staffId ?? null) &&
          b.cashAccountId === (i.cashAccountId ?? null) &&
          b.shopId === (i.shopId ?? null),
      )}.kind`,
      code: i.code,
    }));
}

/**
 * Cash and bank balances belong to the whole distributor, so an account can be opened by one
 * company only. Row locks serialise two companies saving the same account at once.
 */
async function requireCashFree(
  tx: Tx,
  access: CompanyAccess,
  balances: OpeningBalanceLine[],
): Promise<void> {
  const cashIds = balances
    .filter((b) => b.kind === "cash" && b.cashAccountId && b.amount !== null)
    .map((b) => b.cashAccountId as string);
  if (!cashIds.length) return;
  await tx.$queryRaw`SELECT id FROM cash_account WHERE id = ANY(${cashIds}::text[]) FOR UPDATE`;
  const elsewhere = await tx.openingBalanceLine.count({
    where: {
      kind: "cash",
      cashAccountId: { in: cashIds },
      amount: { not: null },
      session: { tenantId: access.company.tenantId, companyId: { not: access.company.id } },
    },
  });
  if (elsewhere) throw invalid("balances", "validation.opening.cashElsewhere");
}

/**
 * Saves one section and takes effect at once (D43): the stock lines, or the balance lines of one
 * section's kinds. Nothing outside the section changes. Blanks are fine; real mistakes refuse it.
 */
export async function saveOpeningSection(
  ctx: AppContext,
  companyId: string,
  input: unknown,
  requestKey?: string,
): Promise<Opening> {
  const access = await requirePermission(ctx, companyId, "opening.prepare", { write: true });
  const data = parseInput(openingSectionSaveRequestSchema, input);
  return runIdempotent(
    ctx,
    { scope: companyId, action: "opening.section", requestKey },
    data,
    async (tx) => {
      await lockCompany(tx, companyId);
      const session = await ensureSession(tx, access);
      await claimVersion(tx, companyId, session, data.version);
      const cutoffDate = session.cutoffDate ? fromDbDate(session.cutoffDate) : null;
      const catalog = await loadCatalog(tx, access, cutoffDate);
      let prices: number | undefined;
      if (data.section === "stock") {
        validateRefs(catalog, data.stock, []);
        const mistakes = stockMistakes(cutoffDate, data.stock);
        if (mistakes.length) throw new AppError("VALIDATION_FAILED", mistakes);
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
        prices = await writeOpeningPrices(tx, companyId, session.id, cutoffDate);
      } else {
        validateRefs(catalog, [], data.balances);
        const mistakes = balanceMistakes(catalog, data.balances);
        if (mistakes.length) throw new AppError("VALIDATION_FAILED", mistakes);
        if (data.section === "cash") await requireCashFree(tx, access, data.balances);
        await replaceBalances(tx, session, openingSectionKinds[data.section], data.balances);
      }
      await recordAudit(tx, ctx, {
        companyId,
        action: "opening.section",
        resourceType: "opening",
        resourceId: session.id,
        after: { ...data, ...(prices === undefined ? {} : { pricesSet: prices }) },
      });
      return openingView(tx, access);
    },
  );
}
