"use client";

import type { DayView } from "@bsd/contracts";
import {
  cartonFromPiece,
  pieceFromCarton,
  shiftBusinessDate,
  toDecimal,
  todayBusinessDate,
} from "@bsd/domain";
import { formatBusinessDate, formatCount, normalizeDigits, t } from "@bsd/i18n";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/button";
import { tdClass } from "@/components/data-table";
import { DatePicker } from "@/components/date-picker";
import { Icon } from "@/components/icons";
import { QueryError } from "@/components/query-error";
import { TableSkeleton } from "@/components/skeleton";
import { StatePanel } from "@/components/state-panel";
import { useDayView } from "@/data/queries";
import { useToday } from "@/lib/today";
// ---------------------------------------------------------------- the working date

const listeners = new Set<() => void>();
let workingDate: string | null = null;

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
    () => workingDate ?? todayBusinessDate(),
    () => workingDate ?? todayBusinessDate(),
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
  const today = useToday();
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
  const today = useToday();
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
  if (date > today) return <StatePanel title={t("dashboard.futureDate")} />;
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

/** A batch's name: "ব্যাচ n" for an order lot, "অন্যান্য মাল n" for an automatic one (D68). */
export function batchName(batch: { key?: string | undefined; seq: number }): string {
  const auto = batch.key?.startsWith("auto:") ?? false;
  return `${t(auto ? "batch.auto" : "batch.label")} ${formatCount(batch.seq)}`;
}

/** Goods that came without an order at no cost (company free goods, replacements; D49). */
export function isFreeAuto(key: string, costPrice: string | null): boolean {
  return key.startsWith("auto:") && costPrice !== null && toDecimal(costPrice).isZero();
}

// ---------------------------------------------------------------- carton / piece prices (D68)

/** A price entered per carton or per piece; filling one fills the other. */
export type PricePair = { carton: string; piece: string };

const priceText = /^\d+(\.\d+)?$/;

export function pairFromCarton(carton: string, piecesPerCarton: string): PricePair {
  const value = clean(carton);
  return {
    carton,
    piece: priceText.test(value) ? pieceFromCarton(value, piecesPerCarton) : "",
  };
}

export function pairFromPiece(piece: string, piecesPerCarton: string): PricePair {
  const value = clean(piece);
  return {
    carton: priceText.test(value) ? cartonFromPiece(value, piecesPerCarton) : "",
    piece,
  };
}

/** The pair for a stored per-piece price; blank without one. */
export function pairOf(piecePrice: string | null | undefined, piecesPerCarton: string): PricePair {
  if (!piecePrice) return { carton: "", piece: "" };
  return pairFromPiece(toDecimal(piecePrice).toFixed(), piecesPerCarton);
}

/** Two linked cells: price per carton and per piece. */
export function PriceCells({
  label,
  value,
  piecesPerCarton,
  onChange,
  disabled = false,
  invalid = false,
  className = "",
}: {
  label: string;
  value: PricePair;
  piecesPerCarton: string;
  onChange: (value: PricePair) => void;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
}) {
  return (
    <>
      <td className={`${tdClass} text-center ${className}`}>
        <CellInput
          label={`${label} ${t("godown.price.carton")}`}
          placeholder="৳"
          value={value.carton}
          onChange={(carton) => onChange(pairFromCarton(carton, piecesPerCarton))}
          disabled={disabled}
          invalid={invalid}
          mode="decimal"
          width="w-24"
        />
      </td>
      <td className={`${tdClass} text-center`}>
        <CellInput
          label={`${label} ${t("godown.price.piece")}`}
          placeholder="৳"
          value={value.piece}
          onChange={(piece) => onChange(pairFromPiece(piece, piecesPerCarton))}
          disabled={disabled}
          invalid={invalid}
          mode="decimal"
          width="w-24"
        />
      </td>
    </>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-8 mb-3 text-sm font-semibold">{children}</h2>;
}
