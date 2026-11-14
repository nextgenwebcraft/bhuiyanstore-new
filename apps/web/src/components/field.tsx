export const inputClass =
  "min-h-(--touch-target) w-full rounded-lg border border-border bg-surface px-3 text-text transition-colors placeholder:text-text-subtle hover:border-border-strong focus:border-brand";

/** Label + control + field error, so every form renders validation the same way (guide 5.5). */
export function Field({
  id,
  label,
  error,
  hint,
  children,
  className = "",
}: {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1 text-sm text-text-muted">{hint}</p> : null}
      {error ? (
        <p className="mt-1 text-sm text-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
