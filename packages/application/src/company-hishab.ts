import {
  companyHishabYearSchema,
  hishabYearSchema,
  investmentsRequestSchema,
  masterHishabYearSchema,
  monthSchema,
  shareholderCreateRequestSchema,
  shareholderListSchema,
  shareholderSchema,
  shareholderUpdateRequestSchema,
  type CompanyHishabYear,
  type MasterHishabYear,
  type ShareholderList,
  type ShareholderRecord,
} from "@bsd/contracts";
import {
  companyHishabMonth,
  danOf,
  firstOfMonth,
  investShare,
  lastOfMonth,
  monthOf,
  profitPerLakh,
  roundSettlement,
  sumAmounts,
  todayBusinessDate,
  toDecimal,
} from "@bsd/domain";
import { loadCompanyAccess, requireSuperAdmin, requireSuperAdminView } from "./access";
import { recordAudit } from "./audit";
import type { AppContext, Tx } from "./context";
import { dashboardOf } from "./daily";
import { AppError, invalid, parseInput } from "./errors";
import { runIdempotent } from "./idempotency";
import { plain, type DecimalLike } from "./numeric";

/**
 * Company Hishab Reports (one company, one year) and the master panel (every company, one year):
 * profit and khoroch are each company's dashboard figures; দান is always 2% of the net. Invest is
 * the shareholder module's own facts. Nothing posted here moves cash.
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

function parseYear(value: unknown): string {
  const parsed = hishabYearSchema.safeParse(value);
  if (!parsed.success) throw invalid("year", "validation.share.year");
  return parsed.data;
}

function monthsOfYear(year: string): string[] {
  return Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
}

async function companiesOf(ctx: AppContext) {
  return ctx.db.company.findMany({
    where: { tenantId: ctx.actor.tenantId, isMaster: false, status: "active" },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

async function targetCompanyOf(
  db: AppContext["db"] | Tx,
  tenantId: string,
  companyId: string,
) {
  const company = await db.company.findFirst({
    where: { id: companyId, tenantId, isMaster: false, status: "active" },
    select: { id: true, name: true },
  });
  if (!company) throw invalid("companyId", "validation.share.notCompany");
  return company;
}

async function figuresOf(ctx: AppContext, companyId: string, month: string) {
  const access = await loadCompanyAccess(ctx, companyId);
  const { summary } = await dashboardOf(ctx, access, {
    from: firstOfMonth(month),
    to: lastOfMonth(month),
  });
  return { profit: summary.salesProfit ?? "0", khoroch: summary.profitCost ?? "0" };
}

/** The amount in force at `month`: the latest record on or before it, else zero. */
function investmentOn(
  records: readonly { fromMonth: string; amount: DecimalLike }[],
  month: string,
): string {
  const row = [...records]
    .filter((record) => record.fromMonth <= month)
    .sort((a, b) => (a.fromMonth < b.fromMonth ? 1 : -1))[0];
  return row ? roundSettlement(plain(row.amount)) : "0.00";
}

async function peopleOf(ctx: AppContext) {
  return ctx.db.shareholder.findMany({
    where: { tenantId: ctx.actor.tenantId },
    include: { investments: true },
    orderBy: { name: "asc" },
  });
}

type Person = Awaited<ReturnType<typeof peopleOf>>[number];

function hasInvestment(person: Person, filter: (companyId: string) => boolean): boolean {
  return person.investments.some(
    (investment) => filter(investment.companyId) && toDecimal(plain(investment.amount)).gt(0),
  );
}

async function todayCappedFigures(
  ctx: AppContext,
  companyId: string,
  month: string,
  today: string,
) {
  return month > today ? { profit: "0", khoroch: "0" } : figuresOf(ctx, companyId, month);
}

/** The শেয়ারহোল্ডার module: every shareholder and their invest in each active company. */
export async function listShareholders(
  ctx: AppContext,
  companyId: string,
  monthInput?: unknown,
): Promise<ShareholderList> {
  await requireMaster(ctx, companyId);
  const month = monthInput === undefined ? monthOf(todayBusinessDate()) : parseMonth(monthInput);
  const [companies, people] = await Promise.all([companiesOf(ctx), peopleOf(ctx)]);
  return shareholderListSchema.parse({
    month,
    companies: companies.map((company) => ({ companyId: company.id, companyName: company.name })),
    shareholders: people
      .filter((person) => person.active || hasInvestment(person, () => true))
      .map((person) => ({
        shareholderId: person.id,
        name: person.name,
        active: person.active,
        investments: companies.map((company) => ({
          companyId: company.id,
          amount: investmentOn(
            person.investments.filter((investment) => investment.companyId === company.id),
            month,
          ),
        })),
      })),
  });
}

async function personOf(db: AppContext["db"] | Tx, tenantId: string, shareholderId: string) {
  const person = await db.shareholder.findFirst({ where: { id: shareholderId, tenantId } });
  if (!person) throw invalid("shareholderId", "validation.share.unknown");
  return person;
}

function recordOf(person: { id: string; name: string; active: boolean }): ShareholderRecord {
  return shareholderSchema.parse(person);
}

/** Adds a shareholder with no invest yet. */
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

/** Renames a shareholder or marks them inactive. Past invest is left as it was. */
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

/**
 * Sets every invest entry an edit touches, for one shareholder, in a single transaction: all
 * entries land together or none do, so a screen edit can never half-save across companies.
 */
export async function saveInvestments(
  ctx: AppContext,
  companyId: string,
  shareholderId: string,
  input: unknown,
  requestKey?: string,
): Promise<ShareholderRecord> {
  await requireMaster(ctx, companyId, true);
  const request = parseInput(investmentsRequestSchema, input);
  return runIdempotent(
    ctx,
    { scope: companyId, action: `shareholder.investments:${shareholderId}`, requestKey },
    request,
    async (tx) => {
      const person = await personOf(tx, ctx.actor.tenantId, shareholderId);
      for (const entry of request.entries) {
        const target = await targetCompanyOf(tx, ctx.actor.tenantId, entry.targetCompanyId);
        await tx.shareholderInvestment.upsert({
          where: {
            shareholderId_companyId_fromMonth: {
              shareholderId: person.id,
              companyId: target.id,
              fromMonth: entry.fromMonth,
            },
          },
          create: {
            shareholderId: person.id,
            companyId: target.id,
            fromMonth: entry.fromMonth,
            amount: entry.amount,
          },
          update: { amount: entry.amount },
        });
        await recordAudit(tx, ctx, {
          companyId,
          action: "shareholder.investment",
          resourceType: "shareholder",
          resourceId: person.id,
          after: {
            fromMonth: entry.fromMonth,
            amount: entry.amount,
            targetCompanyId: target.id,
          },
        });
      }
      return recordOf(person);
    },
  );
}

/** Company Hishab Reports: one company, one year, every month a row. */
export async function getCompanyHishabYear(
  ctx: AppContext,
  companyId: string,
  targetCompanyId: string,
  yearInput: unknown,
  shareholderIdInput?: unknown,
): Promise<CompanyHishabYear> {
  await requireMaster(ctx, companyId);
  const year = parseYear(yearInput);
  const target = await targetCompanyOf(ctx.db, ctx.actor.tenantId, targetCompanyId);
  const shareholderId =
    typeof shareholderIdInput === "string" && shareholderIdInput.length > 0
      ? shareholderIdInput
      : null;

  const [people, investments] = await Promise.all([
    peopleOf(ctx),
    ctx.db.shareholderInvestment.findMany({
      where: { shareholder: { tenantId: ctx.actor.tenantId }, companyId: target.id },
      select: { shareholderId: true, fromMonth: true, amount: true },
    }),
  ]);
  if (shareholderId && !people.some((person) => person.id === shareholderId)) {
    throw invalid("shareholderId", "validation.share.unknown");
  }

  const today = monthOf(todayBusinessDate());
  const labels = monthsOfYear(year);
  const months = await Promise.all(
    labels.map(async (month) => {
      const figures = await todayCappedFigures(ctx, target.id, month, today);
      const [row] = companyHishabMonth([
        {
          companyId: target.id,
          companyName: target.name,
          profit: figures.profit,
          khoroch: figures.khoroch,
        },
      ]);
      const totalProfitForMonth = row?.totalProfit ?? "0.00";
      const atMonth = investments.filter((investment) => investment.fromMonth <= month);
      const totalInvest = sumAmounts(
        [...new Set(investments.map((investment) => investment.shareholderId))].map((id) =>
          investmentOn(
            atMonth.filter((investment) => investment.shareholderId === id),
            month,
          ),
        ),
      );
      const invest = shareholderId
        ? investmentOn(
            atMonth.filter((investment) => investment.shareholderId === shareholderId),
            month,
          )
        : totalInvest;
      return {
        month,
        profit: row?.profit ?? "0.00",
        khoroch: row?.khoroch ?? "0.00",
        dan: row?.dan ?? "0.00",
        totalProfit: totalProfitForMonth,
        invest,
        shareholderProfit: shareholderId
          ? investShare(totalProfitForMonth, invest, totalInvest)
          : totalProfitForMonth,
        profitPerLakh: profitPerLakh(totalProfitForMonth, totalInvest),
      };
    }),
  );

  return companyHishabYearSchema.parse({
    year,
    companyId: target.id,
    companyName: target.name,
    shareholderId,
    shareholders: people
      .filter((person) => person.active || hasInvestment(person, (id) => id === target.id))
      .map((person) => ({ shareholderId: person.id, name: person.name, active: person.active })),
    months,
  });
}

/** The master panel: every active company's total side by side, one year. */
export async function getMasterHishabYear(
  ctx: AppContext,
  companyId: string,
  yearInput: unknown,
  shareholderIdInput?: unknown,
): Promise<MasterHishabYear> {
  await requireMaster(ctx, companyId);
  const year = parseYear(yearInput);
  const shareholderId =
    typeof shareholderIdInput === "string" && shareholderIdInput.length > 0
      ? shareholderIdInput
      : null;

  const [companies, people, investments] = await Promise.all([
    companiesOf(ctx),
    peopleOf(ctx),
    ctx.db.shareholderInvestment.findMany({
      where: { shareholder: { tenantId: ctx.actor.tenantId } },
      select: { shareholderId: true, companyId: true, fromMonth: true, amount: true },
    }),
  ]);
  if (shareholderId && !people.some((person) => person.id === shareholderId)) {
    throw invalid("shareholderId", "validation.share.unknown");
  }

  const today = monthOf(todayBusinessDate());
  const labels = monthsOfYear(year);
  const shareholderIds = [...new Set(investments.map((investment) => investment.shareholderId))];
  const months = await Promise.all(
    labels.map(async (month) => {
      const figures = await Promise.all(
        companies.map(async (company) => ({
          company,
          ...(await todayCappedFigures(ctx, company.id, month, today)),
        })),
      );
      const rows = companyHishabMonth(
        figures.map((entry) => ({
          companyId: entry.company.id,
          companyName: entry.company.name,
          profit: entry.profit,
          khoroch: entry.khoroch,
        })),
      );
      const totalProfit = sumAmounts(rows.map((row) => row.totalProfit));
      const atMonth = investments.filter((investment) => investment.fromMonth <= month);
      const investOf = (id: string) =>
        sumAmounts(
          companies.map((company) =>
            investmentOn(
              atMonth.filter(
                (investment) =>
                  investment.shareholderId === id && investment.companyId === company.id,
              ),
              month,
            ),
          ),
        );
      const totalInvest = sumAmounts(shareholderIds.map(investOf));
      const invest = shareholderId ? investOf(shareholderId) : totalInvest;
      return {
        month,
        companies: rows.map((row) => ({ companyId: row.companyId, totalProfit: row.totalProfit })),
        totalProfit,
        totalDan: danOf(totalProfit),
        invest,
        shareholderProfit: shareholderId
          ? investShare(totalProfit, invest, totalInvest)
          : totalProfit,
        profitPerLakh: profitPerLakh(totalProfit, totalInvest),
      };
    }),
  );

  return masterHishabYearSchema.parse({
    year,
    shareholderId,
    companies: companies.map((company) => ({ companyId: company.id, companyName: company.name })),
    shareholders: people
      .filter((person) => person.active || hasInvestment(person, () => true))
      .map((person) => ({ shareholderId: person.id, name: person.name, active: person.active })),
    months,
  });
}
