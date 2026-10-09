import {
  openingBalanceKinds,
  openingSaveRequestSchema,
  openingSchema,
  openingTransitionRequestSchema,
  type Opening,
  type OpeningBalanceKind,
  type OpeningBalanceLine,
  type OpeningStockLine,
} from "@bsd/contracts";
import type { Prisma } from "@bsd/database";
import { OPENING_KIND_EFFECTS, checkOpening, type OpeningKindEffect } from "@bsd/domain";
import { requirePermission, type CompanyAccess } from "./access";
import { recordAudit } from "./audit";
import type { AppContext, Tx } from "./context";
import { fromDbDate, toDbDate, todayInDhaka } from "./dates";
import { AppError, parseInput, type FieldError } from "./errors";
import { runIdempotent } from "./idempotency";
import { plain } from "./numeric";
import { packOn } from "./products";

type Db = AppContext["db"] | Tx;

const invalid = (path: string, code: string) => new AppError("VALIDATION_FAILED", [{ path, code }]);

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
  shops: { id: string }[];
};

async function loadCatalog(
  db: Db,
  access: CompanyAccess,
  cutoffDate: string | null,
): Promise<Catalog> {
  const companyId = access.company.id;
  const onDate = cutoffDate ?? todayInDhaka();
  const [products, staff, cashAccounts, shops] = await Promise.all([
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
    db.shop.findMany({ where: { companyId }, select: { id: true } }),
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
    shops,
  };
}

const sessionInclude = { stock: true, balances: true } as const;

async function findSession(db: Db, companyId: string) {
  return db.openingSession.findUnique({ where: { companyId }, include: sessionInclude });
}

type SessionRow = NonNullable<Awaited<ReturnType<typeof findSession>>>;

function toView(companyId: string, session: SessionRow | null, catalog: Catalog): Opening {
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
    status: session?.status ?? "draft",
    version: session?.version ?? 0,
    cutoffDate,
    stock,
    balances,
    issues,
    totals,
    approvedAt: session?.approvedAt?.toISOString() ?? null,
    activatedAt: session?.activatedAt?.toISOString() ?? null,
  });
}

export async function openingView(db: Db, access: CompanyAccess): Promise<Opening> {
  const session = await findSession(db, access.company.id);
  const cutoff = session?.cutoffDate ? fromDbDate(session.cutoffDate) : null;
  return toView(access.company.id, session, await loadCatalog(db, access, cutoff));
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

async function replaceBalances(tx: Tx, session: SessionRow, balances: OpeningBalanceLine[]) {
  await tx.openingBalanceLine.deleteMany({ where: { sessionId: session.id } });
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

/** Full replace of the editable values; a section whose values change loses its confirmation. */
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
      return openingView(tx, access);
    },
  );
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
      const view = await openingView(tx, access);
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
      return openingView(tx, access);
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
      const view = await openingView(tx, access);
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
      return openingView(tx, access);
    },
  );
}
