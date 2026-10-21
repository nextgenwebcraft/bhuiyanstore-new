import {
  dashboardSummarySchema,
  dayViewSchema,
  documentTransitionRequestSchema,
  dsrDaySaveRequestSchema,
  dsrDaySchema,
  moneyAccountKinds,
  moneyAllocationKinds,
  moneyCategoryKinds,
  moneyEntryPostRequestSchema,
  moneyEntrySchema,
  moneyKindPermission,
  moneyKindPerson,
  srLoanTypeKinds,
  stockEntryPostRequestSchema,
  stockEntrySchema,
  type DashboardSummary,
  type DayView,
  type DsrDay,
  type MoneyEntry,
  type MoneyEntryKind,
  type PermissionId,
  type ProductLot,
  type StockEntry,
  type StockEntryKind,
} from "@bsd/contracts";
import type { Prisma } from "@bsd/database";
import { randomUUID } from "node:crypto";
import {
  MONEY_KIND_EFFECTS,
  monthOf,
  sumAmounts,
  sumQuantities,
  summarizeDay,
  dashboardChain,
  pieceFromCarton,
  toDecimal,
  todayBusinessDate,
  type MonthOutput,
} from "@bsd/domain";
import {
  loadCompanyAccess,
  requirePermission,
  requireWriteReady,
  type CompanyAccess,
} from "./access";
import { recordAudit } from "./audit";
import type { AppContext, Tx } from "./context";
import { fromDbDate, toDbDate } from "./dates";
import { AppError, invalid, parseInput } from "./errors";
import { hasFieldVisits, postFieldVisits, reverseFieldVisits } from "./field-posting";
import { isUniqueViolation, runIdempotent } from "./idempotency";
import { cashDefaults, liveOpening, allocationOf, namesFor, rangeRun, runLedger } from "./ledger";
import { staffCompanyIds } from "./master";
import { staffRun } from "./staff-ledger";
import { parseReportRange } from "./report-range";
import { plain } from "./numeric";
import { insertShop } from "./shop-rows";
import { packOn } from "./products";

const isZero = (amount: string) => toDecimal(amount).isZero();
import { ensureStockCovers } from "./stock-guard";
import {
  batchOf,
  dsrLineBatch,
  ensureBatchDue,
  ensureOrderReversible,
  orderBatch,
  productLots,
  useBatchPrices,
} from "./batches";

/**
 * Daily entry (PLAN §9 Phase E): posted raw facts only. Every figure shown back comes from the
 * month engine via `runLedger`. Posted rows never change; a correction reverses and re-enters.
 */

type Db = AppContext["db"] | Tx;

const iso = (value: Date | null) => (value ? value.toISOString() : null);
export const businessDate = (value: unknown, path = "date") => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw invalid(path, "validation.date.invalid");
  }
  return value;
};

export function requireAll(access: CompanyAccess, permissions: Iterable<PermissionId>): void {
  for (const permission of permissions) {
    if (!access.permissions.includes(permission)) throw new AppError("FORBIDDEN");
  }
}

/**
 * Posting needs a live opening (a saved cutoff date, D43), a date from the cutoff to today and an open month. The shared
 * company lock makes a concurrent month close wait for in-flight postings.
 */
export async function postingGuard(tx: Tx, companyId: string, date: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM company WHERE id = ${companyId} FOR SHARE`;
  const session = await tx.openingSession.findUnique({
    where: { companyId },
    select: { cutoffDate: true },
  });
  if (!session?.cutoffDate) {
    throw invalid("date", "validation.daily.noOpening");
  }
  if (date < fromDbDate(session.cutoffDate)) throw invalid("date", "validation.daily.beforeCutoff");
  if (date > todayBusinessDate()) throw invalid("date", "validation.daily.future");
  const closed = await tx.monthClose.findUnique({
    where: { companyId_month: { companyId, month: monthOf(date) } },
    select: { id: true },
  });
  if (closed) throw invalid("date", "validation.daily.monthClosed");
}

type RoleKind = "dsr" | "sr" | "general";

export async function roleOn(
  db: Db,
  companyId: string,
  staffId: string,
  date: string,
): Promise<RoleKind | null> {
  const day = toDbDate(date);
  const companyIds = await staffCompanyIds(db, companyId);
  const assignments = await db.staffAssignment.findMany({
    where: {
      companyId: { in: companyIds },
      staffId,
      from: { lte: day },
      OR: [{ to: null }, { to: { gte: day } }],
    },
    include: { role: true },
  });
  const assignment =
    assignments.find((a) => a.companyId === companyId) ?? assignments.at(0) ?? null;
  return assignment ? (assignment.role.kind as RoleKind) : null;
}

// ---------------------------------------------------------------- stock entries

const STOCK_PERMISSION: Record<StockEntryKind, PermissionId> = {
  order: "purchase.create",
  receipt: "purchase.post",
  damage: "damage.report",
  incentive: "purchase.post",
  damageDeposit: "payment.post",
};

const stockInclude = {
  product: { select: { sku: true, name: true } },
  batch: { select: { seq: true } },
} as const;
type StockRow = Prisma.StockEntryGetPayload<{ include: typeof stockInclude }>;

function toStockEntry(row: StockRow, canSeeCost: boolean): StockEntry {
  return stockEntrySchema.parse({
    id: row.id,
    date: fromDbDate(row.date),
    kind: row.kind,
    productId: row.productId,
    sku: row.product.sku,
    productName: row.product.name,
    pieces: plain(row.pieces),
    freePieces: row.freePieces === null ? null : plain(row.freePieces),
    cartonRate: row.cartonRate === null ? null : plain(row.cartonRate),
    piecesPerCarton: row.piecesPerCarton,
    unitPrice: row.unitPrice === null ? null : plain(row.unitPrice),
    fundFrom: row.fundFrom,
    orderGroup: row.orderGroup,
    batchId: row.batchId,
    batchSeq: row.batch?.seq ?? null,
    costPrice: canSeeCost && row.costPrice !== null ? plain(row.costPrice) : null,
    salePrice: row.salePrice === null ? null : plain(row.salePrice),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    reversedAt: iso(row.reversedAt),
  });
}

const seesCost = (access: CompanyAccess) => access.permissions.includes("inventory.cost_view");

async function stockEntriesOn(db: Db, access: CompanyAccess, date: string): Promise<StockEntry[]> {
  const rows = await db.stockEntry.findMany({
    where: { companyId: access.company.id, date: toDbDate(date) },
    include: stockInclude,
    orderBy: { createdAt: "asc" },
  });
  return rows.map((row) => toStockEntry(row, seesCost(access)));
}

export async function listStockEntries(
  ctx: AppContext,
  companyId: string,
  date: unknown,
): Promise<StockEntry[]> {
  const access = await requirePermission(ctx, companyId, "purchase.view");
  return stockEntriesOn(ctx.db, access, businessDate(date));
}

/** Posts a day's godown lines and price changes together (one Excel row edit). */
export async function postStockEntries(
  ctx: AppContext,
  companyId: string,
  input: unknown,
  requestKey?: string,
): Promise<StockEntry[]> {
  const access = await loadCompanyAccess(ctx, companyId);
  const request = parseInput(stockEntryPostRequestSchema, input);
  requireAll(access, [
    ...new Set(request.lines.map((l) => STOCK_PERMISSION[l.kind] as PermissionId)),
    ...(request.prices.length ? (["product.edit"] as const) : []),
  ]);
  requireWriteReady(ctx);

  const priceKeys = new Set<string>();
  request.prices.forEach((price, index) => {
    const key = `${price.productId}|${price.kind}`;
    if (priceKeys.has(key)) throw invalid(`prices.${index}`, "validation.daily.duplicatePrice");
    priceKeys.add(key);
  });

  return runIdempotent(
    ctx,
    { scope: companyId, action: "stock.post", requestKey },
    request,
    async (tx) => {
      await postingGuard(tx, companyId, request.date);
      const productIds = [
        ...new Set([...request.lines, ...request.prices].map((l) => l.productId)),
      ];
      const known = await tx.product.findMany({
        where: { companyId, id: { in: productIds } },
        include: { packs: true },
      });
      if (known.length !== productIds.length) {
        throw invalid("lines", "validation.daily.unknownProduct");
      }
      const packOf = (productId: string) =>
        packOn(known.find((p) => p.id === productId)?.packs ?? [], request.date)?.piecesPerCarton ??
        1;

      const date = toDbDate(request.date);
      // D57: an order's per-piece price (carton rate ÷ carton size) becomes the current order
      // price, so excess receipts and the order price display follow the latest order.
      const orderPrices = new Map<string, string>();
      // D63: orders posted together share a group and the balance parts named to pay them.
      const orderGroup = randomUUID();
      const owner = { tenantId: access.company.tenantId, companyId };
      // D68: a receipt brings no more into a batch than is still due on it.
      const receipts = request.lines.flatMap((line, index) =>
        line.kind === "receipt" && line.batchId
          ? [{ batchId: line.batchId, productId: line.productId, pieces: line.pieces, index }]
          : [],
      );
      await ensureBatchDue(tx, companyId, request.date, receipts);
      for (const [index, line] of request.lines.entries()) {
        const base = {
          ...owner,
          date,
          kind: line.kind,
          productId: line.productId,
          pieces: line.pieces,
          createdById: ctx.actor.userId,
        };
        if (line.kind === "receipt") {
          const batch = await batchOf(
            tx,
            companyId,
            line.productId,
            line.batchId ?? "",
            `lines.${index}.batchId`,
          );
          const prices = await useBatchPrices(tx, batch, line);
          await tx.stockEntry.create({ data: { ...base, batchId: batch.id, ...prices } });
          continue;
        }
        if (line.kind !== "order") {
          await tx.stockEntry.create({
            data: {
              ...base,
              ...(line.kind === "damageDeposit" ? { unitPrice: line.unitPrice ?? "0" } : {}),
            },
          });
          continue;
        }
        const piecesPerCarton = packOf(line.productId);
        const salePrice = line.salePrice ?? "0";
        const costPrice =
          line.cartonRate === undefined
            ? null
            : pieceFromCarton(line.cartonRate, String(piecesPerCarton));
        if (line.pieces !== "0" && costPrice !== null) orderPrices.set(line.productId, costPrice);
        // D68: unchanged prices keep the product's latest batch, changed ones start a new one;
        // the free pieces go into the same batch at its prices.
        const batch = await orderBatch(tx, owner, line.productId, { costPrice, salePrice });
        await tx.stockEntry.create({
          data: {
            ...base,
            freePieces: line.freePieces ?? "0",
            cartonRate: line.cartonRate ?? "0",
            piecesPerCarton,
            fundFrom: request.fundFrom,
            orderGroup,
            batchId: batch.id,
            costPrice: batch.costPrice,
            salePrice,
          },
        });
      }
      // D53: pieces found damaged in the godown leave saleable stock.
      const damaged = request.lines.filter((l) => l.kind === "damage").map((l) => l.productId);
      await ensureStockCovers(tx, access, request.date, damaged);
      const before: Record<string, string> = {};
      const explicit = new Set(request.prices.map((p) => `${p.productId}|${p.kind}`));
      const derived = [...orderPrices]
        .filter(([productId]) => !explicit.has(`${productId}|order`))
        .map(([productId, price]) => ({ productId, kind: "order" as const, price }));
      for (const price of [...derived, ...request.prices]) {
        const key = { productId: price.productId, kind: price.kind, effectiveFrom: date };
        const existing = await tx.priceChange.findUnique({
          where: { productId_kind_effectiveFrom: key },
        });
        if (existing) before[`${price.productId}|${price.kind}`] = plain(existing.price);
        await tx.priceChange.upsert({
          where: { productId_kind_effectiveFrom: key },
          create: { ...key, price: price.price, source: "manual" },
          update: { price: price.price, source: "manual" },
        });
      }
      await recordAudit(tx, ctx, {
        companyId,
        action: "stock.post",
        resourceType: "stock_day",
        resourceId: request.date,
        ...(Object.keys(before).length ? { before: { prices: before } } : {}),
        after: { lines: request.lines, prices: request.prices },
      });
      return stockEntriesOn(tx, access, request.date);
    },
  );
}

export async function reverseStockEntry(
  ctx: AppContext,
  companyId: string,
  entryId: string,
  requestKey?: string,
): Promise<StockEntry> {
  const access = await requirePermission(ctx, companyId, "purchase.reverse", { write: true });
  return runIdempotent(
    ctx,
    { scope: companyId, action: "stock.reverse", requestKey },
    { entryId },
    async (tx) => {
      const row = await tx.stockEntry.findFirst({ where: { id: entryId, companyId } });
      if (!row) throw invalid("", "validation.daily.notFound");
      if (row.status !== "posted") throw invalid("", "validation.daily.alreadyReversed");
      await postingGuard(tx, companyId, fromDbDate(row.date));
      const updated = await tx.stockEntry.updateMany({
        where: { id: entryId, status: "posted" },
        data: { status: "reversed", reversedAt: new Date(), reversedById: ctx.actor.userId },
      });
      if (updated.count !== 1) throw invalid("", "validation.daily.alreadyReversed");
      if (row.kind === "order") await ensureOrderReversible(tx, companyId, row);
      if (row.kind === "receipt" || row.kind === "incentive") {
        await ensureStockCovers(tx, access, fromDbDate(row.date), [row.productId]);
      }
      await recordAudit(tx, ctx, {
        companyId,
        action: "stock.reverse",
        resourceType: "stock_entry",
        resourceId: entryId,
        before: { status: "posted" },
        after: { status: "reversed" },
      });
      return toStockEntry(
        await tx.stockEntry.findUniqueOrThrow({ where: { id: entryId }, include: stockInclude }),
        seesCost(access),
      );
    },
  );
}

// ---------------------------------------------------------------- DSR day sheets

const dsrInclude = {
  staff: { select: { name: true } },
  lines: {
    include: { product: { select: { sku: true, name: true } } },
    orderBy: [{ product: { sku: "asc" } }, { batchSeq: "asc" }],
  },
} satisfies Prisma.DsrDayInclude;
type DsrRow = Prisma.DsrDayGetPayload<{ include: typeof dsrInclude }>;

function toDsrDay(row: DsrRow, canSeeCost: boolean): DsrDay {
  return dsrDaySchema.parse({
    id: row.id,
    date: fromDbDate(row.date),
    staffId: row.staffId,
    staffName: row.staff.name,
    status: row.status,
    version: row.version,
    marketDueNew: plain(row.marketDueNew),
    marketDueCollected: plain(row.marketDueCollected),
    cashHandedOver: plain(row.cashHandedOver),
    lines: row.lines.map((line) => ({
      productId: line.productId,
      sku: line.product.sku,
      productName: line.product.name,
      piecesPerCarton: String(line.piecesPerCarton),
      issued: plain(line.issued),
      returned: plain(line.returned),
      damaged: plain(line.damaged),
      commission: plain(line.commission),
      batchKey: line.batchKey,
      batchSeq: line.batchSeq,
      costPrice: canSeeCost && line.costPrice !== null ? plain(line.costPrice) : null,
      salePrice: line.salePrice === null ? null : plain(line.salePrice),
    })),
    postedAt: iso(row.postedAt),
    reversedAt: iso(row.reversedAt),
  });
}

export async function listDsrDays(
  ctx: AppContext,
  companyId: string,
  date: unknown,
): Promise<DsrDay[]> {
  const access = await requirePermission(ctx, companyId, "sale.view");
  const rows = await ctx.db.dsrDay.findMany({
    where: { companyId, date: toDbDate(businessDate(date)) },
    include: dsrInclude,
    orderBy: [{ staff: { name: "asc" } }, { createdAt: "asc" }],
  });
  return rows.map((row) => toDsrDay(row, seesCost(access)));
}

async function loadDsrDay(db: Db, companyId: string, id: string): Promise<DsrRow> {
  const row = await db.dsrDay.findFirst({ where: { id, companyId }, include: dsrInclude });
  if (!row) throw invalid("", "validation.daily.notFound");
  return row;
}

/**
 * Creates (version 0) or replaces the live draft for one DSR and date. Lines with nothing entered
 * are dropped. Every piece sells at the day's sale price, as in the workbook.
 */
export async function saveDsrDay(
  ctx: AppContext,
  companyId: string,
  input: unknown,
  requestKey?: string,
): Promise<DsrDay> {
  const access = await requirePermission(ctx, companyId, "sale.create", { write: true });
  const request = parseInput(dsrDaySaveRequestSchema, input);
  const seen = new Set<string>();
  const lines = request.lines.filter(
    (l) => l.issued !== "0" || l.returned !== "0" || l.damaged !== "0" || !isZero(l.commission),
  );
  lines.forEach((line) => {
    const index = request.lines.indexOf(line);
    // D68: one line per product and batch.
    const key = `${line.productId}|${line.batchKey}`;
    if (seen.has(key)) throw invalid(`lines.${index}`, "validation.daily.duplicateProduct");
    seen.add(key);
    const sold = toDecimal(line.issued).sub(line.returned).sub(line.damaged);
    if (!isZero(line.commission) && sold.lte(0)) {
      throw invalid(`lines.${index}.commission`, "validation.daily.commissionWithoutSale");
    }
  });

  return runIdempotent(
    ctx,
    { scope: companyId, action: "dsr_day.save", requestKey },
    request,
    async (tx) => {
      await postingGuard(tx, companyId, request.date);
      if ((await roleOn(tx, companyId, request.staffId, request.date)) !== "dsr") {
        throw invalid("staffId", "validation.daily.dsrOnly");
      }
      const productIds = [...new Set(lines.map((l) => l.productId))];
      const products = await tx.product.findMany({
        where: { companyId, id: { in: productIds } },
        include: { packs: true },
      });
      if (products.length !== productIds.length)
        throw invalid("lines", "validation.daily.unknownProduct");
      const packs = new Map(
        products.map((p) => [p.id, packOn(p.packs, request.date)?.piecesPerCarton ?? 1]),
      );

      const date = toDbDate(request.date);
      const live = await tx.dsrDay.findFirst({
        where: { companyId, staffId: request.staffId, date, status: { not: "reversed" } },
      });
      if ((live?.version ?? 0) !== request.version) {
        throw invalid("version", "validation.daily.stale");
      }
      // D56: saving a posted sheet corrects it; the posted one is reversed with all it owns and
      // the edited sheet is posted in its place, in this transaction.
      const corrected = live?.status === "posted" ? await loadDsrDay(tx, companyId, live.id) : null;
      if (corrected) {
        if (
          !access.permissions.includes("sale.post") ||
          !access.permissions.includes("sale.reverse")
        ) {
          throw new AppError("FORBIDDEN");
        }
        await moveDsrDay(tx, ctx, access, corrected, "reversed");
      }
      const data = {
        ...(request.marketDueNew === undefined ? {} : { marketDueNew: request.marketDueNew }),
        ...(request.marketDueCollected === undefined
          ? {}
          : { marketDueCollected: request.marketDueCollected }),
        ...(request.cashHandedOver === undefined ? {} : { cashHandedOver: request.cashHandedOver }),
      };
      let id: string;
      if (live && !corrected) {
        const updated = await tx.dsrDay.updateMany({
          where: { id: live.id, version: live.version, status: "draft" },
          data: { ...data, version: { increment: 1 } },
        });
        if (updated.count !== 1) throw invalid("version", "validation.daily.stale");
        await tx.dsrLine.deleteMany({ where: { dsrDayId: live.id } });
        id = live.id;
      } else {
        try {
          id = (
            await tx.dsrDay.create({
              data: {
                ...(corrected
                  ? {
                      // Above the corrected sheet's, so a screen still holding it is stale.
                      version: corrected.version + 1,
                      marketDueNew: corrected.marketDueNew,
                      marketDueCollected: corrected.marketDueCollected,
                      cashHandedOver: corrected.cashHandedOver,
                    }
                  : {}),
                ...data,
                tenantId: access.company.tenantId,
                companyId,
                staffId: request.staffId,
                date,
                createdById: ctx.actor.userId,
              },
            })
          ).id;
        } catch (error) {
          if ((error as { code?: string }).code === "P2002") {
            throw invalid("version", "validation.daily.stale");
          }
          throw error;
        }
      }
      for (const line of lines) {
        await tx.dsrLine.create({
          data: {
            dsrDayId: id,
            productId: line.productId,
            piecesPerCarton: packs.get(line.productId) ?? 1,
            issued: line.issued,
            returned: line.returned,
            damaged: line.damaged,
            commission: line.commission,
            ...(await dsrLineBatch(
              tx,
              companyId,
              seesCost(access),
              line,
              request.lines.indexOf(line),
            )),
          },
        });
      }
      if (corrected) {
        const draft = await loadDsrDay(tx, companyId, id);
        await moveDsrDay(tx, ctx, access, draft, "posted");
        await ensureStockCovers(tx, access, request.date, [
          ...new Set([...stockTakenOut(corrected, "reversed"), ...stockTakenOut(draft, "posted")]),
        ]);
      }
      await recordAudit(tx, ctx, {
        companyId,
        action: corrected ? "dsr_day.correct" : "dsr_day.save",
        resourceType: "dsr_day",
        resourceId: id,
        ...(corrected ? { before: { id: corrected.id, version: corrected.version } } : {}),
        after: { ...data, staffId: request.staffId, date: request.date, lines },
      });
      return toDsrDay(await loadDsrDay(tx, companyId, id), seesCost(access));
    },
  );
}

/**
 * Posts or reverses a sheet with everything it owns: the field visits' dues and exchange case
 * (D40). The handover difference is shown only (D62); reversing still removes entries an earlier
 * posting created (D54 history). The stock check is left to the caller.
 */
async function moveDsrDay(
  tx: Tx,
  ctx: AppContext,
  access: CompanyAccess,
  row: DsrRow,
  to: "posted" | "reversed",
): Promise<void> {
  const now = new Date();
  const stamp =
    to === "posted"
      ? { postedAt: now, postedById: ctx.actor.userId }
      : { reversedAt: now, reversedById: ctx.actor.userId };
  const updated = await tx.dsrDay.updateMany({
    where: { id: row.id, version: row.version, status: to === "posted" ? "draft" : "posted" },
    data: { status: to, version: { increment: 1 }, ...stamp },
  });
  if (updated.count !== 1) throw invalid("version", "validation.daily.stale");
  const day = { id: row.id, staffId: row.staffId, date: fromDbDate(row.date) };
  if (to === "posted") {
    await postFieldVisits(tx, ctx, access, { ...row, ...day });
  } else {
    await reverseFieldVisits(tx, ctx, access.company.id, day);
  }
}

/** Products whose stock a move takes out: posting takes issued − returned, reversing gives it back. */
function stockTakenOut(row: DsrRow, to: "posted" | "reversed"): string[] {
  return row.lines
    .filter((line) => {
      const net = toDecimal(line.issued).sub(toDecimal(line.returned));
      return to === "posted" ? net.gt(0) : net.lt(0);
    })
    .map((line) => line.productId);
}

async function transitionDsrDay(
  ctx: AppContext,
  companyId: string,
  id: string,
  input: unknown,
  requestKey: string | undefined,
  move: { action: string; permission: PermissionId; from: string; to: string },
): Promise<DsrDay> {
  const access = await requirePermission(ctx, companyId, move.permission, { write: true });
  const { version } = parseInput(documentTransitionRequestSchema, input);
  return runIdempotent(
    ctx,
    { scope: companyId, action: move.action, requestKey },
    { id, version },
    async (tx) => {
      const row = await loadDsrDay(tx, companyId, id);
      if (row.status !== move.from || row.version !== version) {
        throw invalid("version", "validation.daily.stale");
      }
      await postingGuard(tx, companyId, fromDbDate(row.date));
      await moveDsrDay(tx, ctx, access, row, move.to as "posted" | "reversed");
      await ensureStockCovers(
        tx,
        access,
        fromDbDate(row.date),
        stockTakenOut(row, move.to as "posted" | "reversed"),
      );
      await recordAudit(tx, ctx, {
        companyId,
        action: move.action,
        resourceType: "dsr_day",
        resourceId: id,
        before: { status: move.from, version },
        after: { status: move.to, version: version + 1 },
      });
      return toDsrDay(await loadDsrDay(tx, companyId, id), seesCost(access));
    },
  );
}

export function postDsrDay(
  ctx: AppContext,
  companyId: string,
  id: string,
  input: unknown,
  requestKey?: string,
) {
  return transitionDsrDay(ctx, companyId, id, input, requestKey, {
    action: "dsr_day.post",
    permission: "sale.post",
    from: "draft",
    to: "posted",
  });
}

export function reverseDsrDay(
  ctx: AppContext,
  companyId: string,
  id: string,
  input: unknown,
  requestKey?: string,
) {
  return transitionDsrDay(ctx, companyId, id, input, requestKey, {
    action: "dsr_day.reverse",
    permission: "sale.reverse",
    from: "posted",
    to: "reversed",
  });
}

/** Deletes a draft sheet (never a posted one). */
export async function discardDsrDay(
  ctx: AppContext,
  companyId: string,
  id: string,
  input: unknown,
): Promise<void> {
  await requirePermission(ctx, companyId, "sale.create", { write: true });
  const { version } = parseInput(documentTransitionRequestSchema, input);
  await ctx.db.$transaction(async (tx) => {
    const deleted = await tx.dsrDay.deleteMany({
      where: { id, companyId, status: "draft", version },
    });
    if (deleted.count !== 1) throw invalid("version", "validation.daily.stale");
    await recordAudit(tx, ctx, {
      companyId,
      action: "dsr_day.discard",
      resourceType: "dsr_day",
      resourceId: id,
      before: { status: "draft", version },
    });
  });
}

// ---------------------------------------------------------------- money entries

/** Who may post each entry type (guide §12.2). */

const MONEY_PERSON = moneyKindPerson;
const CATEGORY_KINDS = new Set<MoneyEntryKind>(moneyCategoryKinds);
const ALLOCATION_KINDS = new Set<MoneyEntryKind>(moneyAllocationKinds);
const MARKET_KINDS = new Set<MoneyEntryKind>(["marketDueNew", "marketDueCollected"]);
const SR_LOAN_TYPE_KINDS = new Set<MoneyEntryKind>(srLoanTypeKinds);
const ACCOUNT_KINDS = new Set<MoneyEntryKind>(moneyAccountKinds);

const moneyInclude = {
  staff: { select: { name: true } },
  shop: { select: { name: true } },
  expenseCategory: { select: { name: true } },
  cashAccount: { select: { name: true } },
  toCashAccount: { select: { name: true } },
} as const;
type MoneyRow = Prisma.MoneyEntryGetPayload<{ include: typeof moneyInclude }>;

function toMoneyEntry(row: MoneyRow): MoneyEntry {
  return moneyEntrySchema.parse({
    id: row.id,
    date: fromDbDate(row.date),
    kind: row.kind,
    amount: plain(row.amount),
    staffId: row.staffId,
    staffName: row.staff?.name ?? null,
    shopId: row.shopId,
    shopName: row.shop?.name ?? null,
    expenseCategoryId: row.expenseCategoryId,
    categoryName: row.expenseCategory?.name ?? null,
    allocation: allocationOf(row),
    srLoanType: row.srLoanType,
    cashAccountId: row.cashAccountId,
    cashAccountName: row.cashAccount?.name ?? null,
    toCashAccountId: row.toCashAccountId,
    toCashAccountName: row.toCashAccount?.name ?? null,
    payrollRunId: row.payrollRunId,
    dsrDayId: row.dsrDayId,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    reversedAt: iso(row.reversedAt),
  });
}

/**
 * An explicit allocation or offset may only take what the person owes on the date; an offset
 * also needs as much credit (or money owed to the SR) as it settles. Never netted silently (D27).
 */
async function checkOwedLimits(
  tx: Tx,
  access: CompanyAccess,
  request: { kind: MoneyEntryKind; amount: string; staffId: string | null; date: string },
  allocation: { advance: string; loan: string; shortage: string } | null,
): Promise<void> {
  const offset = request.kind === "staffOffset" || request.kind === "srOffset";
  if (!request.staffId || (!allocation && !offset)) return;
  const run = await staffRun(tx, access.company.tenantId, request.date);
  const b = run?.output.closing.staff[request.staffId];
  const owed = (key: "advance" | "loan" | "shortage" | "credit" | "srLoan" | "owedToSr") =>
    toDecimal(b?.[key] ?? "0");
  const amount = toDecimal(request.amount);
  if (allocation) {
    for (const key of ["advance", "loan", "shortage"] as const) {
      if (toDecimal(allocation[key]).gt(owed(key))) {
        throw invalid(`allocation.${key}`, "validation.money.allocationExceeds");
      }
    }
  }
  if (request.kind === "staffOffset") {
    const totalOwed = owed("advance").add(owed("loan")).add(owed("shortage"));
    if (amount.gt(totalOwed) || amount.gt(owed("credit"))) {
      throw invalid("amount", "validation.money.offsetExceeds");
    }
  }
  if (request.kind === "srOffset" && (amount.gt(owed("srLoan")) || amount.gt(owed("owedToSr")))) {
    throw invalid("amount", "validation.money.offsetExceeds");
  }
}

/**
 * Money entries from `from` to `to` (inclusive). Market due entries need `sale.view`; the others
 * need `finance.view`. Only the kinds the actor may see are returned.
 */
export async function listMoneyEntries(
  ctx: AppContext,
  companyId: string,
  query: { from: unknown; to?: unknown; staffId?: string | null; shopId?: string | null },
): Promise<MoneyEntry[]> {
  const access = await loadCompanyAccess(ctx, companyId);
  const from = businessDate(query.from, "from");
  const to = query.to === undefined || query.to === null ? from : businessDate(query.to, "to");
  const market = access.permissions.includes("sale.view");
  const finance = access.permissions.includes("finance.view");
  if (!market && !finance) throw new AppError("FORBIDDEN");
  const kinds = Object.keys(moneyKindPermission).filter((k) =>
    MARKET_KINDS.has(k as MoneyEntryKind) ? market : finance,
  );
  const rows = await ctx.db.moneyEntry.findMany({
    where: {
      companyId,
      kind: { in: kinds },
      date: { gte: toDbDate(from), lte: toDbDate(to) },
      ...(query.staffId ? { staffId: query.staffId } : {}),
      ...(query.shopId ? { shopId: query.shopId } : {}),
    },
    include: moneyInclude,
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toMoneyEntry);
}

export async function postMoneyEntry(
  ctx: AppContext,
  companyId: string,
  input: unknown,
  requestKey?: string,
): Promise<MoneyEntry> {
  const request = parseInput(moneyEntryPostRequestSchema, input);
  const access = await requirePermission(ctx, companyId, moneyKindPermission[request.kind], {
    write: true,
  });
  const effect = MONEY_KIND_EFFECTS[request.kind];
  const person = MONEY_PERSON[request.kind];
  if (effect.requiresStaff && !request.staffId) {
    throw invalid("staffId", "validation.daily.staffRequired");
  }
  if (!person && request.staffId) throw invalid("staffId", "validation.daily.noStaffForKind");
  const market = MARKET_KINDS.has(request.kind);
  if (market && !request.staffId) throw invalid("staffId", "validation.daily.staffRequired");
  if (market !== Boolean(request.shopId ?? request.newShop)) {
    throw invalid("shopId", market ? "validation.shop.required" : "validation.shop.notForKind");
  }
  if (CATEGORY_KINDS.has(request.kind) !== Boolean(request.expenseCategoryId)) {
    throw invalid(
      "expenseCategoryId",
      CATEGORY_KINDS.has(request.kind)
        ? "validation.daily.categoryRequired"
        : "validation.daily.noCategoryForKind",
    );
  }
  if (SR_LOAN_TYPE_KINDS.has(request.kind) !== Boolean(request.srLoanType)) {
    throw invalid(
      "srLoanType",
      SR_LOAN_TYPE_KINDS.has(request.kind)
        ? "validation.money.srLoanTypeRequired"
        : "validation.money.noSrLoanTypeForKind",
    );
  }
  const allocation = request.allocation;
  if (allocation) {
    if (!ALLOCATION_KINDS.has(request.kind)) {
      throw invalid("allocation", "validation.money.noAllocationForKind");
    }
    const parts = sumAmounts([allocation.advance, allocation.loan, allocation.shortage]);
    if (!toDecimal(parts).eq(toDecimal(request.amount))) {
      throw invalid("allocation", "validation.money.allocationSum");
    }
  }

  try {
    return await runIdempotent(
      ctx,
      { scope: companyId, action: "money.post", requestKey },
      request,
      async (tx) => {
        await postingGuard(tx, companyId, request.date);
        if (request.staffId) {
          const role = await roleOn(tx, companyId, request.staffId, request.date);
          if (!role) throw invalid("staffId", "validation.daily.staffNotAssigned");
          if (person === "dsr" && role !== "dsr")
            throw invalid("staffId", "validation.daily.dsrOnly");
          if (person === "sr" && role !== "sr") throw invalid("staffId", "validation.daily.srOnly");
          if (person === "distributor" && role === "sr") {
            throw invalid("staffId", "validation.daily.notForSr");
          }
        }
        if (request.expenseCategoryId) {
          const category = await tx.expenseCategory.findFirst({
            where: {
              id: request.expenseCategoryId,
              tenantId: access.company.tenantId,
              active: true,
            },
          });
          if (!category) throw invalid("expenseCategoryId", "validation.daily.unknownCategory");
        }
        let shopId = request.shopId;
        if (request.newShop) {
          // D50: the shop typed on the due page. An exact-name match is reused, never duplicated;
          // creating it needs only the posting permission of the kind, and rolls back with the entry.
          const { name } = request.newShop;
          const existing = await tx.shop.findFirst({ where: { companyId, name } });
          if (existing && existing.status !== "active") {
            throw invalid("newShop", "validation.shop.inactiveName");
          }
          shopId =
            existing?.id ??
            (await insertShop(tx, ctx, access.company.tenantId, companyId, { name })).id;
        } else if (shopId) {
          const shop = await tx.shop.findFirst({
            where: { id: shopId, companyId, status: "active" },
          });
          if (!shop) throw invalid("shopId", "validation.shop.unknown");
        }
        if (
          market &&
          request.staffId &&
          (await hasFieldVisits(tx, companyId, request.staffId, request.date))
        ) {
          throw invalid("shopId", "validation.field.manualDueBlocked");
        }
        await checkOwedLimits(tx, access, request, allocation);
        // D52: named accounts must be active and the tenant's; an omitted one gets the default
        // when the entry is stored, so the book never moves if the default changes later.
        const named = [request.cashAccountId, request.toCashAccountId].filter(
          (id): id is string => id !== null,
        );
        if (named.length) {
          const found = await tx.cashAccount.count({
            where: { id: { in: named }, tenantId: access.company.tenantId, active: true },
          });
          if (found !== new Set(named).size) {
            throw invalid(
              request.cashAccountId === null ? "toCashAccountId" : "cashAccountId",
              "validation.money.unknownAccount",
            );
          }
        }
        let cashAccountId = request.cashAccountId;
        if (cashAccountId === null && ACCOUNT_KINDS.has(request.kind)) {
          const defaults = await cashDefaults(tx, access.company.tenantId, companyId);
          cashAccountId =
            (request.kind === "supplierDeposit" ? defaults.deposit : defaults.cash) || null;
        }
        const row = await tx.moneyEntry.create({
          data: {
            tenantId: access.company.tenantId,
            companyId,
            date: toDbDate(request.date),
            kind: request.kind,
            amount: request.amount,
            staffId: request.staffId,
            shopId,
            expenseCategoryId: request.expenseCategoryId,
            allocAdvance: allocation?.advance ?? null,
            allocLoan: allocation?.loan ?? null,
            allocShortage: allocation?.shortage ?? null,
            srLoanType: request.srLoanType,
            cashAccountId,
            toCashAccountId: request.toCashAccountId,
            createdById: ctx.actor.userId,
          },
          include: moneyInclude,
        });
        await recordAudit(tx, ctx, {
          companyId,
          action: "money.post",
          resourceType: "money_entry",
          resourceId: row.id,
          after: request,
        });
        return toMoneyEntry(row);
      },
    );
  } catch (error) {
    // Two requests creating the same new shop at once: the loser sees the name clash.
    if (request.newShop && isUniqueViolation(error)) {
      throw invalid("newShop", "validation.shop.duplicate");
    }
    throw error;
  }
}

export async function reverseMoneyEntry(
  ctx: AppContext,
  companyId: string,
  entryId: string,
  requestKey?: string,
): Promise<MoneyEntry> {
  await requirePermission(ctx, companyId, "payment.reverse", { write: true });
  return runIdempotent(
    ctx,
    { scope: companyId, action: "money.reverse", requestKey },
    { entryId },
    async (tx) => {
      const row = await tx.moneyEntry.findFirst({ where: { id: entryId, companyId } });
      if (!row) throw invalid("", "validation.daily.notFound");
      if (row.status !== "posted") throw invalid("", "validation.daily.alreadyReversed");
      if (row.payrollRunId) throw invalid("", "validation.money.payrollOwned");
      if (row.dsrDayId) {
        // D54: a handover shortage/excess belongs to its day sheet; field entries to the field day.
        const handover = row.kind === "staffShortage" || row.kind === "staffExcess";
        throw invalid(
          "",
          handover ? "validation.money.dsrDayOwned" : "validation.money.fieldOwned",
        );
      }
      await postingGuard(tx, companyId, fromDbDate(row.date));
      const updated = await tx.moneyEntry.updateMany({
        where: { id: entryId, status: "posted" },
        data: { status: "reversed", reversedAt: new Date(), reversedById: ctx.actor.userId },
      });
      if (updated.count !== 1) throw invalid("", "validation.daily.alreadyReversed");
      await recordAudit(tx, ctx, {
        companyId,
        action: "money.reverse",
        resourceType: "money_entry",
        resourceId: entryId,
        before: { status: "posted" },
        after: { status: "reversed" },
      });
      return toMoneyEntry(
        await tx.moneyEntry.findUniqueOrThrow({ where: { id: entryId }, include: moneyInclude }),
      );
    },
  );
}

// ---------------------------------------------------------------- views

const ZERO_MONEY = {
  sales: "0",
  commission: "0",
  marketDueNew: "0",
  marketDueCollected: "0",
  srIncentive: "0",
  expenses: "0",
  cashIn: "0",
  cashOut: "0",
  cashLeft: "0",
  banked: "0",
};

/** The engine's view of one date (PLAN §6): godown, DSR sales, money, dues and warnings. */
export async function getDayView(
  ctx: AppContext,
  companyId: string,
  dateInput: unknown,
): Promise<DayView> {
  const access = await requirePermission(ctx, companyId, "company.view");
  const date = businessDate(dateInput);
  const canSeeCost = access.permissions.includes("inventory.cost_view");
  const canSeeProfit = canSeeCost && access.permissions.includes("report.profit_view");
  const [active, names] = await Promise.all([
    liveOpening(ctx.db, companyId),
    namesFor(ctx.db, access, date),
  ]);
  const run = await runLedger(ctx.db, access, date, active);
  const day = run?.output.days.find((d) => d.date === date);
  const byId = new Map(day?.products.map((p) => [p.productId, p]));
  const cost = (value: string) => (canSeeCost ? value : null);
  const inStock = new Set(
    (day?.products ?? []).flatMap((p) =>
      p.batches.filter((b) => !toDecimal(b.quantity).isZero()).map((b) => b.key),
    ),
  );
  const lots = day
    ? await productLots(ctx.db, companyId, date, inStock, canSeeCost)
    : new Map<string, ProductLot[]>();

  return dayViewSchema.parse({
    date,
    cutoffDate: active?.cutoffDate ?? null,
    products: day
      ? names.products.flatMap((product) => {
          const row = byId.get(product.id);
          if (!row) return [];
          return [
            {
              ...row,
              sku: product.sku,
              productName: product.name,
              piecesPerCarton: product.piecesPerCarton,
              costPrice: canSeeCost ? row.costPrice : null,
              cost: cost(row.cost),
              grossProfit: canSeeProfit ? row.grossProfit : null,
              damageValue: cost(row.damageValue),
              damageRecovery: cost(row.damageRecovery),
              stockValue: cost(row.stockValue),
              batches: row.batches.map((b) => ({
                ...b,
                costPrice: cost(b.costPrice),
                value: cost(b.value),
              })),
              lots: lots.get(product.id) ?? [],
            },
          ];
        })
      : [],
    persons: (day?.persons ?? []).map((p) => ({
      ...p,
      staffName: names.staff.get(p.staffId) ?? "",
      allocations: p.allocations.map((a) => ({ ...a, costPrice: cost(a.costPrice) })),
    })),
    money: day?.money ?? ZERO_MONEY,
    company:
      canSeeCost && run
        ? {
            balance: toDecimal(run.output.month.companyPayable.closing).neg().toString(),
            undeliveredValue: run.output.month.companyPayable.undeliveredClosing,
            undeliveredPieces: sumQuantities([
              "0",
              ...run.output.month.products.map((p) => p.dueFromCompany),
            ]),
            damageBalance: run.output.month.companyPayable.damageBalance,
            incentiveBalance: run.output.month.companyPayable.incentiveBalance,
            totalCash: sumAmounts(["0", ...run.output.month.cashBook.map((a) => a.closing)]),
          }
        : null,
    marketDueOutstanding: run?.output.month.marketDue.closing ?? "0",
    marketDueByDsr: (run?.output.month.marketDue.byDsr ?? [])
      .filter((d) => d.closing !== "0" && d.closing !== "0.00")
      .map((d) => ({
        staffId: d.staffId,
        staffName: names.staff.get(d.staffId) ?? "",
        amount: d.closing,
      })),
    warnings: (run?.output.warnings ?? []).filter((w) => w.date === date),
    canSeeCost,
    canSeeProfit,
  });
}

/**
 * The dashboard's report for a range (guide 5.2): one engine run over [from, to], each day
 * summarised by the domain and summed here; `to` stops at today (same rules as reports).
 */
export async function getDashboardSummary(
  ctx: AppContext,
  companyId: string,
  query: unknown,
): Promise<DashboardSummary> {
  const access = await requirePermission(ctx, companyId, "company.view");
  return (await dashboardOf(ctx, access, parseReportRange(query))).summary;
}

/** The dashboard summary plus the engine's profit over the range (the master panel's P&L). */
export async function dashboardOf(
  ctx: AppContext,
  access: CompanyAccess,
  range: { from: string; to: string },
): Promise<{
  summary: DashboardSummary;
  profit: MonthOutput["month"]["profit"] | null;
}> {
  const companyId = access.company.id;
  const canSeeCost = access.permissions.includes("inventory.cost_view");
  const canSeeProfit = canSeeCost && access.permissions.includes("report.profit_view");
  const dates = { gte: toDbDate(range.from), lte: toDbDate(range.to) };
  const active = await liveOpening(ctx.db, companyId);
  const [run, names, sheets, receipts, accounts] = await Promise.all([
    rangeRun(ctx.db, access, range.from, range.to, active),
    ctx.db.staff.findMany({
      where: { tenantId: access.company.tenantId },
      select: { id: true, name: true },
    }),
    ctx.db.dsrDay.count({ where: { companyId, date: dates, status: "posted" } }),
    ctx.db.stockEntry.count({
      where: { companyId, date: dates, status: "posted", kind: "receipt" },
    }),
    ctx.db.cashAccount.findMany({
      where: { tenantId: access.company.tenantId },
      select: { id: true, name: true, active: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
  ]);
  const accountNames = new Map(accounts.map((a) => [a.id, a.name]));
  const summaries = run
    ? run.output.days.flatMap((day, index) => {
        const input = run.input[index];
        return input ? [summarizeDay(day, input)] : [];
      })
    : [];
  const total = (pick: (s: (typeof summaries)[number]) => string) =>
    sumAmounts(summaries.map(pick));
  const staffName = new Map(names.map((s) => [s.id, s.name]));
  const dsrIds = [...new Set(summaries.flatMap((s) => s.byDsr.map((r) => r.staffId)))];
  const byDsr = dsrIds.map((staffId) => {
    const rows = summaries.flatMap((s) => s.byDsr.filter((r) => r.staffId === staffId));
    const sum = (pick: (r: (typeof rows)[number]) => string) => sumAmounts(rows.map(pick));
    return {
      dsrId: staffId,
      dsrName: staffName.get(staffId) ?? "",
      netSales: sum((r) => r.netSales),
      salesCash: sum((r) => r.salesCash),
      marketDueCreated: sum((r) => r.marketDueCreated),
      oldDuesCollected: sum((r) => r.oldDuesCollected),
    };
  });

  const seesFinance = access.permissions.includes("finance.view");
  const chain = dashboardChain({
    issuedValue: total((s) => s.issuedValue),
    returnValue: total((s) => s.returnValue),
    damageSaleValue: total((s) => s.damageSaleValue),
    commission: total((s) => s.commission),
    expenses: total((s) => s.expenses),
    staffCost: total((s) => s.staffCost),
    srCost: total((s) => s.srCost),
    costOfSold: total((s) => s.costOfSold),
  });

  const summary = dashboardSummarySchema.parse({
    from: range.from,
    to: range.to,
    cutoffDate: active?.cutoffDate ?? null,
    damageSaleValue: total((s) => s.damageSaleValue),
    netSales: total((s) => s.netSales),
    salesCash: total((s) => s.salesCash),
    oldDuesCollected: total((s) => s.oldDuesCollected),
    cashCollected: total((s) => s.cashCollected),
    marketDueCreated: total((s) => s.marketDueCreated),
    marketDueOpening: run?.output.month.marketDue.opening ?? "0.00",
    marketDueOutstanding: run?.output.month.marketDue.closing ?? "0.00",
    issuedValue: total((s) => s.issuedValue),
    returnValue: total((s) => s.returnValue),
    commission: total((s) => s.commission),
    ...(seesFinance
      ? {
          expenses: total((s) => s.expenses),
          staffShortage: total((s) => s.staffShortage),
          staffCost: total((s) => s.staffCost),
          srCost: total((s) => s.srCost),
          srAdvanceDue: sumAmounts([
            "0",
            ...(run?.output.month.staff ?? []).map((s) => s.closing.srLoan),
          ]),
          netBalance: chain.netBalance,
        }
      : {}),
    postedSummaryCount: sheets,
    postedReceiptCount: receipts,
    byDsr,
    ...(canSeeProfit && run
      ? {
          grossProfit: total((s) => s.grossProfit),
          ...(seesFinance && chain.netProfit !== null ? { netProfit: chain.netProfit } : {}),
        }
      : {}),
    ...(access.permissions.includes("finance.view") && run
      ? {
          // Every active account shows, with 0 when it has no opening or movement yet.
          cashAccounts: [
            ...run.output.month.cashBook.map((a) => ({
              accountId: a.accountId,
              accountName: accountNames.get(a.accountId) ?? "",
              balance: a.closing,
            })),
            ...accounts
              .filter(
                (a) => a.active && !run.output.month.cashBook.some((b) => b.accountId === a.id),
              )
              .map((a) => ({ accountId: a.id, accountName: a.name, balance: "0" })),
          ],
        }
      : {}),
    ...(canSeeCost && run
      ? {
          receivedValue: total((s) => s.receivedValue),
          stockValue: summaries.at(-1)?.stockValue ?? "0.00",
          damageValue: total((s) => s.damageValue),
          costOfSold: total((s) => s.costOfSold),
          undeliveredValue: run.output.month.companyPayable.undeliveredClosing,
        }
      : {}),
  });
  return { summary, profit: canSeeProfit && run ? run.output.month.profit : null };
}
