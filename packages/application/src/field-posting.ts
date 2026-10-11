import { fieldVisitTotals, sumAmounts, sumQuantities, toDecimal } from "@bsd/domain";
import type { CompanyAccess } from "./access";
import { nextCaseNumber } from "./case-number";
import type { AppContext, Tx } from "./context";
import { toDbDate } from "./dates";
import { invalid } from "./errors";
import { plain } from "./numeric";

/**
 * What posting a DSR day does with that day's field visits (D40), in the posting transaction:
 * per-shop new due and collection money entries, one buyer-exchange case holding the damaged
 * pieces in custody, and the visits locked. The replacement pieces given are already the sheet's
 * `damaged` column, so the case's buyer leg is recorded as given from the DSR (never from stock).
 */

type PostedDay = {
  id: string;
  staffId: string;
  date: string;
  marketDueNew: Parameters<typeof plain>[0];
  marketDueCollected: Parameters<typeof plain>[0];
  lines: { productId: string; issued: Parameters<typeof plain>[0] }[];
};

const visitInclude = { lines: true } as const;

export async function postFieldVisits(
  tx: Tx,
  ctx: AppContext,
  access: CompanyAccess,
  day: PostedDay,
): Promise<void> {
  const companyId = access.company.id;
  const date = toDbDate(day.date);
  const visits = await tx.fieldVisit.findMany({
    where: { companyId, staffId: day.staffId, date, status: "open" },
    include: visitInclude,
    orderBy: { createdAt: "asc" },
  });
  if (visits.length === 0) return;
  if (plain(day.marketDueNew) !== "0" || plain(day.marketDueCollected) !== "0") {
    throw invalid("marketDueNew", "validation.field.sheetDues");
  }

  const issued = new Map(day.lines.map((l) => [l.productId, toDecimal(plain(l.issued) ?? "0")]));
  const used = new Map<string, string>();
  const exchanged = new Map<string, string>();
  for (const line of visits.flatMap((v) => v.lines)) {
    used.set(
      line.productId,
      sumQuantities([
        used.get(line.productId) ?? "0",
        plain(line.delivered),
        plain(line.exchanged),
      ]),
    );
    if (plain(line.exchanged) !== "0") {
      exchanged.set(
        line.productId,
        sumQuantities([exchanged.get(line.productId) ?? "0", plain(line.exchanged)]),
      );
    }
  }
  for (const [productId, pieces] of used) {
    if (toDecimal(pieces).gt(issued.get(productId) ?? 0)) {
      throw invalid("lines", "validation.field.exceedsSamari");
    }
  }

  const byShop = new Map<string, { due: string[]; collected: string[] }>();
  for (const visit of visits) {
    const totals = fieldVisitTotals(
      visit.lines.map((l) => ({
        delivered: plain(l.delivered),
        exchanged: plain(l.exchanged),
        unitPrice: plain(l.unitPrice),
      })),
      plain(visit.cashReceived),
    );
    const shop = byShop.get(visit.shopId) ?? { due: [], collected: [] };
    shop.due.push(totals.dueCreated);
    shop.collected.push(plain(visit.dueCollected));
    byShop.set(visit.shopId, shop);
  }
  const base = {
    tenantId: access.company.tenantId,
    companyId,
    date,
    staffId: day.staffId,
    dsrDayId: day.id,
    createdById: ctx.actor.userId,
  };
  for (const [shopId, shop] of byShop) {
    for (const [kind, amounts] of [
      ["marketDueNew", shop.due],
      ["marketDueCollected", shop.collected],
    ] as const) {
      const amount = sumAmounts(amounts);
      if (toDecimal(amount).gt(0)) {
        await tx.moneyEntry.create({ data: { ...base, kind, shopId, amount } });
      }
    }
  }

  if (exchanged.size > 0) {
    const created = await tx.damageCase.create({
      data: {
        tenantId: access.company.tenantId,
        companyId,
        caseNumber: await nextCaseNumber(tx, companyId, day.date),
        date,
        origin: "buyerExchange",
        staffId: day.staffId,
        dsrDayId: day.id,
        createdById: ctx.actor.userId,
        lines: {
          create: [...exchanged].map(([productId, quantity]) => ({ productId, quantity })),
        },
      },
      include: { lines: true },
    });
    await tx.damageEvent.createMany({
      data: created.lines.map((line) => ({
        tenantId: access.company.tenantId,
        companyId,
        caseId: created.id,
        lineId: line.id,
        date,
        kind: "buyerReplacement",
        quantity: line.quantity,
        fromStock: false,
        createdById: ctx.actor.userId,
      })),
    });
  }

  await tx.fieldVisit.updateMany({
    where: { id: { in: visits.map((v) => v.id) }, status: "open" },
    data: { status: "locked", version: { increment: 1 } },
  });
}

/** Undoes `postFieldVisits` when the day is reversed; the visits open again for correction. */
export async function reverseFieldVisits(
  tx: Tx,
  ctx: AppContext,
  companyId: string,
  day: { id: string; staffId: string; date: string },
): Promise<void> {
  const now = new Date();
  await tx.moneyEntry.updateMany({
    where: { companyId, dsrDayId: day.id, status: "posted" },
    data: { status: "reversed", reversedAt: now, reversedById: ctx.actor.userId },
  });
  const cases = await tx.damageCase.findMany({
    where: { companyId, dsrDayId: day.id, status: "open" },
    include: { events: true },
  });
  for (const row of cases) {
    const inUse = row.events.some(
      (e) => e.status === "posted" && (e.kind !== "buyerReplacement" || e.fromStock),
    );
    if (inUse) throw invalid("", "validation.field.exchangeInUse");
    await tx.damageEvent.updateMany({
      where: { caseId: row.id, status: "posted" },
      data: { status: "reversed", reversedAt: now, reversedById: ctx.actor.userId },
    });
    await tx.damageCase.update({ where: { id: row.id }, data: { status: "cancelled" } });
  }
  await tx.fieldVisit.updateMany({
    where: { companyId, staffId: day.staffId, date: toDbDate(day.date), status: "locked" },
    data: { status: "open", version: { increment: 1 } },
  });
}

/** Shop dues entered by hand for a DSR and date would count twice next to field visits. */
export async function hasFieldVisits(
  db: Tx | AppContext["db"],
  companyId: string,
  staffId: string,
  date: string,
): Promise<boolean> {
  const count = await db.fieldVisit.count({
    where: { companyId, staffId, date: toDbDate(date) },
  });
  return count > 0;
}
