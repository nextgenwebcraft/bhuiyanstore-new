import { dsrCashSettlement, handoverShortOf, sumAmounts, toDecimal } from "@bsd/domain";
import type { AppContext, Tx } from "./context";
import { fromDbDate, toDbDate } from "./dates";
import { plain } from "./numeric";

/**
 * D81: the day's handover shorts. Each row is expected cash minus what was handed over, when that
 * is a shortfall. Nothing here is posted: cash, staff balances and profit stay as they are.
 */

type Db = AppContext["db"] | Tx;

export type HandoverShort = {
  staffId: string;
  staffName: string;
  date: string;
  amount: string;
};

const MONEY_KINDS = [
  "marketDueNew",
  "marketDueCollected",
  "staffCostPaid",
  "staffAdvance",
  "staffShortage",
  "staffRepayment",
  "srLoan",
  "srRepayment",
  "expense",
] as const;

type MoneyRow = {
  staffId: string | null;
  date: Date;
  kind: string;
  amount: Parameters<typeof plain>[0];
  srLoanType: string | null;
};

function text(value: Parameters<typeof plain>[0] | null): string {
  return value === null ? "0" : plain(value);
}

function sumOf(rows: MoneyRow[], kind: string, skipCommission = false): string {
  return sumAmounts([
    "0",
    ...rows
      .filter((row) => row.kind === kind && (!skipCommission || row.srLoanType !== "commission"))
      .map((row) => text(row.amount)),
  ]);
}

/** Shorts on live sheets in [from, to] whose handover is below the expected cash. */
export async function listHandoverShorts(
  db: Db,
  companyId: string,
  from: string,
  to: string,
): Promise<HandoverShort[]> {
  const range = { gte: toDbDate(from), lte: toDbDate(to) };
  const [days, entries, visits] = await Promise.all([
    db.dsrDay.findMany({
      where: {
        companyId,
        status: { not: "reversed" },
        cashHandedOver: { not: null },
        date: range,
      },
      include: {
        staff: { select: { name: true } },
        lines: {
          select: {
            issued: true,
            returned: true,
            damaged: true,
            commission: true,
            salePrice: true,
            dsrStaffId: true,
          },
        },
      },
    }),
    db.moneyEntry.findMany({
      where: {
        companyId,
        status: "posted",
        date: range,
        kind: { in: [...MONEY_KINDS] },
      },
      select: { staffId: true, date: true, kind: true, amount: true, srLoanType: true },
    }),
    db.fieldVisit.findMany({
      where: { companyId, date: range },
      include: {
        lines: { select: { delivered: true, unitPrice: true } },
      },
    }),
  ]);

  const moneyByDate = new Map<string, MoneyRow[]>();
  for (const entry of entries) {
    const key = fromDbDate(entry.date);
    const list = moneyByDate.get(key) ?? [];
    list.push(entry);
    moneyByDate.set(key, list);
  }
  const visitsByKey = new Map<string, typeof visits>();
  for (const visit of visits) {
    const key = `${visit.staffId}|${fromDbDate(visit.date)}`;
    const list = visitsByKey.get(key) ?? [];
    list.push(visit);
    visitsByKey.set(key, list);
  }

  const shorts: HandoverShort[] = [];
  for (const day of days) {
    if (day.cashHandedOver === null) continue;
    const date = fromDbDate(day.date);
    const dayMoney = moneyByDate.get(date) ?? [];
    const dsrIds = new Set(day.lines.map((l) => l.dsrStaffId));
    const teamMoney = dayMoney.filter((e) => e.staffId !== null && dsrIds.has(e.staffId));
    const srMoney = dayMoney.filter((e) => e.staffId === day.staffId);
    const dsrOnly = teamMoney.filter((e) => e.staffId !== day.staffId);
    const field = visitsByKey.get(`${day.staffId}|${date}`) ?? [];
    const sales = sumAmounts(
      day.lines.map((line) => {
        const sold = toDecimal(text(line.issued)).sub(text(line.returned)).sub(text(line.damaged));
        return sold
          .mul(line.salePrice === null ? "0" : text(line.salePrice))
          .sub(text(line.commission))
          .toString();
      }),
    );
    const fieldDueGiven =
      field.length > 0
        ? toDecimal(
            sumAmounts(
              field.flatMap((visit) =>
                visit.lines.map((line) =>
                  toDecimal(text(line.delivered)).mul(text(line.unitPrice)).toString(),
                ),
              ),
            ),
          )
            .sub(sumAmounts(["0", ...field.map((visit) => text(visit.cashReceived))]))
            .toString()
        : "0";
    const dueGiven = sumAmounts([
      fieldDueGiven,
      sumOf(dsrOnly, "marketDueNew"),
      text(day.marketDueNew),
    ]);
    const dueCollected = sumAmounts([
      field.length > 0
        ? sumAmounts(["0", ...field.map((visit) => text(visit.dueCollected))])
        : "0",
      sumOf(dsrOnly, "marketDueCollected"),
      text(day.marketDueCollected),
    ]);
    const staffMoney = toDecimal(sumOf(srMoney, "staffRepayment"))
      .add(sumOf(dsrOnly, "staffRepayment"))
      .add(sumOf(srMoney, "srRepayment", true))
      .sub(sumOf(srMoney, "staffAdvance"))
      .sub(sumOf(dsrOnly, "staffAdvance"))
      .sub(sumOf(srMoney, "staffShortage"))
      .sub(sumOf(dsrOnly, "staffShortage"))
      .sub(sumOf(srMoney, "srLoan", true));
    const settlement = dsrCashSettlement({
      sales,
      dueGiven,
      dueCollected,
      expenses: sumOf(teamMoney, "staffCostPaid"),
      operatingCost: sumOf(
        dayMoney.filter((e) => e.kind === "expense"),
        "expense",
      ),
      staffMoney: staffMoney.toString(),
      handedOver: text(day.cashHandedOver),
    });
    const amount = handoverShortOf(settlement.difference);
    if (amount === null) continue;
    shorts.push({ staffId: day.staffId, staffName: day.staff.name, date, amount });
  }
  return shorts.sort(
    (a, b) => a.date.localeCompare(b.date) || a.staffName.localeCompare(b.staffName),
  );
}
