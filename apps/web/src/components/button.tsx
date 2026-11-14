import Link from "next/link";

type Variant = "primary" | "secondary";

const base =
  "inline-flex min-h-(--touch-target) items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-out active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50";

const variants: Record<Variant, string> = {
  primary:
    "bg-brand font-semibold text-brand-foreground shadow-card hover:bg-brand-hover hover:shadow-[0_6px_20px_-6px_var(--action)]",
  secondary:
    "border border-border bg-surface text-text shadow-card hover:border-border-strong hover:bg-surface-hover",
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
