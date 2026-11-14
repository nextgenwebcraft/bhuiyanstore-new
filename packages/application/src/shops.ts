import { todayBusinessDate } from "@bsd/domain";
import {
  shopStatementSchema,
  shopUpsertRequestSchema,
  type Shop,
  type ShopStatement,
} from "@bsd/contracts";
import { loadCompanyAccess, requirePermission } from "./access";
import { recordAudit } from "./audit";
import type { AppContext } from "./context";
import { businessDate } from "./daily";
import { AppError, invalid, parseInput } from "./errors";
import { isForeignKeyViolation, isUniqueViolation, runIdempotent } from "./idempotency";
import { rangeRun, runLedger } from "./ledger";
import { releaseOpeningLines } from "./opening-lock";
import { insertShop, toShop } from "./shop-rows";

/**
 * Shops and their market due (D35). The due itself is entered as market due money entries with a
 * shop and a DSR; every balance shown here comes from the month engine.
 */

const duplicateName = () => invalid("name", "validation.shop.duplicate");

/** Every shop of the company; `due` is today's open due when the actor may see sales. */
export async function listShops(ctx: AppContext, companyId: string): Promise<Shop[]> {
  const access = await requirePermission(ctx, companyId, "company.view");
  const canSeeDue = access.permissions.includes("sale.view");
  const [rows, run] = await Promise.all([
    ctx.db.shop.findMany({ where: { companyId }, orderBy: { name: "asc" } }),
    canSeeDue ? runLedger(ctx.db, access, todayBusinessDate()) : null,
  ]);
  const dues = run?.output.closing.shopDue ?? {};
  return rows.map((row) => toShop(row, canSeeDue ? (dues[row.id] ?? "0") : null));
}

export async function createShop(
  ctx: AppContext,
  companyId: string,
  input: unknown,
  requestKey?: string,
): Promise<Shop> {
  const access = await requirePermission(ctx, companyId, "shop.manage", { write: true });
  const data = parseInput(shopUpsertRequestSchema, input);
  try {
    return await runIdempotent(
      ctx,
      { scope: companyId, action: "shop.create", requestKey },
      data,
      (tx) => insertShop(tx, ctx, access.company.tenantId, companyId, data),
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateName();
    throw error;
  }
}

/**
 * Hard delete of a shop that nothing refers to (D51). Any money entry (also a reversed one), field
 * visit or opening due in a locked opening makes it "used": it is then refused and should be
 * deactivated. An unlocked opening's due goes with the shop (D59).
 */
export async function deleteShop(
  ctx: AppContext,
  companyId: string,
  shopId: string,
): Promise<void> {
  await requirePermission(ctx, companyId, "shop.manage", { write: true });
  try {
    await ctx.db.$transaction(async (tx) => {
      const shop = await tx.shop.findFirst({ where: { id: shopId, companyId } });
      if (!shop) throw invalid("id", "validation.shop.unknown");
      const [entries, visits] = await Promise.all([
        tx.moneyEntry.count({ where: { shopId } }),
        tx.fieldVisit.count({ where: { shopId } }),
      ]);
      if (entries + visits > 0) throw invalid("id", "validation.shop.inUse");
      const opening = await releaseOpeningLines(tx, companyId, { shopId });
      if (!opening) throw invalid("id", "validation.shop.inUse");
      await tx.shop.delete({ where: { id: shopId } });
      await recordAudit(tx, ctx, {
        companyId,
        action: "shop.delete",
        resourceType: "shop",
        resourceId: shopId,
        before: { ...toShop(shop, null), openingLinesRemoved: opening },
      });
    });
  } catch (error) {
    if (isForeignKeyViolation(error)) throw invalid("id", "validation.shop.inUse");
    throw error;
  }
}

/** Full replace of the shop's fields; a shop with entries is deactivated, never deleted. */
export async function updateShop(
  ctx: AppContext,
  companyId: string,
  shopId: string,
  input: unknown,
  requestKey?: string,
): Promise<Shop> {
  await requirePermission(ctx, companyId, "shop.manage", { write: true });
  const data = parseInput(shopUpsertRequestSchema, input);
  try {
    return await runIdempotent(
      ctx,
      { scope: companyId, action: `shop.update:${shopId}`, requestKey },
      data,
      async (tx) => {
        const before = await tx.shop.findFirst({ where: { id: shopId, companyId } });
        if (!before) throw invalid("id", "validation.shop.unknown");
        const row = await tx.shop.update({ where: { id: shopId }, data });
        const shop = toShop(row, null);
        await recordAudit(tx, ctx, {
          companyId,
          action: "shop.update",
          resourceType: "shop",
          resourceId: shopId,
          before: toShop(before, null),
          after: shop,
        });
        return shop;
      },
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw duplicateName();
    throw error;
  }
}

/** One shop's due over [from, to] (default: this month to today), with a running balance. */
export async function getShopStatement(
  ctx: AppContext,
  companyId: string,
  shopId: string,
  query: { from?: unknown; to?: unknown },
): Promise<ShopStatement> {
  const access = await loadCompanyAccess(ctx, companyId);
  if (!access.permissions.includes("sale.view")) throw new AppError("FORBIDDEN");
  const today = todayBusinessDate();
  const to = query.to ? businessDate(query.to, "to") : today;
  const from = query.from ? businessDate(query.from, "from") : `${to.slice(0, 7)}-01`;
  if (from > to) throw invalid("from", "validation.period.endBeforeStart");
  const shop = await ctx.db.shop.findFirst({ where: { id: shopId, companyId } });
  if (!shop) throw invalid("id", "validation.shop.unknown");

  const run = await rangeRun(ctx.db, access, from, to);
  const totals = run?.output.month.marketDue.byShop.find((s) => s.shopId === shopId);
  const entries = (run?.output.shopEntries ?? []).filter((e) => e.shopId === shopId);
  const staffIds = [...new Set(entries.flatMap((e) => (e.staffId ? [e.staffId] : [])))];
  const staff = staffIds.length
    ? await ctx.db.staff.findMany({
        where: { id: { in: staffIds }, tenantId: ctx.actor.tenantId },
        select: { id: true, name: true },
      })
    : [];
  const names = new Map(staff.map((s) => [s.id, s.name]));

  return shopStatementSchema.parse({
    shopId,
    from: run?.from ?? from,
    to,
    opening: totals?.opening ?? "0",
    added: totals?.added ?? "0",
    collected: totals?.collected ?? "0",
    closing: totals?.closing ?? "0",
    lines: entries.map((e) => ({
      entryId: e.ref ?? "",
      date: e.date,
      kind: e.kind,
      amount: e.amount,
      staffId: e.staffId ?? null,
      staffName: e.staffId ? (names.get(e.staffId) ?? null) : null,
      balance: e.balance,
    })),
  });
}
