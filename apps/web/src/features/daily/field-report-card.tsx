"use client";

import type { DsrDay } from "@bsd/contracts";
import { sumQuantities } from "@bsd/domain";
import { t } from "@bsd/i18n";
import { Button } from "@/components/button";
import {
  quantity,
  tableClass,
  tdClass,
  tdNum,
  thClass,
  thNum,
  theadClass,
} from "@/components/data-table";
import { TableScroller } from "@/components/table-scroller";
import { useDecideFieldReport } from "@/data/queries";
import { useAsyncAction } from "@/lib/async-action";

type Report = NonNullable<DsrDay["fieldReport"]>;

/**
 * D71: firot and damage the DSR sent from the field after the sheet was posted, beside the
 * sheet's own. Approving puts them into the sheet (a correction); rejecting drops them.
 */
export function FieldReportCard({
  companyId,
  sheet,
  report,
  canDecide,
}: {
  companyId: string;
  sheet: DsrDay;
  report: Report;
  canDecide: boolean;
}) {
  const decide = useDecideFieldReport(companyId);
  const action = useAsyncAction();
  const onSheet = (productId: string, field: "returned" | "damaged") =>
    sumQuantities([
      "0",
      ...sheet.lines.filter((l) => l.productId === productId).map((l) => l[field]),
    ]);
  const run = (kind: "approve" | "reject") =>
    void action.run(
      () => decide.mutateAsync({ reportId: report.id, action: kind, version: report.version }),
      { confirm: kind === "approve" ? "dsr.report.approveConfirm" : "dsr.report.rejectConfirm" },
    );

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning/8 p-4">
      <div>
        <h2 className="text-sm font-semibold">{t("dsr.report.title")}</h2>
        <p className="text-xs text-text-muted">{t("dsr.report.hint")}</p>
      </div>
      <TableScroller>
        <table className={tableClass}>
          <thead className={theadClass}>
            <tr>
              <th scope="col" className={thClass}>
                {t("godown.column.product")}
              </th>
              <th scope="col" className={thNum}>
                {t("dsr.report.sheetReturned")}
              </th>
              <th scope="col" className={thNum}>
                {t("dsr.report.reportReturned")}
              </th>
              <th scope="col" className={thNum}>
                {t("dsr.report.sheetDamaged")}
              </th>
              <th scope="col" className={thNum}>
                {t("dsr.report.reportDamaged")}
              </th>
            </tr>
          </thead>
          <tbody>
            {report.lines.map((line) => (
              <tr key={line.productId} className="border-t border-border">
                <td className={tdClass}>{line.productName}</td>
                <td className={tdNum}>{quantity(onSheet(line.productId, "returned"))}</td>
                <td className={`${tdNum} font-semibold`}>{quantity(line.returned)}</td>
                <td className={tdNum}>{quantity(onSheet(line.productId, "damaged"))}</td>
                <td className={`${tdNum} font-semibold`}>{quantity(line.damaged)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroller>
      {action.error ? (
        <p role="alert" className="text-sm text-error">
          {action.error}
        </p>
      ) : null}
      {canDecide ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" disabled={action.busy} onClick={() => run("approve")}>
            {t("dsr.report.approve")}
          </Button>
          <Button disabled={action.busy} onClick={() => run("reject")}>
            {t("dsr.report.reject")}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
