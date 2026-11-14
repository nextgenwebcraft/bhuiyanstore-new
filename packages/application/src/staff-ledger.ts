import {
  MONEY_KIND_EFFECTS,
  OPENING_KIND_EFFECTS,
  computeMonth,
  datesBetween,
  shiftBusinessDate,
  toMonthOpening,
  type MoneyEntryInput,
  type MonthOpening,
  type MonthOutput,
  type OpeningKind,
} from "@bsd/domain";
import type { AppContext, Tx } from "./context";
import { fromDbDate, toDbDate } from "./dates";
import { allocationOf } from "./ledger";
import { staffCompanyIds } from "./master";
import { plain } from "./numeric";

/**
 * D65: staff balances are one account per person across the tenant. This runs the month engine
 * once over every staff money entry of every company and the master company, from the earliest
 * opening cutoff, with every opening's staff lines summed. Nothing here calculates.
 */

type Db = AppContext["db"] | Tx;

const STAFF_KINDS = (Object.keys(MONEY_KIND_EFFECTS) as MoneyEntryInput["kind"][]).filter(
  (kind) => MONEY_KIND_EFFECTS[kind].staff !== undefined,
);

export type StaffRun = { cutoffDate: string; from: string; to: string; output: MonthOutput };

export type StaffPerson = { id: string; name: string; kind: "sr" | "distributor" };

/**
 * People assigned to the company at any time, global staff included (D65), with their account
 * kind (SR = supplier-employed); the master company sees every person of the tenant (D66).
 */
export async function staffInScope(
  db: Db,
  company: { id: string; tenantId: string; isMaster: boolean },
): Promise<StaffPerson[]> {
  const assignments = await db.staffAssignment.findMany({
    where: company.isMaster
      ? { company: { tenantId: company.tenantId } }
      : { companyId: { in: await staffCompanyIds(db, company.id) } },
    include: { staff: { select: { id: true, name: true, employer: true } } },
  });
  const people = new Map<string, StaffPerson>();
  for (const a of assignments) {
    people.set(a.staff.id, {
      id: a.staff.id,
      name: a.staff.name,
      kind: a.staff.employer === "supplier" ? "sr" : "distributor",
    });
  }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The tenant's staff opening: the earliest cutoff and every opening's staff balance lines. */
export async function staffOpening(
  db: Db,
  tenantId: string,
): Promise<{ cutoffDate: string; opening: MonthOpening } | null> {
  const sessions = await db.openingSession.findMany({
    where: { company: { tenantId }, cutoffDate: { not: null } },
    select: {
      cutoffDate: true,
      balances: { where: { staffId: { not: null } }, orderBy: { partyKey: "asc" } },
    },
  });
  const cutoffs = sessions.flatMap((s) => (s.cutoffDate ? [fromDbDate(s.cutoffDate)] : []));
  if (cutoffs.length === 0) return null;
  const cutoffDate = cutoffs.sort()[0] as string;
  const built = toMonthOpening({
    cutoffDate,
    stock: [],
    balances: sessions.flatMap((s) =>
      s.balances
        .filter((line) => "staffBalance" in OPENING_KIND_EFFECTS[line.kind as OpeningKind])
        .map((line) => ({
          kind: line.kind as OpeningKind,
          amount: plain(line.amount),
          staffId: line.staffId,
          cashAccountId: null,
          shopId: null,
        })),
    ),
  });
  return { cutoffDate, opening: { products: {}, staff: built.staff ?? {} } };
}

async function run(
  db: Db,
  tenantId: string,
  from: string,
  to: string,
  opening: MonthOpening,
): Promise<MonthOutput> {
  const money = await db.moneyEntry.findMany({
    where: {
      tenantId,
      status: "posted",
      staffId: { not: null },
      kind: { in: STAFF_KINDS },
      date: { gte: toDbDate(from), lte: toDbDate(to) },
    },
    orderBy: { createdAt: "asc" },
  });
  const days = new Map<string, MoneyEntryInput[]>(datesBetween(from, to).map((d) => [d, []]));
  for (const entry of money) {
    const allocation = allocationOf(entry);
    days.get(fromDbDate(entry.date))?.push({
      kind: entry.kind as MoneyEntryInput["kind"],
      amount: plain(entry.amount),
      ref: entry.id,
      ...(entry.staffId ? { staffId: entry.staffId } : {}),
      ...(allocation ? { allocation } : {}),
    });
  }
  return computeMonth({
    products: [],
    opening,
    days: [...days].map(([date, entries]) => ({ date, money: entries })),
  });
}

/**
 * Every person's balances through `to`; with `from`, the output's month aggregates and entries
 * cover exactly [from, to] (opening = the state at the end of the day before). Null before any
 * cutoff is saved or for a range that ends before it.
 */
export async function staffRun(
  db: Db,
  tenantId: string,
  to: string,
  from?: string,
): Promise<StaffRun | null> {
  const active = await staffOpening(db, tenantId);
  if (!active || to < active.cutoffDate) return null;
  const start = from && from > active.cutoffDate ? from : active.cutoffDate;
  let opening = active.opening;
  if (start > active.cutoffDate) {
    const before = await run(
      db,
      tenantId,
      active.cutoffDate,
      shiftBusinessDate(start, -1),
      opening,
    );
    opening = { products: {}, staff: before.closing.staff };
  }
  return {
    cutoffDate: active.cutoffDate,
    from: start,
    to,
    output: await run(db, tenantId, start, to, opening),
  };
}
