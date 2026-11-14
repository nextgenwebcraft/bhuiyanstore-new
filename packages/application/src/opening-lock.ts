import type { AppContext, Tx } from "./context";

type Db = AppContext["db"] | Tx;

/** D43: the opening is locked once the company's first month is closed. */
export async function isLocked(db: Db, companyId: string): Promise<boolean> {
  return (await db.monthClose.findFirst({ where: { companyId }, select: { id: true } })) !== null;
}

/**
 * Deleting an unused product, person or shop (D51) also removes its opening lines while this
 * company's opening is still editable (D43, D59). Once it is locked, or when the person has lines
 * in another company's opening, the lines count as use. Returns false when they must stay, and
 * the number of removed lines otherwise (for the audit).
 */
export async function releaseOpeningLines(
  tx: Tx,
  companyId: string,
  party: { productId: string } | { staffId: string } | { shopId: string },
): Promise<{ stock: number; balances: number } | false> {
  const stockWhere = "productId" in party ? { productId: party.productId } : null;
  const balanceWhere =
    "staffId" in party
      ? { staffId: party.staffId }
      : "shopId" in party
        ? { shopId: party.shopId }
        : null;
  const [stock, balances, elsewhere] = await Promise.all([
    stockWhere ? tx.openingStockLine.count({ where: stockWhere }) : 0,
    balanceWhere ? tx.openingBalanceLine.count({ where: balanceWhere }) : 0,
    balanceWhere
      ? tx.openingBalanceLine.count({
          where: { ...balanceWhere, session: { companyId: { not: companyId } } },
        })
      : 0,
  ]);
  if (stock + balances === 0) return { stock: 0, balances: 0 };
  if (elsewhere > 0 || (await isLocked(tx, companyId))) return false;
  if (stockWhere) await tx.openingStockLine.deleteMany({ where: stockWhere });
  if (balanceWhere) await tx.openingBalanceLine.deleteMany({ where: balanceWhere });
  return { stock, balances };
}

/**
 * D110: deleting a person from the master panel releases their opening lines in every company.
 * A locked opening in any of those companies keeps the person (the lines are part of a closed month).
 */
export async function releaseStaffOpenings(
  tx: Tx,
  staffId: string,
): Promise<{ stock: number; balances: number } | false> {
  const lines = await tx.openingBalanceLine.findMany({
    where: { staffId },
    select: { session: { select: { companyId: true } } },
  });
  const companyIds = [...new Set(lines.map((line) => line.session.companyId))];
  if (companyIds.length > 0) {
    const locked = await tx.monthClose.findFirst({
      where: { companyId: { in: companyIds } },
      select: { id: true },
    });
    if (locked) return false;
  }
  if (lines.length === 0) return { stock: 0, balances: 0 };
  await tx.openingBalanceLine.deleteMany({ where: { staffId } });
  return { stock: 0, balances: lines.length };
}
