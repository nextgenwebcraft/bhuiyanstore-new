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
          },
        },
      },
    }),
    db.moneyEntry.findMany({
      where: {
        companyId,
        status: "posted",
        staffId: { not: null },
        date: range,
        kind: { in: [...MONEY_KINDS] },
      },
      select: { staffId: true, date: true, kind: true, amount: true, srLoanType: true },
    }),
    db.fieldVisit.findMany({
      where: { companyId, date: range },
      include: { lines: { select: { delivered: true, unitPrice: true } } },
    }),
  ]);

  const moneyByKey = new Map<string, MoneyRow[]>();
  for (const entry of entries) {
    if (!entry.staffId) continue;
    const key = `${entry.staffId}|${fromDbDate(entry.date)}`;
    const list = moneyByKey.get(key) ?? [];
    list.push(entry);
    moneyByKey.set(key, list);
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
    const key = `${day.staffId}|${date}`;
    const money = moneyByKey.get(key) ?? [];
    const field = visitsByKey.get(key) ?? [];
    const sales = sumAmounts(
      day.lines.map((line) => {
        const sold = toDecimal(text(line.issued)).sub(text(line.returned)).sub(text(line.damaged));
        return sold
          .mul(line.salePrice === null ? "0" : text(line.salePrice))
          .sub(text(line.commission))
          .toString();
      }),
    );
    const dueGiven =
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
        : sumAmounts([text(day.marketDueNew), sumOf(money, "marketDueNew")]);
    const dueCollected =
      field.length > 0
        ? sumAmounts(["0", ...field.map((visit) => text(visit.dueCollected))])
        : sumAmounts([text(day.marketDueCollected), sumOf(money, "marketDueCollected")]);
    const staffMoney = toDecimal(sumOf(money, "staffRepayment"))
      .add(sumOf(money, "srRepayment", true))
      .sub(sumOf(money, "staffAdvance"))
      .sub(sumOf(money, "staffShortage"))
      .sub(sumOf(money, "srLoan", true));
    const settlement = dsrCashSettlement({
      sales,
      dueGiven,
      dueCollected,
      expenses: sumOf(money, "staffCostPaid"),
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
