"use client";

import { clampDate, monthOf, shiftBusinessDate, shiftMonth } from "@bsd/domain";
import {
  t,
  formatBusinessDate,
  formatCount,
  formatMonth,
  formatShortDate,
  monthNames,
  weekdayNames,
} from "@bsd/i18n";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { monthGrid, presetRange, rangePresets, type DateRange } from "./calendar-math";
import { useToday } from "@/lib/today";
import { Icon } from "./icons";

const sorted = (a: string, b: string): [string, string] => (a <= b ? [a, b] : [b, a]);

// ---------------------------------------------------------------- popover

export type PanelApi = { close: () => void; open: boolean };

function placePanel(trigger: HTMLElement, panel: HTMLElement, align: "start" | "end") {
  const edge = 8;
  const gap = 6;
  const rect = trigger.getBoundingClientRect();
  const width = panel.offsetWidth;
  const height = panel.offsetHeight;
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight;
  let left = align === "end" ? rect.right - width : rect.left;
  left = Math.max(edge, Math.min(left, viewportWidth - width - edge));
  let top = rect.bottom + gap;
  if (top + height > viewportHeight - edge && rect.top - gap - height >= edge) {
    top = rect.top - gap - height;
  }
  panel.style.left = `${left}px`;
  panel.style.top = `${Math.max(edge, top)}px`;
}

/**
 * A trigger button and a panel in the browser's top layer (native popover: light dismiss, Esc,
 * never clipped by a scrolling table), placed under the trigger or above it when there is no room.
 */
export function Popover({
  id,
  label,
  disabled,
  align = "start",
  triggerClassName,
  trigger,
  children,
}: {
  id?: string | undefined;
  label: string;
  disabled?: boolean | undefined;
  align?: "start" | "end";
  triggerClassName: string;
  trigger: React.ReactNode;
  children: (api: PanelApi) => React.ReactNode;
}) {
  const panelId = useId();
  const ownId = useId();
  const triggerId = id ?? ownId;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);

  useEffect(() => {
    const panel = panelRef.current;
    const button = triggerRef.current;
    if (!panel || !button) return;
    const before = (event: Event) => {
      if ((event as ToggleEvent).newState !== "open") return;
      panel.style.visibility = "hidden";
      setSession((s) => s + 1);
    };
    const toggle = (event: Event) => {
      const isOpen = (event as ToggleEvent).newState === "open";
      setOpen(isOpen);
      if (isOpen) {
        placePanel(button, panel, align);
        panel.style.visibility = "";
      }
    };
    panel.addEventListener("beforetoggle", before);
    panel.addEventListener("toggle", toggle);
    return () => {
      panel.removeEventListener("beforetoggle", before);
      panel.removeEventListener("toggle", toggle);
    };
  }, [align]);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const button = triggerRef.current;
    if (!open || !panel || !button) return;
    const reposition = () => placePanel(button, panel, align);
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, session, align]);

  const close = () => {
    document.getElementById(panelId)?.hidePopover();
    document.getElementById(triggerId)?.focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        disabled={disabled}
        popoverTarget={panelId}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        className={triggerClassName}
      >
        {trigger}
      </button>
      <div
        ref={panelRef}
        id={panelId}
        popover="auto"
        role="dialog"
        aria-label={label}
        className="fixed inset-auto m-0 max-w-[calc(100vw-16px)] overflow-hidden rounded-xl border border-border bg-surface p-0 text-text shadow-raised open:animate-pop-in"
      >
        <div key={session}>{children({ close, open })}</div>
      </div>
    </>
  );
}

const triggerBase =
  "inline-flex items-center gap-2 border border-border bg-surface text-left text-sm text-text transition-colors hover:border-border-strong disabled:cursor-not-allowed disabled:bg-surface-muted disabled:opacity-70 aria-expanded:border-brand aria-expanded:ring-2 aria-expanded:ring-brand/15";
const triggerSize = {
  md: "min-h-(--touch-target) rounded-lg px-3",
  sm: "min-h-9 rounded-md px-2",
};

// ---------------------------------------------------------------- calendar pieces

const iconButton =
  "grid size-8 shrink-0 place-items-center rounded-lg text-text-muted transition-colors hover:bg-surface-hover hover:text-text disabled:pointer-events-none disabled:opacity-40";
const selectClass =
  "h-8 cursor-pointer rounded-lg border border-border bg-surface px-2 text-sm font-medium transition-colors hover:border-border-strong";

function MonthHeader({
  month,
  onMonth,
  min,
  max,
  showSelects = true,
  hidePrev = false,
  hideNext = false,
}: {
  month: string;
  onMonth: (month: string) => void;
  min?: string | undefined;
  max?: string | undefined;
  showSelects?: boolean;
  hidePrev?: boolean;
  hideNext?: boolean;
}) {
  const today = useToday();
  const year = Number(month.slice(0, 4));
  const firstYear = Number((min ?? shiftBusinessDate(today, -365 * 10)).slice(0, 4));
  const lastYear = Number((max ?? shiftBusinessDate(today, 365)).slice(0, 4));
  const years = Array.from(
    { length: Math.max(lastYear, year) - Math.min(firstYear, year) + 1 },
    (_, i) => Math.min(firstYear, year) + i,
  );
  const canPrev = !min || shiftMonth(month, -1) >= monthOf(min);
  const canNext = !max || shiftMonth(month, 1) <= monthOf(max);
  const names = monthNames();

  return (
    <div className="flex items-center justify-between gap-1 pb-2">
      <button
        type="button"
        className={`${iconButton} ${hidePrev ? "invisible" : ""}`}
        disabled={!canPrev}
        aria-label={t("date.previousMonth")}
        onClick={() => onMonth(shiftMonth(month, -1))}
      >
        <Icon name="chevronLeft" className="size-4" />
      </button>
      {showSelects ? (
        <div className="flex items-center gap-1.5">
          <select
            aria-label={t("date.month")}
            className={selectClass}
            value={month.slice(5, 7)}
            onChange={(e) => onMonth(`${month.slice(0, 4)}-${e.target.value}`)}
          >
            {names.map((name, i) => (
              <option key={name} value={String(i + 1).padStart(2, "0")}>
                {name}
              </option>
            ))}
          </select>
          <select
            aria-label={t("date.year")}
            className={selectClass}
            value={String(year)}
            onChange={(e) => onMonth(`${e.target.value}-${month.slice(5, 7)}`)}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {formatCount(y)}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p className="text-sm font-semibold">{formatMonth(month)}</p>
      )}
      <button
        type="button"
        className={`${iconButton} ${hideNext ? "invisible" : ""}`}
        disabled={!canNext}
        aria-label={t("date.nextMonth")}
        onClick={() => onMonth(shiftMonth(month, 1))}
      >
        <Icon name="chevronRight" className="size-4" />
      </button>
    </div>
  );
}

type DayLook = { selected: boolean; edge: boolean; middle: boolean };

function DayGrid({
  month,
  focusDate,
  look,
  min,
  max,
  onPick,
  onFocusDate,
  onHover,
  autoFocus,
}: {
  month: string;
  focusDate: string;
  look: (date: string) => DayLook;
  min?: string | undefined;
  max?: string | undefined;
  onPick: (date: string) => void;
  onFocusDate: (date: string) => void;
  onHover?: ((date: string | null) => void) | undefined;
  autoFocus: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const wantFocus = useRef(false);
  const today = useToday();
  const weekdays = weekdayNames();

  useEffect(() => {
    if (autoFocus) wantFocus.current = true;
  }, [autoFocus]);
  useEffect(() => {
    if (!wantFocus.current) return;
    ref.current?.querySelector<HTMLButtonElement>(`[data-date="${focusDate}"]`)?.focus();
  }, [focusDate, month, autoFocus]);

  const move = (event: React.KeyboardEvent, date: string) => {
    const steps: Record<string, () => string> = {
      ArrowLeft: () => shiftBusinessDate(date, -1),
      ArrowRight: () => shiftBusinessDate(date, 1),
      ArrowUp: () => shiftBusinessDate(date, -7),
      ArrowDown: () => shiftBusinessDate(date, 7),
      PageUp: () => `${shiftMonth(monthOf(date), -1)}${date.slice(7)}`,
      PageDown: () => `${shiftMonth(monthOf(date), 1)}${date.slice(7)}`,
    };
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    wantFocus.current = true;
    const next = step();
    // Day 31 shifted into a shorter month falls back to that month's last valid day.
    const valid = new Date(`${next}T00:00:00Z`).toISOString().slice(0, 10) === next;
    onFocusDate(clampDate(valid ? next : shiftBusinessDate(`${next.slice(0, 8)}01`, -1), min, max));
  };

  return (
    <div ref={ref} onMouseLeave={() => onHover?.(null)}>
      <div className="grid grid-cols-7 pb-1">
        {weekdays.map((day, i) => (
          <span
            key={day}
            className={`grid h-7 place-items-center text-[11px] font-medium ${i === 6 ? "text-error/80" : "text-text-muted"}`}
          >
            {day}
          </span>
        ))}
      </div>
      <div role="grid" aria-label={formatMonth(month)} className="grid grid-cols-7 gap-y-0.5">
        {monthGrid(month).map((date) => {
          const outside = monthOf(date) !== month;
          const disabled = (min !== undefined && date < min) || (max !== undefined && date > max);
          const { selected, edge, middle } = look(date);
          const isToday = date === today;
          return (
            <div
              key={date}
              role="gridcell"
              aria-selected={selected}
              className={`relative flex justify-center ${middle ? "bg-brand/10" : ""}`}
            >
              <button
                type="button"
                data-date={date}
                tabIndex={date === focusDate ? 0 : -1}
                disabled={disabled}
                aria-label={formatBusinessDate(date)}
                aria-current={isToday ? "date" : undefined}
                onClick={() => onPick(date)}
                onMouseEnter={() => onHover?.(date)}
                onFocus={() => onHover?.(date)}
                onKeyDown={(e) => move(e, date)}
                className={`relative grid size-9 place-items-center rounded-lg text-[13px] tabular-nums transition-[background-color,color,transform] duration-150 active:scale-95 disabled:pointer-events-none disabled:opacity-30 ${
                  edge
                    ? "bg-brand font-semibold text-brand-foreground shadow-card"
                    : middle
                      ? "text-text hover:bg-brand/15"
                      : outside
                        ? "text-text-subtle hover:bg-surface-hover"
                        : "text-text hover:bg-surface-hover"
                } ${isToday && !edge ? "font-semibold ring-1 ring-brand/40 ring-inset" : ""}`}
              >
                {formatCount(Number(date.slice(8)))}
                {isToday ? (
                  <span
                    aria-hidden
                    className={`absolute bottom-1 size-1 rounded-full ${edge ? "bg-brand-foreground" : "bg-brand"}`}
                  />
                ) : null}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Slides the month in from the side it came from. */
function useMonth(initial: string): [string, (month: string) => void, string] {
  const [state, setState] = useState({ month: initial, anim: "" });
  const set = (month: string) =>
    setState((s) =>
      month === s.month
        ? s
        : { month, anim: month > s.month ? "animate-calendar-next" : "animate-calendar-prev" },
    );
  return [state.month, set, state.anim];
}

const footerButton =
  "inline-flex h-8 items-center rounded-lg px-3 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-40";
const ghostButton = `${footerButton} text-text-muted hover:bg-surface-hover hover:text-text`;
const outlineButton = `${footerButton} border border-border hover:bg-surface-muted`;
const primaryButton = `${footerButton} bg-brand text-brand-foreground shadow-card hover:opacity-90`;

// ---------------------------------------------------------------- single date

function SinglePanel({
  value,
  onChange,
  min,
  max,
  clearable,
  api,
}: {
  value: string;
  onChange: (date: string) => void;
  min?: string | undefined;
  max?: string | undefined;
  clearable: boolean;
  api: PanelApi;
}) {
  const today = useToday();
  const start = value || clampDate(today, min, max);
  const [month, setMonth, anim] = useMonth(monthOf(start));
  const [focusDate, setFocusDate] = useState(start);
  const todayAllowed = clampDate(today, min, max) === today;
  const pick = (date: string) => {
    onChange(date);
    api.close();
  };

  return (
    <div className="w-[19.5rem] max-w-full">
      <div className="p-3 pb-2">
        <MonthHeader month={month} onMonth={setMonth} min={min} max={max} />
        <div key={month} className={anim}>
          <DayGrid
            month={month}
            focusDate={monthOf(focusDate) === month ? focusDate : `${month}-01`}
            look={(date) => ({ selected: date === value, edge: date === value, middle: false })}
            min={min}
            max={max}
            onPick={pick}
            onFocusDate={(date) => {
              setFocusDate(date);
              setMonth(monthOf(date));
            }}
            autoFocus={api.open}
          />
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
        <button
          type="button"
          className={outlineButton}
          disabled={!todayAllowed}
          onClick={() => pick(today)}
        >
          {t("date.today")}
        </button>
        <div className="flex items-center gap-1">
          {clearable && value ? (
            <button type="button" className={ghostButton} onClick={() => pick("")}>
              {t("date.clear")}
            </button>
          ) : null}
          <button type="button" className={primaryButton} onClick={api.close}>
            {t("date.done")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Single business-date picker (YYYY-MM-DD strings) with month/year selects, a Saturday-first
 * Bangla calendar and Today / Clear / Done. `clearable` allows "" (no date).
 */
export function DatePicker({
  id,
  value,
  onChange,
  min,
  max,
  disabled,
  clearable = false,
  label,
  placeholder,
  long = false,
  size = "md",
  align = "start",
  className = "",
}: {
  id?: string | undefined;
  value: string;
  onChange: (date: string) => void;
  min?: string | undefined;
  max?: string | undefined;
  disabled?: boolean | undefined;
  clearable?: boolean;
  label?: string | undefined;
  placeholder?: string | undefined;
  /** Weekday and full month name, for the working-date bar. */
  long?: boolean;
  size?: "md" | "sm";
  align?: "start" | "end";
  className?: string;
}) {
  const text = value ? (long ? formatBusinessDate(value) : formatShortDate(value)) : null;
  return (
    <Popover
      id={id}
      label={`${label ?? t("date.pick")}${text ? `: ${text}` : ""}`}
      disabled={disabled}
      align={align}
      triggerClassName={`${triggerBase} ${triggerSize[size]} ${className}`}
      trigger={
        <>
          <Icon name="calendar" className="size-4 text-text-muted" />
          <span className={`truncate tabular-nums ${text ? "" : "text-text-subtle"}`}>
            {text ?? placeholder ?? t("date.pick")}
          </span>
        </>
      }
    >
      {(api) => (
        <SinglePanel
          value={value}
          onChange={onChange}
          min={min}
          max={max}
          clearable={clearable}
          api={api}
        />
      )}
    </Popover>
  );
}

// ---------------------------------------------------------------- date range

function RangePanel({
  value,
  onChange,
  min,
  max,
  api,
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  min?: string | undefined;
  max?: string | undefined;
  api: PanelApi;
}) {
  const today = useToday();
  const [draft, setDraft] = useState<{ from: string; to: string | null }>(value);
  const [hover, setHover] = useState<string | null>(null);
  const [month, setMonth, anim] = useMonth(
    monthOf(value.from) === monthOf(value.to)
      ? shiftMonth(monthOf(value.to), -1)
      : monthOf(value.from),
  );
  const [focusDate, setFocusDate] = useState(value.from);
  const right = shiftMonth(month, 1);

  const [lo, hi] = draft.to
    ? sorted(draft.from, draft.to)
    : hover
      ? sorted(draft.from, hover)
      : [draft.from, draft.from];
  const look = (date: string): DayLook => ({
    selected: date >= lo && date <= hi,
    edge: date === lo || date === hi,
    middle: date > lo && date < hi,
  });
  const commit = (range: DateRange) => {
    onChange(range);
    api.close();
  };
  const pick = (date: string) => {
    if (draft.to !== null) {
      setDraft({ from: date, to: null });
      return;
    }
    const [from, to] = sorted(draft.from, date);
    commit({ from, to });
  };
  const focusTo = (date: string) => {
    setFocusDate(date);
    const m = monthOf(date);
    if (m < month) setMonth(m);
    else if (m > right) setMonth(shiftMonth(m, -1));
  };
  const presets = rangePresets
    .map((preset) => ({ preset, range: presetRange(preset, today) }))
    .filter(({ range }) => (!max || range.to <= max) && (!min || range.from >= min));
  const grid = (m: string, showPrev: boolean, showNext: boolean, extra = "") => (
    <div className={`w-[17.5rem] ${extra}`}>
      <MonthHeader
        month={m}
        onMonth={(next) => setMonth(m === month ? next : shiftMonth(next, -1))}
        min={min}
        max={max}
        showSelects={false}
        hidePrev={!showPrev}
        hideNext={!showNext}
      />
      <div key={m} className={anim}>
        <DayGrid
          month={m}
          focusDate={monthOf(focusDate) === m ? focusDate : ""}
          look={look}
          min={min}
          max={max}
          onPick={pick}
          onFocusDate={focusTo}
          onHover={draft.to === null ? setHover : undefined}
          autoFocus={api.open && monthOf(focusDate) === m}
        />
      </div>
    </div>
  );

  return (
    <div className="flex max-h-[85vh] flex-col overflow-y-auto sm:flex-row">
      <div className="flex gap-1 overflow-x-auto border-b border-border p-2 sm:w-36 sm:flex-col sm:overflow-visible sm:border-r sm:border-b-0">
        {presets.map(({ preset, range }) => {
          const active = range.from === value.from && range.to === value.to;
          return (
            <button
              key={preset}
              type="button"
              onClick={() => commit(range)}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-left text-[13px] whitespace-nowrap transition-colors ${
                active
                  ? "bg-brand font-medium text-brand-foreground"
                  : "text-text-muted hover:bg-surface-hover hover:text-text"
              }`}
            >
              {t(`date.preset.${preset}`)}
            </button>
          );
        })}
      </div>
      <div className="flex flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <p className="text-sm font-medium">{t("date.pickRange")}</p>
          <p className="text-xs text-text-muted tabular-nums">
            {formatShortDate(lo)}
            {hi !== lo ? ` – ${formatShortDate(hi)}` : ""}
          </p>
        </div>
        <div className="flex gap-6 p-3">
          {grid(month, true, false, "max-md:hidden")}
          {grid(right, false, true, "max-md:hidden")}
          {grid(month, true, true, "md:hidden")}
        </div>
        <p
          className={`border-t border-border px-4 py-2 text-xs text-text-muted transition-opacity ${draft.to === null ? "opacity-100" : "opacity-0"}`}
        >
          {t("date.rangeHint")}
        </p>
      </div>
    </div>
  );
}

/**
 * Report/statement period filter: preset periods beside a two-month calendar (one on phones).
 * The first click starts the range, the second ends it and applies.
 */
export function DateRangePicker({
  value,
  onChange,
  min,
  max,
  label,
  align = "end",
  className = "",
}: {
  value: DateRange;
  onChange: (range: DateRange) => void;
  min?: string | undefined;
  max?: string | undefined;
  label?: string | undefined;
  align?: "start" | "end";
  className?: string;
}) {
  const text =
    value.from === value.to
      ? formatShortDate(value.from)
      : `${formatShortDate(value.from)} – ${formatShortDate(value.to)}`;
  return (
    <Popover
      label={`${label ?? t("date.pickRange")}: ${text}`}
      align={align}
      triggerClassName={`${triggerBase} ${triggerSize.md} ${className}`}
      trigger={
        <>
          <Icon name="calendar" className="size-4 text-text-muted" />
          <span className="truncate tabular-nums">{text}</span>
          <Icon name="chevronDown" className="ml-auto size-3.5 text-text-muted" />
        </>
      }
    >
      {(api) => <RangePanel value={value} onChange={onChange} min={min} max={max} api={api} />}
    </Popover>
  );
}

// ---------------------------------------------------------------- month

function MonthPanel({
  value,
  onChange,
  min,
  max,
  api,
}: {
  value: string;
  onChange: (month: string) => void;
  min?: string | undefined;
  max?: string | undefined;
  api: PanelApi;
}) {
  const current = monthOf(useToday());
  const [year, setYearState] = useState({ year: Number(value.slice(0, 4)), anim: "" });
  const setYear = (next: number) =>
    setYearState((s) => ({
      year: next,
      anim: next > s.year ? "animate-calendar-next" : "animate-calendar-prev",
    }));
  const allowed = (m: string) => (!min || m >= min) && (!max || m <= max);
  const pick = (m: string) => {
    onChange(m);
    api.close();
  };
  const names = monthNames("short");
  const gridRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (api.open) gridRef.current?.querySelector<HTMLButtonElement>("[aria-pressed=true]")?.focus();
  }, [api.open]);

  return (
    <div className="w-[17rem] max-w-full">
      <div className="p-3">
        <div className="flex items-center justify-between pb-2">
          <button
            type="button"
            className={iconButton}
            aria-label={t("date.previousYear")}
            disabled={!!min && year.year - 1 < Number(min.slice(0, 4))}
            onClick={() => setYear(year.year - 1)}
          >
            <Icon name="chevronLeft" className="size-4" />
          </button>
          <p className="text-sm font-semibold tabular-nums">{formatCount(year.year)}</p>
          <button
            type="button"
            className={iconButton}
            aria-label={t("date.nextYear")}
            disabled={!!max && year.year + 1 > Number(max.slice(0, 4))}
            onClick={() => setYear(year.year + 1)}
          >
            <Icon name="chevronRight" className="size-4" />
          </button>
        </div>
        <div ref={gridRef} key={year.year} className={`grid grid-cols-3 gap-1.5 ${year.anim}`}>
          {names.map((name, i) => {
            const m = `${year.year}-${String(i + 1).padStart(2, "0")}`;
            const selected = m === value;
            return (
              <button
                key={m}
                type="button"
                disabled={!allowed(m)}
                aria-pressed={selected}
                aria-label={formatMonth(m)}
                onClick={() => pick(m)}
                className={`h-10 rounded-lg text-[13px] transition-[background-color,transform] duration-150 active:scale-95 disabled:pointer-events-none disabled:opacity-30 ${
                  selected
                    ? "bg-brand font-semibold text-brand-foreground shadow-card"
                    : "hover:bg-surface-hover"
                } ${m === current && !selected ? "font-semibold ring-1 ring-brand/40 ring-inset" : ""}`}
              >
                {name}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-border px-3 py-2">
        <button
          type="button"
          className={outlineButton}
          disabled={!allowed(current)}
          onClick={() => pick(current)}
        >
          {t("date.thisMonth")}
        </button>
        <button type="button" className={primaryButton} onClick={api.close}>
          {t("date.done")}
        </button>
      </div>
    </div>
  );
}

/** Month picker (YYYY-MM) as a year page of twelve months. */
export function MonthPicker({
  id,
  value,
  onChange,
  min,
  max,
  label,
  className = "",
}: {
  id?: string | undefined;
  value: string;
  onChange: (month: string) => void;
  min?: string | undefined;
  max?: string | undefined;
  label?: string | undefined;
  className?: string;
}) {
  return (
    <Popover
      id={id}
      label={`${label ?? t("date.pickMonth")}: ${formatMonth(value)}`}
      triggerClassName={`${triggerBase} ${triggerSize.md} ${className}`}
      trigger={
        <>
          <Icon name="calendar" className="size-4 text-text-muted" />
          <span className="truncate">{formatMonth(value)}</span>
          <Icon name="chevronDown" className="ml-auto size-3.5 text-text-muted" />
        </>
      }
    >
      {(api) => <MonthPanel value={value} onChange={onChange} min={min} max={max} api={api} />}
    </Popover>
  );
}
