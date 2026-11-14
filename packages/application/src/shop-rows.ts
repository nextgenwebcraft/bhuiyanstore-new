import { shopSchema, type Shop } from "@bsd/contracts";
import type { Prisma } from "@bsd/database";
import { recordAudit } from "./audit";
import type { AppContext, Tx } from "./context";
import { plain } from "./numeric";

/**
 * Shop row mapping and the single insert, kept apart from `shops.ts` so the daily entries (D50)
 * and the starter dataset (D51) can create shops without importing the shop service.
 */

export type ShopRow = Prisma.ShopGetPayload<object>;
export type ShopInsert = Omit<Prisma.ShopUncheckedCreateInput, "tenantId" | "companyId">;

export function toShop(row: ShopRow, due: string | null): Shop {
  return shopSchema.parse({
    id: row.id,
    name: row.name,
    ownerName: row.ownerName,
    phone: row.phone,
    area: row.area,
    address: row.address,
    dueLimit: row.dueLimit === null ? null : plain(row.dueLimit),
    status: row.status,
    due,
  });
}

/**
 * Creates one shop and its `shop.create` audit event inside the caller's transaction. Shared by
 * `createShop` and by the due entry that names a new shop (D50), so both write the same row.
 */
export async function insertShop(
  tx: Tx,
  ctx: AppContext,
  tenantId: string,
  companyId: string,
  data: ShopInsert,
): Promise<Shop> {
  const row = await tx.shop.create({ data: { ...data, tenantId, companyId } });
  const shop = toShop(row, null);
  await recordAudit(tx, ctx, {
    companyId,
    action: "shop.create",
    resourceType: "shop",
    resourceId: shop.id,
    after: shop,
  });
  return shop;
}
