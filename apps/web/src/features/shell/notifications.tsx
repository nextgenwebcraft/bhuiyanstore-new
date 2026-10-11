"use client";

import type { EngineWarningDto } from "@bsd/contracts";
import { t, type TranslationKey, formatCount, formatShortDate } from "@bsd/i18n";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Icon } from "@/components/icons";
import { useProducts, useStaff } from "@/data/queries";
import { groupWarnings } from "@/features/daily/warning-groups";
import { useCurrentWorkspace } from "./workspace-context";

type Publish = (source: string, warnings: readonly EngineWarningDto[] | null) => void;

const PublishContext = createContext<Publish | null>(null);
const WarningsContext = createContext<readonly EngineWarningDto[]>([]);

/** Collects the engine warnings of whatever the current page shows for the header bell. */
export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const [sources, setSources] = useState<ReadonlyMap<string, readonly EngineWarningDto[]>>(
    () => new Map(),
  );
  const publish = useCallback<Publish>((source, warnings) => {
    setSources((current) => {
      const next = new Map(current);
      if (warnings && warnings.length > 0) next.set(source, warnings);
      else if (!next.delete(source)) return current;
      return next;
    });
  }, []);
  const warnings = useMemo(() => [...sources.values()].flat(), [sources]);
  return (
    <PublishContext.Provider value={publish}>
      <WarningsContext.Provider value={warnings}>{children}</WarningsContext.Provider>
    </PublishContext.Provider>
  );
}

/** Hands a page's engine warnings to the header bell while the page is mounted; renders nothing. */
export function PageWarnings({ warnings }: { warnings: readonly EngineWarningDto[] }) {
  const publish = useContext(PublishContext);
  const source = useId();
  useEffect(() => {
    publish?.(source, warnings);
    return () => publish?.(source, null);
  }, [publish, source, warnings]);
  return null;
}

const NAMES_SHOWN = 8;

/** Product or people names, the first few in full and the rest as a count. */
function nameList(ids: string[], names: Map<string, string>, unit: TranslationKey): string {
  const known = ids.map((id) => names.get(id)).filter((n): n is string => Boolean(n));
  if (known.length === 0) return `${formatCount(ids.length)} ${t(unit)}`;
  const shown = known.slice(0, NAMES_SHOWN).join(", ");
  const rest = ids.length - Math.min(known.length, NAMES_SHOWN);
  return rest > 0 ? `${shown} ${t("warning.andMore")} ${formatCount(rest)}` : shown;
}

/** The engine's warnings, one line per kind with the days and the products or people affected. */
function WarningList({ warnings }: { warnings: readonly EngineWarningDto[] }) {
  const { company } = useCurrentWorkspace();
  const products = useProducts(company.id);
  const staff = useStaff(company.id);
  const productNames = new Map((products.data ?? []).map((p) => [p.id, p.name]));
  const staffNames = new Map((staff.data ?? []).map((s) => [s.id, s.name]));
  const groups = groupWarnings(warnings);

  if (groups.length === 0) {
    return (
      <p className="px-2 py-4 text-center text-sm text-text-muted">{t("notifications.empty")}</p>
    );
  }
  return (
    <ul className="flex flex-col gap-2.5">
      {groups.map((g) => (
        <li key={g.code} className="flex gap-2.5 rounded-lg px-2 py-1.5 text-sm">
          <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-warning" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">{t(`warning.${g.code}` as TranslationKey)}</span>
              <span className="text-xs text-text-muted tabular-nums">
                {formatCount(g.days)} {t("warning.days")}
                {g.days > 1
                  ? ` · ${formatShortDate(g.firstDate)} – ${formatShortDate(g.lastDate)}`
                  : ` · ${formatShortDate(g.firstDate)}`}
              </span>
            </div>
            {g.productIds.length > 0 ? (
              <p className="mt-0.5 text-text-muted">
                {nameList(g.productIds, productNames, "warning.products")}
              </p>
            ) : null}
            {g.staffIds.length > 0 ? (
              <p className="mt-0.5 text-text-muted">
                {nameList(g.staffIds, staffNames, "warning.people")}
              </p>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Header bell: a badge with the number of warning kinds and a panel listing them. */
export function NotificationBell() {
  const warnings = useContext(WarningsContext);
  const kinds = useMemo(() => new Set(warnings.map((w) => w.code)).size, [warnings]);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={t("notifications.open")}
        title={t("day.warnings")}
        onClick={() => setOpen((value) => !value)}
        className={`relative inline-flex size-10 items-center justify-center rounded-lg transition-colors hover:bg-surface-hover hover:text-text ${
          open ? "bg-surface-hover text-text" : "text-text-muted"
        }`}
      >
        <Icon name="bell" />
        {kinds > 0 ? (
          <span className="absolute top-1 right-1 inline-flex min-w-4.5 items-center justify-center rounded-full bg-warning px-1 text-[10px] leading-4.5 font-semibold text-surface tabular-nums">
            {formatCount(kinds)}
          </span>
        ) : null}
      </button>
      <span role="status" className="sr-only">
        {kinds > 0 ? `${t("day.warnings")}: ${formatCount(kinds)}` : ""}
      </span>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label={t("day.warnings")}
          className="absolute top-full right-0 z-40 mt-1.5 flex max-h-[70vh] w-[min(24rem,calc(100vw-2rem))] flex-col rounded-xl border border-border bg-surface p-1.5 shadow-raised"
        >
          <p className="px-2 pt-1 pb-1.5 text-[11px] font-semibold tracking-wider text-text-muted">
            {t("day.warnings")}
          </p>
          <div className="min-h-0 overflow-y-auto">
            <WarningList warnings={warnings} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
