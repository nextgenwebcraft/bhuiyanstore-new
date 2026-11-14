import { todayBusinessDate } from "@bsd/domain";
import {
  staffAccountsSchema,
  staffBalanceKeys,
  staffStatementSchema,
  type StaffAccountKind,
  type StaffAccounts,
  type StaffBalancesDto,
  type StaffStatement,
} from "@bsd/contracts";
import type { StaffBalanceValues } from "@bsd/domain";
import { loadCompanyAccess, type CompanyAccess } from "./access";
import type { AppContext } from "./context";
import { businessDate } from "./daily";
import { AppError, invalid } from "./errors";
import { toReportFile, type ReportFile } from "./month";
import { parseReportRange } from "./report-range";
import { staffInScope, staffRun } from "./staff-ledger";

/**
 * Staff and SR money accounts (D27, D18, guide §11.9): balances and statements are month-engine
 * figures (closing balances and per-entry ledger lines); nothing is netted or summed here.
 */

const ZERO_BALANCES = Object.fromEntries(staffBalanceKeys.map((k) => [k, "0"])) as StaffBalancesDto;

/** Distributor staff accounts need `finance.view`; SR accounts also open with `sr_loan.view`. */
function canView(access: CompanyAccess, kind: StaffAccountKind): boolean {
  if (access.permissions.includes("finance.view")) return true;
  return kind === "sr" && access.permissions.includes("sr_loan.view");
}

const companyPeople = (ctx: AppContext, access: CompanyAccess) =>
  staffInScope(ctx.db, access.company);

/** Every person's balances at the end of `date` (default today), for one account kind. */
export async function getStaffAccounts(
  ctx: AppContext,
  companyId: string,
  query: { date?: unknown; kind?: unknown },
): Promise<StaffAccounts> {
  const access = await loadCompanyAccess(ctx, companyId);
  const kind: StaffAccountKind = query.kind === "sr" ? "sr" : "distributor";
  if (!canView(access, kind)) throw new AppError("FORBIDDEN");
  const today = todayBusinessDate();
  const asked = query.date === undefined || query.date === null ? today : businessDate(query.date);
  const date = asked > today ? today : asked;
  const run = await staffRun(ctx.db, access.company.tenantId, date);
  const closing = run?.output.closing.staff ?? {};
  const owesUs = new Map(run?.output.month.staff.map((s) => [s.staffId, s]) ?? []);
  const rows = (await companyPeople(ctx, access))
    .filter((p) => p.kind === kind)
    .map((p) => {
      const balances = closing[p.id] ?? ZERO_BALANCES;
      const totals = owesUs.get(p.id);
      return {
        staffId: p.id,
        staffName: p.name,
        kind: p.kind,
        balances,
        owesUs: totals?.owesUs ?? "0",
        weOwe: totals?.weOwe ?? "0",
      };
    });
  return staffAccountsSchema.parse({ date, cutoffDate: run?.cutoffDate ?? null, rows });
}

/** One person's account over [from, to]: opening, every entry with its effect, closing. */
export async function getStaffStatement(
  ctx: AppContext,
  companyId: string,
  staffId: string,
  query: unknown,
): Promise<StaffStatement> {
  const access = await loadCompanyAccess(ctx, companyId);
  const person = (await companyPeople(ctx, access)).find((p) => p.id === staffId);
  if (!person) throw invalid("staffId", "validation.daily.staffNotAssigned");
  if (!canView(access, person.kind)) throw new AppError("FORBIDDEN");
  const range = parseReportRange(query);
  const run = await staffRun(ctx.db, access.company.tenantId, range.to, range.from);
  const month = run?.output.month.staff.find((s) => s.staffId === staffId);
  const entries = (run?.output.staffEntries ?? []).filter((e) => e.staffId === staffId);
  const refs = entries.flatMap((e) => (e.ref ? [e.ref] : []));
  const rows = refs.length
    ? await ctx.db.moneyEntry.findMany({
        where: { id: { in: refs }, tenantId: access.company.tenantId },
        select: { id: true, payrollRunId: true, srLoanType: true },
      })
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return staffStatementSchema.parse({
    staffId,
    staffName: person.name,
    kind: person.kind,
    from: run?.from ?? range.from,
    to: range.to,
    cutoffDate: run?.cutoffDate ?? null,
    opening: month?.opening ?? ZERO_BALANCES,
    closing: month?.closing ?? ZERO_BALANCES,
    owesUs: month?.owesUs ?? "0",
    weOwe: month?.weOwe ?? "0",
    lines: entries.map((e) => {
      const row = e.ref ? byId.get(e.ref) : undefined;
      return {
        entryId: row?.id ?? null,
        date: e.date,
        kind: e.kind,
        amount: e.amount,
        payrollRunId: row?.payrollRunId ?? null,
        srLoanType: row?.srLoanType ?? null,
        change: e.change,
        balances: e.balances,
      };
    }),
  });
}

/** Balance columns shown for each account kind; SR accounts have no salary (D18). */
const KIND_KEYS: Record<StaffAccountKind, readonly (keyof StaffBalanceValues)[]> = {
  distributor: ["advance", "loan", "shortage", "credit", "salaryPayable"],
  sr: ["srLoan", "owedToSr"],
};

/** The statement as CSV or XLSX (needs `report.export` as well). */
export async function exportStaffStatement(
  ctx: AppContext,
  companyId: string,
  staffId: string,
  query: unknown,
  format: unknown,
): Promise<ReportFile> {
  const access = await loadCompanyAccess(ctx, companyId);
  if (!access.permissions.includes("report.export")) throw new AppError("FORBIDDEN");
  if (format !== "csv" && format !== "xlsx") throw invalid("format", "validation.report.format");
  const s = await getStaffStatement(ctx, companyId, staffId, query);
  const keys = KIND_KEYS[s.kind];
  const money = (key: string) => ({ key, label: `report.column.${key}`, kind: "money" });
  return toReportFile(
    {
      report: "staff-statement",
      from: s.from,
      to: s.to,
      tables: [
        {
          title: "report.table.statementBalances",
          columns: [
            { key: "line", label: "report.column.line", kind: "label" },
            ...keys.map(money),
          ],
          rows: [
            { cells: { line: "report.column.opening", ...pick(s.opening, keys) } },
            { cells: { line: "report.column.closing", ...pick(s.closing, keys) } },
          ],
          totals: null,
        },
        {
          title: "report.table.statementEntries",
          columns: [
            { key: "date", label: "report.column.date", kind: "text" },
            { key: "kind", label: "report.column.kind", kind: "label" },
            money("amount"),
            ...keys.map(money),
          ],
          rows: s.lines.map((l) => ({
            cells: {
              date: l.date,
              kind: `money.kind.${l.kind}`,
              amount: l.amount,
              ...pick(l.balances, keys),
            },
          })),
          totals: null,
        },
      ],
    },
    `statement_${s.staffName.replace(/[^\p{L}\p{N}]+/gu, "-")}_${s.from}_${s.to}`,
    format,
  );
}

function pick(b: StaffBalancesDto, keys: readonly (keyof StaffBalanceValues)[]) {
  return Object.fromEntries(keys.map((k) => [k, b[k]]));
}
