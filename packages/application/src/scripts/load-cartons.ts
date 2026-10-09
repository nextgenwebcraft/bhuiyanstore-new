import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createDatabase } from "@bsd/database";
import { readCartonSizes } from "@bsd/importer";
import { todayInDhaka } from "../dates";
import { addProductPack, packOn, updateProduct } from "../products";

/**
 * D37: one-time load of carton sizes from a month sheet into existing products (local only; the
 * workbook is never copied). Dry run by default; `--apply` writes only changed sizes through the
 * product services, so every change is validated and audited.
 *
 *   pnpm db:load-cartons -- --company <id> [--file "docs/Drinko 2026 Oct.xlsx"] [--sheet "Oct 2026"] [--apply]
 */
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)), quiet: true });

const args = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const companyId = arg("company");
const file = fileURLToPath(
  new URL(`../../../../${arg("file") ?? "docs/Drinko 2026 Oct.xlsx"}`, import.meta.url),
);
const sheet = arg("sheet") ?? "Oct 2026";
const apply = args.includes("--apply");
if (!companyId) throw new Error("--company <id> is required");

const key = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error("DIRECT_URL or DATABASE_URL is not set");
const db = createDatabase(url);

try {
  const company = await db.company.findUnique({ where: { id: companyId } });
  if (!company) throw new Error(`company not found: ${companyId}`);
  const admin = await db.user.findFirst({
    where: { tenantId: company.tenantId, isSuperAdmin: true, active: true },
  });
  if (!admin) throw new Error("no active super-admin in the company's tenant");
  const ctx = {
    db,
    actor: {
      userId: admin.id,
      tenantId: company.tenantId,
      isSuperAdmin: true,
      mustChangePassword: false,
    },
    requestId: `load-cartons-${randomUUID()}`,
  };

  const rows = await readCartonSizes(file, sheet);
  const products = await db.product.findMany({ where: { companyId }, include: { packs: true } });
  const byName = new Map<string, (typeof products)[number]>();
  for (const p of products) {
    for (const name of [p.name, ...p.aliases]) byName.set(key(name), p);
  }

  const report: Record<string, string[]> = {
    unchanged: [],
    changed: [],
    noSizeInSheet: [],
    conflict: [],
    notInDatabase: [],
    notInSheet: [],
  };
  const matched = new Set<string>();
  const today = todayInDhaka();

  for (const row of rows) {
    const product = byName.get(key(row.name));
    if (!product) {
      report.notInDatabase?.push(`${row.name} (row ${row.row})`);
      continue;
    }
    if (matched.has(product.id)) {
      report.conflict?.push(`${product.name}: appears twice in the sheet (row ${row.row})`);
      continue;
    }
    matched.add(product.id);
    if (!row.size) {
      report.noSizeInSheet?.push(product.name);
      continue;
    }
    if (row.seen.length > 1) {
      report.conflict?.push(`${product.name}: factors ${row.seen.join(", ")} (P04)`);
      continue;
    }
    const current = packOn(product.packs, today)?.piecesPerCarton;
    if (String(current) === row.size) {
      report.unchanged?.push(`${product.name}: ${row.size}`);
      continue;
    }
    report.changed?.push(`${product.name}: ${current ?? "—"} → ${row.size}`);
    if (!apply) continue;
    const hasHistory = product.packs.some((p) => p.effectiveFrom !== null);
    if (hasHistory) {
      await addProductPack(ctx, companyId, product.id, {
        piecesPerCarton: row.size,
        effectiveFrom: today,
      });
    } else {
      await updateProduct(ctx, companyId, product.id, {
        sku: product.sku,
        name: product.name,
        aliases: product.aliases,
        piecesPerCarton: row.size,
        status: product.status,
      });
    }
  }
  for (const p of products) if (!matched.has(p.id)) report.notInSheet?.push(p.name);

  const lines = [`${apply ? "APPLIED" : "DRY RUN"}: ${sheet}, ${rows.length} sheet products`];
  for (const [group, items] of Object.entries(report)) {
    lines.push(`\n${group} (${items.length})`);
    for (const item of items) lines.push(`  ${item}`);
  }
  if (!apply && report.changed?.length) lines.push("\nRe-run with --apply to write the changes.");
  process.stdout.write(`${lines.join("\n")}\n`);
} finally {
  await db.$disconnect();
}
