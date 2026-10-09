import type { AppContext, Tx } from "./context";

type Db = AppContext["db"] | Tx;

/** The next free `D-YYYYMMDD-n` damage case number for the date. */
export async function nextCaseNumber(db: Db, companyId: string, date: string): Promise<string> {
  const prefix = `D-${date.replaceAll("-", "")}-`;
  const taken = new Set(
    (
      await db.damageCase.findMany({
        where: { companyId, caseNumber: { startsWith: prefix } },
        select: { caseNumber: true },
      })
    ).map((c) => c.caseNumber),
  );
  let n = taken.size + 1;
  while (taken.has(`${prefix}${n}`)) n += 1;
  return `${prefix}${n}`;
}
