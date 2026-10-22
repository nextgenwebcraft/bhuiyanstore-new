import { hashPassword } from "@bsd/auth";
import {
  documentTransitionRequestSchema,
  fieldDayEndRequestSchema,
  fieldDaySchema,
  fieldPermissionIds,
  fieldShopCreateRequestSchema,
  fieldVisitDeleteRequestSchema,
  fieldVisitSaveRequestSchema,
  fieldVisitSchema,
  staffLoginCreateRequestSchema,
  type FieldDay,
  type FieldVisit,
  type StaffRecord,
} from "@bsd/contracts";
import type { Prisma } from "@bsd/database";
import {
  fieldRemaining,
  fieldVisitTotals,
  lineValue,
  roundSettlement,
  sumAmounts,
  sumQuantities,
  toDecimal,
  todayBusinessDate,
} from "@bsd/domain";
import {
  loadCompanyAccess,
  requirePermission,
  requireSuperAdmin,
  type CompanyAccess,
} from "./access";
import { recordAudit } from "./audit";
import { lastBatchLine, linesByProduct, type SheetLine } from "./batches";
import type { AppContext, Tx } from "./context";
import { businessDate, postingGuard, roleOn, saveDsrDayIn } from "./daily";
import { fromDbDate, toDbDate } from "./dates";
import { invalid, parseInput } from "./errors";
import { isUniqueViolation, runIdempotent } from "./idempotency";
import { runLedger } from "./ledger";
import { staffCompanyIds } from "./master";
import { plain } from "./numeric";
import { packOn } from "./products";
import { getStaffRecord } from "./staff";

/**
 * DSR field panel (D40). A DSR signs in as themselves (`staff.user_id`) and records each shop
 * visit: pieces delivered at the day's price, cash received, old due collected and damaged pieces
 * exchanged. Every use case acts on the actor's own staff record only; a super-admin names the DSR
 * (D59). Posting the office day sheet turns the visits into shop dues and exchange custody
 * (`field-posting.ts`).
 */

type Db = AppContext["db"] | Tx;

/** The tenant role every field login gets; created on first use with the field permissions. */
export const FIELD_ROLE_NAME = "ডিএসআর (মাঠ)";

async function ownStaffId(db: Db, ctx: AppContext): Promise<string> {
  const staff = await db.staff.findFirst({
    where: { userId: ctx.actor.userId, tenantId: ctx.actor.tenantId, status: "active" },
    select: { id: true },
  });
  if (!staff) throw invalid("", "validation.field.noStaffLink");
  return staff.id;
}

/**
 * The DSR a field use case acts on: the actor's own staff record, or for a super-admin the named
 * person assigned to the company (D59). Anyone else naming a different person is refused.
 */
async function fieldStaffId(
  db: Db,
  ctx: AppContext,
  companyId: string,
  requested: string | undefined,
): Promise<string> {
  if (!ctx.actor.isSuperAdmin) {
    const own = await ownStaffId(db, ctx);
    if (requested !== undefined && requested !== own) {
      throw invalid("staffId", "validation.field.ownOnly");
    }
    return own;
  }
  if (requested === undefined) throw invalid("staffId", "validation.field.chooseDsr");
  const staff = await db.staff.findFirst({
    where: {
      id: requested,
      tenantId: ctx.actor.tenantId,
      status: "active",
      assignments: { some: { companyId: { in: await staffCompanyIds(db, companyId) } } },
    },
    select: { id: true },
  });
  if (!staff) throw invalid("staffId", "validation.staff.unknown");
  return staff.id;
}

/** The day's sale price per piece: the latest `sale` price change on or before the date. */
async function salePricesOn(
  db: Db,
  productIds: readonly string[],
  date: string,
): Promise<Map<string, string>> {
  if (productIds.length === 0) return new Map();
  const rows = await db.priceChange.findMany({
    where: {
      productId: { in: [...productIds] },
      kind: "sale",
      effectiveFrom: { lte: toDbDate(date) },
    },
    orderBy: { effectiveFrom: "asc" },
    select: { productId: true, price: true },
  });
  return new Map(rows.map((r) => [r.productId, plain(r.price)]));
}

const visitInclude = {
  shop: { select: { name: true } },
  lines: {
    include: { product: { select: { name: true, sku: true } } },
    orderBy: { product: { sku: "asc" } },
  },
} as const;
type VisitRow = Prisma.FieldVisitGetPayload<{ include: typeof visitInclude }>;

function toVisit(row: VisitRow): FieldVisit {
  const lines = row.lines.map((l) => {
    const line = {
      delivered: plain(l.delivered),
      exchanged: plain(l.exchanged),
      unitPrice: plain(l.unitPrice),
    };
    return {
      productId: l.productId,
      productName: l.product.name,
      piecesPerCarton: String(l.piecesPerCarton),
      ...line,
      value: roundSettlement(lineValue(line)),
    };
  });
  const totals = fieldVisitTotals(lines, plain(row.cashReceived));
  return fieldVisitSchema.parse({
    id: row.id,
    staffId: row.staffId,
    shopId: row.shopId,
    shopName: row.shop.name,
    date: fromDbDate(row.date),
    status: row.status,
    version: row.version,
    cashReceived: plain(row.cashReceived),
    dueCollected: plain(row.dueCollected),
    note: row.note,
    salesValue: totals.salesValue,
    dueCreated: totals.dueCreated,
    lines,
    createdAt: row.createdAt.toISOString(),
  });
}

/** A reported value when there is one, else the sheet's. */
const plainOr = (reported: Prisma.Decimal | undefined, sheet: string | undefined) =>
  reported === undefined ? (sheet ?? "0") : plain(reported);

/** One DSR's field day: samari in hand per product, the visits and the shop list with dues. */
async function buildFieldDay(
  db: Db,
  access: CompanyAccess,
  staffId: string,
  date: string,
): Promise<FieldDay> {
  const companyId = access.company.id;
  const day = toDbDate(date);
  const [staff, sheet, visitRows, shops, run, report] = await Promise.all([
    db.staff.findFirst({
      where: { id: staffId, tenantId: access.company.tenantId },
      select: { name: true },
    }),
    db.dsrDay.findFirst({
      where: { companyId, staffId, date: day, status: { not: "reversed" } },
      include: { lines: true },
    }),
    db.fieldVisit.findMany({
      where: { companyId, staffId, date: day },
      include: visitInclude,
      orderBy: { createdAt: "asc" },
    }),
    db.shop.findMany({
      where: { companyId, status: "active" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, area: true, addedByStaffId: true },
    }),
    runLedger(db, access, date < todayBusinessDate() ? date : todayBusinessDate()),
    db.fieldDayReport.findFirst({
      where: { companyId, staffId, date: day, status: "pending" },
      include: { lines: true },
    }),
  ]);
  if (!staff) throw invalid("staffId", "validation.staff.unknown");
  const reported = new Map((report?.lines ?? []).map((l) => [l.productId, l]));
  const visits = visitRows.map(toVisit);

  const sheetLine = linesByProduct(sheet?.lines ?? []);
  const issued = new Map([...sheetLine].map(([id, l]) => [id, l.issued]));
  const used = new Map<string, { delivered: string; exchanged: string }[]>();
  for (const v of visits) {
    for (const l of v.lines) {
      used.set(l.productId, [...(used.get(l.productId) ?? []), l]);
    }
  }
  const productIds = [
    ...new Set([
      ...[...issued].filter(([, pieces]) => pieces !== "0").map(([id]) => id),
      ...used.keys(),
    ]),
  ];
  const catalog = await db.product.findMany({
    where: { companyId, OR: [{ status: "active" }, { id: { in: productIds } }] },
    include: { packs: true },
    orderBy: { sku: "asc" },
  });
  const prices = await salePricesOn(
    db,
    catalog.map((p) => p.id),
    date,
  );
  const inHand = new Set(productIds);
  const dues = run?.output.closing.shopDue ?? {};
  const sum = (values: string[]) => sumAmounts(values.length ? values : ["0"]);
  const sales = sum(visits.map((v) => v.salesValue));
  const cash = sum(visits.map((v) => v.cashReceived));
  const collected = sum(visits.map((v) => v.dueCollected));

  const toProduct = (p: (typeof catalog)[number]) => {
    const lines = used.get(p.id) ?? [];
    return {
      productId: p.id,
      sku: p.sku,
      productName: p.name,
      piecesPerCarton: String(packOn(p.packs, date)?.piecesPerCarton ?? 1),
      unitPrice: prices.get(p.id) ?? null,
      issued: issued.get(p.id) ?? "0",
      delivered: sumQuantities(lines.map((l) => l.delivered)),
      exchanged: sumQuantities(lines.map((l) => l.exchanged)),
      remaining: fieldRemaining(issued.get(p.id) ?? "0", lines),
      returned: plainOr(reported.get(p.id)?.returned, sheetLine.get(p.id)?.returned),
      damaged: plainOr(reported.get(p.id)?.damaged, sheetLine.get(p.id)?.damaged),
    };
  };

  return fieldDaySchema.parse({
    date,
    staffId,
    staffName: staff.name,
    sheetStatus: sheet ? sheet.status : "none",
    locked: sheet?.status === "posted",
    reportPending: report !== null,
    products: catalog.filter((p) => inHand.has(p.id)).map(toProduct),
    dayEnd: catalog.map(toProduct),
    visits,
    shops: shops.map((s) => ({
      id: s.id,
      name: s.name,
      area: s.area,
      due: run ? (dues[s.id] ?? "0") : null,
      addedByDsr: s.addedByStaffId !== null,
    })),
    totals: {
      sales,
      cashReceived: cash,
      dueCreated: roundSettlement(toDecimal(sales).sub(toDecimal(cash))),
      dueCollected: collected,
      cashInHand: roundSettlement(toDecimal(cash).add(toDecimal(collected))),
    },
  });
}

/** The signed-in DSR's own field day. */
export async function getFieldDay(
  ctx: AppContext,
  companyId: string,
  dateInput: unknown,
): Promise<FieldDay> {
  const access = await requirePermission(ctx, companyId, "field.entry");
  const date = businessDate(dateInput);
  return buildFieldDay(ctx.db, access, await fieldStaffId(ctx.db, ctx, companyId, undefined), date);
}

/** The office's read of one DSR's field day (day-end reconciliation). */
export async function getDsrFieldDay(
  ctx: AppContext,
  companyId: string,
  staffId: string,
  dateInput: unknown,
): Promise<FieldDay> {
  const access = await requirePermission(ctx, companyId, "sale.view");
  return buildFieldDay(ctx.db, access, staffId, businessDate(dateInput));
}

async function loadOwnVisit(tx: Tx, companyId: string, staffId: string, visitId: string) {
  const visit = await tx.fieldVisit.findFirst({ where: { id: visitId, companyId, staffId } });
  if (!visit) throw invalid("", "validation.field.visitNotFound");
  if (visit.status !== "open") throw invalid("", "validation.field.visitLocked");
  return visit;
}

async function refuseIfPosted(tx: Tx, companyId: string, staffId: string, date: string) {
  const posted = await tx.dsrDay.count({
    where: { companyId, staffId, date: toDbDate(date), status: "posted" },
  });
  if (posted > 0) throw invalid("", "validation.field.dayPosted");
}

/**
 * Creates (`visitId` undefined, version 0) or replaces an open visit. The price is read here,
 * never taken from the client; pieces may not exceed the samari still in hand.
 */
export async function saveFieldVisit(
  ctx: AppContext,
  companyId: string,
  visitId: string | undefined,
  input: unknown,
  requestKey?: string,
): Promise<FieldVisit> {
  const access = await requirePermission(ctx, companyId, "field.entry", { write: true });
  const request = parseInput(fieldVisitSaveRequestSchema, input);
  const lines = request.lines.filter((l) => l.delivered !== "0" || l.exchanged !== "0");
  const seen = new Set<string>();
  for (const [index, line] of lines.entries()) {
    if (seen.has(line.productId))
      throw invalid(`lines.${index}`, "validation.daily.duplicateProduct");
    seen.add(line.productId);
  }
  if (lines.length === 0 && toDecimal(request.dueCollected).isZero()) {
    throw invalid("lines", "validation.field.empty");
  }
  if (visitId ? request.version === 0 : request.version !== 0) {
    throw invalid("version", "validation.daily.stale");
  }

  return runIdempotent(
    ctx,
    { scope: companyId, action: `field.visit_save:${visitId ?? "new"}`, requestKey },
    request,
    async (tx) => {
      const staffId = await fieldStaffId(tx, ctx, companyId, request.staffId);
      // One DSR's visits are checked against the same samari: serialize them.
      await tx.$queryRaw`SELECT id FROM staff WHERE id = ${staffId} FOR UPDATE`;
      await postingGuard(tx, companyId, request.date);
      if ((await roleOn(tx, companyId, staffId, request.date)) !== "dsr") {
        throw invalid("", "validation.daily.dsrOnly");
      }
      await refuseIfPosted(tx, companyId, staffId, request.date);
      const existing = visitId ? await loadOwnVisit(tx, companyId, staffId, visitId) : null;
      if (existing && existing.version !== request.version) {
        throw invalid("version", "validation.daily.stale");
      }
      if (existing && fromDbDate(existing.date) !== request.date) {
        throw invalid("date", "validation.daily.stale");
      }
      const shop = await tx.shop.findFirst({
        where: { id: request.shopId, companyId, status: "active" },
        select: { id: true },
      });
      if (!shop) throw invalid("shopId", "validation.shop.unknown");

      const productIds = lines.map((l) => l.productId);
      const [products, prices, sheet, others] = await Promise.all([
        tx.product.findMany({
          where: { companyId, id: { in: productIds } },
          include: { packs: true },
        }),
        salePricesOn(tx, productIds, request.date),
        tx.dsrDay.findFirst({
          where: { companyId, staffId, date: toDbDate(request.date), status: "draft" },
          include: { lines: true },
        }),
        tx.fieldVisitLine.findMany({
          where: {
            productId: { in: productIds },
            visit: {
              companyId,
              staffId,
              date: toDbDate(request.date),
              ...(visitId ? { id: { not: visitId } } : {}),
            },
          },
          select: { productId: true, delivered: true, exchanged: true },
        }),
      ]);
      if (products.length !== productIds.length) {
        throw invalid("lines", "validation.daily.unknownProduct");
      }
      const issued = new Map(
        [...linesByProduct(sheet?.lines ?? [])].map(([id, l]) => [id, l.issued]),
      );
      const priced = lines.map((line, index) => {
        const unitPrice = prices.get(line.productId);
        if (unitPrice === undefined) throw invalid(`lines.${index}`, "validation.field.noPrice");
        const before = others
          .filter((o) => o.productId === line.productId)
          .map((o) => ({ delivered: plain(o.delivered), exchanged: plain(o.exchanged) }));
        const left = fieldRemaining(issued.get(line.productId) ?? "0", [...before, line]);
        if (toDecimal(left).lt(0))
          throw invalid(`lines.${index}`, "validation.field.exceedsSamari");
        const product = products.find((p) => p.id === line.productId);
        return {
          ...line,
          unitPrice,
          piecesPerCarton: packOn(product?.packs ?? [], request.date)?.piecesPerCarton ?? 1,
        };
      });
      const totals = fieldVisitTotals(priced, request.cashReceived);
      if (toDecimal(request.cashReceived).gt(toDecimal(totals.salesValue))) {
        throw invalid("cashReceived", "validation.field.cashExceedsSales");
      }

      const data = {
        shopId: request.shopId,
        cashReceived: request.cashReceived,
        dueCollected: request.dueCollected,
        note: request.note,
      };
      let id: string;
      if (existing) {
        const updated = await tx.fieldVisit.updateMany({
          where: { id: existing.id, version: existing.version, status: "open" },
          data: { ...data, version: { increment: 1 } },
        });
        if (updated.count !== 1) throw invalid("version", "validation.daily.stale");
        await tx.fieldVisitLine.deleteMany({ where: { visitId: existing.id } });
        id = existing.id;
      } else {
        id = (
          await tx.fieldVisit.create({
            data: {
              ...data,
              tenantId: access.company.tenantId,
              companyId,
              staffId,
              date: toDbDate(request.date),
              createdById: ctx.actor.userId,
            },
          })
        ).id;
      }
      if (priced.length) {
        await tx.fieldVisitLine.createMany({
          data: priced.map((l) => ({
            visitId: id,
            productId: l.productId,
            piecesPerCarton: l.piecesPerCarton,
            unitPrice: l.unitPrice,
            delivered: l.delivered,
            exchanged: l.exchanged,
          })),
        });
      }
      const visit = toVisit(
        await tx.fieldVisit.findUniqueOrThrow({ where: { id }, include: visitInclude }),
      );
      await recordAudit(tx, ctx, {
        companyId,
        action: existing ? "field.visit_update" : "field.visit_create",
        resourceType: "field_visit",
        resourceId: id,
        after: visit,
      });
      return visit;
    },
  );
}

/**
 * The DSR's day end: firot and damage per product written into the office's draft sheet, which
 * is created when the office has not started one (never posted here). Where samari exists,
 * firot + damage may not exceed it.
 */
export async function saveFieldDayEnd(
  ctx: AppContext,
  companyId: string,
  input: unknown,
  requestKey?: string,
): Promise<FieldDay> {
  const access = await requirePermission(ctx, companyId, "field.entry", { write: true });
  const request = parseInput(fieldDayEndRequestSchema, input);
  const staffId = await runIdempotent(
    ctx,
    { scope: companyId, action: "field.day_end", requestKey },
    request,
    async (tx) => {
      const staffId = await fieldStaffId(tx, ctx, companyId, request.staffId);
      await postingGuard(tx, companyId, request.date);
      if ((await roleOn(tx, companyId, staffId, request.date)) !== "dsr") {
        throw invalid("", "validation.daily.dsrOnly");
      }
      const date = toDbDate(request.date);
      const posted = await tx.dsrDay.findFirst({
        where: { companyId, staffId, date, status: "posted" },
        include: { lines: true },
      });
      if (posted) {
        await saveFieldReport(tx, ctx, access, staffId, request, posted.lines);
        return staffId;
      }
      const existing = await tx.dsrDay.findFirst({
        where: { companyId, staffId, date, status: "draft" },
        include: { lines: true },
      });
      const products = await tx.product.findMany({
        where: { companyId, id: { in: request.lines.map((l) => l.productId) } },
        include: { packs: true },
      });
      const productOf = new Map(products.map((p) => [p.id, p]));
      const sheetLines = existing?.lines ?? [];
      const byProduct = linesByProduct(sheetLines);
      for (const [index, line] of request.lines.entries()) {
        if (!productOf.has(line.productId)) {
          throw invalid(`lines.${index}`, "validation.daily.unknownProduct");
        }
        // Before the office enters samari the DSR may still report; the office checks at posting.
        const issued = toDecimal(byProduct.get(line.productId)?.issued ?? "0");
        if (issued.gt(0) && toDecimal(line.returned).add(line.damaged).gt(issued)) {
          throw invalid(`lines.${index}`, "validation.field.exceedsSamari");
        }
      }
      let sheetId: string;
      if (existing) {
        const updated = await tx.dsrDay.updateMany({
          where: { id: existing.id, version: existing.version, status: "draft" },
          data: { version: { increment: 1 } },
        });
        if (updated.count !== 1) throw invalid("", "validation.daily.stale");
        sheetId = existing.id;
      } else {
        sheetId = (
          await tx.dsrDay.create({
            data: {
              tenantId: access.company.tenantId,
              companyId,
              staffId,
              date,
              createdById: ctx.actor.userId,
            },
          })
        ).id;
      }
      for (const line of request.lines) {
        // D68: firot and damage go to the product's last batch issued; its other lines get none.
        const row = lastBatchLine(sheetLines, line.productId);
        if (row) {
          await tx.dsrLine.updateMany({
            where: { dsrDayId: row.dsrDayId, productId: line.productId, id: { not: row.id } },
            data: { returned: "0", damaged: "0" },
          });
          await tx.dsrLine.update({
            where: { id: row.id },
            data: { returned: line.returned, damaged: line.damaged },
          });
        } else if (line.returned !== "0" || line.damaged !== "0") {
          await tx.dsrLine.create({
            data: {
              dsrDayId: sheetId,
              productId: line.productId,
              piecesPerCarton:
                packOn(productOf.get(line.productId)?.packs ?? [], request.date)?.piecesPerCarton ??
                1,
              issued: "0",
              returned: line.returned,
              damaged: line.damaged,
              commission: "0",
            },
          });
        }
      }
      await recordAudit(tx, ctx, {
        companyId,
        action: "dsr_day.field_day_end",
        resourceType: "dsr_day",
        resourceId: sheetId,
        after: { staffId, date: request.date, lines: request.lines },
      });
      return staffId;
    },
  );
  return buildFieldDay(ctx.db, access, staffId, request.date);
}

type DayEndRequest = ReturnType<typeof fieldDayEndRequestSchema.parse>;

/**
 * D71: the day end after the office posted the day. What differs from the posted sheet waits as
 * the DSR's one pending report (replaced on every send, removed when nothing differs).
 */
async function saveFieldReport(
  tx: Tx,
  ctx: AppContext,
  access: CompanyAccess,
  staffId: string,
  request: DayEndRequest,
  sheetLines: readonly SheetLine[],
): Promise<void> {
  const companyId = access.company.id;
  await tx.$queryRaw`SELECT id FROM staff WHERE id = ${staffId} FOR UPDATE`;
  const ids = request.lines.map((l) => l.productId);
  const known = await tx.product.count({ where: { companyId, id: { in: ids } } });
  if (known !== new Set(ids).size) throw invalid("lines", "validation.daily.unknownProduct");
  const byProduct = linesByProduct(sheetLines);
  const same = (a: string, b: string | undefined) => toDecimal(a).eq(toDecimal(b ?? "0"));
  const changed = request.lines.filter((line, index) => {
    const sheet = byProduct.get(line.productId);
    const issued = toDecimal(sheet?.issued ?? "0");
    if (issued.gt(0) && toDecimal(line.returned).add(line.damaged).gt(issued)) {
      throw invalid(`lines.${index}`, "validation.field.exceedsSamari");
    }
    return !same(line.returned, sheet?.returned) || !same(line.damaged, sheet?.damaged);
  });

  const date = toDbDate(request.date);
  const existing = await tx.fieldDayReport.findFirst({
    where: { companyId, staffId, date, status: "pending" },
  });
  if (existing) await tx.fieldDayReport.delete({ where: { id: existing.id } });
  if (changed.length === 0) return;
  const report = await tx.fieldDayReport.create({
    data: {
      tenantId: access.company.tenantId,
      companyId,
      staffId,
      date,
      version: (existing?.version ?? 0) + 1,
      createdById: ctx.actor.userId,
      lines: {
        create: changed.map((l) => ({
          productId: l.productId,
          returned: l.returned,
          damaged: l.damaged,
        })),
      },
    },
  });
  await recordAudit(tx, ctx, {
    companyId,
    action: "field_day_report.save",
    resourceType: "field_day_report",
    resourceId: report.id,
    after: { staffId, date: request.date, lines: changed },
  });
}

async function loadPendingReport(tx: Tx, companyId: string, reportId: string, version: number) {
  const report = await tx.fieldDayReport.findFirst({
    where: { id: reportId, companyId },
    include: { lines: true },
  });
  if (!report || report.status !== "pending" || report.version !== version) {
    throw invalid("version", "validation.daily.stale");
  }
  return report;
}

/**
 * D71: approving a DSR's report corrects the DSR's live sheet (D56 when posted): each reported
 * product's firot and damage go to its last batch line issued, its other lines get none.
 */
export async function approveFieldDayReport(
  ctx: AppContext,
  companyId: string,
  reportId: string,
  input: unknown,
  requestKey?: string,
): Promise<void> {
  const access = await requirePermission(ctx, companyId, "sale.create", { write: true });
  const { version } = parseInput(documentTransitionRequestSchema, input);
  await runIdempotent(
    ctx,
    { scope: companyId, action: `field_day_report.approve:${reportId}`, requestKey },
    { reportId, version },
    async (tx) => {
      const report = await loadPendingReport(tx, companyId, reportId, version);
      const sheet = await tx.dsrDay.findFirst({
        where: {
          companyId,
          staffId: report.staffId,
          date: report.date,
          status: { not: "reversed" },
        },
        include: { lines: true },
      });
      if (!sheet) throw invalid("", "validation.field.reportNoSheet");
      const lines = sheet.lines.map((l) => ({
        productId: l.productId,
        batchKey: l.batchKey,
        issued: plain(l.issued),
        returned: plain(l.returned),
        damaged: plain(l.damaged),
        commission: plain(l.commission),
        ...(l.salePrice === null ? {} : { salePrice: plain(l.salePrice) }),
        ...(l.costPrice === null ? {} : { costPrice: plain(l.costPrice) }),
      }));
      for (const r of report.lines) {
        const target = lastBatchLine(sheet.lines, r.productId);
        const values = { returned: plain(r.returned), damaged: plain(r.damaged) };
        if (!target) {
          lines.push({
            productId: r.productId,
            batchKey: "",
            issued: "0",
            commission: "0",
            ...values,
          });
          continue;
        }
        for (const line of lines) {
          if (line.productId !== r.productId) continue;
          Object.assign(
            line,
            line.batchKey === target.batchKey ? values : { returned: "0", damaged: "0" },
          );
        }
      }
      await saveDsrDayIn(tx, ctx, access, {
        date: fromDbDate(sheet.date),
        staffId: sheet.staffId,
        version: sheet.version,
        lines,
      });
      await tx.fieldDayReport.update({
        where: { id: report.id },
        data: {
          status: "approved",
          version: { increment: 1 },
          decidedById: ctx.actor.userId,
          decidedAt: new Date(),
        },
      });
      await recordAudit(tx, ctx, {
        companyId,
        action: "field_day_report.approve",
        resourceType: "field_day_report",
        resourceId: report.id,
        before: { status: "pending", version },
        after: { status: "approved", sheetId: sheet.id },
      });
    },
  );
}

/** D71: the office turns a DSR's report down; the sheet stays as it is. */
export async function rejectFieldDayReport(
  ctx: AppContext,
  companyId: string,
  reportId: string,
  input: unknown,
): Promise<void> {
  await requirePermission(ctx, companyId, "sale.create", { write: true });
  const { version } = parseInput(documentTransitionRequestSchema, input);
  await ctx.db.$transaction(async (tx) => {
    const report = await loadPendingReport(tx, companyId, reportId, version);
    await tx.fieldDayReport.update({
      where: { id: report.id },
      data: {
        status: "rejected",
        version: { increment: 1 },
        decidedById: ctx.actor.userId,
        decidedAt: new Date(),
      },
    });
    await recordAudit(tx, ctx, {
      companyId,
      action: "field_day_report.reject",
      resourceType: "field_day_report",
      resourceId: report.id,
      before: { status: "pending", version },
      after: { status: "rejected" },
    });
  });
}

/** Deletes an own open visit while the office has not posted the day. */
export async function deleteFieldVisit(
  ctx: AppContext,
  companyId: string,
  visitId: string,
  input: unknown,
): Promise<void> {
  await requirePermission(ctx, companyId, "field.entry", { write: true });
  const { version, staffId: requested } = parseInput(fieldVisitDeleteRequestSchema, input);
  await ctx.db.$transaction(async (tx) => {
    const staffId = await fieldStaffId(tx, ctx, companyId, requested);
    const visit = await loadOwnVisit(tx, companyId, staffId, visitId);
    await refuseIfPosted(tx, companyId, staffId, fromDbDate(visit.date));
    const deleted = await tx.fieldVisit.deleteMany({
      where: { id: visitId, version, status: "open" },
    });
    if (deleted.count !== 1) throw invalid("version", "validation.daily.stale");
    await recordAudit(tx, ctx, {
      companyId,
      action: "field.visit_delete",
      resourceType: "field_visit",
      resourceId: visitId,
      before: { version },
    });
  });
}

/** A DSR adds a shop from the field; it is marked so the office can complete its details. */
export async function createFieldShop(
  ctx: AppContext,
  companyId: string,
  input: unknown,
  requestKey?: string,
): Promise<FieldDay["shops"][number]> {
  const access = await requirePermission(ctx, companyId, "field.shop_create", { write: true });
  const { staffId: requested, ...data } = parseInput(fieldShopCreateRequestSchema, input);
  try {
    return await runIdempotent(
      ctx,
      { scope: companyId, action: "field.shop_create", requestKey },
      { ...data, staffId: requested },
      async (tx) => {
        const staffId = await fieldStaffId(tx, ctx, companyId, requested);
        const row = await tx.shop.create({
          data: {
            ...data,
            tenantId: access.company.tenantId,
            companyId,
            addedByStaffId: staffId,
          },
        });
        await recordAudit(tx, ctx, {
          companyId,
          action: "shop.create",
          resourceType: "shop",
          resourceId: row.id,
          after: { ...data, addedByStaffId: staffId },
        });
        return { id: row.id, name: row.name, area: row.area, due: "0", addedByDsr: true };
      },
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw invalid("name", "validation.shop.duplicate");
    throw error;
  }
}

/**
 * Super-admin: a sign-in for a DSR with the field role in this company, linked to the staff
 * record. The password is one-time; the DSR changes it at first sign-in.
 */
export async function createStaffLogin(
  ctx: AppContext,
  companyId: string,
  staffId: string,
  input: unknown,
  requestKey?: string,
): Promise<StaffRecord> {
  requireSuperAdmin(ctx);
  await loadCompanyAccess(ctx, companyId);
  const data = parseInput(staffLoginCreateRequestSchema, input);
  const email = data.email.trim().toLowerCase();
  const passwordHash = await hashPassword(data.password);
  try {
    await runIdempotent(
      ctx,
      { scope: companyId, action: `staff.login:${staffId}`, requestKey },
      { staffId, email },
      async (tx) => {
        const staff = await tx.staff.findFirst({
          where: {
            id: staffId,
            tenantId: ctx.actor.tenantId,
            assignments: { some: { companyId: { in: await staffCompanyIds(tx, companyId) } } },
          },
        });
        if (!staff) throw invalid("id", "validation.staff.unknown");
        if (staff.userId) throw invalid("email", "validation.field.duplicateLogin");
        if ((await roleOn(tx, companyId, staffId, todayBusinessDate())) !== "dsr") {
          throw invalid("id", "validation.daily.dsrOnly");
        }
        if (await tx.user.findUnique({ where: { email } })) {
          throw invalid("email", "validation.user.duplicateEmail");
        }
        let role = await tx.role.findFirst({
          where: { tenantId: ctx.actor.tenantId, name: FIELD_ROLE_NAME },
        });
        if (!role) {
          role = await tx.role.create({
            data: {
              tenantId: ctx.actor.tenantId,
              name: FIELD_ROLE_NAME,
              permissions: { create: fieldPermissionIds.map((permission) => ({ permission })) },
            },
          });
        }
        const id = crypto.randomUUID();
        await tx.user.create({
          data: {
            id,
            name: staff.name,
            email,
            emailVerified: true,
            tenantId: ctx.actor.tenantId,
            mustChangePassword: true,
          },
        });
        await tx.account.create({
          data: {
            id: crypto.randomUUID(),
            accountId: id,
            providerId: "credential",
            userId: id,
            password: passwordHash,
          },
        });
        await tx.membership.create({
          data: { userId: id, companyId, roles: { create: [{ roleId: role.id }] } },
        });
        await tx.staff.update({ where: { id: staffId }, data: { userId: id } });
        await recordAudit(tx, ctx, {
          companyId,
          action: "staff.login_create",
          resourceType: "staff",
          resourceId: staffId,
          after: { userId: id, email, roleId: role.id },
        });
        return { userId: id };
      },
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw invalid("email", "validation.user.duplicateEmail");
    throw error;
  }
  return getStaffRecord(ctx, companyId, staffId);
}
