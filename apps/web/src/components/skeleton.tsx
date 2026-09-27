import { t } from "@bsd/i18n";

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded bg-border ${className}`} />;
}

/** Loading placeholder for a list or table, announced once to assistive technology. */
export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" className="flex flex-col gap-3">
      <span className="sr-only">{t("state.loading")}</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}
