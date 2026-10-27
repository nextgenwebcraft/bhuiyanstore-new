import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { createDatabase } from "@bsd/database";

/**
 * One-time cleanup: deletes every staff-tied money entry (advance, loan, shortage, salary,
 * absent fee, recovery, …), every staff opening-balance line, and every payroll run/line,
 * tenant-wide — so every staff member's salary and dena-pauna read zero. Dry run by default;
 * `--apply` deletes.
 *
 *   pnpm db:zero-staff-balances [-- --apply]
 */
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)), quiet: true });

const apply = process.argv.slice(2).includes("--apply");
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DIRECT_URL or DATABASE_URL is not set");
const db = createDatabase(url);

try {
  const [moneyCount, openingCount, payrollLineCount, payrollRunCount] = await Promise.all([
    db.moneyEntry.count({ where: { staffId: { not: null } } }),
    db.openingBalanceLine.count({ where: { staffId: { not: null } } }),
    db.payrollLine.count(),
    db.payrollRun.count(),
  ]);
  const lines = [
    apply ? "APPLIED" : "DRY RUN",
    `money_entry (staff-tied): ${moneyCount}`,
    `opening_balance_line (staff-tied): ${openingCount}`,
    `payroll_line: ${payrollLineCount}`,
    `payroll_run: ${payrollRunCount}`,
  ];
  if (apply) {
    await db.$transaction(async (tx) => {
      await tx.moneyEntry.deleteMany({ where: { staffId: { not: null } } });
      await tx.payrollRun.deleteMany({});
      await tx.openingBalanceLine.deleteMany({ where: { staffId: { not: null } } });
    });
    lines.push("Done: every staff salary/dena-pauna entry, opening line and payroll run deleted.");
  } else {
    lines.push("Re-run with --apply to delete.");
  }
  process.stdout.write(`${lines.join("\n")}\n`);
} finally {
  await db.$disconnect();
}
