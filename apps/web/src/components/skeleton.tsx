import { t } from "@bsd/i18n";

/** One placeholder block with a soft light sweep (stilled by prefers-reduced-motion). */
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`relative overflow-hidden rounded-lg bg-surface-hover before:absolute before:inset-0 before:animate-shimmer before:bg-linear-to-r before:from-transparent before:via-text/6 before:to-transparent ${className}`}
    />
  );
}

/** Announces loading once to assistive technology; the placeholders inside stay hidden. */
function Loading({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    <div role="status" className={className}>
      <span className="sr-only">{t("state.loading")}</span>
      {children}
    </div>
  );
}

const range = (n: number) => Array.from({ length: n }, (_, i) => i);
/** Varied text widths so rows don't look like a barcode. */
const nameWidths = ["w-32", "w-24", "w-40", "w-28", "w-36", "w-20"];
const numberWidths = ["w-14", "w-10", "w-16", "w-12"];

/** A list of plain rows, for short lists without columns. */
export function ListSkeleton({
  rows = 5,
  action = false,
  detail = false,
}: {
  rows?: number;
  /** Rows end in a status chip and a button (e.g. the DSR sheet list). */
  action?: boolean;
  /** Rows carry a muted second line under the name (e.g. phone and role). */
  detail?: boolean;
}) {
  return (
    <Loading className="flex flex-col gap-2">
      {range(rows).map((i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3.5 shadow-card"
        >
          <div className="flex flex-col gap-2">
            <Skeleton className={`h-4 ${nameWidths[i % nameWidths.length]}`} />
            {detail ? (
              <Skeleton className={`h-3 ${nameWidths[(i + 2) % nameWidths.length]}`} />
            ) : null}
          </div>
          {action ? (
            <>
              <Skeleton className="h-5 w-14 rounded-full" />
              <Skeleton className="ml-auto h-9 w-24" />
            </>
          ) : (
            <Skeleton className="ml-auto h-4 w-16" />
          )}
        </div>
      ))}
    </Loading>
  );
}

/** Shaped like the app's tables: a header row, a name column and right-aligned figures. */
export function TableSkeleton({
  rows = 6,
  columns = 5,
  title = false,
}: {
  rows?: number;
  columns?: number;
  /** Adds a section heading above the table. */
  title?: boolean;
}) {
  const figures = range(Math.max(columns - 1, 0));
  return (
    <Loading className="flex flex-col gap-3">
      {title ? <Skeleton className="h-4 w-40" /> : null}
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-card">
        <div className="flex items-center gap-6 bg-surface-muted px-4 py-3">
          <Skeleton className="h-3 w-20" />
          {figures.map((c) => (
            <Skeleton key={c} className="ml-auto h-3 w-12" />
          ))}
        </div>
        {range(rows).map((r) => (
          <div key={r} className="flex items-center gap-6 border-t border-border px-4 py-3.5">
            <Skeleton className={`h-4 ${nameWidths[r % nameWidths.length]}`} />
            {figures.map((c) => (
              <Skeleton
                key={c}
                className={`ml-auto h-4 ${numberWidths[(r + c) % numberWidths.length]}`}
              />
            ))}
          </div>
        ))}
      </div>
    </Loading>
  );
}

/** A row of figure tiles like `StatTile`. */
export function StatsSkeleton({ count = 4, title = false }: { count?: number; title?: boolean }) {
  return (
    <Loading className="flex flex-col gap-3">
      {title ? <Skeleton className="h-5 w-36" /> : null}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {range(count).map((i) => (
          <div key={i} className="rounded-xl border border-border bg-surface p-4 shadow-card">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-3 h-6 w-28" />
          </div>
        ))}
      </div>
    </Loading>
  );
}

/** A grid of link cards, like the dashboard's work checklist. */
export function CardGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <Loading className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {range(count).map((i) => (
        <div key={i} className="rounded-xl border border-border bg-surface p-3.5 shadow-card">
          <div className="flex items-center gap-2.5">
            <Skeleton className="size-7 rounded-full" />
            <Skeleton className={`h-4 ${nameWidths[i % nameWidths.length]}`} />
          </div>
          <Skeleton className="mt-3 ml-9.5 h-3 w-20" />
        </div>
      ))}
    </Loading>
  );
}

/** Labelled fields in a card, for forms that load their current values. */
export function FormSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <Loading className="rounded-xl border border-border bg-surface p-5 shadow-card">
      <div className="grid gap-4 sm:grid-cols-2">
        {range(fields).map((i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
      </div>
      <Skeleton className="mt-5 h-10 w-28" />
    </Loading>
  );
}

/** The sidebar while the workspace loads: grouped icon-and-label links. */
export function NavSkeleton() {
  return (
    <Loading className="flex flex-col gap-5">
      {[4, 3, 3].map((items, g) => (
        <div key={g} className="flex flex-col gap-1">
          <Skeleton className="mb-2 ml-3 h-3 w-16" />
          {range(items).map((i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2">
              <Skeleton className="size-4 rounded" />
              <Skeleton className={`h-3.5 ${nameWidths[(g + i) % nameWidths.length]}`} />
            </div>
          ))}
        </div>
      ))}
    </Loading>
  );
}

/** A whole page before anything is known: title, description, optional tabs, then a table. */
export function PageSkeleton({ tabs = 0 }: { tabs?: number }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      {tabs > 0 ? (
        <div className="flex gap-2">
          {range(tabs).map((i) => (
            <Skeleton key={i} className="h-9 w-24" />
          ))}
        </div>
      ) : null}
      <TableSkeleton rows={6} />
    </div>
  );
}

/** Figure tiles above a table: the shape of the month and statement screens. */
export function SummarySkeleton({ stats = 4, rows = 6 }: { stats?: number; rows?: number }) {
  return (
    <div className="flex flex-col gap-6">
      <StatsSkeleton count={stats} />
      <TableSkeleton rows={rows} title />
    </div>
  );
}
