import type { AppContext, Tx } from "./context";

/**
 * D66: each tenant has one hidden master company (`company.is_master`) for tenant-level records:
 * global staff assignments, non-DSR staff money, payroll and its own opening.
 */

type Db = AppContext["db"] | Tx;

export const MASTER_COMPANY_NAME = "মাস্টার প্যানেল";

export async function masterCompanyId(db: Db, tenantId: string): Promise<string | null> {
  const master = await db.company.findFirst({
    where: { tenantId, isMaster: true },
    select: { id: true },
  });
  return master?.id ?? null;
}

/** The tenant's master company, created on first use (all modules, the first legal entity). */
export async function ensureMasterCompany(db: Db, tenantId: string): Promise<string> {
  const existing = await masterCompanyId(db, tenantId);
  if (existing) return existing;
  const legalEntity = await db.legalEntity.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!legalEntity) throw new Error("master: the tenant has no legal entity");
  const company = await db.company.create({
    data: {
      tenantId,
      legalEntityId: legalEntity.id,
      name: MASTER_COMPANY_NAME,
      isMaster: true,
      themePrimary: "#1f2937",
      themePrimaryForeground: "#ffffff",
      modules: {
        create: ["finance", "dsrStaff", "srAccounts", "reports"].map((module) => ({ module })),
      },
    },
    select: { id: true },
  });
  return company.id;
}

/**
 * The companies whose staff assignments count in `companyId` (D65): its own (SRs) and the
 * master's (DSRs, managers and other distributor staff). The master itself sees only its own.
 */
export async function staffCompanyIds(db: Db, companyId: string): Promise<string[]> {
  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { tenantId: true, isMaster: true },
  });
  if (!company || company.isMaster) return [companyId];
  const master = await masterCompanyId(db, company.tenantId);
  return master ? [companyId, master] : [companyId];
}
