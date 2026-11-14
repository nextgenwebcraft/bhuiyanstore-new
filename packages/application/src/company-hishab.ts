import {
  companyHishabYearSchema,
  hishabYearSchema,
  investmentsRequestSchema,
  masterHishabYearSchema,
  monthSchema,
  previousDueCreateRequestSchema,
  previousDueListSchema,
  previousDueReduceRequestSchema,
  previousDueSchema,
  previousDueUpdateRequestSchema,
  shareholderCreateRequestSchema,
  shareholderListSchema,
  shareholderPayoutRequestSchema,
  shareholderSchema,
  shareholderUpdateRequestSchema,
  type CompanyHishabYear,
  type MasterHishabYear,
  type PreviousDueList,
  type PreviousDueRecord,
  type PreviousDueReduceRequest,
  type ShareholderList,
  type ShareholderRecord,
} from "@bsd/contracts";
import {
  companyHishabMonth,
  danOf,
  distributableProfit,
  firstOfMonth,
  investShare,
  lastOfMonth,
  monthOf,
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

  const [companies, people, investments, payouts, dueRows, reductions] = await Promise.all([
    companiesOf(ctx),
    peopleOf(ctx),
    ctx.db.shareholderInvestment.findMany({
      where: { shareholder: { tenantId: ctx.actor.tenantId } },
      select: { shareholderId: true, companyId: true, fromMonth: true, amount: true },
    }),
    ctx.db.shareholderPayout.findMany({
      where: { shareholder: { tenantId: ctx.actor.tenantId }, month: { startsWith: year } },
      select: { shareholderId: true, month: true },
    }),
    ctx.db.previousDue.findMany({
      where: { tenantId: ctx.actor.tenantId },
      select: { amount: true },
    }),
    ctx.db.previousDueReduction.findMany({
      where: { tenantId: ctx.actor.tenantId, month: { startsWith: year } },
      select: { month: true, amount: true },
    }),
  ]);
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
  const labels = monthsOfYear(year);
  // Closed (inactive) shareholders are omitted from the payment table and get no share; their
  // invest is also left out of totalInvest so the open partners split the full distributable pool.
  const shareholderIds = listedPeople.map((person) => person.id);
  const paidSet = new Set(payouts.map((p) => `${p.shareholderId}|${p.month}`));
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
      const dueApplied = appliedByMonth.get(month) ?? "0.00";
      const pool = distributableProfit(totalProfit, dueApplied);
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
        previousDueTotal: roundSettlement(dueApplied),
        distributableProfit: pool,
        totalDan: danOf(totalProfit),
        invest,
        shareholderProfit: shareholderId ? investShare(pool, invest, totalInvest) : pool,
        profitPerLakh: profitPerLakh(pool, totalInvest),
        perShareholder: listedPeople.map((person) => ({
          shareholderId: person.id,
          profit: investShare(pool, investOf(person.id), totalInvest),
          paid: paidSet.has(`${person.id}|${month}`),
        })),
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

/**
 * D94: marks (or unmarks) one shareholder's one month as paid on the master panel. Existence of
 * the row is the only fact; the amount is always the computed শেয়ারহোল্ডারের প্রফিট, never stored.
 */
export async function setShareholderPayout(
  ctx: AppContext,
  companyId: string,
  input: unknown,
): Promise<void> {
  await requireMaster(ctx, companyId, true);
  const request = parseInput(shareholderPayoutRequestSchema, input);
  // Upsert-or-delete-by-unique-key is already idempotent on retry; no requestKey/idempotency
  // record needed (same convention as deleteCompany/deleteProduct's other void-returning writes).
  await ctx.db.$transaction(async (tx) => {
    const person = await personOf(tx, ctx.actor.tenantId, request.shareholderId);
    if (request.paid) {
      await tx.shareholderPayout.upsert({
        where: {
          shareholderId_month: { shareholderId: person.id, month: request.month },
        },
        create: { shareholderId: person.id, month: request.month, paidById: ctx.actor.userId },
        update: {},
      });
    } else {
      await tx.shareholderPayout.deleteMany({
        where: { shareholderId: person.id, month: request.month },
      });
    }
    await recordAudit(tx, ctx, {
      companyId,
      action: "shareholder.payout",
      resourceType: "shareholder",
      resourceId: person.id,
      after: { month: request.month, paid: request.paid },
    });
  });
}
