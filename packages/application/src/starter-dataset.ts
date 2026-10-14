import { priceKinds } from "@bsd/contracts";
import { todayBusinessDate } from "@bsd/domain";
import { recordAudit } from "./audit";
import type { AppContext, Tx } from "./context";
import { toDbDate } from "./dates";

/**
 * D51: the synthetic starter dataset cloned into every new company, and the standard tenant lists.
 * Everything here is invented sample data owned by this file; nothing comes from the workbook.
 * It holds masters only (no opening, no daily record), so each row stays editable and, until used
 * somewhere, deletable.
 */

/** Standard expense categories; created in a tenant only when missing by name (also by migration). */
export const STANDARD_EXPENSE_CATEGORIES = [
  "অফিস খরচ",
  "পরিবহন খরচ",
  "লোড আনলোড",
  "বিদ্যুৎ বিল",
  "গ্যারেজ ভাড়া",
  "গোডাউন ভাড়া",
] as const;

export const STANDARD_CASH_ACCOUNTS = [
  { name: "ক্যাশ", kind: "cash" },
  { name: "ব্যাংক", kind: "bank" },
] as const;

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
  employer: "distributor";
  roleKind: "dsr" | "general";
  monthlySalary: string;
};

export const STARTER_PEOPLE: readonly StarterPerson[] = [
  { name: "নমুনা ডিএসআর ১", employer: "distributor", roleKind: "dsr", monthlySalary: "12000" },
  { name: "নমুনা ডিএসআর ২", employer: "distributor", roleKind: "dsr", monthlySalary: "12000" },
  { name: "নমুনা ম্যানেজার", employer: "distributor", roleKind: "general", monthlySalary: "25000" },
];

export const STARTER_SHOPS = [
  { name: "নমুনা দোকান ১", ownerName: "নমুনা মালিক ১", area: "বাজার রোড" },
  { name: "নমুনা দোকান ২", ownerName: "নমুনা মালিক ২", area: "স্টেশন রোড" },
  { name: "নমুনা দোকান ৩", ownerName: "নমুনা মালিক ৩", area: "কলেজ গেট" },
  { name: "নমুনা দোকান ৪", ownerName: "নমুনা মালিক ৪", area: "হাসপাতাল রোড" },
] as const;

export type StarterSummary = {
  products: number;
  people: number;
  shops: number;
  expenseCategoriesAdded: number;
  cashAccountsAdded: number;
  staffRolesAdded: number;
};

type NewCompany = { id: string; tenantId: string; legalEntityId: string };

/**
 * Tenant lists first (each name only when missing), then the company's products, people and
 * shops. Runs in the caller's transaction, so a failure leaves neither company nor sample data.
 *
 * Price effective date: every starter price is dated the company's creation day (Dhaka) with
 * source `starter`. The opening's stock section replaces a starter price of the same product and
 * kind whenever it writes its own price (`writeOpeningPrices`), so the owner's opening prices
 * always win, whatever go-live date they pick.
 */
export async function applyStarterDataset(
  tx: Tx,
  ctx: AppContext,
  company: NewCompany,
): Promise<StarterSummary> {
  const tenantId = company.tenantId;
  const today = toDbDate(todayBusinessDate());

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
  const roleOf = (kind: "dsr" | "general"): string => {
    const wanted = STANDARD_STAFF_ROLES.find((r) => r.kind === kind)?.name;
    const found =
      activeRoles.find((r) => r.kind === kind && r.name === wanted) ??
      activeRoles.find((r) => r.kind === kind);
    if (!found) throw new Error(`no active ${kind} staff role for the starter dataset`);
    return found.id;
  };

  for (const p of STARTER_PRODUCTS) {
    await tx.product.create({
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
  }
  for (const person of STARTER_PEOPLE) {
    await tx.staff.create({
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
  }
  await tx.shop.createMany({
    data: STARTER_SHOPS.map((s) => ({ ...s, tenantId, companyId: company.id })),
  });

  const summary: StarterSummary = {
    products: STARTER_PRODUCTS.length,
    people: STARTER_PEOPLE.length,
    shops: STARTER_SHOPS.length,
    expenseCategoriesAdded: categories.count,
    cashAccountsAdded: accounts.count,
    staffRolesAdded: roles.count,
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
