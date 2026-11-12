import {
  companyCheckBulkCreateRequestSchema,
  companyCheckHistoryListSchema,
  companyCheckListSchema,
  companyCheckPaymentRequestSchema,
  companyCheckPaymentSchema,
  companyCheckPickerListSchema,
  companyCheckSchema,
  type CompanyCheckBulkCreateRequest,
  type CompanyCheckHistoryList,
  type CompanyCheckList,
  type CompanyCheckPaymentRecord,
  type CompanyCheckPaymentRequest,
  type CompanyCheckPickerList,
  type CompanyCheckRecord,
} from "@bsd/contracts";
import {
  checkDueRemaining,
  checkIsCompleted,
  roundSettlement,
  stockEntryAmount,
  sumAmounts,
  toDecimal,
} from "@bsd/domain";
import { requirePermission } from "./access";
import { recordAudit } from "./audit";
import type { AppContext, Tx } from "./context";
import { fromDbDate, toDbDate } from "./dates";
import { plain, type DecimalLike } from "./numeric";
import { invalid, parseInput } from "./errors";
import { runIdempotent } from "./idempotency";

function amountsOf(rows: { amount: DecimalLike; status: string }[]): string[] {
  return rows.filter((row) => row.status === "posted").map((row) => plain(row.amount));
}

function recordOf(row: {
  id: string;
  bankName: string;
  checkNumber: string;
  createdAt: Date;
  charges: { amount: DecimalLike; status: string }[];
  payments: { amount: DecimalLike; status: string }[];
}): CompanyCheckRecord {
  const charges = amountsOf(row.charges);
  const payments = amountsOf(row.payments);
  return companyCheckSchema.parse({
    id: row.id,
    bankName: row.bankName,
    checkNumber: row.checkNumber,
    chargedTotal: roundSettlement(sumAmounts(charges.length ? charges : ["0"])),
    paidTotal: roundSettlement(sumAmounts(payments.length ? payments : ["0"])),
    due: checkDueRemaining(charges, payments),
    createdAt: row.createdAt.toISOString(),
  });
}

const checkInclude = {
  charges: { select: { amount: true, status: true } },
  payments: { select: { amount: true, status: true } },
} as const;

/** Active due cheques (due > 0) for the company-checks page. */
export async function listCompanyCheckDues(
  ctx: AppContext,
  companyId: string,
): Promise<CompanyCheckList> {
  await requirePermission(ctx, companyId, "finance.view");
  const rows = await ctx.db.companyCheck.findMany({
    where: { companyId },
    include: checkInclude,
    orderBy: [{ bankName: "asc" }, { checkNumber: "asc" }],
  });
  const items = rows.map(recordOf).filter((row) => /[1-9]/.test(row.due));
  return companyCheckListSchema.parse({ items });
}

/** Cheques that can still receive an order bill (not fully paid). */
export async function listCompanyCheckPicker(
  ctx: AppContext,
  companyId: string,
): Promise<CompanyCheckPickerList> {
  await requirePermission(ctx, companyId, "purchase.view");
  const rows = await ctx.db.companyCheck.findMany({
    where: { companyId },
    include: checkInclude,
    orderBy: [{ bankName: "asc" }, { checkNumber: "asc" }],
  });
  const items = rows
    .map((row) => {
      const charges = amountsOf(row.charges);
      const payments = amountsOf(row.payments);
      if (checkIsCompleted(charges, payments)) return null;
      const due = checkDueRemaining(charges, payments);
      return {
        id: row.id,
        bankName: row.bankName,
        checkNumber: row.checkNumber,
        due,
        label: `${row.bankName} · ${row.checkNumber}`,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
  return companyCheckPickerListSchema.parse({ items });
}

/** Bulk register cheques (bank + number only). */
export async function bulkCreateCompanyChecks(
  ctx: AppContext,
  companyId: string,
  input: unknown,
  requestKey?: string,
): Promise<CompanyCheckList> {
  const access = await requirePermission(ctx, companyId, "payment.post", { write: true });
  const request = parseInput(
    companyCheckBulkCreateRequestSchema,
    input,
  ) as CompanyCheckBulkCreateRequest;
  return runIdempotent(
    ctx,
    { scope: companyId, action: "companyCheck.bulkCreate", requestKey },
    request,
    async (tx) => {
      const seen = new Set<string>();
      for (const [index, row] of request.rows.entries()) {
        const key = `${row.bankName.trim().toLowerCase()}|${row.checkNumber.trim().toLowerCase()}`;
        if (seen.has(key))
          throw invalid(`rows.${index}.checkNumber`, "validation.companyCheck.duplicate");
        seen.add(key);
      }
      const created = [];
      for (const [index, row] of request.rows.entries()) {
        const bankName = row.bankName.trim();
        const checkNumber = row.checkNumber.trim();
        const existing = await tx.companyCheck.findFirst({
          where: { companyId, bankName, checkNumber },
        });
        if (existing) {
          throw invalid(`rows.${index}.checkNumber`, "validation.companyCheck.exists");
        }
        const check = await tx.companyCheck.create({
          data: {
            tenantId: access.company.tenantId,
            companyId,
            bankName,
            checkNumber,
          },
          include: checkInclude,
        });
        created.push(recordOf(check));
      }
      await recordAudit(tx, ctx, {
        companyId,
        action: "companyCheck.bulkCreate",
        resourceType: "companyCheck",
        resourceId: companyId,
        after: { count: created.length, ids: created.map((c) => c.id) },
      });
      return companyCheckListSchema.parse({ items: created });
    },
  );
}

/** Partial or full cash repayment against a cheque due (D129). */
export async function postCompanyCheckPayment(
  ctx: AppContext,
  companyId: string,
  input: unknown,
  requestKey?: string,
): Promise<CompanyCheckPaymentRecord> {
  const access = await requirePermission(ctx, companyId, "payment.post", { write: true });
  const request = parseInput(companyCheckPaymentRequestSchema, input) as CompanyCheckPaymentRequest;
  return runIdempotent(
    ctx,
    {
      scope: companyId,
      action: `companyCheck.pay:${request.companyCheckId}:${request.date}:${request.amount}`,
      requestKey,
    },
    request,
    async (tx) => {
      // Lazy import avoids a daily ↔ company-check cycle (orders also create check charges).
      const { postingGuard } = await import("./daily");
      await postingGuard(tx, companyId, request.date);
      const check = await tx.companyCheck.findFirst({
        where: { id: request.companyCheckId, companyId },
        include: checkInclude,
      });
      if (!check) throw invalid("companyCheckId", "validation.companyCheck.unknown");
      const due = toDecimal(checkDueRemaining(amountsOf(check.charges), amountsOf(check.payments)));
      const amount = toDecimal(request.amount);
      if (amount.lte(0)) throw invalid("amount", "validation.amountPositive");
      if (amount.gt(due)) throw invalid("amount", "validation.companyCheck.exceedsDue");
      const money = await tx.moneyEntry.create({
        data: {
          tenantId: access.company.tenantId,
          companyId,
          date: toDbDate(request.date),
          kind: "companyCheckPayment",
          amount: request.amount,
          reference: check.checkNumber,
          note: `${check.bankName} · ${check.checkNumber}`,
          createdById: ctx.actor.userId,
        },
      });
      const payment = await tx.companyCheckPayment.create({
        data: {
          tenantId: access.company.tenantId,
          companyId,
          companyCheckId: check.id,
          moneyEntryId: money.id,
          amount: request.amount,
          date: toDbDate(request.date),
          createdById: ctx.actor.userId,
        },
      });
      await recordAudit(tx, ctx, {
        companyId,
        action: "companyCheck.pay",
        resourceType: "companyCheck",
        resourceId: check.id,
        after: { paymentId: payment.id, amount: request.amount, date: request.date },
      });
      return companyCheckPaymentSchema.parse({
        id: payment.id,
        companyCheckId: check.id,
        amount: plain(payment.amount),
        date: request.date,
        moneyEntryId: money.id,
      });
    },
  );
}

/** Completed cheques for History (due 0 after at least one charge). */
export async function listCompanyCheckHistory(
  ctx: AppContext,
  companyId: string,
): Promise<CompanyCheckHistoryList> {
  await requirePermission(ctx, companyId, "finance.view");
  const rows = await ctx.db.companyCheck.findMany({
    where: { companyId },
    include: {
      charges: {
        where: { status: "posted" },
        include: { stockEntry: { select: { date: true } } },
        orderBy: { createdAt: "asc" },
      },
      payments: {
        where: { status: "posted" },
        orderBy: [{ date: "asc" }, { createdAt: "asc" }],
      },
    },
    orderBy: [{ updatedAt: "desc" }],
  });
  const items = rows
    .map((row) => {
      const chargeAmounts = row.charges.map((c) => plain(c.amount));
      const paymentAmounts = row.payments.map((p) => plain(p.amount));
      if (!checkIsCompleted(chargeAmounts, paymentAmounts)) return null;
      const lastPayment = row.payments[row.payments.length - 1];
      const lastCharge = row.charges[row.charges.length - 1];
      const completedAt =
        lastPayment?.createdAt.toISOString() ??
        lastCharge?.createdAt.toISOString() ??
        row.updatedAt.toISOString();
      return {
        id: row.id,
        bankName: row.bankName,
        checkNumber: row.checkNumber,
        chargedTotal: roundSettlement(sumAmounts(chargeAmounts)),
        paidTotal: roundSettlement(sumAmounts(paymentAmounts)),
        completedAt,
        lines: [
          ...row.charges.map((c) => ({
            kind: "charge" as const,
            id: c.id,
            date: fromDbDate(c.stockEntry.date),
            amount: plain(c.amount),
            note: "order",
          })),
          ...row.payments.map((p) => ({
            kind: "payment" as const,
            id: p.id,
            date: fromDbDate(p.date),
            amount: plain(p.amount),
            note: "payment",
          })),
        ],
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
  return companyCheckHistoryListSchema.parse({ items });
}

/** Create charge rows for posted order lines that name a cheque (D129). */
export async function createCheckChargesForEntries(
  tx: Tx,
  args: {
    tenantId: string;
    companyId: string;
    companyCheckId: string;
    orderGroup: string | null;
    entries: {
      id: string;
      pieces: DecimalLike;
      cartonRate: DecimalLike | null;
      piecesPerCarton: number | null;
      kind: string;
    }[];
  },
): Promise<void> {
  for (const entry of args.entries) {
    if (entry.kind !== "order") continue;
    const amount = stockEntryAmount({
      kind: "order",
      pieces: plain(entry.pieces),
      cartonRate: entry.cartonRate === null ? null : plain(entry.cartonRate),
      piecesPerCarton: entry.piecesPerCarton === null ? null : String(entry.piecesPerCarton),
      costPrice: null,
      unitPrice: null,
    });
    if (!/[1-9]/.test(amount)) continue;
    await tx.companyCheckCharge.create({
      data: {
        tenantId: args.tenantId,
        companyId: args.companyId,
        companyCheckId: args.companyCheckId,
        stockEntryId: entry.id,
        orderGroup: args.orderGroup,
        amount,
      },
    });
  }
}

/** Reverse cheque charge when its stock entry reverses; refuse if payments would exceed charges. */
export async function reverseCheckChargeForEntry(tx: Tx, stockEntryId: string): Promise<void> {
  const charge = await tx.companyCheckCharge.findFirst({
    where: { stockEntryId, status: "posted" },
  });
  if (!charge) return;
  const check = await tx.companyCheck.findUniqueOrThrow({
    where: { id: charge.companyCheckId },
    include: {
      charges: { where: { status: "posted" }, select: { id: true, amount: true } },
      payments: { where: { status: "posted" }, select: { amount: true } },
    },
  });
  const remainingCharges = check.charges
    .filter((c) => c.id !== charge.id)
    .map((c) => plain(c.amount));
  const payments = check.payments.map((p) => plain(p.amount));
  const chargedLeft = remainingCharges.reduce((sum, a) => sum.add(toDecimal(a)), toDecimal("0"));
  const paid = payments.reduce((sum, a) => sum.add(toDecimal(a)), toDecimal("0"));
  if (paid.gt(chargedLeft)) {
    throw invalid("", "validation.companyCheck.reverseBlocked");
  }
  await tx.companyCheckCharge.update({
    where: { id: charge.id },
    data: { status: "reversed", reversedAt: new Date() },
  });
}

/** Validate a cheque is usable for a new order (exists, not completed). */
export async function assertCheckUsable(
  tx: Tx,
  companyId: string,
  companyCheckId: string,
): Promise<void> {
  const check = await tx.companyCheck.findFirst({
    where: { id: companyCheckId, companyId },
    include: checkInclude,
  });
  if (!check) throw invalid("companyCheckId", "validation.companyCheck.unknown");
  if (checkIsCompleted(amountsOf(check.charges), amountsOf(check.payments))) {
    throw invalid("companyCheckId", "validation.companyCheck.completed");
  }
}
