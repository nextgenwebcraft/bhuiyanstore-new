import {
  businessDateSchema,
  damageCaseCreateRequestSchema,
  damageCaseSchema,
  damageEventRequestSchema,
  damageUnitCostKinds,
  type DamageCase,
  type PermissionId,
} from "@bsd/contracts";
import type { Prisma } from "@bsd/database";
import {
  companyReturnKinds,
  damageCaseSettled,
  damageEventError,
  damageLineProgress,
  toDecimal,
  type DamageEventKind,
  type DamageOrigin,
} from "@bsd/domain";
import { z } from "zod";
import { loadCompanyAccess, requirePermission, type CompanyAccess } from "./access";
import { recordAudit } from "./audit";
import type { AppContext, Tx } from "./context";
import { invalid, postingGuard, requireAll, roleOn } from "./daily";
import { fromDbDate, toDbDate } from "./dates";
import { AppError, parseInput } from "./errors";
import { runIdempotent } from "./idempotency";
import { plain } from "./numeric";
import { packOn } from "./products";
import { ensureStockCovers } from "./stock-guard";

/**
 * Damage cases (D17, guide §9.7): damaged pieces received with independent buyer and company
 * legs. Quantities only; the over-allocation rules live in `@bsd/domain`. A buyer replacement
 * from godown stock, an accepted company replacement and a company money return (D33) reach the
 * month engine through the ledger; the other legs move damaged custody only.
 */

type Db = AppContext["db"] | Tx;

const caseInclude = {
  staff: { select: { name: true } },
  lines: {
    include: { product: { include: { packs: true } } },
    orderBy: { product: { sku: "asc" } },
  },
  events: {
    include: { line: { include: { product: { select: { name: true } } } } },
    orderBy: { createdAt: "asc" },
  },
} as const;
type CaseRow = Prisma.DamageCaseGetPayload<{ include: typeof caseInclude }>;

/** Who posts (and reverses) each leg (guide §12.2). */
const EVENT_PERMISSIONS: Record<DamageEventKind, [PermissionId, ...PermissionId[]]> = {
  buyerReplacement: ["damage.report"],
  companyDispatch: ["damage.claim_settle"],
  companyAccept: ["damage.claim_settle"],
  companyReject: ["damage.claim_settle"],
  companyReplacement: ["damage.claim_settle", "inventory.cost_view"],
  writeOff: ["damage.approve"],
  companyRefund: ["damage.claim_settle", "inventory.cost_view"],
};

const isReturn = (kind: DamageEventKind) =>
  (companyReturnKinds as readonly DamageEventKind[]).includes(kind);

async function writeAccess(ctx: AppContext, companyId: string, kind: DamageEventKind) {
  const [first, ...rest] = EVENT_PERMISSIONS[kind];
  const access = await requirePermission(ctx, companyId, first, { write: true });
  requireAll(access, rest);
  return access;
}

const VIEW_PERMISSIONS: readonly PermissionId[] = [
  "damage.report",
  "damage.claim_settle",
  "damage.approve",
];

function canView(access: CompanyAccess): boolean {
  return VIEW_PERMISSIONS.some((p) => access.permissions.includes(p));
}

function toCase(row: CaseRow, access: CompanyAccess): DamageCase {
  const origin = row.origin as DamageOrigin;
  const canSeeCost = access.permissions.includes("inventory.cost_view");
  const posted = row.events.filter((e) => e.status === "posted");
  const lines = row.lines.map((l) => ({
    id: l.id,
    productId: l.productId,
    sku: l.product.sku,
    productName: l.product.name,
    piecesPerCarton: String(packOn(l.product.packs, fromDbDate(row.date))?.piecesPerCarton ?? 1),
    quantity: plain(l.quantity),
    progress: damageLineProgress(
      origin,
      plain(l.quantity),
      posted
        .filter((e) => e.lineId === l.id)
        .map((e) => ({ kind: e.kind as DamageEventKind, quantity: plain(e.quantity) })),
    ),
  }));
  const status =
    row.status === "cancelled"
      ? "cancelled"
      : damageCaseSettled(lines.map((l) => l.progress))
        ? "settled"
        : "open";
  return damageCaseSchema.parse({
    id: row.id,
    caseNumber: row.caseNumber,
    date: fromDbDate(row.date),
    origin,
    staffId: row.staffId,
    staffName: row.staff?.name ?? null,
    status,
    note: row.note,
    lines,
    events: [...row.events]
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .map((e) => ({
        id: e.id,
        lineId: e.lineId,
        productName: e.line.product.name,
        date: fromDbDate(e.date),
        kind: e.kind,
        quantity: plain(e.quantity),
        fromStock: e.fromStock,
        unitCost: canSeeCost ? plain(e.unitCost) : null,
        reference: e.reference,
        note: e.note,
        status: e.status,
        createdAt: e.createdAt.toISOString(),
        reversedAt: e.reversedAt?.toISOString() ?? null,
      })),
    createdAt: row.createdAt.toISOString(),
  });
}

async function loadCase(db: Db, companyId: string, caseId: string): Promise<CaseRow> {
  const row = await db.damageCase.findFirst({
    where: { id: caseId, companyId },
    include: caseInclude,
  });
  if (!row) throw invalid("", "validation.daily.notFound");
  return row;
}

const listQuerySchema = z.object({
  from: businessDateSchema.optional(),
  to: businessDateSchema.optional(),
});

/** Cases newest first; `open` hides settled and cancelled ones; `from`/`to` bound the case date. */
export async function listDamageCases(
  ctx: AppContext,
  companyId: string,
  query: { status?: unknown; from?: unknown; to?: unknown },
): Promise<DamageCase[]> {
  const access = await loadCompanyAccess(ctx, companyId);
  if (!canView(access)) throw new AppError("FORBIDDEN");
  const { from, to } = parseInput(listQuerySchema, {
    from: query.from || undefined,
    to: query.to || undefined,
  });
  const rows = await ctx.db.damageCase.findMany({
    where: {
      companyId,
      ...(from || to
        ? {
            date: {
              ...(from ? { gte: toDbDate(from) } : {}),
              ...(to ? { lte: toDbDate(to) } : {}),
            },
          }
        : {}),
    },
    include: caseInclude,
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 500,
  });
  const cases = rows.map((r) => toCase(r, access));
  return query.status === "open" ? cases.filter((c) => c.status === "open") : cases;
}

export async function getDamageCase(
  ctx: AppContext,
  companyId: string,
  caseId: string,
): Promise<DamageCase> {
  const access = await loadCompanyAccess(ctx, companyId);
  if (!canView(access)) throw new AppError("FORBIDDEN");
  return toCase(await loadCase(ctx.db, companyId, caseId), access);
}

/** The next free `D-YYYYMMDD-n` number for the date. */
async function nextCaseNumber(db: Db, companyId: string, date: string): Promise<string> {
  const prefix = `D-${date.replaceAll("-", "")}-`;
  const taken = new Set(
    (
      await db.damageCase.findMany({
        where: { companyId, caseNumber: { startsWith: prefix } },
        select: { caseNumber: true },
      })
    ).map((c) => c.caseNumber),
  );
  let n = taken.size + 1;
  while (taken.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}

/**
 * Records damaged pieces received; no stock moves until a leg is posted. With `sentToCompany`
 * the pieces were handed to the company the same day, so each line's dispatch is posted too.
 */
export async function createDamageCase(
  ctx: AppContext,
  companyId: string,
  input: unknown,
  requestKey?: string,
): Promise<DamageCase> {
  const request = parseInput(damageCaseCreateRequestSchema, input);
  const access = await requirePermission(ctx, companyId, "damage.report", { write: true });
  if (request.sentToCompany) requireAll(access, EVENT_PERMISSIONS.companyDispatch);
  const products = new Set<string>();
  request.lines.forEach((l, index) => {
    if (products.has(l.productId))
      throw invalid(`lines.${index}`, "validation.daily.duplicateProduct");
    products.add(l.productId);
  });

  return runIdempotent(
    ctx,
    { scope: companyId, action: "damage.case", requestKey },
    request,
    async (tx) => {
      await postingGuard(tx, companyId, request.date);
      const known = await tx.product.count({ where: { companyId, id: { in: [...products] } } });
      if (known !== products.size) throw invalid("lines", "validation.daily.unknownProduct");
      if (request.staffId) {
        const role = await roleOn(tx, companyId, request.staffId, request.date);
        if (role !== "dsr") throw invalid("staffId", "validation.daily.dsrOnly");
      }
      const caseNumber = request.caseNumber || (await nextCaseNumber(tx, companyId, request.date));
      const exists = await tx.damageCase.findUnique({
        where: { companyId_caseNumber: { companyId, caseNumber } },
        select: { id: true },
      });
      if (exists) throw invalid("caseNumber", "validation.damage.duplicateCase");
      const row = await tx.damageCase.create({
        data: {
          tenantId: access.company.tenantId,
          companyId,
          caseNumber,
          date: toDbDate(request.date),
          origin: request.origin,
          staffId: request.staffId,
          note: request.note,
          createdById: ctx.actor.userId,
          lines: {
            create: request.lines.map((l) => ({ productId: l.productId, quantity: l.quantity })),
          },
        },
        include: { lines: true },
      });
      if (request.sentToCompany) {
        await tx.damageEvent.createMany({
          data: row.lines.map((line) => ({
            tenantId: access.company.tenantId,
            companyId,
            caseId: row.id,
            lineId: line.id,
            date: toDbDate(request.date),
            kind: "companyDispatch",
            quantity: line.quantity,
            createdById: ctx.actor.userId,
          })),
        });
      }
      await recordAudit(tx, ctx, {
        companyId,
        action: "damage.case",
        resourceType: "damage_case",
        resourceId: row.id,
        after: request,
      });
      return toCase(await loadCase(tx, companyId, row.id), access);
    },
  );
}

/** Posts one leg on a case line, refusing over-dispatch, over-replacement and duplicates. */
export async function postDamageEvent(
  ctx: AppContext,
  companyId: string,
  caseId: string,
  input: unknown,
  requestKey?: string,
): Promise<DamageCase> {
  const request = parseInput(damageEventRequestSchema, input);
  const access = await writeAccess(ctx, companyId, request.kind);
  if (request.fromStock && request.kind !== "buyerReplacement") {
    throw invalid("fromStock", "validation.damage.fromStockBuyerOnly");
  }
  const needsCost = damageUnitCostKinds.includes(request.kind);
  if (needsCost !== (request.unitCost !== null)) {
    throw invalid(
      "unitCost",
      needsCost ? "validation.damage.unitCostRequired" : "validation.damage.noUnitCost",
    );
  }
  if (request.autoAccept) {
    if (!isReturn(request.kind)) throw invalid("autoAccept", "validation.damage.autoAcceptReturn");
    requireAll(access, EVENT_PERMISSIONS.companyAccept);
  }

  return runIdempotent(
    ctx,
    { scope: companyId, action: "damage.event", requestKey },
    { caseId, ...request },
    async (tx) => {
      await postingGuard(tx, companyId, request.date);
      await tx.$queryRaw`SELECT id FROM damage_case WHERE id = ${caseId} AND company_id = ${companyId} FOR UPDATE`;
      const row = await loadCase(tx, companyId, caseId);
      if (row.status === "cancelled") throw invalid("", "validation.damage.cancelled");
      if (request.date < fromDbDate(row.date))
        throw invalid("date", "validation.damage.beforeCase");
      const line = row.lines.find((l) => l.id === request.lineId);
      if (!line) throw invalid("lineId", "validation.daily.notFound");
      const origin = row.origin as DamageOrigin;
      const legs = row.events
        .filter((e) => e.status === "posted" && e.lineId === line.id)
        .map((e) => ({ kind: e.kind as DamageEventKind, quantity: plain(e.quantity) }));
      let progress = damageLineProgress(origin, plain(line.quantity), legs);
      if (request.autoAccept) {
        const pending = toDecimal(progress.companyPending);
        const missing = toDecimal(request.quantity).sub(pending);
        if (missing.gt(0)) {
          const accept = missing.toString();
          const acceptError = damageEventError(origin, progress, "companyAccept", accept);
          if (acceptError) throw invalid("quantity", `validation.damage.${acceptError}`);
          await tx.damageEvent.create({
            data: {
              tenantId: access.company.tenantId,
              companyId,
              caseId,
              lineId: line.id,
              date: toDbDate(request.date),
              kind: "companyAccept",
              quantity: accept,
              createdById: ctx.actor.userId,
            },
          });
          progress = damageLineProgress(origin, plain(line.quantity), [
            ...legs,
            { kind: "companyAccept", quantity: accept },
          ]);
        }
      }
      const error = damageEventError(origin, progress, request.kind, request.quantity);
      if (error) throw invalid("quantity", `validation.damage.${error}`);
      const event = await tx.damageEvent.create({
        data: {
          tenantId: access.company.tenantId,
          companyId,
          caseId,
          lineId: line.id,
          date: toDbDate(request.date),
          kind: request.kind,
          quantity: request.quantity,
          fromStock: request.fromStock,
          unitCost: request.unitCost,
          reference: request.reference,
          note: request.note,
          createdById: ctx.actor.userId,
        },
      });
      if (request.kind === "buyerReplacement") {
        await ensureStockCovers(tx, access, request.date, [line.productId]);
      }
      await recordAudit(tx, ctx, {
        companyId,
        action: "damage.event",
        resourceType: "damage_event",
        resourceId: event.id,
        after: { caseId, ...request },
      });
      return toCase(await loadCase(tx, companyId, caseId), access);
    },
  );
}

/**
 * Reverses one leg. A later leg that depends on it (e.g. acceptance after a dispatch) must be
 * reversed first, so pending quantities never go negative.
 */
export async function reverseDamageEvent(
  ctx: AppContext,
  companyId: string,
  eventId: string,
  requestKey?: string,
): Promise<DamageCase> {
  await loadCompanyAccess(ctx, companyId);
  const event = await ctx.db.damageEvent.findFirst({ where: { id: eventId, companyId } });
  if (!event) throw invalid("", "validation.daily.notFound");
  const access = await writeAccess(ctx, companyId, event.kind as DamageEventKind);

  return runIdempotent(
    ctx,
    { scope: companyId, action: "damage.reverse", requestKey },
    { eventId },
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM damage_case WHERE id = ${event.caseId} FOR UPDATE`;
      const row = await loadCase(tx, companyId, event.caseId);
      const live = row.events.find((e) => e.id === eventId);
      if (!live || live.status !== "posted") throw invalid("", "validation.daily.alreadyReversed");
      await postingGuard(tx, companyId, fromDbDate(live.date));
      const remaining = row.events
        .filter((e) => e.status === "posted" && e.lineId === live.lineId && e.id !== eventId)
        .map((e) => ({ kind: e.kind as DamageEventKind, quantity: plain(e.quantity) }));
      const line = row.lines.find((l) => l.id === live.lineId);
      const progress = damageLineProgress(
        row.origin as DamageOrigin,
        plain(line?.quantity ?? live.quantity),
        remaining,
      );
      const negative = Object.values(progress).some((v) => v.startsWith("-"));
      if (negative) throw invalid("", "validation.damage.reverseLaterFirst");
      const updated = await tx.damageEvent.updateMany({
        where: { id: eventId, status: "posted" },
        data: { status: "reversed", reversedAt: new Date(), reversedById: ctx.actor.userId },
      });
      if (updated.count !== 1) throw invalid("", "validation.daily.alreadyReversed");
      if (live.kind === "companyReplacement" && line) {
        await ensureStockCovers(tx, access, fromDbDate(live.date), [line.productId]);
      }
      await recordAudit(tx, ctx, {
        companyId,
        action: "damage.reverse",
        resourceType: "damage_event",
        resourceId: eventId,
        before: { status: "posted" },
        after: { status: "reversed" },
      });
      return toCase(await loadCase(tx, companyId, event.caseId), access);
    },
  );
}

/** Cancels a case entered by mistake; only while no leg is posted. */
export async function cancelDamageCase(
  ctx: AppContext,
  companyId: string,
  caseId: string,
  requestKey?: string,
): Promise<DamageCase> {
  const access = await requirePermission(ctx, companyId, "damage.report", { write: true });
  return runIdempotent(
    ctx,
    { scope: companyId, action: "damage.cancel", requestKey },
    { caseId },
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM damage_case WHERE id = ${caseId} AND company_id = ${companyId} FOR UPDATE`;
      const row = await loadCase(tx, companyId, caseId);
      if (row.status === "cancelled") throw invalid("", "validation.damage.cancelled");
      if (row.events.some((e) => e.status === "posted")) {
        throw invalid("", "validation.damage.hasEvents");
      }
      await tx.damageCase.update({ where: { id: caseId }, data: { status: "cancelled" } });
      await recordAudit(tx, ctx, {
        companyId,
        action: "damage.cancel",
        resourceType: "damage_case",
        resourceId: caseId,
        before: { status: "open" },
        after: { status: "cancelled" },
      });
      return toCase(await loadCase(tx, companyId, caseId), access);
    },
  );
}
