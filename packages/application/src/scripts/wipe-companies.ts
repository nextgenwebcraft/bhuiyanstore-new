import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { createDatabase } from "@bsd/database";

/**
 * One-time cleanup (owner 2026-10-28): keeps exactly one real company and the hidden master
 * company, deletes every other company and all of its data, and removes every sample (নমুনা)
 * staff/shop tenant-wide. Dry run by default (counts only); `--apply` deletes.
 *
 *   pnpm --filter @bsd/application exec tsx src/scripts/wipe-companies.ts [-- --apply]
 */
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)), quiet: true });

const KEEP_COMPANY_ID = "cmvml8dbz000008jjwlffqlye";
const apply = process.argv.slice(2).includes("--apply");
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DIRECT_URL or DATABASE_URL is not set");
const db = createDatabase(url);

try {
  const toDelete = await db.company.findMany({
    where: { isMaster: false, id: { not: KEEP_COMPANY_ID } },
    select: { id: true, name: true },
  });
  const companyIds = toDelete.map((c) => c.id);
  const sampleStaff = await db.staff.findMany({
    where: { name: { startsWith: "নমুনা" } },
    select: { id: true, name: true },
  });
  const sampleShops = await db.shop.findMany({
    where: { name: { startsWith: "নমুনা" }, companyId: { not: { in: companyIds } } },
    select: { id: true, name: true, companyId: true },
  });

  const lines = [apply ? "APPLIED" : "DRY RUN"];
  lines.push(`companies to delete (${toDelete.length}):`);
  for (const c of toDelete) lines.push(`  ${c.id}  ${c.name}`);
  lines.push(`sample staff to delete (${sampleStaff.length}):`);
  for (const s of sampleStaff) lines.push(`  ${s.id}  ${s.name}`);
  lines.push(`sample shops outside a deleted company to delete (${sampleShops.length}):`);
  for (const s of sampleShops) lines.push(`  ${s.id}  ${s.name}  companyId=${s.companyId}`);

  if (apply) {
    const where = { companyId: { in: companyIds } };
    await db.$transaction(
      async (tx) => {
        await tx.moneyEntry.deleteMany({ where });
        await tx.damageEvent.deleteMany({ where });
        await tx.damageCase.deleteMany({ where });
        await tx.payrollRun.deleteMany({ where });
        await tx.stockEntry.deleteMany({ where });
        await tx.dsrDay.deleteMany({ where });
        await tx.fieldVisit.deleteMany({ where });
        await tx.fieldDayReport.deleteMany({ where });
        await tx.openingSession.deleteMany({ where });
        await tx.productBatch.deleteMany({ where });
        await tx.product.deleteMany({ where });
        await tx.shop.deleteMany({ where });
        await tx.supplier.deleteMany({ where });
        await tx.staffAssignment.deleteMany({ where });
        await tx.monthClose.deleteMany({ where });
        await tx.company.deleteMany({ where: { id: { in: companyIds } } });
        // Sample staff/shops: delete after the company wipe so a sample shop/staff that belonged
        // to a deleted company is already gone with it (cascade), leaving only survivors to name.
        // A kept company's own (unlocked) opening can still carry an opening-balance line for one
        // of these; drop that line first so the Restrict on shop_id/staff_id doesn't block it.
        const sampleStaffIds = (
          await tx.staff.findMany({
            where: { name: { startsWith: "নমুনা" } },
            select: { id: true },
          })
        ).map((s) => s.id);
        const sampleShopIds = (
          await tx.shop.findMany({ where: { name: { startsWith: "নমুনা" } }, select: { id: true } })
        ).map((s) => s.id);
        await tx.openingBalanceLine.deleteMany({
          where: { OR: [{ staffId: { in: sampleStaffIds } }, { shopId: { in: sampleShopIds } }] },
        });
        await tx.staff.deleteMany({ where: { id: { in: sampleStaffIds } } });
        await tx.shop.deleteMany({ where: { id: { in: sampleShopIds } } });
      },
      { timeout: 120_000 },
    );
    lines.push("Done.");
  } else {
    lines.push("Re-run with --apply to delete.");
  }
  process.stdout.write(`${lines.join("\n")}\n`);
} finally {
  await db.$disconnect();
}
