import type { Company } from "@bsd/contracts";

const dimensions = {
  sm: "size-7 rounded-md text-sm",
  md: "size-9 rounded-lg text-base",
  lg: "size-12 rounded-xl text-xl",
} as const;

/** Company logo placeholder: the brand initial on its own theme colors. */
export function CompanyMark({
  company,
  size = "md",
}: {
  company: Company;
  size?: keyof typeof dimensions;
}) {
  return (
    <span
      aria-hidden
      style={{ background: company.theme.primary, color: company.theme.primaryForeground }}
      className={`inline-flex shrink-0 items-center justify-center font-semibold shadow-card ring-1 ring-black/5 ${dimensions[size]}`}
    >
      {company.name.slice(0, 1).toUpperCase()}
    </span>
  );
}
