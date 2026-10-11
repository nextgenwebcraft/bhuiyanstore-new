import {
  canViewReport,
  monthSchema,
  monthViewSchema,
  reportIds,
  reportSchema,
  type MonthCloseResult,
  type MonthStatus,
  type MonthView,
  type Report,
  type ReportColumnKind,
  type ReportId,
  type ReportTable,
} from "@bsd/contracts";
import type { Prisma } from "@bsd/database";
import {
  dsrCashSettlement,
  fieldRemaining,
  firstOfMonth,
  lastOfMonth,
  monthOf,
  shiftBusinessDate,
  sumQuantities,
  toDecimal,
  type MonthClosing,
  type MonthOutput,
  todayBusinessDate,
} from "@bsd/domain";
import { buildReportWorkbook, reportCsv, type ExportableReport } from "@bsd/importer";
import { requirePermission, type CompanyAccess } from "./access";
import { recordAudit } from "./audit";
import type { AppContext, Tx } from "./context";
import { fromDbDate, toDbDate } from "./dates";
import { AppError, invalid } from "./errors";
import { runIdempotent } from "./idempotency";
import { liveOpening, namesFor, rangeRun, runLedger, type ActiveOpening } from "./ledger";
import { plain } from "./numeric";
import { parseReportRange } from "./report-range";

/**
 * Month view, month close/reopen and range reports (PLAN §9 Phase F). Every figure is a field of
 * one month-engine run; nothing is summed here.
 */

type Db = AppContext["db"] | Tx;

export function previousMonth(month: string): string {
  return monthOf(shiftBusinessDate(firstOfMonth(month), -1));
}

function parseMonth(value: unknown): string {
  const parsed = monthSchema.safeParse(value);
  if (!parsed.success) throw invalid("month", "validation.month.invalid");
  return parsed.data;
}

type Visibility = { canSeeCost: boolean; canSeeProfit: boolean; canSeeStaff: boolean };

function visibility(access: CompanyAccess): Visibility {
  const canSeeCost = access.permissions.includes("inventory.cost_view");
  return {
    canSeeCost,
    canSeeProfit: canSeeCost && access.permissions.includes("report.profit_view"),
    canSeeStaff: access.permissions.includes("finance.view"),
  };
}

function monthStatus(month: string, active: ActiveOpening | null, closed: boolean): MonthStatus {
  if (!active) return "noOpening";
  if (month < monthOf(active.cutoffDate)) return "beforeOpening";
  if (month > monthOf(todayBusinessDate())) return "future";
  return closed ? "closed" : "open";
}

/** Why `month` can't be closed now (an i18n key), or null. Assumes the month is open. */
async function closeBlocker(
  db: Db,
  companyId: string,
  month: string,
  active: ActiveOpening,
): Promise<string | null> {
  if (lastOfMonth(month) >= todayBusinessDate()) return "validation.month.notOver";
  const previous = previousMonth(month);
  if (previous >= monthOf(active.cutoffDate)) {
    const closed = await db.monthClose.findUnique({
      where: { companyId_month: { companyId, month: previous } },
      select: { id: true },
    });
    if (!closed) return "validation.month.previousOpen";
  }
  const drafts = await db.dsrDay.count({
    where: {
      companyId,
      status: "draft",
      date: { gte: toDbDate(firstOfMonth(month)), lte: toDbDate(lastOfMonth(month)) },
    },
  });
  return drafts > 0 ? "validation.month.drafts" : null;
}

async function categoryNames(db: Db, tenantId: string): Promise<Map<string, string>> {
  const rows = await db.expenseCategory.findMany({
    where: { tenantId },
    select: { id: true, name: true },
  });
  return new Map(rows.map((r) => [r.id, r.name]));
}

// ---------------------------------------------------------------- month view

/** The workbook's right side for one month (PLAN §2.5), with its close state. */
export async function getMonthView(
  ctx: AppContext,
  companyId: string,
  monthInput: unknown,
): Promise<MonthView> {
  const access = await requirePermission(ctx, companyId, "report.view");
  const month = parseMonth(monthInput);
  const seen = visibility(access);
  const active = await liveOpening(ctx.db, companyId);
  const [close, laterClose] = await Promise.all([
    ctx.db.monthClose.findUnique({
      where: { companyId_month: { companyId, month } },
      select: { closedAt: true, closedById: true },
    }),
    ctx.db.monthClose.findFirst({
      where: { companyId, month: { gt: month } },
      select: { id: true },
    }),
  ]);
  const status = monthStatus(month, active, Boolean(close));
  const mayClose = access.permissions.includes("period.close");

  const today = todayBusinessDate();
  const to = month === monthOf(today) ? today : lastOfMonth(month);
  const run =
    active && (status === "open" || status === "closed")
      ? await runLedger(ctx.db, access, to, active)
      : null;
  const [names, categories, closedBy, blocker] = await Promise.all([
    namesFor(ctx.db, access, run?.from ?? firstOfMonth(month)),
    categoryNames(ctx.db, access.company.tenantId),
    close
      ? ctx.db.user.findUnique({ where: { id: close.closedById }, select: { name: true } })
      : null,
    active && status === "open" && mayClose ? closeBlocker(ctx.db, companyId, month, active) : null,
  ]);

  const output = run?.output;
  const cost = (value: string) => (seen.canSeeCost ? value : null);
  const profit = (value: string) => (seen.canSeeProfit ? value : null);
  const productRows = output
    ? names.products.flatMap((product) => {
        const row = output.month.products.find((p) => p.productId === product.id);
        if (!row) return [];
        return [
          {
            ...row,
            sku: product.sku,
            productName: product.name,
            piecesPerCarton: product.piecesPerCarton,
            costTotal: cost(row.costTotal),
            profitTotal: profit(row.profitTotal),
            damageValue: cost(row.damageValue),
            replacementValue: cost(row.replacementValue),
            closingValue: cost(row.closingValue),
          },
        ];
      })
    : [];
  const totals = output?.month.totals;
  const staffName = (id: string) => names.staff.get(id) ?? "";

  return monthViewSchema.parse({
    month,
    status,
    cutoffDate: active?.cutoffDate ?? null,
    from: run?.from ?? null,
    to: run?.to ?? null,
    closedAt: close?.closedAt.toISOString() ?? null,
    closedByName: closedBy?.name ?? null,
    canClose: mayClose && status === "open" && blocker === null,
    closeBlockedBy: blocker,
    canReopen: mayClose && status === "closed" && !laterClose,
    products: productRows,
    totals: {
      orderTotal: totals?.orderTotal ?? "0",
      receiptTotal: totals?.receiptTotal ?? "0",
      commissionTotal: totals?.commissionTotal ?? "0",
      salesTotal: totals?.salesTotal ?? "0",
      costTotal: cost(totals?.costTotal ?? "0"),
      profitTotal: profit(totals?.profitTotal ?? "0"),
      damageValue: cost(totals?.damageValue ?? "0"),
      replacementValue: cost(totals?.replacementValue ?? "0"),
      closingValue: cost(totals?.closingValue ?? "0"),
    },
    days: (output?.days ?? []).map((d) => ({ date: d.date, ...d.money })),
    marketDue: {
      opening: output?.month.marketDue.opening ?? "0",
      added: output?.month.marketDue.added ?? "0",
      collected: output?.month.marketDue.collected ?? "0",
      closing: output?.month.marketDue.closing ?? "0",
      byDsr: (output?.month.marketDue.byDsr ?? []).map((d) => ({
        ...d,
        staffName: staffName(d.staffId),
      })),
    },
    staff: seen.canSeeStaff
      ? (output?.month.staff ?? []).map((s) => ({ ...s, staffName: staffName(s.staffId) }))
      : [],
    companyPayable: output?.month.companyPayable ?? {
      opening: "0",
      receipts: "0",
      deposits: "0",
      incentives: "0",
      damageRefunds: "0",
      closing: "0",
    },
    profit:
      seen.canSeeProfit && output
        ? {
            ...output.month.profit,
            expensesByCategory: Object.entries(output.month.profit.expensesByCategory).map(
              ([id, amount]) => ({ name: categories.get(id) ?? "", amount }),
            ),
          }
        : null,
    cashLeftTotal: output?.month.cashLeftTotal ?? "0",
    warnings: output?.warnings ?? [],
    ...seen,
  });
}

// ---------------------------------------------------------------- close and reopen

/**
 * Stores the engine's closing for `month` as the next month's opening and locks the month. The
 * exclusive company lock waits for in-flight postings (they hold it shared).
 */
export async function closeMonth(
  ctx: AppContext,
  companyId: string,
  monthInput: unknown,
  requestKey?: string,
): Promise<MonthCloseResult> {
  const access = await requirePermission(ctx, companyId, "period.close", { write: true });
  const month = parseMonth(monthInput);
  return runIdempotent(
    ctx,
    { scope: companyId, action: `month.close:${month}`, requestKey },
    { month },
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM company WHERE id = ${companyId} FOR UPDATE`;
      const active = await liveOpening(tx, companyId);
      const existing = await tx.monthClose.findUnique({
        where: { companyId_month: { companyId, month } },
        select: { id: true },
      });
      const status = monthStatus(month, active, Boolean(existing));
      if (status === "closed") throw invalid("month", "validation.month.alreadyClosed");
      if (status !== "open" || !active) throw invalid("month", "validation.month.notOpen");
      const blocker = await closeBlocker(tx, companyId, month, active);
      if (blocker) throw invalid("month", blocker);
      const run = await runLedger(tx, access, lastOfMonth(month), active);
      if (!run) throw invalid("month", "validation.month.notOpen");
      const row = await tx.monthClose.create({
        data: {
          tenantId: access.company.tenantId,
          companyId,
          month,
          closing: run.output.closing as unknown as Prisma.InputJsonValue,
          closedById: ctx.actor.userId,
        },
      });
      await recordAudit(tx, ctx, {
        companyId,
        action: "month.close",
        resourceType: "month_close",
        resourceId: row.id,
        after: {
          month,
          salesTotal: run.output.month.totals.salesTotal,
          profitTotal: run.output.month.totals.profitTotal,
          marketDue: run.output.month.marketDue.closing,
          cashLeftTotal: run.output.month.cashLeftTotal,
        },
      });
      return { month, status: "closed" as const };
    },
  );
}

/** Reopens the latest closed month; its stored closing is dropped and recalculated on read. */
export async function reopenMonth(
  ctx: AppContext,
  companyId: string,
  monthInput: unknown,
  requestKey?: string,
): Promise<MonthCloseResult> {
  await requirePermission(ctx, companyId, "period.close", { write: true });
  const month = parseMonth(monthInput);
  return runIdempotent(
    ctx,
    { scope: companyId, action: `month.reopen:${month}`, requestKey },
    { month },
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM company WHERE id = ${companyId} FOR UPDATE`;
      const row = await tx.monthClose.findUnique({
        where: { companyId_month: { companyId, month } },
      });
      if (!row) throw invalid("month", "validation.month.notClosed");
      const later = await tx.monthClose.findFirst({
        where: { companyId, month: { gt: month } },
        select: { id: true },
      });
      if (later) throw invalid("month", "validation.month.laterClosed");
      await tx.monthClose.delete({ where: { id: row.id } });
      await recordAudit(tx, ctx, {
        companyId,
        action: "month.reopen",
        resourceType: "month_close",
        resourceId: row.id,
        before: {
          month,
          closedAt: row.closedAt.toISOString(),
          closedById: row.closedById,
          closing: row.closing as unknown as MonthClosing,
        },
      });
      return { month, status: "open" as const };
    },
  );
}

// ---------------------------------------------------------------- range reports

type Column = { key: string; kind: ReportColumnKind; needs?: "cost" | "profit" };
type Cells = Record<string, string | null>;
type Names = Awaited<ReturnType<typeof namesFor>>;

const col = (key: string, kind: ReportColumnKind, needs?: Column["needs"]): Column =>
  needs ? { key, kind, needs } : { key, kind };

function table(
  title: string,
  columns: Column[],
  rows: { piecesPerCarton?: string; cells: Cells }[],
  totals: Cells | null,
  seen: Visibility,
): ReportTable {
  const shown = columns.filter(
    (c) => !c.needs || (c.needs === "cost" ? seen.canSeeCost : seen.canSeeProfit),
  );
  const keep = (cells: Cells) =>
    Object.fromEntries(shown.map((c) => [c.key, cells[c.key] ?? null]));
  return {
    title: `report.table.${title}`,
    columns: shown.map((c) => ({ key: c.key, label: `report.column.${c.key}`, kind: c.kind })),
    rows: rows.map((r) => ({ ...r, cells: keep(r.cells) })),
    totals: totals ? keep(totals) : null,
  };
}

function productRows(output: MonthOutput, names: Names, fields: readonly string[]) {
  return names.products.flatMap((product) => {
    const row = output.month.products.find((p) => p.productId === product.id) as
      Record<string, string> | undefined;
    if (!row) return [];
    const cells: Cells = { product: product.name, sku: product.sku };
    for (const f of fields) cells[f] = row[f] ?? null;
    return [{ piecesPerCarton: product.piecesPerCarton, cells }];
  });
}

function buildTables(
  id: ReportId,
  output: MonthOutput,
  names: Names,
  categories: Map<string, string>,
  seen: Visibility,
  from: string,
  dsrExtras?: DsrExtras,
): ReportTable[] {
  const m = output.month;
  const staffName = (sid: string) => names.staff.get(sid) ?? "";
  const product = col("product", "text");
  switch (id) {
    case "stock": {
      const fields = [
        "closingStock",
        "closingValue",
        "closingAtSale",
        "dueFromCompany",
        "incentiveReceived",
      ];
      return [
        table(
          "stock",
          [
            product,
            col("closingStock", "quantity"),
            col("closingValue", "money", "cost"),
            col("closingAtSale", "money"),
            col("dueFromCompany", "quantity"),
            col("incentiveReceived", "quantity"),
          ],
          productRows(output, names, fields),
          { closingValue: m.totals.closingValue },
          seen,
        ),
      ];
    }
    case "sales": {
      const fields = [
        "delivered",
        "damaged",
        "sold",
        "commissionTotal",
        "salesTotal",
        "returnValue",
      ];
      return [
        table(
          "salesByProduct",
          [
            product,
            col("delivered", "quantity"),
            col("damaged", "quantity"),
            col("sold", "quantity"),
            col("commissionTotal", "money"),
            col("salesTotal", "money"),
            col("returnValue", "money"),
          ],
          productRows(output, names, fields),
          { commissionTotal: m.totals.commissionTotal, salesTotal: m.totals.salesTotal },
          seen,
        ),
        table(
          "salesByDay",
          [col("date", "text"), col("commission", "money"), col("sales", "money")],
          output.days.map((d) => ({
            cells: { date: d.date, commission: d.money.commission, sales: d.money.sales },
          })),
          { commission: m.totals.commissionTotal, sales: m.totals.salesTotal },
          seen,
        ),
      ];
    }
    case "profit": {
      const fields = ["sold", "salesTotal", "costTotal", "profitTotal"];
      const p = m.profit;
      const line = (key: string, amount: string, label?: string) => ({
        cells: { line: label ?? key, amount },
      });
      return [
        table(
          "profitByProduct",
          [
            product,
            col("sold", "quantity"),
            col("salesTotal", "money"),
            col("costTotal", "money", "cost"),
            col("profitTotal", "money", "profit"),
          ],
          productRows(output, names, fields),
          {
            salesTotal: m.totals.salesTotal,
            costTotal: m.totals.costTotal,
            profitTotal: m.totals.profitTotal,
          },
          seen,
        ),
        table(
          "profitSummary",
          [col("line", "label"), col("amount", "money")],
          [
            line("report.line.gross", p.gross),
            line("report.line.salaries", p.salaries),
            ...Object.entries(p.expensesByCategory).map(([cid, amount]) =>
              line("", amount, categories.get(cid) ?? "report.line.uncategorized"),
            ),
            line("report.line.expenses", p.expenses),
            line("report.line.srIncentive", p.srIncentive),
            line("report.line.net", p.net),
            line("report.line.netWithoutIncentive", p.netWithoutIncentive),
          ],
          null,
          seen,
        ),
      ];
    }
    case "market-due":
      return [
        table(
          "marketDue",
          [
            col("staff", "text"),
            col("opening", "money"),
            col("added", "money"),
            col("collected", "money"),
            col("closing", "money"),
          ],
          m.marketDue.byDsr.map((d) => ({
            cells: {
              staff: staffName(d.staffId),
              opening: d.opening,
              added: d.added,
              collected: d.collected,
              closing: d.closing,
            },
          })),
          {
            opening: m.marketDue.opening,
            added: m.marketDue.added,
            collected: m.marketDue.collected,
            closing: m.marketDue.closing,
          },
          seen,
        ),
      ];
    case "company-due": {
      const fields = [
        "ordered",
        "received",
        "orderTotal",
        "receiptTotal",
        "dueFromCompany",
        "dueFromCompanyValue",
      ];
      const c = m.companyPayable;
      return [
        table(
          "companyDue",
          [
            product,
            col("ordered", "quantity"),
            col("received", "quantity"),
            col("orderTotal", "money"),
            col("receiptTotal", "money"),
            col("dueFromCompany", "quantity"),
            col("dueFromCompanyValue", "money"),
          ],
          productRows(output, names, fields),
          { orderTotal: m.totals.orderTotal, receiptTotal: m.totals.receiptTotal },
          seen,
        ),
        table(
          "companyPayable",
          [col("line", "label"), col("amount", "money")],
          [
            { cells: { line: "report.line.payableOpening", amount: c.opening } },
            { cells: { line: "report.line.payableReceipts", amount: c.receipts } },
            { cells: { line: "report.line.payableDeposits", amount: c.deposits } },
            { cells: { line: "report.line.payableIncentives", amount: c.incentives } },
            { cells: { line: "report.line.payableDamageRefunds", amount: c.damageRefunds } },
            { cells: { line: "report.line.payableClosing", amount: c.closing } },
          ],
          null,
          seen,
        ),
      ];
    }
    case "company-account": {
      const c = m.companyPayable;
      const productNames = new Map(names.products.map((p) => [p.id, p.name]));
      const sizes = new Map(names.products.map((p) => [p.id, p.piecesPerCarton]));
      return [
        table(
          "companyAccountSummary",
          [
            col("opening", "money"),
            col("receipts", "money"),
            col("deposits", "money"),
            col("incentives", "money"),
            col("damageRefunds", "money"),
            col("closing", "money"),
          ],
          [{ cells: { ...c } }],
          null,
          seen,
        ),
        table(
          "companyAccountStatement",
          [
            col("date", "text"),
            col("line", "label"),
            col("product", "text"),
            col("quantity", "quantity"),
            col("increase", "money"),
            col("decrease", "money"),
            col("balance", "money"),
          ],
          [
            {
              cells: {
                date: from,
                line: "report.line.company.opening",
                product: "",
                quantity: null,
                increase: null,
                decrease: null,
                balance: c.opening,
              },
            },
            ...output.companyEntries.map((e) => {
              const increase = e.kind === "receipt";
              const memo = e.kind === "freeGoods";
              return {
                ...(e.productId ? { piecesPerCarton: sizes.get(e.productId) ?? "1" } : {}),
                cells: {
                  date: e.date,
                  line: `report.line.company.${e.kind}`,
                  product: e.productId ? (productNames.get(e.productId) ?? "") : "",
                  quantity: e.quantity ?? null,
                  increase: increase && !memo ? e.amount : null,
                  decrease: increase || memo ? null : e.amount,
                  balance: e.balance,
                },
              };
            }),
          ],
          null,
          seen,
        ),
      ];
    }
    case "damage":
      return [
        table(
          "damage",
          [
            product,
            col("damaged", "quantity"),
            col("replacedFromStock", "quantity"),
            col("damageValue", "money", "cost"),
            col("replacementReceived", "quantity"),
            col("replacementValue", "money", "cost"),
          ],
          productRows(output, names, [
            "damaged",
            "replacedFromStock",
            "damageValue",
            "replacementReceived",
            "replacementValue",
          ]),
          { damageValue: m.totals.damageValue, replacementValue: m.totals.replacementValue },
          seen,
        ),
      ];
    case "cartons":
      return [
        table(
          "cartons",
          [
            product,
            col("piecesPerCarton", "text"),
            col("salesCartons", "cartons"),
            col("closingCartons", "cartons"),
          ],
          productRows(output, names, ["salesCartons", "closingCartons"]).map((r) => ({
            ...r,
            cells: { ...r.cells, piecesPerCarton: r.piecesPerCarton },
          })),
          null,
          seen,
        ),
      ];
    case "person-sales": {
      const sizes = new Map(names.products.map((p) => [p.id, p]));
      return [
        table(
          "personTotals",
          [col("staff", "text"), col("amount", "money")],
          m.persons.map((p) => ({ cells: { staff: staffName(p.staffId), amount: p.amount } })),
          null,
          seen,
        ),
        table(
          "personProducts",
          [col("staff", "text"), product, col("net", "quantity"), col("amount", "money")],
          m.persons.flatMap((p) =>
            p.products.map((row) => ({
              piecesPerCarton: sizes.get(row.productId)?.piecesPerCarton ?? "1",
              cells: {
                staff: staffName(p.staffId),
                product: sizes.get(row.productId)?.name ?? "",
                net: row.net,
                amount: row.amount,
              },
            })),
          ),
          null,
          seen,
        ),
      ];
    }
    case "staff-balances": {
      const keys = ["advance", "loan", "shortage", "credit", "salaryPayable", "srLoan", "owedToSr"];
      return [
        table(
          "staffBalances",
          [
            col("staff", "text"),
            ...keys.map((k) => col(k, "money")),
            col("owesUs", "money"),
            col("weOwe", "money"),
          ],
          m.staff.map((s) => ({
            cells: {
              staff: staffName(s.staffId),
              ...Object.fromEntries(
                keys.map((k) => [k, (s.closing as Record<string, string>)[k] ?? null]),
              ),
              owesUs: s.owesUs,
              weOwe: s.weOwe,
            },
          })),
          null,
          seen,
        ),
      ];
    }
    case "daily-cash": {
      const keys = [
        "sales",
        "marketDueNew",
        "marketDueCollected",
        "srIncentive",
        "expenses",
        "cashIn",
        "cashOut",
        "cashLeft",
        "banked",
      ] as const;
      return [
        table(
          "dailyCash",
          [col("date", "text"), ...keys.map((k) => col(k, "money"))],
          output.days.map((d) => ({
            cells: { date: d.date, ...Object.fromEntries(keys.map((k) => [k, d.money[k]])) },
          })),
          { sales: m.totals.salesTotal, cashLeft: m.cashLeftTotal },
          seen,
        ),
      ];
    }
    case "dsr-daily": {
      const sizes = new Map(names.products.map((p) => [p.id, p]));
      return [
        table(
          "dsrDaily",
          [
            col("date", "text"),
            col("staff", "text"),
            col("sales", "money"),
            col("marketDueNew", "money"),
            col("marketDueCollected", "money"),
            col("costPaid", "money"),
            col("expectedCash", "money"),
            col("handedOver", "money"),
            col("difference", "money"),
            col("flag", "label"),
          ],
          output.days.flatMap((d) =>
            d.dsrs.map((r) => {
              const extra = dsrExtras?.get(`${d.date}|${r.staffId}`);
              const cash = dsrCashSettlement({
                sales: r.sales,
                dueGiven: r.marketDueNew,
                dueCollected: r.marketDueCollected,
                expenses: r.costPaid,
                handedOver: extra?.handedOver ?? null,
              });
              return {
                cells: {
                  date: d.date,
                  staff: staffName(r.staffId),
                  sales: r.sales,
                  marketDueNew: r.marketDueNew,
                  marketDueCollected: r.marketDueCollected,
                  costPaid: r.costPaid,
                  expectedCash: cash.expected,
                  handedOver: cash.handedOver,
                  difference: cash.difference,
                  flag: extra?.stockMismatch ? "report.flag.stockMismatch" : "",
                },
              };
            }),
          ),
          null,
          seen,
        ),
        table(
          "dsrDailyProducts",
          [
            col("date", "text"),
            col("staff", "text"),
            product,
            col("issued", "quantity"),
            col("returned", "quantity"),
            col("damaged", "quantity"),
            col("sold", "quantity"),
            col("commission", "money"),
            col("soldValue", "money"),
          ],
          output.days.flatMap((d) =>
            d.persons.map((p) => ({
              piecesPerCarton: sizes.get(p.productId)?.piecesPerCarton ?? "1",
              cells: {
                date: d.date,
                staff: staffName(p.staffId),
                product: sizes.get(p.productId)?.name ?? "",
                issued: p.issued,
                returned: p.returned,
                damaged: p.damaged,
                sold: p.sold,
                commission: p.commission,
                soldValue: p.soldValue,
              },
            })),
          ),
          null,
          seen,
        ),
      ];
    }
  }
}

type DsrExtras = Map<string, { handedOver: string | null; stockMismatch: boolean }>;

/**
 * Per posted DSR day (`date|staffId`): the cash handed over (D39) and whether the sheet's firot
 * or damage differs from what the field visits left in hand (D40).
 */
async function loadDsrExtras(
  db: Db,
  companyId: string,
  from: string,
  to: string,
): Promise<DsrExtras> {
  const range = { gte: toDbDate(from), lte: toDbDate(to) };
  const [sheets, visits] = await Promise.all([
    db.dsrDay.findMany({
      where: { companyId, status: "posted", date: range },
      select: {
        staffId: true,
        date: true,
        cashHandedOver: true,
        lines: { select: { productId: true, issued: true, returned: true, damaged: true } },
      },
    }),
    db.fieldVisit.findMany({
      where: { companyId, status: "locked", date: range },
      select: {
        staffId: true,
        date: true,
        lines: { select: { productId: true, delivered: true, exchanged: true } },
      },
    }),
  ]);
  const used = new Map<string, { delivered: string; exchanged: string }[]>();
  for (const v of visits) {
    for (const l of v.lines) {
      const key = `${fromDbDate(v.date)}|${v.staffId}|${l.productId}`;
      used.set(key, [
        ...(used.get(key) ?? []),
        { delivered: plain(l.delivered), exchanged: plain(l.exchanged) },
      ]);
    }
  }
  const withVisits = new Set(visits.map((v) => `${fromDbDate(v.date)}|${v.staffId}`));
  const extras: DsrExtras = new Map();
  for (const s of sheets) {
    const key = `${fromDbDate(s.date)}|${s.staffId}`;
    const stockMismatch =
      withVisits.has(key) &&
      s.lines.some((l) => {
        const lines = used.get(`${key}|${l.productId}`) ?? [];
        const expected = fieldRemaining(plain(l.issued), lines);
        const exchanged = sumQuantities(["0", ...lines.map((u) => u.exchanged)]);
        return (
          !toDecimal(plain(l.returned)).eq(toDecimal(expected)) ||
          !toDecimal(plain(l.damaged)).eq(toDecimal(exchanged))
        );
      });
    extras.set(key, {
      handedOver: s.cashHandedOver === null ? null : plain(s.cashHandedOver),
      stockMismatch,
    });
  }
  return extras;
}

/** One report over [from, to] from a single engine run (PLAN §6). `to` stops at today. */
export async function getReport(
  ctx: AppContext,
  companyId: string,
  reportInput: unknown,
  query: unknown,
): Promise<Report> {
  const access = await requirePermission(ctx, companyId, "report.view");
  const id = reportIds.find((r) => r === reportInput);
  if (!id) throw invalid("report", "validation.report.unknown");
  const seen = visibility(access);
  if (!canViewReport(id, access.permissions)) throw new AppError("FORBIDDEN");
  const range = parseReportRange(query);
  const to = range.to;

  const active = await liveOpening(ctx.db, companyId);
  const run = await rangeRun(ctx.db, access, range.from, to, active);
  const [names, categories, dsrExtras] = await Promise.all([
    namesFor(ctx.db, access, run?.from ?? range.from),
    categoryNames(ctx.db, access.company.tenantId),
    run && id === "dsr-daily" ? loadDsrExtras(ctx.db, companyId, run.from, to) : undefined,
  ]);
  return reportSchema.parse({
    report: id,
    from: run?.from ?? range.from,
    to,
    cutoffDate: active?.cutoffDate ?? null,
    tables: run ? buildTables(id, run.output, names, categories, seen, run.from, dsrExtras) : [],
    warnings: run?.output.warnings ?? [],
  });
}

export type ReportFile = { fileName: string; contentType: string; data: Uint8Array };

/** The same report as CSV or XLSX; needs `report.export` as well. */
export async function exportReport(
  ctx: AppContext,
  companyId: string,
  reportInput: unknown,
  query: unknown,
  format: unknown,
): Promise<ReportFile> {
  await requirePermission(ctx, companyId, "report.export");
  if (format !== "csv" && format !== "xlsx") throw invalid("format", "validation.report.format");
  const report = await getReport(ctx, companyId, reportInput, query);
  return toReportFile(report, `${report.report}_${report.from}_${report.to}`, format);
}

/** CSV or XLSX bytes for any table set (reports, staff statements). */
export async function toReportFile(
  report: ExportableReport,
  base: string,
  format: "csv" | "xlsx",
): Promise<ReportFile> {
  if (format === "csv") {
    return {
      fileName: `${base}.csv`,
      contentType: "text/csv; charset=utf-8",
      data: new TextEncoder().encode(reportCsv(report)),
    };
  }
  return {
    fileName: `${base}.xlsx`,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    data: await buildReportWorkbook(report),
  };
}
