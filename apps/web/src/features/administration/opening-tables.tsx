"use client";

import type { Opening, OpeningIssue } from "@bsd/contracts";
import { formatAmount, t, type TranslationKey } from "@bsd/i18n";
import { useMemo } from "react";
import { StatePanel } from "@/components/state-panel";
import { TableScroller } from "@/components/table-scroller";
import { stickyCell, stickyHead } from "@/components/data-table";
import {
  keyOf,
  piecesOf,
  stockFields,
  type BalanceDraft,
  type BalanceRow,
  type Draft,
  type StockField,
} from "./opening-draft";

function CellInput({
  label,
  value,
  onChange,
  disabled,
  invalid = false,
  wide = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  invalid?: boolean;
  wide?: boolean;
}) {
  return (
    <input
      aria-label={label}
      aria-invalid={invalid || undefined}
      inputMode="decimal"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className={`min-h-9 rounded-md border bg-surface px-2 text-right tabular-nums disabled:bg-surface-muted ${
        wide ? "w-32" : "w-24"
      } ${invalid ? "border-error" : "border-border"}`}
    />
  );
}

/** A blank cell is "not entered yet", not a mistake: shown quietly, never as a red field. */
const BLANK_CODES = new Set(["opening.issue.stockUnknown", "opening.issue.amountUnknown"]);
const isMistake = (issue: OpeningIssue) =>
  issue.severity === "error" && !BLANK_CODES.has(issue.code);
const issueTone = (issue: OpeningIssue) =>
  BLANK_CODES.has(issue.code)
    ? "text-text-subtle"
    : issue.severity === "error"
      ? "text-error"
      : "text-warning";

function issueText(issue: OpeningIssue) {
  return t(issue.code as TranslationKey);
}

export function StockTable({
  view,
  draft,
  locked,
  onChange,
}: {
  view: Opening;
  draft: Draft;
  locked: boolean;
  onChange: (productId: string, field: StockField | "note", value: string) => void;
}) {
  const issuesBy = useMemo(() => {
    const map = new Map<string, OpeningIssue[]>();
    for (const issue of view.issues) {
      if (!issue.productId) continue;
      map.set(issue.productId, [...(map.get(issue.productId) ?? []), issue]);
    }
    return map;
  }, [view.issues]);
  const labels: Record<StockField, string> = {
    cartons: t("opening.cartons"),
    loose: t("opening.loosePieces"),
    unitCost: t("opening.unitCost"),
    salePrice: t("opening.salePrice"),
    orderPrice: t("opening.orderPrice"),
    dueFromCompany: t("opening.dueFromCompany"),
  };

  if (view.stock.length === 0) return <StatePanel title={t("product.empty")} />;
  return (
    <div className="flex flex-col gap-3">
      <TableScroller>
        <table className="w-full border-collapse text-sm">
          <thead className="bg-surface-muted text-left text-xs text-text-muted">
            <tr>
              <th scope="col" className={`px-3 py-3 font-medium ${stickyHead}`}>
                {t("product.name")}
              </th>
              {stockFields.map((f) => (
                <th key={f} scope="col" className="px-3 py-3 text-right font-medium">
                  {labels[f]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {view.stock.map((line) => {
              const d = draft.stock[line.productId];
              const issues = issuesBy.get(line.productId) ?? [];
              const errors = issues.filter(isMistake);
              return (
                <tr key={line.productId} className="border-t border-border align-top">
                  <th scope="row" className={`px-3 py-2 text-left font-medium ${stickyCell}`}>
                    <div>{line.productName}</div>
                    <div className="text-xs font-normal text-text-subtle">
                      {line.sku}
                      {line.piecesPerCarton
                        ? ` · ${t("product.piecesPerCarton")} ${formatAmount(line.piecesPerCarton)}`
                        : ""}
                    </div>
                    {(() => {
                      const total = piecesOf(line, d);
                      return total && total !== "invalid" ? (
                        <div className="text-xs font-normal text-text-muted">
                          {t("opening.totalPieces")}: {formatAmount(total)}
                        </div>
                      ) : null;
                    })()}
                    {issues.map((issue) => (
                      <div
                        key={issue.code}
                        className={`mt-1 text-xs font-normal ${issueTone(issue)}`}
                      >
                        {issueText(issue)}
                      </div>
                    ))}
                  </th>
                  {stockFields.map((f) => (
                    <td key={f} className="px-3 py-2 text-right">
                      <CellInput
                        label={`${line.productName}: ${labels[f]}`}
                        value={d?.[f] ?? ""}
                        disabled={locked}
                        invalid={
                          ((f === "cartons" || f === "loose") && piecesOf(line, d) === "invalid") ||
                          ((f === "cartons" || f === "loose") &&
                            errors.some((e) => e.code.startsWith("opening.issue.stock"))) ||
                          (f === "unitCost" &&
                            errors.some((e) => e.code === "opening.issue.costMissing")) ||
                          (f === "dueFromCompany" &&
                            errors.some((e) => e.code === "opening.issue.dueInvalid"))
                        }
                        onChange={(value) => onChange(line.productId, f, value)}
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroller>
    </div>
  );
}

export function BalanceTable({
  rows,
  view,
  draft,
  locked,
  onChange,
}: {
  rows: BalanceRow[];
  view: Opening;
  draft: Draft;
  locked: boolean;
  onChange: (key: string, field: keyof BalanceDraft, value: string) => void;
}) {
  const issuesOf = (row: BalanceRow) =>
    view.issues.filter(
      (i) =>
        i.kind === row.kind &&
        (i.staffId ?? null) === row.party.staffId &&
        (i.cashAccountId ?? null) === row.party.cashAccountId &&
        (i.shopId ?? null) === row.party.shopId,
    );
  return (
    <TableScroller>
      <table className="w-full border-collapse text-sm">
        <thead className="bg-surface-muted text-left text-xs text-text-muted">
          <tr>
            <th scope="col" className="px-3 py-3 font-medium">
              {t("common.kind")}
            </th>
            <th scope="col" className="px-3 py-3 text-right font-medium">
              {t("opening.amount")}
            </th>
            <th scope="col" className="px-3 py-3 font-medium">
              {t("opening.note")}
            </th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.flatMap((row, index) => {
            const key = keyOf(row.kind, row.party);
            const d = draft.balances[key] ?? { amount: "", note: "" };
            const issues = issuesOf(row);
            const out: React.ReactNode[] = [];
            if (row.group && row.group !== rows[index - 1]?.group) {
              out.push(
                <tr key={`${key}-group`} className="border-t border-border bg-surface-muted/50">
                  <th colSpan={3} scope="rowgroup" className="px-3 py-2 text-left font-semibold">
                    {row.group}
                  </th>
                </tr>,
              );
            }
            out.push(
              <tr key={key} className="border-t border-border align-top">
                <th scope="row" className="px-3 py-2 text-left font-medium">
                  {row.label}
                  {issues.map((issue) => (
                    <div
                      key={issue.code}
                      className={`mt-1 text-xs font-normal ${issueTone(issue)}`}
                    >
                      {issueText(issue)}
                    </div>
                  ))}
                </th>
                <td className="px-3 py-2 text-right">
                  <CellInput
                    label={`${row.group ? `${row.group}: ` : ""}${row.label}`}
                    value={d.amount}
                    disabled={locked}
                    wide
                    invalid={issues.some(isMistake)}
                    onChange={(value) => onChange(key, "amount", value)}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    aria-label={`${row.label}: ${t("opening.note")}`}
                    value={d.note}
                    disabled={locked}
                    onChange={(event) => onChange(key, "note", event.target.value)}
                    className="min-h-9 w-full min-w-40 rounded-md border border-border bg-surface px-2 disabled:bg-surface-muted"
                  />
                </td>
              </tr>,
            );
            return out;
          })}
        </tbody>
      </table>
    </TableScroller>
  );
}
