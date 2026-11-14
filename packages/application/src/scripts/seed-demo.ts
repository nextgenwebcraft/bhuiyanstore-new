import { Decimal, toDecimal, todayBusinessDate } from "@bsd/domain";
import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDatabase } from "@bsd/database";
import { openingBalanceSections, sectionOfBalanceKind, workspaceModuleIds } from "@bsd/contracts";
import { readMonthSheetFile } from "@bsd/importer";
import { createCompany } from "../companies";
import { cashAccounts, expenseCategories, staffRoles } from "../configuration";
import type { AppContext } from "../context";
import { getDayView, postDsrDay, postMoneyEntry, postStockEntries, saveDsrDay } from "../daily";
import { createDamageCase } from "../damage";
import { ensureMasterCompany } from "../master";
import { getOpening, saveOpeningCutoff, saveOpeningSection } from "../opening";
import { createProduct } from "../products";
import { createShop } from "../shops";
import { createStaff } from "../staff";
import { demoSheet } from "./demo-sheet";
import { addDays, buildSeedPlan, summarizePlan, type SeedPlan } from "./seed-demo-plan";

/**
 * D45: local-only demo company filled from a month sheet, so every screen has data to look at and
 * edit. The workbook is read at runtime and never copied; without it the made-up `demoSheet` is
 * used; every write goes through the application
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

const read = existsSync(file) ? await readMonthSheetFile(file, sheet) : demoSheet();
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
  const runId = randomUUID();
  const ctx: AppContext = {
    db,
    actor: { userId: admin.id, tenantId, isSuperAdmin: true },
    requestId: `seed-demo-${runId}`,
  };
  // One counter per step name gives every write the key "seed-demo-<run>-<step>-<n>". A run is
  // never retried (the name check above refuses it), so keys must not replay an earlier run's.
  const counters = new Map<string, number>();
  const key = (step: string): string => {
    const n = (counters.get(step) ?? 0) + 1;
    counters.set(step, n);
    return `seed-demo-${runId}-${step}-${n}`;
  };

  // ---- company and tenant-wide lists (reused by name when they exist)
  const company = await createCompany(
    ctx,
    {
      name: plan.companyName,
      theme: { primary: "#0F766E", primaryForeground: "#FFFFFF" },
      modules: [...workspaceModuleIds],
      blockNegativeStock: false,
      starterData: false,
    },
    key("company"),
  );
  const companyId = company.company.id;
  // D65/D66: DSRs and managers are global staff of the master company; SRs stay company-wise.
  const masterId = await ensureMasterCompany(db, tenantId);
  const roleKindOf = new Map(plan.people.map((p) => [p.key, p.roleKind]));
  const isGlobal = (personKey: string | null) =>
    personKey !== null && roleKindOf.get(personKey) !== "sr";

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
    // A global person an earlier demo company already created is reused by name and role kind.
    const existing = isGlobal(person.key)
      ? await db.staff.findFirst({
          where: {
            tenantId,
            name: person.name,
            status: "active",
            assignments: { some: { companyId: masterId, role: { kind: person.roleKind } } },
          },
          select: { id: true },
        })
      : null;
    if (existing) {
      staffId.set(person.key, existing.id);
      continue;
    }
    const created = await createStaff(
      ctx,
      isGlobal(person.key) ? masterId : companyId,
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
  const toLine = (b: (typeof opening.staff)[number]) => ({
    kind: b.kind,
    staffId: need(staffId, b.personKey, "person"),
    cashAccountId: need(accountId, b.cashAccountName, "cash account"),
    shopId: need(shopId, b.shopKey, "shop"),
    amount: b.amount,
    note: b.note,
  });
  // A cash account is opened by one company only; a later demo company leaves it out.
  const openedElsewhere = new Set(
    (
      await db.openingBalanceLine.findMany({
        where: {
          kind: "cash",
          amount: { not: null },
          cashAccountId: { not: null },
          session: { tenantId, companyId: { not: companyId } },
        },
        select: { cashAccountId: true },
      })
    ).map((l) => l.cashAccountId),
  );
  const cash = opening.cash.filter(
    (b) => !openedElsewhere.has(need(accountId, b.cashAccountName, "cash account")),
  );
  if (cash.length < opening.cash.length) {
    print([
      `${opening.cash.length - cash.length} cash opening(s) already opened elsewhere; left out`,
    ]);
  }
  const balances = [
    ...opening.marketDue,
    ...opening.shopDue,
    ...opening.staff.filter((b) => !isGlobal(b.personKey)),
    ...opening.company,
    ...cash,
  ].map(toLine);
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
  // The master's opening: the same cutoff and the global staff's balances (D66).
  const masterOpening = await getOpening(ctx, masterId);
  if (!masterOpening.cutoffDate) {
    const master = await saveOpeningCutoff(
      ctx,
      masterId,
      { version: masterOpening.version, cutoffDate: plan.cutoff },
      key("master-cutoff"),
    );
    await saveOpeningSection(
      ctx,
      masterId,
      {
        section: "staff",
        version: master.version,
        balances: opening.staff.filter((b) => isGlobal(b.personKey)).map(toLine),
      },
      key("master-staff"),
    );
  }

  // ---- the two replayed days: godown, DSR sheets, money entries, damage case
  // D68: an order names its sale price (the product's current one); a receipt fills the open
  // batches oldest first, never beyond what is due on them; a DSR line takes the oldest batch in
  // stock.
  const salePrice = new Map(
    opening.stock.map((s) => [need(productId, s.productKey, "product"), s.salePrice ?? "0"]),
  );
  let skippedReceipt = 0;
  for (const day of plan.days) {
    for (const p of day.prices) {
      if (p.kind === "sale") salePrice.set(need(productId, p.productKey, "product") ?? "", p.price);
    }
    const stockLine = (l: (typeof day.stock)[number]) => {
      const id = need(productId, l.productKey, "product") ?? "";
      return {
        kind: l.kind,
        productId: id,
        pieces: l.pieces,
        ...(l.cartonRate === undefined ? {} : { cartonRate: l.cartonRate }),
        ...(l.kind === "order" ? { salePrice: salePrice.get(id) ?? "0" } : {}),
      };
    };
    const others = day.stock.filter((l) => l.kind !== "receipt").map(stockLine);
    if (others.length || day.prices.length) {
      await postStockEntries(
        ctx,
        companyId,
        {
          date: day.date,
          lines: others,
          prices: day.prices.map((p) => ({
            productId: need(productId, p.productKey, "product"),
            kind: p.kind,
            price: p.price,
          })),
        },
        key("stock"),
      );
    }
    const receipts = day.stock.filter((l) => l.kind === "receipt").map(stockLine);
    if (receipts.length) {
      const view = await getDayView(ctx, companyId, day.date);
      const lines = receipts.flatMap((r) => {
        const lots = view.products.find((p) => p.productId === r.productId)?.lots ?? [];
        let left = toDecimal(r.pieces);
        const out = [];
        for (const lot of lots) {
          const take = Decimal.min(left, toDecimal(lot.undelivered));
          if (take.lte(0)) continue;
          out.push({ ...r, pieces: take.toString(), batchId: lot.id });
          left = left.sub(take);
        }
        if (left.gt(0)) skippedReceipt += 1;
        return out;
      });
      if (lines.length) {
        await postStockEntries(ctx, companyId, { date: day.date, lines }, key("receipt"));
      }
    }
    const stockView = day.dsrSheets.length ? await getDayView(ctx, companyId, day.date) : null;
    const oldestBatch = (id: string) =>
      stockView?.products
        .find((p) => p.productId === id)
        ?.batches.find((b) => toDecimal(b.quantity).gt(0))?.key ?? "";
    for (const sheet of day.dsrSheets) {
      const draft = await saveDsrDay(
        ctx,
        companyId,
        {
          date: day.date,
          staffId: need(staffId, sheet.dsrKey, "DSR"),
          version: 0,
          cashHandedOver: null,
          lines: sheet.lines.map((l) => {
            const id = need(productId, l.productKey, "product") ?? "";
            const dsr = need(staffId, sheet.dsrKey, "DSR") ?? "";
            return {
              productId: id,
              dsrStaffId: dsr,
              issued: l.issued,
              returned: l.returned,
              damaged: l.damaged,
              commission: l.commission,
              batchKey: oldestBatch(id),
            };
          }),
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
  if (skippedReceipt) {
    print([
      `${skippedReceipt} receipt line(s) brought more than was ordered; the excess was left out`,
    ]);
  }
  return companyId;
}
