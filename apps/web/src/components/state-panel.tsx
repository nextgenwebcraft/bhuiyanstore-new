type Tone = "neutral" | "warning" | "error";

const toneClasses: Record<Tone, string> = {
  neutral: "border-border bg-surface",
  warning: "border-warning/30 bg-warning/5",
  error: "border-error/30 bg-error/5",
};

const dotClasses: Record<Tone, string> = {
  neutral: "bg-text-subtle",
  warning: "bg-warning",
  error: "bg-error",
};

/**
 * One component for empty, forbidden, unavailable, not-found and error states (guide section 5.5).
 * Tone is reinforced by the title text, never by color alone.
 */
export function StatePanel({
  title,
  hint,
  tone = "neutral",
  action,
}: {
  title: string;
  hint?: string;
  tone?: Tone;
  action?: React.ReactNode;
}) {
  return (
    <section
      role={tone === "error" ? "alert" : "status"}
      className={`flex flex-col items-start gap-2 rounded-xl border p-5 shadow-card ${toneClasses[tone]}`}
    >
      <h2 className="flex items-center gap-2.5 text-base font-semibold">
        <span aria-hidden className={`size-2 shrink-0 rounded-full ${dotClasses[tone]}`} />
        {title}
      </h2>
      {hint ? <p className="pl-4.5 text-sm text-text-muted">{hint}</p> : null}
      {action ? <div className="mt-1 pl-4.5">{action}</div> : null}
    </section>
  );
}
