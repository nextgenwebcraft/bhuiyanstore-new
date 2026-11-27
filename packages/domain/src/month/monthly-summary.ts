import { Decimal, toDecimal, type DecimalInput } from "../decimal";
import { roundSettlement } from "../money";
import { MONEY_KIND_EFFECTS } from "./money-kinds";
import type { MoneyKind } from "./types";

/**
 * D148 History → মাসিক সারসংক্ষেপ: the month's khoroch split into অপারেটিং খরচ and each staff
 * role's খরচ (বেতনসহ), and the net profit after all of them.
 *
 * - Staff খরচ = posted salary accrual (salary − absent fee, D67) + category expenses booked on that
 *   person (`staffCostPaid`, or an `expense` carrying a staff id).
 * - অপারেটিং খরচ = category expenses with no staff.
 * - Advances, loans and shortages are not khoroch: they are owed back and recovered from salary.
 * - নিট লাভ = বিক্রয় লাভ (dashboard `salesProfit`) − অপারেটিং খরচ − Σ staff খরচ.
 */

export type KhorochEntry = { kind: MoneyKind; amount: DecimalInput; staffId?: string };
export type StaffRoleRef = { roleId: string; roleName: string };

export type StaffKhoroch = { staffId: string; salary: string; expenses: string; total: string };
export type RoleKhoroch = StaffRoleRef & {
  salary: string;
  expenses: string;
  total: string;
  staff: StaffKhoroch[];
};

export type MonthKhoroch = {
  operating: string;
  roles: RoleKhoroch[];
  /** Σ every role's total. */
  staffTotal: string;
};

const ZERO = new Decimal(0);

export function monthKhoroch(
  entries: readonly KhorochEntry[],
  roleOf: ReadonlyMap<string, StaffRoleRef>,
): MonthKhoroch {
  let operating = ZERO;
  const people = new Map<string, { salary: Decimal; expenses: Decimal }>();
  const person = (staffId: string) => {
    let row = people.get(staffId);
    if (!row) {
      row = { salary: ZERO, expenses: ZERO };
      people.set(staffId, row);
    }
    return row;
  };
  for (const entry of entries) {
    const effect = MONEY_KIND_EFFECTS[entry.kind];
    const amount = toDecimal(entry.amount);
    if (effect.expense === "salary" && entry.staffId) {
      person(entry.staffId).salary = person(entry.staffId).salary.add(amount);
    } else if (effect.expense === "category") {
      if (entry.staffId) {
        person(entry.staffId).expenses = person(entry.staffId).expenses.add(amount);
      } else {
        operating = operating.add(amount);
      }
    }
  }

  const roles = new Map<string, StaffRoleRef & { staff: StaffKhoroch[] }>();
  for (const [staffId, row] of people) {
    const ref = roleOf.get(staffId) ?? { roleId: "", roleName: "" };
    const group = roles.get(ref.roleId) ?? { ...ref, staff: [] };
    group.staff.push({
      staffId,
      salary: roundSettlement(row.salary),
      expenses: roundSettlement(row.expenses),
      total: roundSettlement(row.salary.add(row.expenses)),
    });
    roles.set(ref.roleId, group);
  }
  const sum = (values: readonly string[]) =>
    values.reduce((total, v) => total.add(toDecimal(v)), ZERO);
  const roleRows = [...roles.values()].map((group) => ({
    roleId: group.roleId,
    roleName: group.roleName,
    salary: roundSettlement(sum(group.staff.map((s) => s.salary))),
    expenses: roundSettlement(sum(group.staff.map((s) => s.expenses))),
    total: roundSettlement(sum(group.staff.map((s) => s.total))),
    staff: group.staff,
  }));
  return {
    operating: roundSettlement(operating),
    roles: roleRows,
    staffTotal: roundSettlement(sum(roleRows.map((r) => r.total))),
  };
}

/** নিট লাভ = বিক্রয় লাভ − অপারেটিং খরচ − staff খরচ (D148). */
export function monthNetProfit(
  salesProfit: DecimalInput,
  khoroch: Pick<MonthKhoroch, "operating" | "staffTotal">,
): string {
  return roundSettlement(
    toDecimal(salesProfit).sub(toDecimal(khoroch.operating)).sub(toDecimal(khoroch.staffTotal)),
  );
}
