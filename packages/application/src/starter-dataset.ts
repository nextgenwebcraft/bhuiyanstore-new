import { priceKinds, type OpeningBalanceKind } from "@bsd/contracts";
import { todayBusinessDate } from "@bsd/domain";
import { recordAudit } from "./audit";
import type { AppContext, Tx } from "./context";
import { toDbDate } from "./dates";
import { writeSeededOpening, type SeededOpening } from "./opening";

/**
 * D51, D59: the synthetic starter dataset cloned into every new company, and the standard tenant
 * lists. Everything here is invented sample data owned by this file; nothing comes from the
 * workbook. It holds masters plus a complete opening (প্রারম্ভিক তথ্য, go-live = creation day)
 * and no daily record, so every row stays editable and, until used by a daily record, deletable.
 */

/** Note on every seeded opening line, so the owner can tell sample values from entered ones. */
export const STARTER_NOTE = "নমুনা";

/** Opening stock of every starter product, in whole cartons. */
export const STARTER_OPENING_CARTONS = 5;

/** Money we hold with the company at go-live (company_advance) and the cash in hand. */
export const STARTER_COMPANY_ADVANCE = "20000";
export const STARTER_CASH = "10000";

/** Standard expense categories; created in a tenant only when missing by name (also by migration). */
export const STANDARD_EXPENSE_CATEGORIES = [
  "অফিস খরচ",
  "পরিবহন খরচ",
  "লোড আনলোড",
  "বিদ্যুৎ বিল",
  "গ্যারেজ ভাড়া",
  "গোডাউন ভাড়া",
] as const;

/** D72: all money is cash; a tenant has one cash account. */
export const STANDARD_CASH_ACCOUNTS = [{ name: "ক্যাশ", kind: "cash" }] as const;

export const STANDARD_STAFF_ROLES = [
  { name: "ডিএসআর", kind: "dsr" },
  { name: "এসআর", kind: "sr" },
  { name: "ম্যানেজার", kind: "general" },
] as const;

type StarterProduct = {
  sku: string;
  name: string;
  piecesPerCarton: number;
  order: string;
  cost: string;
  sale: string;
};

/** Per-piece prices: order (company bill) <= cost < sale. */
export const STARTER_PRODUCTS: readonly StarterProduct[] = [
  {
    sku: "NMN-001",
    name: "নমুনা কোমল পানীয় ২৫০ মি.লি.",
    piecesPerCarton: 24,
    order: "17",
    cost: "17.5",
    sale: "20",
  },
  {
    sku: "NMN-002",
    name: "নমুনা কোমল পানীয় ৫০০ মি.লি.",
    piecesPerCarton: 24,
    order: "27",
    cost: "27.5",
    sale: "30",
  },
  {
    sku: "NMN-003",
    name: "নমুনা ফলের জুস ২০০ মি.লি.",
    piecesPerCarton: 24,
    order: "22",
    cost: "22.5",
    sale: "25",
  },
  {
    sku: "NMN-004",
    name: "নমুনা খাবার পানি ১ লিটার",
    piecesPerCarton: 12,
    order: "16",
    cost: "16.5",
    sale: "20",
  },
  {
    sku: "NMN-005",
    name: "নমুনা বিস্কুট",
    piecesPerCarton: 48,
    order: "9",
    cost: "9.25",
    sale: "10",
  },
  {
    sku: "NMN-006",
    name: "নমুনা চানাচুর",
    piecesPerCarton: 40,
    order: "11",
    cost: "11.5",
    sale: "15",
  },
  {
    sku: "NMN-007",
    name: "নমুনা নুডলস",
    piecesPerCarton: 36,
    order: "13",
    cost: "13.5",
    sale: "15",
  },
  {
    sku: "NMN-008",
    name: "নমুনা চা পাতা ২০০ গ্রাম",
    piecesPerCarton: 20,
    order: "82",
    cost: "83",
    sale: "90",
  },
];

type StarterPerson = {
  name: string;
  employer: "distributor" | "supplier";
  roleKind: "dsr" | "sr" | "general";
  /** SR assignments carry no salary (D18). */
  monthlySalary: string | null;
  /** The person's opening balance; the kind must suit the role (D18, D27). */
  opening: { kind: OpeningBalanceKind; amount: string };
};

export const STARTER_PEOPLE: readonly StarterPerson[] = [
  {
    name: "নমুনা ডিএসআর ১",
    employer: "distributor",
    roleKind: "dsr",
    monthlySalary: "12000",
    opening: { kind: "advance", amount: "1000" },
  },
  {
    name: "নমুনা ডিএসআর ২",
    employer: "distributor",
    roleKind: "dsr",
    monthlySalary: "12000",
    opening: { kind: "loan", amount: "2000" },
  },
  {
    name: "নমুনা ম্যানেজার",
    employer: "distributor",
    roleKind: "general",
    monthlySalary: "25000",
    opening: { kind: "salary_payable", amount: "0" },
  },
  {
    name: "নমুনা এসআর",
    employer: "supplier",
    roleKind: "sr",
    monthlySalary: null,
    opening: { kind: "sr_loan", amount: "1500" },
  },
];

export const STARTER_SHOPS = [
  { name: "নমুনা দোকান ১", ownerName: "নমুনা মালিক ১", area: "বাজার রোড", openingDue: "1500" },
  { name: "নমুনা দোকান ২", ownerName: "নমুনা মালিক ২", area: "স্টেশন রোড", openingDue: "800" },
  { name: "নমুনা দোকান ৩", ownerName: "নমুনা মালিক ৩", area: "কলেজ গেট", openingDue: "2200" },
  { name: "নমুনা দোকান ৪", ownerName: "নমুনা মালিক ৪", area: "হাসপাতাল রোড", openingDue: "0" },
] as const;

export type StarterSummary = {
  products: number;
  people: number;
  shops: number;
  expenseCategoriesAdded: number;
  cashAccountsAdded: number;
  staffRolesAdded: number;
  opening: { cutoffDate: string; stockLines: number; balanceLines: number; pricesSet: number };
};

type NewCompany = { id: string; tenantId: string; legalEntityId: string; name: string };

/** The cash account the company's opening cash is seeded in. */
export const starterCashAccountName = (companyName: string) => `${companyName} ক্যাশ`;

/**
 * The company's own cash account for the seeded opening cash. Cash and bank accounts belong to the
 * whole distributor and one account opens in one company only, so the seed never claims the
 * shared standard accounts. Null when an account of that name is already opened elsewhere.
 */
async function starterCashAccount(
  tx: Tx,
  company: NewCompany,
): Promise<{ id: string | null; created: boolean }> {
  const name = starterCashAccountName(company.name);
  const existing = await tx.cashAccount.findFirst({
    where: { legalEntityId: company.legalEntityId, name },
  });
  if (!existing) {
    const created = await tx.cashAccount.create({
      data: {
        tenantId: company.tenantId,
        legalEntityId: company.legalEntityId,
        name,
        kind: "cash",
      },
    });
    return { id: created.id, created: true };
  }
  if (!existing.active) return { id: null, created: false };
  const openedElsewhere = await tx.openingBalanceLine.count({
    where: {
      kind: "cash",
      cashAccountId: existing.id,
      amount: { not: null },
      session: { companyId: { not: company.id } },
    },
  });
  return { id: openedElsewhere > 0 ? null : existing.id, created: false };
}

/**
 * Tenant lists first (each name only when missing), then the company's products, people and
 * shops, then the opening with every section filled (D59). Runs in the caller's transaction, so a
 * failure leaves neither company nor sample data.
 *
 * Prices: every starter price is dated the company's creation day (Dhaka) with source `starter`;
 * the seeded opening (go-live = that day) writes the same prices as opening prices, which replace
 * them (`writeOpeningPrices`), exactly as when the owner saves the stock card.
 */
export async function applyStarterDataset(
  tx: Tx,
  ctx: AppContext,
  company: NewCompany,
): Promise<StarterSummary> {
  const tenantId = company.tenantId;
  const cutoffDate = todayBusinessDate();
  const today = toDbDate(cutoffDate);

  const categories = await tx.expenseCategory.createMany({
    data: STANDARD_EXPENSE_CATEGORIES.map((name) => ({ tenantId, name })),
    skipDuplicates: true,
  });
  const accounts = await tx.cashAccount.createMany({
    data: STANDARD_CASH_ACCOUNTS.map((a) => ({
      tenantId,
      legalEntityId: company.legalEntityId,
      name: a.name,
      kind: a.kind,
    })),
    skipDuplicates: true,
  });
  const roles = await tx.staffRole.createMany({
    data: STANDARD_STAFF_ROLES.map((r) => ({ tenantId, name: r.name, kind: r.kind })),
    skipDuplicates: true,
  });

  const activeRoles = await tx.staffRole.findMany({ where: { tenantId, active: true } });
  const roleOf = (kind: StarterPerson["roleKind"]): string => {
    const wanted = STANDARD_STAFF_ROLES.find((r) => r.kind === kind)?.name;
    const found =
      activeRoles.find((r) => r.kind === kind && r.name === wanted) ??
      activeRoles.find((r) => r.kind === kind);
    if (!found) throw new Error(`no active ${kind} staff role for the starter dataset`);
    return found.id;
  };

  const stock: SeededOpening["stock"] = [];
  for (const p of STARTER_PRODUCTS) {
    const product = await tx.product.create({
      data: {
        tenantId,
        companyId: company.id,
        sku: p.sku,
        name: p.name,
        aliases: [],
        packs: { create: { piecesPerCarton: p.piecesPerCarton, effectiveFrom: null } },
        prices: {
          create: priceKinds.map((kind) => ({
            kind,
            price: p[kind],
            effectiveFrom: today,
            source: "starter",
          })),
        },
      },
    });
    stock.push({
      productId: product.id,
      pieces: String(STARTER_OPENING_CARTONS * p.piecesPerCarton),
      unitCost: p.cost,
      salePrice: p.sale,
      orderPrice: p.order,
      dueFromCompany: "0",
      note: STARTER_NOTE,
    });
  }

  const balance = (
    kind: OpeningBalanceKind,
    amount: string,
    party: { staffId?: string; shopId?: string; cashAccountId?: string } = {},
    personRoleKind: StarterPerson["roleKind"] | null = null,
  ): SeededOpening["balances"][number] => ({
    kind,
    staffId: party.staffId ?? null,
    cashAccountId: party.cashAccountId ?? null,
    shopId: party.shopId ?? null,
    amount,
    note: STARTER_NOTE,
    personRoleKind,
  });
  const balances: SeededOpening["balances"] = [];

  for (const person of STARTER_PEOPLE) {
    const staff = await tx.staff.create({
      data: {
        tenantId,
        name: person.name,
        employer: person.employer,
        assignments: {
          create: {
            companyId: company.id,
            roleId: roleOf(person.roleKind),
            from: today,
            to: null,
            monthlySalary: person.monthlySalary,
          },
        },
      },
    });
    balances.push(
      balance(person.opening.kind, person.opening.amount, { staffId: staff.id }, person.roleKind),
    );
    // Shop dues carry the market due (D38); each DSR's own bucket opens at zero.
    if (person.roleKind === "dsr") {
      balances.push(balance("market_due", "0", { staffId: staff.id }, person.roleKind));
    }
  }
  for (const s of STARTER_SHOPS) {
    const { openingDue, ...data } = s;
    const shop = await tx.shop.create({ data: { ...data, tenantId, companyId: company.id } });
    balances.push(balance("shop_due", openingDue, { shopId: shop.id }));
  }
  balances.push(balance("company_advance", STARTER_COMPANY_ADVANCE));
  const cash = await starterCashAccount(tx, company);
  if (cash.id) balances.push(balance("cash", STARTER_CASH, { cashAccountId: cash.id }));

  const opening = await writeSeededOpening(tx, company, { cutoffDate, stock, balances });

  const summary: StarterSummary = {
    products: STARTER_PRODUCTS.length,
    people: STARTER_PEOPLE.length,
    shops: STARTER_SHOPS.length,
    expenseCategoriesAdded: categories.count,
    cashAccountsAdded: accounts.count + (cash.created ? 1 : 0),
    staffRolesAdded: roles.count,
    opening: {
      cutoffDate,
      stockLines: stock.length,
      balanceLines: balances.length,
      pricesSet: opening.pricesSet,
    },
  };
  await recordAudit(tx, ctx, {
    companyId: company.id,
    action: "company.starter_data",
    resourceType: "company",
    resourceId: company.id,
    after: summary,
  });
  return summary;
}
