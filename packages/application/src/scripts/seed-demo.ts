import { todayBusinessDate } from "@bsd/domain";
import { config } from "dotenv";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "@bsd/database";
import { openingBalanceSections, sectionOfBalanceKind, workspaceModuleIds } from "@bsd/contracts";
import { readMonthSheetFile } from "@bsd/importer";
import { createCompany } from "../companies";
import { cashAccounts, expenseCategories, staffRoles } from "../configuration";
import type { AppContext } from "../context";
import { postDsrDay, postMoneyEntry, postStockEntries, saveDsrDay } from "../daily";
import { createDamageCase } from "../damage";
import { getOpening, saveOpeningCutoff, saveOpeningSection } from "../opening";
import { createProduct } from "../products";
import { createShop } from "../shops";
import { createStaff } from "../staff";
import { addDays, buildSeedPlan, summarizePlan, type SeedPlan } from "./seed-demo-plan";

/**
 * D45: local-only demo company filled from a month sheet, so every screen has data to look at and
 * edit. The workbook is read at runtime and never copied; every write goes through the application
 * services (validated, audited, idempotent). `--dry-run` builds the plan and prints counts only.
 *
 *   pnpm db:seed-demo -- [--dry-run] [--file "docs/Drinko 2026.xlsx"] [--sheet "Aug 2026"]
 *                        [--company-name "Drinko (ডেমো)"] [--cutoff 2026-10-01]
 *
 * Needs an existing super-admin (`pnpm db:bootstrap-admin`). Refuses to run when the company name
 * already exists, so a demo company is never half re-seeded.
 */
const root = fileURLToPath(new URL("../../../../", import.meta.url));
config({ path: resolve(root, ".env"), quiet: true });

const args = process.argv.slice(2);
const arg = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const dryRun = args.includes("--dry-run");
const file = resolve(root, arg("file") ?? "docs/Drinko 2026.xlsx");
const sheet = arg("sheet") ?? "Aug 2026";
const companyName = arg("company-name") ?? "Drinko (ডেমো)";
const cutoff = arg("cutoff") ?? "2026-10-01";

const today = todayBusinessDate();
if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) throw new Error("--cutoff must be YYYY-MM-DD");
if (addDays(cutoff, 1) > today) {
  throw new Error(`--cutoff ${cutoff}: the cutoff and the day after it must not be after ${today}`);
}

const read = await readMonthSheetFile(file, sheet);
const plan = buildSeedPlan(read, { companyName, cutoff });
const print = (lines: string[]) => process.stdout.write(`${lines.join("\n")}\n`);

if (dryRun) {
  print(["DRY RUN (nothing written)", ...summarizePlan(plan)]);
} else {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DIRECT_URL or DATABASE_URL is not set");
  const db = createDatabase(url);
  try {
    const companyId = await seed(db, plan);
    print(["SEEDED", `company id: ${companyId}`, ...summarizePlan(plan)]);
  } finally {
    await db.$disconnect();
  }
}

async function seed(db: ReturnType<typeof createDatabase>, plan: SeedPlan): Promise<string> {
  const admin = await db.user.findFirst({ where: { isSuperAdmin: true, active: true } });
  if (!admin?.tenantId)
    throw new Error("no active super-admin: run `pnpm db:bootstrap-admin` first");
  const tenantId = admin.tenantId;
  if (await db.company.findFirst({ where: { tenantId, name: plan.companyName } })) {
    throw new Error(`company "${plan.companyName}" already exists; nothing was changed`);
  }
  const ctx: AppContext = {
    db,
    actor: { userId: admin.id, tenantId, isSuperAdmin: true, mustChangePassword: false },
    requestId: `seed-demo-${randomUUID()}`,
  };
  // One counter per step name gives every write the key "seed-demo-<step>-<n>".
  const counters = new Map<string, number>();
  const key = (step: string): string => {
    const n = (counters.get(step) ?? 0) + 1;
    counters.set(step, n);
    return `seed-demo-${step}-${n}`;
  };

  // ---- company and tenant-wide lists (reused by name when they exist)
  const nameHash = createHash("sha1").update(plan.companyName).digest("hex").slice(0, 8);
  const company = await createCompany(
    ctx,
    {
      name: plan.companyName,
      theme: { primary: "#0F766E", primaryForeground: "#FFFFFF" },
      modules: [...workspaceModuleIds],
      blockNegativeStock: false,
      starterData: false,
    },
    `seed-demo-company-${nameHash}`,
  );
  const companyId = company.company.id;

  const categoryId = new Map<string, string>();
  const existingCategories = await expenseCategories.list(ctx);
  for (const name of plan.expenseCategories) {
    const found = existingCategories.find((c) => c.name === name);
    categoryId.set(
      name,
      found?.id ??
        (await expenseCategories.create(ctx, { name, active: true }, key("category"))).id,
    );
  }
  const accountId = new Map<string, string>();
  const existingAccounts = await cashAccounts.list(ctx);
  for (const account of plan.cashAccounts) {
    const found = existingAccounts.find((a) => a.name === account.name);
    accountId.set(
      account.name,
      found?.id ??
        (
          await cashAccounts.create(
            ctx,
            { name: account.name, kind: account.kind, active: true },
            key("account"),
          )
        ).id,
    );
  }
  const roleName = { dsr: "ডিএসআর", sr: "এসআর", general: "ম্যানেজার" } as const;
  const roleId = new Map<string, string>();
  const existingRoles = await staffRoles.list(ctx);
  for (const kind of ["dsr", "sr", "general"] as const) {
    const found =
      existingRoles.find((r) => r.kind === kind && r.name === roleName[kind] && r.active) ??
      existingRoles.find((r) => r.kind === kind && r.active);
    roleId.set(
      kind,
      found?.id ??
        (await staffRoles.create(ctx, { name: roleName[kind], kind, active: true }, key("role")))
          .id,
    );
  }

  // ---- masters
  const productId = new Map<string, string>();
  for (const p of plan.products) {
    const created = await createProduct(
      ctx,
      companyId,
      {
        sku: p.sku,
        name: p.name,
        aliases: [],
        baseUnit: "piece",
        piecesPerCarton: p.piecesPerCarton,
        status: "active",
      },
      key("product"),
    );
    productId.set(p.key, created.id);
  }
  const staffId = new Map<string, string>();
  for (const person of plan.people) {
    const created = await createStaff(
      ctx,
      companyId,
      {
        name: person.name,
        employer: person.employer,
        status: "active",
        assignment: {
          roleId: roleId.get(person.roleKind),
          from: person.from,
          to: null,
          monthlySalary: person.monthlySalary,
        },
      },
      key("staff"),
    );
    staffId.set(person.key, created.id);
  }
  const shopId = new Map<string, string>();
  for (const shop of plan.shops) {
    const created = await createShop(
      ctx,
      companyId,
      { name: shop.name, area: shop.area, dueLimit: shop.dueLimit },
      key("shop"),
    );
    shopId.set(shop.key, created.id);
  }
  const need = (map: Map<string, string>, k: string | null, what: string): string | null => {
    if (k === null) return null;
    const id = map.get(k);
    if (!id) throw new Error(`plan references an unknown ${what}`);
    return id;
  };

  // ---- opening: cutoff, stock, then each balance section (call order as in saveWholeOpening)
  const { opening } = plan;
  let view = await saveOpeningCutoff(
    ctx,
    companyId,
    { version: (await getOpening(ctx, companyId)).version, cutoffDate: plan.cutoff },
    key("opening-cutoff"),
  );
  view = await saveOpeningSection(
    ctx,
    companyId,
    {
      section: "stock",
      version: view.version,
      stock: opening.stock.map((s) => ({
        productId: need(productId, s.productKey, "product"),
        pieces: s.pieces,
        unitCost: s.unitCost,
        salePrice: s.salePrice,
        orderPrice: s.orderPrice,
        dueFromCompany: s.dueFromCompany,
        note: s.note,
      })),
    },
    key("opening-stock"),
  );
  const balances = [
    ...opening.marketDue,
    ...opening.shopDue,
    ...opening.staff,
    ...opening.company,
    ...opening.cash,
  ].map((b) => ({
    kind: b.kind,
    staffId: need(staffId, b.personKey, "person"),
    cashAccountId: need(accountId, b.cashAccountName, "cash account"),
    shopId: need(shopId, b.shopKey, "shop"),
    amount: b.amount,
    note: b.note,
  }));
  for (const section of openingBalanceSections) {
    view = await saveOpeningSection(
      ctx,
      companyId,
      {
        section,
        version: view.version,
        balances: balances.filter((b) => sectionOfBalanceKind(b.kind) === section),
      },
      key("opening-section"),
    );
  }

  // ---- the two replayed days: godown, DSR sheets, money entries, damage case
  for (const day of plan.days) {
    if (day.stock.length || day.prices.length) {
      await postStockEntries(
        ctx,
        companyId,
        {
          date: day.date,
          lines: day.stock.map((l) => ({
            kind: l.kind,
            productId: need(productId, l.productKey, "product"),
            pieces: l.pieces,
            ...(l.cartonRate === undefined ? {} : { cartonRate: l.cartonRate }),
          })),
          prices: day.prices.map((p) => ({
            productId: need(productId, p.productKey, "product"),
            kind: p.kind,
            price: p.price,
          })),
        },
        key("stock"),
      );
    }
    for (const sheet of day.dsrSheets) {
      const draft = await saveDsrDay(
        ctx,
        companyId,
        {
          date: day.date,
          staffId: need(staffId, sheet.dsrKey, "DSR"),
          version: 0,
          cashHandedOver: null,
          lines: sheet.lines.map((l) => ({
            productId: need(productId, l.productKey, "product"),
            issued: l.issued,
            returned: l.returned,
            damaged: l.damaged,
            commission: l.commission,
          })),
        },
        key("dsr-save"),
      );
      await postDsrDay(ctx, companyId, draft.id, { version: draft.version }, key("dsr-post"));
    }
    for (const m of day.money) {
      await postMoneyEntry(
        ctx,
        companyId,
        {
          date: day.date,
          kind: m.kind,
          amount: m.amount,
          staffId: need(staffId, m.personKey, "person"),
          shopId: need(shopId, m.shopKey, "shop"),
          expenseCategoryId: need(categoryId, m.category, "expense category"),
          srLoanType: m.srLoanType,
        },
        key("money"),
      );
    }
    for (const c of day.damageCases) {
      await createDamageCase(
        ctx,
        companyId,
        {
          date: day.date,
          origin: "buyerExchange",
          staffId: need(staffId, c.dsrKey, "DSR"),
          note: c.note,
          lines: [{ productId: need(productId, c.productKey, "product"), quantity: c.quantity }],
        },
        key("damage"),
      );
    }
  }
  return companyId;
}
