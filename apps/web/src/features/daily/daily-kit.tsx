"use client";

import type { DayView } from "@bsd/contracts";
import { businessDateOf, shiftBusinessDate, toCartonDisplay } from "@bsd/domain";
import { formatAmount, formatBusinessDate, normalizeDigits, t, toBengaliDigits } from "@bsd/i18n";
import { useSyncExternalStore } from "react";
import { Button, ButtonLink } from "@/components/button";
import { DatePicker } from "@/components/date-picker";
import { Icon } from "@/components/icons";
import { QueryError } from "@/components/query-error";
import { TableSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { useDayView } from "@/data/queries";
import { companyHref } from "@/features/shell/navigation";

// ---------------------------------------------------------------- the working date

const listeners = new Set<() => void>();
let workingDate: string | null = null;

const todayDate = () => businessDateOf(new Date());

/**
 * The business date shared by every daily screen in this tab, so moving from the godown to the
 * DSR sheets keeps the same day. Starts at today.
 */
export function useWorkingDate(): [string, (date: string) => void] {
  const date = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => workingDate ?? todayDate(),
    () => workingDate ?? todayDate(),
  );
  const set = (next: string) => {
    workingDate = next;
    listeners.forEach((l) => l());
  };
  return [date, set];
}

export function DateBar({
  date,
  onChange,
  id = "working-date",
}: {
  date: string;
  onChange: (date: string) => void;
  id?: string;
}) {
  const today = todayDate();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        aria-label={t("dashboard.previousDay")}
        title={t("dashboard.previousDay")}
        className="px-2.5"
        onClick={() => onChange(shiftBusinessDate(date, -1))}
      >
        <Icon name="chevronLeft" className="size-4" />
      </Button>
      <DatePicker
        id={id}
        value={date}
        max={today}
        long
        label={t("dashboard.date")}
        onChange={(next) => next && onChange(next)}
      />
      <Button
        aria-label={t("dashboard.nextDay")}
        title={t("dashboard.nextDay")}
        className="px-2.5"
        disabled={date >= today}
        onClick={() => onChange(shiftBusinessDate(date, 1))}
      >
        <Icon name="chevronRight" className="size-4" />
      </Button>
      <Button disabled={date === today} onClick={() => onChange(today)}>
        {t("dashboard.today")}
      </Button>
    </div>
  );
}

export function DateHeading({ date }: { date: string }) {
  return (
    <p className="mb-4 flex items-center gap-2 text-base font-semibold">
      <Icon name="calendar" className="size-4 text-text-muted" />
      {formatBusinessDate(date)}
    </p>
  );
}

// ---------------------------------------------------------------- the opening gate

/**
 * Daily figures exist only from the activated opening's cutoff date (PLAN §7). Renders the day's
 * engine view to `children`, or explains why there is none.
 */
export function DayGate({
  companyId,
  date,
  skeleton = <TableSkeleton rows={8} columns={8} />,
  children,
}: {
  companyId: string;
  date: string;
  /** Placeholder shaped like the page's content while the day view loads. */
  skeleton?: React.ReactNode;
  children: (view: DayView) => React.ReactNode;
}) {
  const view = useDayView(companyId, date);
  if (view.isPending) return skeleton;
  if (view.isError) return <QueryError error={view.error} onRetry={() => void view.refetch()} />;
  const data = view.data;
  if (!data.cutoffDate) {
    return (
      <StatePanel
        tone="warning"
        title={t("daily.noOpening.title")}
        hint={t("daily.noOpening.hint")}
        action={
          <ButtonLink href={companyHref(companyId, "admin/opening")}>
            {t("daily.noOpening.link")}
          </ButtonLink>
        }
      />
    );
  }
  if (date < data.cutoffDate) {
    return (
      <StatePanel
        tone="warning"
        title={t("daily.beforeCutoff.title")}
        hint={`${t("daily.beforeCutoff.hint")} ${formatBusinessDate(data.cutoffDate)}`}
      />
    );
  }
  if (date > todayDate()) return <StatePanel title={t("dashboard.futureDate")} />;
  return children(data);
}

// ---------------------------------------------------------------- inputs and display

export function CellInput({
  label,
  value,
  onChange,
  disabled = false,
  placeholder,
  invalid = false,
  width = "w-20",
  mode = "numeric",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string | undefined;
  invalid?: boolean;
  width?: string;
  mode?: "numeric" | "decimal" | "text";
}) {
  return (
    <input
      aria-label={label}
      aria-invalid={invalid || undefined}
      inputMode={mode === "text" ? undefined : mode}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className={`min-h-9 rounded-md border bg-surface px-2 tabular-nums placeholder:text-text-subtle disabled:bg-surface-muted ${
        mode === "text" ? "" : "text-right"
      } ${width} ${invalid ? "border-error" : "border-border"}`}
    />
  );
}

/** User input with Bangla digits normalised; blank stays blank. */
export const clean = (value: string) => normalizeDigits(value).trim();

/** Pieces as "cartons/pieces" for the product's carton size (display only). */
export function cartonText(pieces: string, piecesPerCarton: string): string {
  if (!/^-?\d+$/.test(pieces) || !/^[1-9]\d*$/.test(piecesPerCarton) || piecesPerCarton === "1") {
    return toBengaliDigits(pieces);
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
  if (text === toBengaliDigits(pieces)) return text;
  const hint = `${t("common.totalPieces")}: ${formatAmount(pieces)} (${t("common.perCarton")} ${toBengaliDigits(piecesPerCarton)})`;
  return (
    <span title={hint} className="cursor-help">
      {text}
    </span>
  );
}

export const money = (value: string | null) => (value === null ? "—" : formatAmount(value));
export const quantity = (value: string) => toBengaliDigits(value);

export { TableScroller } from "@/components/table-scroller";
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

export function StatusChip({ status }: { status: "draft" | "posted" | "reversed" | "none" }) {
  const tone =
    status === "posted"
      ? "border-success/30 bg-success/10 text-success"
      : status === "draft"
        ? "border-brand/30 bg-brand/10 text-brand"
        : status === "reversed"
          ? "border-error/30 bg-error/5 text-error"
          : "border-border bg-surface-muted text-text-muted";
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${tone}`}>
      {t(`daily.status.${status}`)}
    </span>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-8 mb-3 text-sm font-semibold">{children}</h2>;
}
