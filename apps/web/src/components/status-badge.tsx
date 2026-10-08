export type BadgeTone = "success" | "brand" | "error" | "muted";

const TONE_CLASS: Record<BadgeTone, string> = {
  success: "border-success/30 bg-success/10 text-success",
  brand: "border-brand/30 bg-brand/10 text-brand",
  error: "border-error/30 bg-error/10 text-error",
  muted: "border-border bg-surface-muted text-text-muted",
};

/** A document or period status: done = success, in progress = brand, reversed = error. */
export function StatusBadge({ tone, children }: { tone: BadgeTone; children: React.ReactNode }) {
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}
