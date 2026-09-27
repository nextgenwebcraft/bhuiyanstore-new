type Tone = "neutral" | "warning" | "error";

const toneClasses: Record<Tone, string> = {
  neutral: "border-border",
  warning: "border-warning",
  error: "border-error",
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
      className={`flex flex-col items-start gap-2 rounded-lg border border-l-4 bg-surface p-6 ${toneClasses[tone]}`}
    >
      <h2 className="text-lg font-semibold">{title}</h2>
      {hint ? <p className="text-text-muted">{hint}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </section>
  );
}
