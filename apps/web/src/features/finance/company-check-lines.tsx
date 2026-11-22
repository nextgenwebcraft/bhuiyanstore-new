"use client";

import type { CompanyCheckHistoryLine } from "@bsd/contracts";
import { formatMoney, formatShortDate, t } from "@bsd/i18n";
import { tableClass, tdClass, tdNum, thClass, thNum, theadClass } from "@/components/data-table";
import { TableScroller } from "@/components/table-scroller";

/**
 * D145: a cheque's dated records (order bills and repayments), oldest first, with the due left
 * after each one. Shared by the active cheque page and History.
 */
export function CompanyCheckLines({
  lines,
  className = "",
}: {
  lines: readonly CompanyCheckHistoryLine[];
  className?: string;
}) {
  return (
    <TableScroller className={className}>
      <table className={tableClass}>
        <thead className={theadClass}>
          <tr>
            <th scope="col" className={thClass}>
              {t("companyCheck.line.date")}
            </th>
            <th scope="col" className={thClass}>
              {t("companyCheck.line.kind")}
            </th>
            <th scope="col" className={thNum}>
              {t("companyCheck.amount")}
            </th>
            <th scope="col" className={thNum}>
              {t("companyCheck.line.balance")}
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id} className="border-t border-border">
              <td className={`${tdClass} whitespace-nowrap`}>{formatShortDate(line.date)}</td>
              <td className={tdClass}>
                <span className={line.kind === "payment" ? "text-success" : ""}>
                  {t(
                    line.kind === "charge"
                      ? "companyCheck.line.charge"
                      : "companyCheck.line.payment",
                  )}
                </span>
              </td>
              <td className={`${tdNum} ${line.kind === "payment" ? "text-success" : ""}`}>
                {line.kind === "payment" ? "− " : ""}
                {formatMoney(line.amount)}
              </td>
              <td className={`${tdNum} font-medium`}>{formatMoney(line.balance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroller>
  );
}
