import Link from "next/link";

type Variant = "primary" | "secondary";

const base =
  "inline-flex min-h-(--touch-target) items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50";

const variants: Record<Variant, string> = {
  primary:
    "bg-brand text-brand-foreground shadow-card hover:opacity-90 hover:shadow-raised active:translate-y-px",
  secondary:
    "border border-border bg-surface text-text shadow-card hover:border-border-strong hover:bg-surface-muted",
};

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button type="button" className={`${base} ${variants[variant]} ${className}`} {...props} />
  );
}

export function ButtonLink({
  variant = "secondary",
  className = "",
  ...props
}: React.ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={`${base} ${variants[variant]} ${className}`} {...props} />;
}
