import {
  companyHishabYearSchema,
  hishabYearSchema,
  investmentsRequestSchema,
  masterHishabYearSchema,
  monthSchema,
  partnerPayoutHistorySchema,
  partnerPayoutMonthSchema,
  partnerPayRequestSchema,
  partnerPayResultSchema,
  previousDueCreateRequestSchema,
  previousDueListSchema,
  previousDueReduceRequestSchema,
  previousDueSchema,
  previousDueUpdateRequestSchema,
  shareholderCreateRequestSchema,
  shareholderListSchema,
  shareholderSchema,
  shareholderUpdateRequestSchema,
  type CompanyHishabYear,
  type MasterHishabYear,
  type PartnerPayout,
  type PartnerPayoutHistory,
  type PartnerPayoutMonth,
  type PartnerPayResult,
  type PreviousDueList,
  type PreviousDueRecord,
  type PreviousDueReduceRequest,
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
  partnerShares,
  previousDueOpenTotal,
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

async function targetCompanyOf(db: AppContext["db"] | Tx, tenantId: string, companyId: string) {
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

/** D144: the month of the record in force at `month` (latest on or before it), else null. */
function recordMonthOn(records: readonly { fromMonth: string }[], month: string): string | null {
  return records.reduce<string | null>(
    (latest, record) =>
      record.fromMonth <= month && (latest === null || record.fromMonth > latest)
        ? record.fromMonth
        : latest,
    null,
  );
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
  const companyIds = new Set(companies.map((company) => company.id));
  const listed = people.filter((person) => person.active || hasInvestment(person, () => true));
  const shareholders = listed.map((person) => {
    const investments = companies.map((company) => {
      const own = person.investments.filter((investment) => investment.companyId === company.id);
      return {
        companyId: company.id,
        amount: investmentOn(own, month),
        fromMonth: recordMonthOn(own, month),
      };
    });
    return {
      shareholderId: person.id,
      name: person.name,
      active: person.active,
      investments,
      totalInvest: sumAmounts(investments.map((investment) => investment.amount)),
      changedThisMonth: person.investments.some(
        (investment) => investment.fromMonth === month && companyIds.has(investment.companyId),
      ),
    };
  });
  const active = shareholders.filter((holder) => holder.active);

  // D144 change log: one row per shareholder per month that holds an invest record.
  const changes = listed
    .flatMap((person) => {
      const own = person.investments.filter((investment) => companyIds.has(investment.companyId));
      const months = [...new Set(own.map((investment) => investment.fromMonth))];
      return months.map((changeMonth) => {
        const amounts = companies.map((company) => ({
          companyId: company.id,
          amount: investmentOn(
            own.filter((investment) => investment.companyId === company.id),
            changeMonth,
          ),
        }));
        return {
          shareholderId: person.id,
          name: person.name,
          month: changeMonth,
          amounts,
          changedCompanyIds: own
            .filter((investment) => investment.fromMonth === changeMonth)
            .map((investment) => investment.companyId),
          total: sumAmounts(amounts.map((entry) => entry.amount)),
        };
      });
    })
    .sort((a, b) =>
      a.month === b.month ? a.name.localeCompare(b.name) : a.month < b.month ? 1 : -1,
    );

  return shareholderListSchema.parse({
    month,
    companies: companies.map((company) => ({ companyId: company.id, companyName: company.name })),
    shareholders,
    totals: {
      totalInvest: sumAmounts(active.map((holder) => holder.totalInvest)),
      byCompany: companies.map((company) => ({
        companyId: company.id,
        amount: sumAmounts(
          active.map(
            (holder) =>
              holder.investments.find((investment) => investment.companyId === company.id)
                ?.amount ?? "0.00",
          ),
        ),
      })),
      partnerCount: active.length,
      changedCount: active.filter((holder) => holder.changedThisMonth).length,
    },
    changes,
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

type InvestmentRow = {
  shareholderId: string;
  companyId: string;
  fromMonth: string;
  amount: DecimalLike;
};

/**
 * One month of partner profit (D143): every active company's figures, then the per-company split
 * among the given (active) partners after the month's Previous Due cut. Shared by the master year
 * grid, the payment month and the pay action so all three always agree.
 */
async function partnerMonthOf(
  ctx: AppContext,
  input: {
    companies: readonly { id: string; name: string }[];
    partners: readonly { id: string }[];
    investments: readonly InvestmentRow[];
    dueApplied: string;
    month: string;
    today: string;
  },
) {
  const { companies, partners, investments, dueApplied, month, today } = input;
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
  const atMonth = investments.filter((investment) => investment.fromMonth <= month);
  const shares = partnerShares({
    companies: rows.map((row) => ({ companyId: row.companyId, totalProfit: row.totalProfit })),
    previousDueTotal: dueApplied,
    partners: partners.map((person) => ({
      shareholderId: person.id,
      invest: Object.fromEntries(
        companies.map((company) => [
          company.id,
          investmentOn(
            atMonth.filter(
              (investment) =>
                investment.shareholderId === person.id && investment.companyId === company.id,
            ),
            month,
          ),
        ]),
      ),
    })),
  });
  return { rows, shares };
}

async function investmentsOf(ctx: AppContext): Promise<InvestmentRow[]> {
  return ctx.db.shareholderInvestment.findMany({
    where: { shareholder: { tenantId: ctx.actor.tenantId } },
    select: { shareholderId: true, companyId: true, fromMonth: true, amount: true },
  });
}

async function dueAppliedOf(ctx: AppContext, month: string): Promise<string> {
  const rows = await ctx.db.previousDueReduction.findMany({
    where: { tenantId: ctx.actor.tenantId, month },
    select: { amount: true },
  });
  return sumAmounts(rows.map((row) => plain(row.amount)));
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

  const [companies, people, investments, dueRows, reductions] = await Promise.all([
    companiesOf(ctx),
    peopleOf(ctx),
    investmentsOf(ctx),
    ctx.db.previousDue.findMany({
      where: { tenantId: ctx.actor.tenantId },
      select: { amount: true },
    }),
    ctx.db.previousDueReduction.findMany({
      where: { tenantId: ctx.actor.tenantId, month: { startsWith: year } },
      select: { month: true, amount: true },
    }),
  ]);
  // Closed (inactive) shareholders get no share and their invest stays out of every company's
  // pool, so the open partners split the full distributable profit of the companies they are in.
  const listedPeople = people.filter((person) => person.active);
  if (shareholderId && !listedPeople.some((person) => person.id === shareholderId)) {
    throw invalid("shareholderId", "validation.share.unknown");
  }

  const openPreviousDueTotal = previousDueOpenTotal(dueRows.map((row) => plain(row.amount)));
  const appliedByMonth = new Map<string, string>();
  for (const row of reductions) {
    const prev = appliedByMonth.get(row.month) ?? "0";
    appliedByMonth.set(row.month, sumAmounts([prev, plain(row.amount)]));
  }
  const today = monthOf(todayBusinessDate());
  const months = await Promise.all(
    monthsOfYear(year).map(async (month) => {
      const dueApplied = appliedByMonth.get(month) ?? "0.00";
      const { rows, shares } = await partnerMonthOf(ctx, {
        companies,
        partners: listedPeople,
        investments,
        dueApplied,
        month,
        today,
      });
      const selected = shareholderId
        ? shares.partners.find((partner) => partner.shareholderId === shareholderId)
        : undefined;
      const invest = selected
        ? selected.invest
        : sumAmounts(shares.partners.map((partner) => partner.invest));
      const shareholderProfit = selected ? selected.amount : shares.allocated;
      return {
        month,
        companies: rows.map((row) => ({ companyId: row.companyId, totalProfit: row.totalProfit })),
        totalProfit: shares.totalProfit,
        previousDueTotal: roundSettlement(dueApplied),
        distributableProfit: shares.distributableProfit,
        totalDan: danOf(shares.totalProfit),
        invest,
        shareholderProfit,
        profitPerLakh: profitPerLakh(shareholderProfit, invest),
      };
    }),
  );

  return masterHishabYearSchema.parse({
    year,
    shareholderId,
    openPreviousDueTotal,
    companies: companies.map((company) => ({ companyId: company.id, companyName: company.name })),
    shareholders: listedPeople.map((person) => ({
      shareholderId: person.id,
      name: person.name,
      active: person.active,
    })),
    months,
  });
}

function previousDueRecordOf(row: {
  id: string;
  reason: string;
  amount: DecimalLike;
}): PreviousDueRecord {
  return previousDueSchema.parse({
    id: row.id,
    reason: row.reason,
    amount: roundSettlement(plain(row.amount)),
  });
}

/** Master Previous Due list (D128): every row plus the open total used in the shareholder split. */
export async function listPreviousDues(
  ctx: AppContext,
  companyId: string,
): Promise<PreviousDueList> {
  await requireMaster(ctx, companyId);
  const rows = await ctx.db.previousDue.findMany({
    where: { tenantId: ctx.actor.tenantId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const items = rows.map(previousDueRecordOf);
  return previousDueListSchema.parse({
    items,
    openTotal: previousDueOpenTotal(items.map((item) => item.amount)),
  });
}

export async function createPreviousDue(
  ctx: AppContext,
  companyId: string,
  input: unknown,
  requestKey?: string,
): Promise<PreviousDueRecord> {
  await requireMaster(ctx, companyId, true);
  const request = parseInput(previousDueCreateRequestSchema, input);
  return runIdempotent(
    ctx,
    { scope: companyId, action: "previousDue.create", requestKey },
    request,
    async (tx) => {
      const created = await tx.previousDue.create({
        data: {
          tenantId: ctx.actor.tenantId,
          reason: request.reason,
          amount: request.amount,
        },
      });
      await recordAudit(tx, ctx, {
        companyId,
        action: "previousDue.create",
        resourceType: "previousDue",
        resourceId: created.id,
        after: { reason: created.reason, amount: plain(created.amount) },
      });
      return previousDueRecordOf(created);
    },
  );
}

export async function updatePreviousDue(
  ctx: AppContext,
  companyId: string,
  previousDueId: string,
  input: unknown,
  requestKey?: string,
): Promise<PreviousDueRecord> {
  await requireMaster(ctx, companyId, true);
  const request = parseInput(previousDueUpdateRequestSchema, input);
  return runIdempotent(
    ctx,
    { scope: companyId, action: `previousDue.update:${previousDueId}`, requestKey },
    request,
    async (tx) => {
      const existing = await tx.previousDue.findFirst({
        where: { id: previousDueId, tenantId: ctx.actor.tenantId },
      });
      if (!existing) throw invalid("previousDueId", "validation.previousDue.unknown");
      const updated = await tx.previousDue.update({
        where: { id: existing.id },
        data: { reason: request.reason, amount: request.amount },
      });
      await recordAudit(tx, ctx, {
        companyId,
        action: "previousDue.update",
        resourceType: "previousDue",
        resourceId: existing.id,
        before: { reason: existing.reason, amount: plain(existing.amount) },
        after: { reason: updated.reason, amount: plain(updated.amount) },
      });
      return previousDueRecordOf(updated);
    },
  );
}

export async function deletePreviousDue(
  ctx: AppContext,
  companyId: string,
  previousDueId: string,
): Promise<void> {
  await requireMaster(ctx, companyId, true);
  await ctx.db.$transaction(async (tx) => {
    const existing = await tx.previousDue.findFirst({
      where: { id: previousDueId, tenantId: ctx.actor.tenantId },
    });
    if (!existing) throw invalid("previousDueId", "validation.previousDue.unknown");
    await tx.previousDue.delete({ where: { id: existing.id } });
    await recordAudit(tx, ctx, {
      companyId,
      action: "previousDue.delete",
      resourceType: "previousDue",
      resourceId: existing.id,
      before: { reason: existing.reason, amount: plain(existing.amount) },
    });
  });
}

/**
 * Apply an amount from one Previous Due against one month's profit (D128): lowers the due's
 * remaining balance and records a reduction so that month's distributable profit is cut by the
 * same amount.
 */
export async function applyPreviousDueReduction(
  ctx: AppContext,
  companyId: string,
  input: unknown,
  requestKey?: string,
): Promise<PreviousDueRecord> {
  await requireMaster(ctx, companyId, true);
  const request = parseInput(previousDueReduceRequestSchema, input) as PreviousDueReduceRequest;
  return runIdempotent(
    ctx,
    {
      scope: companyId,
      action: `previousDue.reduce:${request.previousDueId}:${request.month}`,
      requestKey,
    },
    request,
    async (tx) => {
      const due = await tx.previousDue.findFirst({
        where: { id: request.previousDueId, tenantId: ctx.actor.tenantId },
      });
      if (!due) throw invalid("previousDueId", "validation.previousDue.unknown");
      const remaining = toDecimal(plain(due.amount));
      const cut = toDecimal(request.amount);
      if (cut.lte(0)) throw invalid("amount", "validation.previousDue.reduceAmount");
      if (cut.gt(remaining)) throw invalid("amount", "validation.previousDue.exceedsRemaining");
      const nextAmount = roundSettlement(remaining.sub(cut));
      const updated = await tx.previousDue.update({
        where: { id: due.id },
        data: { amount: nextAmount },
      });
      await tx.previousDueReduction.create({
        data: {
          tenantId: ctx.actor.tenantId,
          previousDueId: due.id,
          month: request.month,
          amount: request.amount,
          createdById: ctx.actor.userId,
        },
      });
      await recordAudit(tx, ctx, {
        companyId,
        action: "previousDue.reduce",
        resourceType: "previousDue",
        resourceId: due.id,
        before: { amount: plain(due.amount) },
        after: {
          amount: nextAmount,
          month: request.month,
          reduced: request.amount,
        },
      });
      return previousDueRecordOf(updated);
    },
  );
}

const payoutInclude = {
  lines: true,
  shareholder: { select: { name: true } },
} as const;

type PayoutRow = {
  id: string;
  month: string;
  shareholderId: string;
  amount: DecimalLike;
  note: string | null;
  paidAt: Date;
  paidById: string;
  shareholder: { name: string };
  lines: { companyId: string; companyName: string; invest: DecimalLike; amount: DecimalLike }[];
};

async function userNamesOf(ctx: AppContext, ids: readonly string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map<string, string>();
  const users = await ctx.db.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(users.map((user) => [user.id, user.name]));
}

function payoutOf(row: PayoutRow, names: Map<string, string>): PartnerPayout {
  return {
    id: row.id,
    month: row.month,
    shareholderId: row.shareholderId,
    shareholderName: row.shareholder.name,
    amount: roundSettlement(plain(row.amount)),
    // D144: the invest the payment was made on (the snapshot lines summed).
    invest: sumAmounts(row.lines.map((line) => plain(line.invest))),
    note: row.note,
    paidAt: row.paidAt.toISOString(),
    paidByName: names.get(row.paidById) ?? null,
    lines: [...row.lines]
      .sort((a, b) => a.companyName.localeCompare(b.companyName))
      .map((line) => ({
        companyId: line.companyId,
        companyName: line.companyName,
        invest: roundSettlement(plain(line.invest)),
        amount: roundSettlement(plain(line.amount)),
      })),
  };
}

function monthStateOf(month: string, today: string) {
  if (month > today) return "future" as const;
  return month === today ? ("current" as const) : ("closed" as const);
}

/** Everything one payment month needs: live shares for the active partners (D143). */
async function payoutBasisOf(ctx: AppContext, month: string) {
  const [companies, people, investments, dueApplied] = await Promise.all([
    companiesOf(ctx),
    peopleOf(ctx),
    investmentsOf(ctx),
    dueAppliedOf(ctx, month),
  ]);
  const today = monthOf(todayBusinessDate());
  const active = people.filter((person) => person.active);
  const { shares } = await partnerMonthOf(ctx, {
    companies,
    partners: active,
    investments,
    dueApplied,
    month,
    today,
  });
  const companyName = new Map(companies.map((company) => [company.id, company.name]));
  const linesOf = (shareholderId: string) =>
    (shares.partners.find((partner) => partner.shareholderId === shareholderId)?.lines ?? []).map(
      (line) => ({ ...line, companyName: companyName.get(line.companyId) ?? "" }),
    );
  return { companies, people, active, shares, dueApplied, today, linesOf };
}

/**
 * অংশীদারদের পেমেন্ট for one month (D143): each active partner's per-company share and total,
 * with the recorded payment (a snapshot) when already paid.
 */
export async function getPartnerPayoutMonth(
  ctx: AppContext,
  companyId: string,
  monthInput: unknown,
): Promise<PartnerPayoutMonth> {
  await requireMaster(ctx, companyId);
  const month = parseMonth(monthInput);
  const [basis, payouts] = await Promise.all([
    payoutBasisOf(ctx, month),
    ctx.db.shareholderPayout.findMany({
      where: { shareholder: { tenantId: ctx.actor.tenantId }, month },
      include: payoutInclude,
    }),
  ]);
  const names = await userNamesOf(
    ctx,
    payouts.map((payout) => payout.paidById),
  );
  const payoutBy = new Map(
    payouts.map((payout) => [payout.shareholderId, payoutOf(payout, names)]),
  );
  const { shares } = basis;

  const activeRows = basis.active.map((person) => {
    const share = shares.partners.find((partner) => partner.shareholderId === person.id);
    const amount = share?.amount ?? "0.00";
    const payout = payoutBy.get(person.id) ?? null;
    return {
      shareholderId: person.id,
      name: person.name,
      active: true,
      invest: share?.invest ?? "0.00",
      amount,
      lines: basis.linesOf(person.id),
      payout,
      changed: payout !== null && !toDecimal(payout.amount).eq(toDecimal(amount)),
    };
  });
  // A partner closed after being paid keeps their payment on screen, with no live share.
  const closedRows = basis.people
    .filter((person) => !person.active && payoutBy.has(person.id))
    .map((person) => ({
      shareholderId: person.id,
      name: person.name,
      active: false,
      invest: "0.00",
      amount: "0.00",
      lines: [],
      payout: payoutBy.get(person.id) ?? null,
      changed: false,
    }));

  return partnerPayoutMonthSchema.parse({
    month,
    state: monthStateOf(month, basis.today),
    companies: shares.companies.map((row) => ({
      ...row,
      companyName: basis.companies.find((company) => company.id === row.companyId)?.name ?? "",
    })),
    totalProfit: shares.totalProfit,
    previousDueTotal: roundSettlement(basis.dueApplied),
    distributableProfit: shares.distributableProfit,
    unallocated: shares.unallocated,
    partners: [...activeRows, ...closedRows],
    summary: {
      payable: shares.allocated,
      paid: sumAmounts(payouts.map((payout) => plain(payout.amount))),
      unpaid: sumAmounts(activeRows.filter((row) => !row.payout).map((row) => row.amount)),
      paidCount: activeRows.filter((row) => row.payout).length,
      partnerCount: activeRows.length,
    },
  });
}

/**
 * Pays one or more partners for a month (D143): stores each partner's live amount and its
 * per-company parts as a snapshot. Refuses a future month, a partner already paid, and an amount
 * that no longer matches the live figure the admin reviewed.
 */
export async function payPartners(
  ctx: AppContext,
  companyId: string,
  input: unknown,
  requestKey?: string,
): Promise<PartnerPayResult> {
  await requireMaster(ctx, companyId, true);
  const request = parseInput(partnerPayRequestSchema, input);
  const ids = request.entries.map((entry) => entry.shareholderId);
  if (new Set(ids).size !== ids.length) throw invalid("entries", "validation.payout.duplicate");
  const basis = await payoutBasisOf(ctx, request.month);
  if (request.month > basis.today) throw invalid("month", "validation.payout.futureMonth");

  return runIdempotent(
    ctx,
    { scope: companyId, action: `partner.pay:${request.month}`, requestKey },
    request,
    async (tx) => {
      for (const entry of request.entries) {
        const share = basis.shares.partners.find(
          (partner) => partner.shareholderId === entry.shareholderId,
        );
        if (!share) throw invalid("entries", "validation.payout.notPartner");
        if (!toDecimal(share.amount).eq(toDecimal(entry.amount))) {
          throw invalid("entries", "validation.payout.stale");
        }
        const existing = await tx.shareholderPayout.findUnique({
          where: {
            shareholderId_month: { shareholderId: entry.shareholderId, month: request.month },
          },
          select: { id: true },
        });
        if (existing) throw invalid("entries", "validation.payout.alreadyPaid");
        const lines = basis
          .linesOf(entry.shareholderId)
          .filter((line) => toDecimal(line.invest).gt(0) || !toDecimal(line.amount).isZero());
        const created = await tx.shareholderPayout.create({
          data: {
            shareholderId: entry.shareholderId,
            month: request.month,
            amount: share.amount,
            note: request.note ? request.note : null,
            paidById: ctx.actor.userId,
            lines: {
              create: lines.map((line) => ({
                companyId: line.companyId,
                companyName: line.companyName,
                invest: line.invest,
                amount: line.amount,
              })),
            },
          },
        });
        await recordAudit(tx, ctx, {
          companyId,
          action: "shareholder.payout",
          resourceType: "shareholder",
          resourceId: entry.shareholderId,
          after: {
            payoutId: created.id,
            month: request.month,
            amount: share.amount,
            lines: lines.map((line) => ({ companyId: line.companyId, amount: line.amount })),
          },
        });
      }
      return partnerPayResultSchema.parse({ paid: request.entries.length });
    },
  );
}

/** Cancels one recorded payment (D143); the audit log keeps what was cancelled. */
export async function cancelPartnerPayout(
  ctx: AppContext,
  companyId: string,
  payoutId: string,
): Promise<void> {
  await requireMaster(ctx, companyId, true);
  await ctx.db.$transaction(async (tx) => {
    const payout = await tx.shareholderPayout.findFirst({
      where: { id: payoutId, shareholder: { tenantId: ctx.actor.tenantId } },
      include: { lines: true },
    });
    if (!payout) throw invalid("payoutId", "validation.payout.unknown");
    await tx.shareholderPayout.delete({ where: { id: payout.id } });
    await recordAudit(tx, ctx, {
      companyId,
      action: "shareholder.payout.cancel",
      resourceType: "shareholder",
      resourceId: payout.shareholderId,
      before: {
        payoutId: payout.id,
        month: payout.month,
        amount: plain(payout.amount),
        lines: payout.lines.map((line) => ({
          companyId: line.companyId,
          amount: plain(line.amount),
        })),
      },
    });
  });
}

/**
 * Payment history for a year (D143): every recorded payment, newest first, plus what each partner
 * received per month and per company, the month totals and the company totals.
 */
export async function getPartnerPayoutHistory(
  ctx: AppContext,
  companyId: string,
  yearInput: unknown,
  shareholderIdInput?: unknown,
): Promise<PartnerPayoutHistory> {
  await requireMaster(ctx, companyId);
  const year = parseYear(yearInput);
  const shareholderId =
    typeof shareholderIdInput === "string" && shareholderIdInput.length > 0
      ? shareholderIdInput
      : null;
  const [people, activeCompanies, payouts] = await Promise.all([
    peopleOf(ctx),
    companiesOf(ctx),
    ctx.db.shareholderPayout.findMany({
      where: {
        shareholder: { tenantId: ctx.actor.tenantId },
        month: { startsWith: year },
        ...(shareholderId ? { shareholderId } : {}),
      },
      include: payoutInclude,
      orderBy: [{ month: "desc" }, { paidAt: "desc" }],
    }),
  ]);
  if (shareholderId && !people.some((person) => person.id === shareholderId)) {
    throw invalid("shareholderId", "validation.share.unknown");
  }
  const names = await userNamesOf(
    ctx,
    payouts.map((payout) => payout.paidById),
  );
  const payments = payouts.map((payout) => payoutOf(payout, names));

  // Columns: every active company, plus any company that only appears in older payments.
  const companyNames = new Map(activeCompanies.map((company) => [company.id, company.name]));
  for (const payment of payments) {
    for (const line of payment.lines) {
      if (!companyNames.has(line.companyId)) companyNames.set(line.companyId, line.companyName);
    }
  }
  const companies = [...companyNames.entries()]
    .map(([id, name]) => ({ companyId: id, companyName: name }))
    .sort((a, b) => a.companyName.localeCompare(b.companyName));
  const labels = monthsOfYear(year);
  const companyTotal = (rows: readonly PartnerPayout[], id: string) =>
    sumAmounts(
      rows.flatMap((row) =>
        row.lines.filter((line) => line.companyId === id).map((line) => line.amount),
      ),
    );

  const paidPeople = people.filter((person) =>
    payments.some((payment) => payment.shareholderId === person.id),
  );

  return partnerPayoutHistorySchema.parse({
    year,
    shareholderId,
    shareholders: people
      .filter((person) => person.active || paidPeople.includes(person))
      .map((person) => ({ shareholderId: person.id, name: person.name, active: person.active })),
    companies,
    payments,
    byShareholder: paidPeople.map((person) => {
      const own = payments.filter((payment) => payment.shareholderId === person.id);
      return {
        shareholderId: person.id,
        name: person.name,
        total: sumAmounts(own.map((payment) => payment.amount)),
        months: labels.map((month) => {
          const paid = own.filter((payment) => payment.month === month);
          return paid.length > 0 ? sumAmounts(paid.map((payment) => payment.amount)) : null;
        }),
        byCompany: companies.map((company) => ({
          companyId: company.companyId,
          amount: companyTotal(own, company.companyId),
        })),
      };
    }),
    byMonth: labels.map((month) =>
      sumAmounts(
        payments.filter((payment) => payment.month === month).map((payment) => payment.amount),
      ),
    ),
    byCompany: companies.map((company) => ({
      companyId: company.companyId,
      amount: companyTotal(payments, company.companyId),
    })),
    total: sumAmounts(payments.map((payment) => payment.amount)),
  });
}
