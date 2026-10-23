import {
  monthSchema,
  shareHoldingRequestSchema,
  shareMonthSchema,
  sharePolicyRequestSchema,
  shareYearParamSchema,
  shareYearSchema,
  shareholderCreateRequestSchema,
  shareholderSchema,
  shareholderUpdateRequestSchema,
  type ShareMonth,
  type ShareYear,
  type ShareholderRecord,
} from "@bsd/contracts";
import type { Prisma } from "@bsd/database";
import {
  firstOfMonth,
  lastOfMonth,
  monthOf,
  shareMonth,
  shareYearIncome,
  todayBusinessDate,
  toDecimal,
  type DanBasis,
} from "@bsd/domain";
import { loadCompanyAccess, requireSuperAdmin, requireSuperAdminView } from "./access";
import { recordAudit } from "./audit";
import type { AppContext, Tx } from "./context";
import { dashboardOf } from "./daily";
import { AppError, invalid, parseInput } from "./errors";
import { runIdempotent } from "./idempotency";
import { plain } from "./numeric";

/**
 * The master monthly account (D76). Profit and khoroch are each company's dashboard figures.
 * Shareholders, units and the দান basis are the only facts stored here. Nothing is posted.
 */

async function requireMaster(ctx: AppContext, companyId: string, write = false) {
  if (write) requireSuperAdmin(ctx);
  else requireSuperAdminView(ctx);
  const access = await loadCompanyAccess(ctx, companyId);
  if (!access.company.isMaster) throw new AppError("COMPANY_NOT_FOUND");
  return access;
}

function parseMonth(value: unknown): string {
  const parsed = monthSchema.safeParse(value);
  if (!parsed.success) throw invalid("month", "validation.month.invalid");
  return parsed.data;
}

function monthsThrough(month: string): string[] {
  const year = month.slice(0, 4);
  const end = Number(month.slice(5));
  return Array.from({ length: end }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
}

function unitsOn(holdings: { fromMonth: string; units: Prisma.Decimal }[], month: string): string {
  const row = holdings
    .filter((holding) => holding.fromMonth <= month)
    .sort((a, b) => (a.fromMonth < b.fromMonth ? 1 : -1))[0];
  return row ? plain(row.units) : "0";
}

async function companiesOf(ctx: AppContext) {
  return ctx.db.company.findMany({
    where: { tenantId: ctx.actor.tenantId, isMaster: false, status: "active" },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

async function figuresOf(ctx: AppContext, companyId: string, month: string) {
  const access = await loadCompanyAccess(ctx, companyId);
  const { summary } = await dashboardOf(ctx, access, {
    from: firstOfMonth(month),
    to: lastOfMonth(month),
  });
  return { profit: summary.salesProfit ?? "0", khoroch: summary.profitCost ?? "0" };
}

type Person = Prisma.ShareholderGetPayload<{ include: { holdings: true } }>;

type Statement = ReturnType<typeof shareMonth>;

function shownIn(person: Person, months: readonly Statement[]): boolean {
  return (
    person.active ||
    months.some((item) =>
      toDecimal(
        item.shareholders.find((holder) => holder.shareholderId === person.id)?.units ?? "0",
      ).gt(0),
    )
  );
}

/**
 * January through `throughMonth`. A month after today has no entries, so its profit and khoroch
 * stay zero and the ledger is not run again.
 */
async function statementsOf(ctx: AppContext, throughMonth: string) {
  const [companies, people, policies] = await Promise.all([
    companiesOf(ctx),
    ctx.db.shareholder.findMany({
      where: { tenantId: ctx.actor.tenantId },
      include: { holdings: true },
      orderBy: { name: "asc" },
    }),
    ctx.db.companySharePolicy.findMany({
      where: { company: { tenantId: ctx.actor.tenantId } },
      select: { companyId: true, danBasis: true },
    }),
  ]);
  const basis = new Map(policies.map((policy) => [policy.companyId, policy.danBasis]));
  const basisOf = (id: string): DanBasis => (basis.get(id) === "profit" ? "profit" : "net");
  const today = monthOf(todayBusinessDate());
  const labels = monthsThrough(throughMonth);
  const months = await Promise.all(
    labels.map(async (at) => {
      const figures =
        at > today
          ? companies.map((company) => ({ company, profit: "0", khoroch: "0" }))
          : await Promise.all(
              companies.map(async (company) => ({
                company,
                ...(await figuresOf(ctx, company.id, at)),
              })),
            );
      return shareMonth({
        companies: figures.map((figure) => ({
          companyId: figure.company.id,
          companyName: figure.company.name,
          profit: figure.profit,
          khoroch: figure.khoroch,
          danBasis: basisOf(figure.company.id),
        })),
        shareholders: people.map((person) => ({
          shareholderId: person.id,
          name: person.name,
          units: unitsOn(person.holdings, at),
        })),
      });
    }),
  );
  return { companies, people, labels, months };
}

/** The month's statement, with each person's income from January through that month. */
export async function getShareMonth(
  ctx: AppContext,
  companyId: string,
  monthInput: unknown,
): Promise<ShareMonth> {
  await requireMaster(ctx, companyId);
  const month = parseMonth(monthInput);
  const { people, labels, months } = await statementsOf(ctx, month);
  const selected = months.at(-1);
  if (!selected || labels.at(-1) !== month) throw invalid("month", "validation.month.invalid");
  const year = new Map(shareYearIncome(months).map((row) => [row.shareholderId, row.income]));
  const byId = new Map(people.map((person) => [person.id, person]));
  return shareMonthSchema.parse({
    month,
    companies: selected.companies,
    shareholders: selected.shareholders.flatMap((holder) => {
      const person = byId.get(holder.shareholderId);
      if (!person || !shownIn(person, months)) return [];
      return [
        { ...holder, active: person.active, yearIncome: year.get(holder.shareholderId) ?? "0" },
      ];
    }),
    totals: selected.totals,
  });
}

/**
 * The master page for one year (D77): twelve months, each company's total beside the others,
 * then দান, per unit and each shareholder. Same statement as the monthly account.
 */
export async function getShareYear(
  ctx: AppContext,
  companyId: string,
  yearInput: unknown,
): Promise<ShareYear> {
  await requireMaster(ctx, companyId);
  const parsed = shareYearParamSchema.safeParse(yearInput);
  if (!parsed.success) throw invalid("year", "validation.share.year");
  const year = parsed.data;
  const { companies, people, labels, months } = await statementsOf(ctx, `${year}-12`);
  const visible = people.filter((person) => shownIn(person, months));
  const ids = new Set(visible.map((person) => person.id));
  return shareYearSchema.parse({
    year,
    companies: companies.map((company) => ({ companyId: company.id, companyName: company.name })),
    shareholders: visible.map((person) => ({
      shareholderId: person.id,
      name: person.name,
      active: person.active,
    })),
    months: labels.map((month, index) => {
      const statement = months[index];
      if (!statement) throw invalid("year", "validation.share.year");
      return {
        month,
        companies: statement.companies.map((company) => ({
          companyId: company.companyId,
          total: company.total,
          dan: company.dan,
        })),
        totals: {
          distributable: statement.totals.distributable,
          dan: statement.totals.dan,
          units: statement.totals.units,
          perUnit: statement.totals.perUnit,
        },
        shareholders: statement.shareholders.flatMap((holder) =>
          ids.has(holder.shareholderId)
            ? [{ shareholderId: holder.shareholderId, units: holder.units, income: holder.income }]
            : [],
        ),
      };
    }),
  });
}

async function personOf(db: AppContext["db"] | Tx, tenantId: string, shareholderId: string) {
  const person = await db.shareholder.findFirst({
    where: { id: shareholderId, tenantId },
  });
  if (!person) throw invalid("shareholderId", "validation.share.unknown");
  return person;
}

function recordOf(person: { id: string; name: string; active: boolean }): ShareholderRecord {
  return shareholderSchema.parse(person);
}

/** Adds a shareholder with no units yet. */
export async function createShareholder(
  ctx: AppContext,
  companyId: string,
  input: unknown,
  requestKey?: string,
): Promise<ShareholderRecord> {
  await requireMaster(ctx, companyId, true);
  const request = parseInput(shareholderCreateRequestSchema, input);
  return runIdempotent(
    ctx,
    { scope: companyId, action: "shareholder.create", requestKey },
    request,
    async (tx) => {
      const existing = await tx.shareholder.findFirst({
        where: { tenantId: ctx.actor.tenantId, name: request.name },
        select: { id: true },
      });
      if (existing) throw invalid("name", "validation.share.duplicateName");
      const created = await tx.shareholder.create({
        data: { tenantId: ctx.actor.tenantId, name: request.name },
      });
      await recordAudit(tx, ctx, {
        companyId,
        action: "shareholder.create",
        resourceType: "shareholder",
        resourceId: created.id,
        after: { name: created.name },
      });
      return recordOf(created);
    },
  );
}

/** Renames a shareholder or marks them inactive. Past months keep their units. */
export async function updateShareholder(
  ctx: AppContext,
  companyId: string,
  shareholderId: string,
  input: unknown,
  requestKey?: string,
): Promise<ShareholderRecord> {
  await requireMaster(ctx, companyId, true);
  const request = parseInput(shareholderUpdateRequestSchema, input);
  return runIdempotent(
    ctx,
    { scope: companyId, action: `shareholder.update:${shareholderId}`, requestKey },
    request,
    async (tx) => {
      const person = await personOf(tx, ctx.actor.tenantId, shareholderId);
      const clash = await tx.shareholder.findFirst({
        where: { tenantId: ctx.actor.tenantId, name: request.name, id: { not: person.id } },
        select: { id: true },
      });
      if (clash) throw invalid("name", "validation.share.duplicateName");
      const updated = await tx.shareholder.update({
        where: { id: person.id },
        data: { name: request.name, active: request.active },
      });
      await recordAudit(tx, ctx, {
        companyId,
        action: "shareholder.update",
        resourceType: "shareholder",
        resourceId: person.id,
        before: { name: person.name, active: person.active },
        after: { name: updated.name, active: updated.active },
      });
      return recordOf(updated);
    },
  );
}

/** Sets the units in force from a month. Earlier months are left as they were. */
export async function saveShareHolding(
  ctx: AppContext,
  companyId: string,
  shareholderId: string,
  input: unknown,
  requestKey?: string,
): Promise<ShareholderRecord> {
  await requireMaster(ctx, companyId, true);
  const request = parseInput(shareHoldingRequestSchema, input);
  return runIdempotent(
    ctx,
    { scope: companyId, action: `shareholder.holding:${shareholderId}`, requestKey },
    request,
    async (tx) => {
      const person = await personOf(tx, ctx.actor.tenantId, shareholderId);
      await tx.shareholderHolding.upsert({
        where: {
          shareholderId_fromMonth: { shareholderId: person.id, fromMonth: request.fromMonth },
        },
        create: { shareholderId: person.id, fromMonth: request.fromMonth, units: request.units },
        update: { units: request.units },
      });
      await recordAudit(tx, ctx, {
        companyId,
        action: "shareholder.holding",
        resourceType: "shareholder",
        resourceId: person.id,
        after: request,
      });
      return recordOf(person);
    },
  );
}

/** Sets whether a company's দান is 2% of the net or 2% of the profit. */
export async function saveSharePolicy(
  ctx: AppContext,
  companyId: string,
  targetCompanyId: string,
  input: unknown,
  requestKey?: string,
): Promise<{ companyId: string; danBasis: DanBasis }> {
  await requireMaster(ctx, companyId, true);
  const request = parseInput(sharePolicyRequestSchema, input);
  return runIdempotent(
    ctx,
    { scope: companyId, action: `share.policy:${targetCompanyId}`, requestKey },
    request,
    async (tx) => {
      const company = await tx.company.findFirst({
        where: {
          id: targetCompanyId,
          tenantId: ctx.actor.tenantId,
          isMaster: false,
          status: "active",
        },
        select: { id: true },
      });
      if (!company) throw invalid("companyId", "validation.share.notCompany");
      await tx.companySharePolicy.upsert({
        where: { companyId: company.id },
        create: { companyId: company.id, danBasis: request.danBasis },
        update: { danBasis: request.danBasis },
      });
      await recordAudit(tx, ctx, {
        companyId,
        action: "share.policy",
        resourceType: "company",
        resourceId: company.id,
        after: request,
      });
      return { companyId: company.id, danBasis: request.danBasis };
    },
  );
}
