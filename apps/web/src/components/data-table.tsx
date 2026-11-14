import { toCartonDisplay } from "@bsd/domain";
import { t, toBengaliDigits, formatAmount, formatCount, formatMoney } from "@bsd/i18n";
import { StatusBadge } from "@/components/status-badge";

export const money = (value: string | null) => formatMoney(value);
export const quantity = (value: number | string) => formatCount(value);

/** The first (product or person) column stays in view while a wide table scrolls sideways. */
export const stickyHead =
  "sticky left-0 z-10 bg-surface-muted shadow-[inset_-1px_0_0_var(--color-border)]";
export const stickyCell =
  "sticky left-0 z-10 bg-surface shadow-[inset_-1px_0_0_var(--color-border)]";
export const tableClass = "w-full border-collapse text-sm";
export const theadClass = "bg-surface-muted text-left text-xs text-text-muted";
export const thClass = "px-3 py-2.5 font-medium";
export const thNum = "px-3 py-2.5 text-right font-medium";
export const tdClass = "px-3 py-2";
export const tdNum = "px-3 py-2 text-right tabular-nums";

/** A numeric column header, with "(cartons/pieces)" under quantity columns. */
export function ColumnHead({
  label,
  quantity = false,
}: {
  label: string;
  quantity?: boolean | undefined;
}) {
  return (
    <th scope="col" className={`${thNum} whitespace-nowrap`}>
      {label}
      {quantity ? (
        <span className="block text-[10.5px] font-normal text-text-subtle">
          {t("common.cartonPiece")}
        </span>
      ) : null}
    </th>
  );
}

export function StatusChip({
  status,
}: {
  status: "draft" | "pending" | "posted" | "reversed" | "none";
}) {
  const tone =
    status === "posted"
      ? "success"
      : status === "draft" || status === "pending"
        ? "brand"
        : status === "reversed"
          ? "error"
          : "muted";
  return <StatusBadge tone={tone}>{t(`daily.status.${status}`)}</StatusBadge>;
}

/** Pieces as "cartons/pieces" for the product's carton size (display only). */
export function cartonText(pieces: string, piecesPerCarton: string): string {
  if (!/^-?\d+$/.test(pieces) || !/^[1-9]\d*$/.test(piecesPerCarton) || piecesPerCarton === "1") {
    return formatCount(pieces);
  }
  const negative = pieces.startsWith("-");
  const { cartons, loosePieces } = toCartonDisplay(
    negative ? pieces.slice(1) : pieces,
    piecesPerCarton,
  );
  return toBengaliDigits(`${negative ? "-" : ""}${cartons}/${loosePieces}`);
}

/** `cartonText` with the total pieces on hover, where a carton holds more than one piece. */
export function CartonQty({
  pieces,
  piecesPerCarton,
}: {
  pieces: string;
  piecesPerCarton: string;
}) {
  const text = cartonText(pieces, piecesPerCarton);
  if (text === formatCount(pieces)) return text;
  const hint = `${t("common.totalPieces")}: ${formatAmount(pieces)} (${t("common.perCarton")} ${toBengaliDigits(piecesPerCarton)})`;
  return (
    <span title={hint} className="cursor-help">
      {text}
    </span>
  );
}

/** What a column needs the actor to see: cost columns and profit columns can be hidden. */
export type ColumnNeeds = "cost" | "profit";

export const columnVisible = (
  needs: ColumnNeeds | undefined,
  view: { canSeeCost: boolean; canSeeProfit: boolean },
) => !needs || (needs === "cost" ? view.canSeeCost : view.canSeeProfit);
