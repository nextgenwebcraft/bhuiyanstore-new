import type { Company } from "@bsd/contracts";

/** Company logo placeholder: the brand initial on its own theme colors. */
export function CompanyMark({ company, size = "md" }: { company: Company; size?: "md" | "lg" }) {
  const dimensions = size === "lg" ? "size-12 text-xl" : "size-9 text-base";
  return (
    <span
      aria-hidden
      style={{ background: company.theme.primary, color: company.theme.primaryForeground }}
      className={`inline-flex shrink-0 items-center justify-center rounded-md border border-white/40 font-bold ${dimensions}`}
    >
      {company.name.slice(0, 1).toUpperCase()}
    </span>
  );
}
